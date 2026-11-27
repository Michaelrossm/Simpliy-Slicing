//! Schreibt ein Projekt im 3MF-Format von PrusaSlicer 3.0 (alpha15).
//! Aufbau an der echten Engine geprueft: `volume_settings` ist Pflicht, sonst stuerzt der Lader ab.
use crate::mesh::Mesh;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{collections::BTreeMap, fmt::Write as _, io::{Seek, Write}};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub config: Value,
    /// Schluessel, deren Ankunft in der Engine kontrolliert wird.
    #[serde(default)]
    pub applied: Vec<String>,
    pub models: Vec<Model>,
    /// Daraus baut Rust vor dem Slicen die Stuetzen.
    #[serde(default)]
    pub support_plate: Option<crate::supports::Plate>,
    #[serde(default)]
    pub disable_weak_retry: bool,
    /// Einstellungsuebersicht von Simpliy fuer den G-Code-Kopf: (Name, Wert).
    #[serde(default)]
    pub summary: Vec<(String, String)>,
    /// Exakte Simpliy-Konfiguration als Kommentarzeilen (Base64), damit sie aus dem G-Code zurueckgeholt werden kann.
    #[serde(default)]
    pub restore: Vec<String>,
    /// Zusaetzliche Luefter (M106 P<n>) mit Sollwerten pro Schicht.
    #[serde(default)]
    pub fans: Vec<crate::fans::Fan>,
    /// Temperatur-Sollwerte ab Schicht 3 (Extruder, Bett, Bauraum).
    #[serde(default)]
    pub temps: crate::temps::Setpoints,
    /// Prozesse mit Z-Bereich: je Zone ein eigener Slice des ganzen Bauteils, danach zusammengesetzt.
    #[serde(default)]
    pub parts: Vec<Part>,
    /// Zonenwerte, die nach dem gemeinsamen nativen Slicing im G-Code gesetzt werden (Temperatur, Bett, Lüfter, Geschwindigkeiten).
    #[serde(default)]
    pub zone_post: crate::zonepost::ZonePost,
}

#[derive(Clone, Deserialize)]
pub struct Part {
    pub job: Box<Job>,
    pub zone: crate::zones::Zone,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    /// Verbindet das Modell mit seinen Stuetzen.
    #[serde(default)]
    pub id: Option<String>,
    pub path: String,
    #[serde(default)]
    pub inline: Option<Inline>,
    pub name: String,
    pub matrix: [f64; 12],
    pub signature: Option<u32>,
    #[serde(default)]
    pub paint: Paint,
    #[serde(default)]
    pub volumes: Vec<Volume>,
    #[serde(default)]
    pub ranges: Vec<Range>,
    #[serde(default)]
    pub settings: Map<String, Value>,
}

/// Netz direkt im Auftrag, schon in Bettlage. Nicht zentrieren.
#[derive(Clone, Deserialize)]
pub struct Inline {
    pub vertices: Vec<[f32; 3]>,
    pub triangles: Vec<[u32; 3]>,
}

impl Inline {
    pub fn mesh(&self) -> Result<Mesh, String> {
        let count = self.vertices.len() as u32;
        if self.triangles.is_empty()
            || self.triangles.len() > crate::mesh::MAX_TRIANGLES
            || self.triangles.iter().flatten().any(|i| *i >= count)
            || self.vertices.iter().flatten().any(|v| !v.is_finite())
        {
            return Err("Stützkörper ist beschädigt".into());
        }
        Ok(Mesh { vertices: self.vertices.clone(), triangles: self.triangles.clone() })
    }
}

#[derive(Clone, Deserialize, Default)]
pub struct Paint {
    #[serde(default)]
    pub support: BTreeMap<u32, String>,
    #[serde(default)]
    pub seam: BTreeMap<u32, String>,
    #[serde(default)]
    pub fuzzy: BTreeMap<u32, String>,
    #[serde(default)]
    pub color: BTreeMap<u32, String>,
}

impl Paint {
    fn layers(&self) -> [(&'static str, &BTreeMap<u32, String>); 4] {
        [
            ("mmSegmentationFacets", &self.color),
            ("supportedFacets", &self.support),
            ("seamFacets", &self.seam),
            ("fuzzySkinFacets", &self.fuzzy),
        ]
    }

    pub fn is_empty(&self) -> bool {
        self.layers().iter().all(|(_, layer)| layer.is_empty())
    }
}

#[derive(Clone, Deserialize)]
pub struct Volume {
    pub kind: VolumeKind,
    pub vertices: Vec<[f32; 3]>,
    pub triangles: Vec<[u32; 3]>,
    #[serde(default)]
    pub settings: Map<String, Value>,
}

#[derive(Deserialize, Clone, Copy, Debug)]
pub enum VolumeKind {
    ModelPart,
    NegativeVolume,
    ParameterModifier,
    SupportBlocker,
    SupportEnforcer,
}

#[derive(Deserialize, Clone)]
pub struct Range {
    pub from: f64,
    pub to: f64,
    pub height: f64,
    /// Native VolumeSettings for this height range. Older projects omit this field.
    #[serde(default)]
    pub settings: Map<String, Value>,
}

impl Range {
    pub fn height_only(&self) -> Self {
        Self { from: self.from, to: self.to, height: self.height, settings: Map::new() }
    }
    fn configuration(&self) -> Value {
        let mut configuration = self.settings.clone();
        configuration.insert("layer_height".into(), json!(self.height));
        Value::Object(configuration)
    }
}

/// Alpha15 uses Domain::VolumeSettings for ranges, not ObjectSettings.
/// Validate the same catalog classification on the Rust boundary as in the frontend.
fn native_range_keys() -> &'static std::collections::HashSet<String> {
    static KEYS: std::sync::OnceLock<std::collections::HashSet<String>> = std::sync::OnceLock::new();
    KEYS.get_or_init(|| {
        let catalog: Value = serde_json::from_str(include_str!("../../frontend/engine-catalog.json"))
            .expect("Simpliy engine catalog invalid");
        catalog.as_array().expect("Simpliy engine catalog not an array").iter().filter_map(|item| {
            let key = item["key"].as_str()?;
            (item["box"] == "print" && item["perVolume"] == true &&
             key != "layer_height" && key != "first_layer_height" && key != "post_process" &&
             !key.starts_with("support_") && !key.starts_with("raft_")).then(|| key.to_owned())
        }).collect()
    })
}

const CONTENT_TYPES: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="json" ContentType="application/json"/></Types>"#;
const RELATIONSHIPS: &str = r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/><Relationship Target="/Metadata/PrusaSlicer3_project.json" Id="rel-2" Type="http://schemas.prusa3d.cz/package/2024/relationships/metadata/projectfile"/></Relationships>"#;

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

fn write_mesh(xml: &mut String, id: u32, vertices: &[[f32; 3]], triangles: &[[u32; 3]]) {
    let _ = write!(xml, "<object id=\"{id}\"><mesh><vertices>");
    for [x, y, z] in vertices {
        let _ = write!(xml, "<vertex x=\"{x}\" y=\"{y}\" z=\"{z}\"/>");
    }
    xml.push_str("</vertices><triangles>");
    for [a, b, c] in triangles {
        let _ = write!(xml, "<triangle v1=\"{a}\" v2=\"{b}\" v3=\"{c}\"/>");
    }
    xml.push_str("</triangles></mesh></object>");
}

fn volume_settings(extra: &Map<String, Value>) -> Value {
    let mut settings = Map::new();
    settings.insert("wipe_into_infill".into(), json!(false));
    settings.extend(extra.clone());
    Value::Object(settings)
}

pub fn validate(model: &Model, mesh: &Mesh) -> Result<(), String> {
    let fail = |what: &str| Err(format!("{}: {what}", model.name));
    if model.matrix.iter().any(|v| !v.is_finite()) {
        return fail("ungültige Position");
    }
    if !model.paint.is_empty() {
        if model.signature != Some(mesh.signature()) {
            return fail("Die Datei wurde nach dem Anmalen geändert. Bitte Bemalung löschen und neu anmalen.");
        }
        for (_, layer) in model.paint.layers() {
            for (triangle, code) in layer {
                let valid = !code.is_empty()
                    && code.len() <= 400_000
                    && code.bytes().all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b));
                if *triangle as usize >= mesh.triangles.len() || !valid {
                    return fail("Bemalung ist beschädigt");
                }
            }
        }
    }
    for volume in &model.volumes {
        let count = volume.vertices.len() as u32;
        if volume.triangles.iter().flatten().any(|i| *i >= count) || volume.vertices.iter().flatten().any(|v| !v.is_finite()) {
            return fail("Zusatzkörper ist beschädigt");
        }
    }
    let mut ranges: Vec<&Range> = model.ranges.iter().collect();
    ranges.sort_by(|a, b| a.from.total_cmp(&b.from));
    if ranges.iter().any(|r| !(r.from.is_finite() && r.to.is_finite() && r.height.is_finite() && r.from >= 0.0 && r.to > r.from && r.height > 0.0)) {
        return fail("ungültiger Schichthöhenbereich");
    }
    for range in &ranges {
        if let Some(key) = range.settings.keys().find(|key| !native_range_keys().contains(*key)) {
            return Err(format!("{}: unzulässiger nativer Zonen-Parameter: {key}", model.name));
        }
        if range.settings.values().any(Value::is_null) {
            return fail("leerer nativer Zonen-Parameter");
        }
    }
    if ranges.windows(2).any(|pair| pair[1].from < pair[0].to) {
        return fail("Schichthöhenbereiche überlappen sich");
    }
    Ok(())
}

pub fn write<W: Write + Seek>(target: W, job: &Job, meshes: &[Mesh]) -> Result<(), String> {
    if job.models.is_empty() || job.models.len() != meshes.len() {
        return Err("Keine Modelle zum Slicen".into());
    }
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><model unit=\"millimeter\" xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\"><resources>",
    );
    let mut build = String::new();
    let mut objects = Vec::new();
    let mut annotations = Vec::new();
    let mut next_id = 1u32;

    for (model, mesh) in job.models.iter().zip(meshes) {
        validate(model, mesh)?;
        let name = escape(&model.name);

        write_mesh(&mut xml, next_id, &mesh.vertices, &mesh.triangles);
        let part = next_id + 1;
        let _ = write!(xml, "<object id=\"{part}\" name=\"{name}\"><components><component objectid=\"{next_id}\"/></components></object>");
        next_id += 2;
        let mut volumes = vec![json!({"id": part, "type": "ModelPart", "volume_settings": volume_settings(&Map::new())})];
        let mut components = format!("<component objectid=\"{part}\"/>");

        for volume in &model.volumes {
            write_mesh(&mut xml, next_id, &volume.vertices, &volume.triangles);
            let id = next_id + 1;
            let _ = write!(xml, "<object id=\"{id}\" name=\"{:?}\"><components><component objectid=\"{next_id}\"/></components></object>", volume.kind);
            next_id += 2;
            let _ = write!(components, "<component objectid=\"{id}\"/>");
            volumes.push(json!({"id": id, "type": format!("{:?}", volume.kind), "volume_settings": volume_settings(&volume.settings)}));
        }

        let object = next_id;
        next_id += 1;
        let _ = write!(xml, "<object id=\"{object}\" name=\"{name}\"><components>{components}</components></object>");
        let matrix: Vec<String> = model.matrix.iter().map(|v| v.to_string()).collect();
        let _ = write!(build, "<item objectid=\"{object}\" transform=\"{}\"/>", matrix.join(" "));

        let mut entry = json!({"id": object, "volumes": volumes});
        if !model.settings.is_empty() {
            entry["object_settings"] = Value::Object(model.settings.clone());
        }
        if !model.ranges.is_empty() {
            entry["ranges"] = model
                .ranges
                .iter()
                .map(|r| json!({"zRange": [r.from, r.to], "configuration": r.configuration()}))
                .collect();
        }
        objects.push(entry);

        if !model.paint.is_empty() {
            let mut row = json!({"id": part});
            for (key, layer) in model.paint.layers() {
                if layer.is_empty() {
                    continue;
                }
                row[key] = layer.iter().map(|(t, code)| json!({"triangle": t, "dividing": code})).collect();
                row[format!("{key}Version")] = json!(1);
            }
            annotations.push(row);
        }
    }
    let _ = write!(xml, "</resources><build>{build}</build></model>");

    let mut container = job.config.clone();
    if !container["configuration"].is_object() || !container["preset"].is_object() {
        return Err("Engine-Konfiguration unvollständig".into());
    }
    container["beds"] = json!([{"position_x": 0.0, "position_y": 0.0, "wipe_tower": null, "custom_gcode": null}]);
    let project = json!({
        "objects": objects,
        "project": {"id": "5b0f3a52-6c1e-4a53-9d39-3f5c6b0a2e11", "version": 1},
        "config_containers": [container],
    });

    let mut files = vec![
        ("[Content_Types].xml", CONTENT_TYPES.as_bytes().to_vec()),
        ("_rels/.rels", RELATIONSHIPS.as_bytes().to_vec()),
        ("3D/3dmodel.model", xml.into_bytes()),
        ("Metadata/PrusaSlicer3_project.json", serde_json::to_vec(&project).map_err(|e| e.to_string())?),
    ];
    if !annotations.is_empty() {
        files.push(("Metadata/Slic3r_facets_annotation.json", serde_json::to_vec(&annotations).map_err(|e| e.to_string())?));
    }

    let mut zip = ZipWriter::new(target);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, data) in files {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mesh() -> Mesh {
        Mesh { vertices: vec![[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], triangles: vec![[0, 1, 2]] }
    }

    fn model(extra: Value) -> Model {
        let mut base = json!({"path": "a.stl", "name": "a", "matrix": [1,0,0,0,1,0,0,0,1,0,0,0]});
        base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn paint_needs_matching_mesh_and_valid_codes() {
        let sig = mesh().signature();
        assert!(validate(&model(json!({"signature": sig, "paint": {"seam": {"0": "4"}}})), &mesh()).is_ok());
        assert!(validate(&model(json!({"signature": sig ^ 1, "paint": {"seam": {"0": "4"}}})), &mesh()).is_err());
        assert!(validate(&model(json!({"signature": sig, "paint": {"seam": {"9": "4"}}})), &mesh()).is_err());
        assert!(validate(&model(json!({"signature": sig, "paint": {"seam": {"0": "x"}}})), &mesh()).is_err());
    }

    #[test]
    fn overlapping_ranges_are_rejected() {
        let ranges = json!({"ranges": [{"from": 0, "to": 5, "height": 0.1}, {"from": 4, "to": 8, "height": 0.2}]});
        assert!(validate(&model(ranges), &mesh()).is_err());
    }

    #[test]
    fn native_range_configuration_and_support_height_only() {
        let m = model(json!({"ranges":[{"from": 1.0, "to": 5.0, "height": 0.1, "settings":{"perimeters":4,"fill_density":{"value":70,"is_percent":true}}}]}));
        assert!(validate(&m, &mesh()).is_ok());
        let r = &m.ranges[0];
        assert_eq!(r.configuration()["layer_height"], json!(0.1));
        assert_eq!(r.configuration()["perimeters"], json!(4));
        assert_eq!(r.height_only().configuration(), json!({"layer_height":0.1}));
        let invalid = model(json!({"ranges":[{"from": 0.0, "to": 4.0, "height": 0.2, "settings":{"post_process":"unsafe"}}]}));
        assert!(validate(&invalid, &mesh()).is_err());
    }

    #[test]
    fn names_cannot_inject_xml() {
        assert_eq!(escape("a\"><object>&"), "a&quot;&gt;&lt;object&gt;&amp;");
    }
}
