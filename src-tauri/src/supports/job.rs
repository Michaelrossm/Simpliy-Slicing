//! Stuetzen in den Auftrag fuer die Engine. Pfeiler und Mini baut Prusa aus Erzwingern,
//! die Formen werden eigene Objekte mit Stuetzen-Druckweise.
use super::{
    generate,
    inspect::Check,
    input::{world_of, Item, ModelInput},
    meshes::{boxes_mesh, pillar_mesh, Pillar, Triangles},
    plan::{self, absolute, is_percent, plain, ModelPlan},
};
use crate::{mesh::Mesh, project};
use serde_json::{json, Map, Value};
use std::{collections::HashMap, f64::consts::PI, sync::Arc};

#[derive(Default)]
pub struct Prepared {
    pub checks: Vec<Check>,
    pub notes: Vec<String>,
    pub problems: Vec<String>,
    automatic_trials: Vec<AutomaticTrial>,
}

struct AutomaticTrial {
    model_index: usize,
    volume_count: usize,
    safe_settings: Map<String, Value>,
}

impl Prepared {
    pub fn has_automatic_trial(&self) -> bool { !self.automatic_trials.is_empty() }
    pub fn use_safe_fallback(&self, job: &mut project::Job) {
        for trial in &self.automatic_trials {
            let model = &mut job.models[trial.model_index];
            model.volumes.truncate(trial.volume_count);
            model.settings = trial.safe_settings.clone();
        }
    }
}

pub type LoadMesh<'a> = dyn Fn(&str) -> Result<Arc<Mesh>, String> + 'a;

/// Ergaenzt den Auftrag. Bei Problemen bleibt er unbrauchbar, der Aufrufer bricht dann ab.
pub fn expand(job: &mut project::Job, load: &LoadMesh) -> Result<Prepared, String> {
    let mut out = Prepared::default();
    let Some(plate) = job.support_plate.take() else { return Ok(out) };
    let loaded: Vec<(ModelInput, Arc<Mesh>)> =
        plate.models.into_iter().map(|input| load(&input.path).map(|mesh| (input, mesh))).collect::<Result<_, _>>()?;
    let items: Vec<Item> = loaded.into_iter().map(|(input, mesh)| Item::new(input, mesh, plate.bed)).collect::<Result<_, _>>()?;
    if !items.iter().any(|item| has_stored(&item.input.stored)) {
        return Ok(out);
    }
    let plans = plan::plate(&items)?;
    let names: HashMap<String, usize> =
        job.models.iter().enumerate().filter_map(|(i, model)| model.id.clone().map(|id| (id, i))).collect();

    let mut bodies = Vec::new();
    for (item, plan) in items.iter().zip(plans.iter()) {
        if !has_stored(&item.input.stored) {
            continue;
        }
        let &at = names.get(&item.input.id).ok_or("Modell fehlt im Auftrag")?;
        let name = job.models[at].name.clone();
        match supports_of(item, plan, &job.models[at], plate.tools) {
            Ok(made) => {
                let model = &mut job.models[at];
                let original_settings = model.settings.clone();
                model.volumes.extend(made.volumes);
                model.settings.extend(made.settings);
                let everywhere = item.input.resolved.get("support_material").and_then(Value::as_str) == Some("everywhere");
                if everywhere && made.body.is_some() {
                    if let Some(blockers) = automatic_blockers(item, plan) {
                        let trial = AutomaticTrial { model_index: at, volume_count: model.volumes.len(), safe_settings: model.settings.clone() };
                        model.volumes.extend(blockers);
                        model.settings.insert("support_material".into(), json!("everywhere"));
                        for key in ["support_material_threshold", "support_material_buildplate_only"] {
                            if let Some(value) = original_settings.get(key).or_else(|| item.input.resolved.get(key)) { model.settings.insert(key.into(), value.clone()); }
                            else { model.settings.remove(key); }
                        }
                        out.automatic_trials.push(trial);
                    }
                }
                out.checks.extend(made.checks);
                let tried = out.automatic_trials.last().is_some_and(|trial| trial.model_index == at);
                out.notes.extend(made.notes.into_iter().filter(|note| !(tried && note.starts_with("automatische Prusa-St?tzen sind"))).map(|note| format!("{name}: {note}")));
                if tried { out.notes.push(format!("{name}: automatische Prusa-St?tzen werden mit Schutzbereichen versucht und nach dem Slicen gepr?ft")); }
                bodies.extend(made.body);
            }
            Err(error) => out.problems.push(format!("{name}: {error}")),
        }
    }
    if bodies.is_empty() {
        return Ok(out);
    }

    let on = |key: &str| {
        let boxes = job.config["configuration"].as_object();
        boxes.and_then(|b| b.values().find_map(|values| values.get(key))) == Some(&json!(true))
    };
    if on("complete_objects") {
        out.problems.push("Baum, Fächer und Knotenblech gehen nicht mit „Objekte einzeln drucken“.".into());
    }
    if on("spiral_vase") {
        out.problems.push("Eigene Stützen gehen nicht mit Vasenmodus.".into());
    }
    // Nur Kommentare. Daran erkennt Simpliy die Stuetzkoerper im G-Code und kennzeichnet sie als Stuetze.
    let mut labelled = false;
    if let Some(boxes) = job.config.get_mut("configuration").and_then(Value::as_object_mut) {
        for values in boxes.values_mut() {
            let Some(value) = values.get_mut("gcode_label_objects") else { continue };
            if !matches!(value.as_str(), Some("octoprint" | "firmware")) {
                *value = json!("octoprint");
            }
            labelled = true;
            break;
        }
    }
    if !labelled {
        out.problems.push("Die Engine kann Stützkörper nicht kennzeichnen.".into());
    }
    job.models.extend(bodies);
    Ok(out)
}

/// Mark only weak on-model pillar contacts in a temporary clone of the job.
/// The stored workspace is never touched; the result is accepted only after reslicing.
pub fn retry_weak_as_native(job: &mut project::Job, weak: &[[f64; 3]]) -> usize {
    let Some(plate)=job.support_plate.as_mut() else {return 0};
    let mut changed=0;
    for input in &mut plate.models {
        let aligned=super::input::aligned(input);
        let ids: std::collections::HashSet<String>=aligned.all().into_iter()
            .filter(|p| super::types::is_column(p) && weak.iter().any(|q|
                (p.x-q[0]).abs()<0.05 && (p.y-q[1]).abs()<0.05 && (p.surface_z-q[2]).abs()<0.05))
            .map(|p|p.id).collect();
        for key in ["automatic","manual"] {
            if let Some(list)=input.stored.get_mut(key).and_then(Value::as_array_mut) {
                for value in list {
                    if value.get("id").and_then(Value::as_str).is_some_and(|id|ids.contains(id)) {
                        if let Some(row)=value.as_object_mut() { row.insert("__internal_retry_native".into(),json!(true)); changed+=1; }
                    }
                }
            }
        }
    }
    changed
}

fn has_stored(stored: &Value) -> bool {
    stored_count(stored) > 0
}

fn stored_count(stored: &Value) -> usize {
    ["automatic", "manual"].iter().map(|key| stored.get(*key).and_then(Value::as_array).map_or(0, Vec::len)).sum()
}

struct Made {
    volumes: Vec<project::Volume>,
    settings: Map<String, Value>,
    checks: Vec<Check>,
    notes: Vec<String>,
    body: Option<project::Model>,
}

fn supports_of(item: &Item, plan: &ModelPlan, model: &project::Model, tools: usize) -> Result<Made, String> {
    let resolved = &item.input.resolved;
    let get = |key: &str| resolved.get(key);
    let gap = plain(get("support_material_contact_distance"))
        .filter(|gap| *gap >= 0.0)
        .ok_or("Kontaktabstand im Prozess ist ungültig.")?;
    let layer = plain(get("layer_height")).filter(|layer| *layer > 0.0).ok_or("Schichthöhe im Prozess ist ungültig.")?;
    if item.stale {
        return Err("Stützen sind veraltet. Bitte neu erzeugen.".into());
    }
    if item.data.incomplete {
        return Err("Zu viele Stützen, die Erzeugung wurde begrenzt. Bitte die Pfeiler-Auflösung vergrößern und neu erzeugen.".into());
    }
    if stored_count(&item.input.stored) != item.data.count() {
        return Err("Stützdaten sind beschädigt. Bitte neu erzeugen.".into());
    }
    let thickest = item.input.range_heights.iter().map(|h| plain(Some(h)).unwrap_or(0.0)).fold(layer, f64::max);
    let (volumes, targets) = enforcers(item, plan, thickest)?;

    let layers = plain(get("support_material_interface_layers")).unwrap_or(0.0);
    let everywhere = get("support_material").and_then(Value::as_str) == Some("everywhere");
    let has_body = !plan.body.is_empty() || !plan.solids.is_empty() || !plan.pads.is_empty() || !plan.strips.is_empty() || !plan.lines.is_empty();
    // Automatische Stuetzen wuerden quer durch die eigenen Aeste gedruckt.
    let automatic = everywhere && !has_body;
    let mut settings = Map::new();
    if !targets.is_empty() || everywhere {
        settings.insert("support_material".into(), json!(if automatic { "everywhere" } else { "enforcers_only" }));
    }
    let mut branched = false;
    if !targets.is_empty() {
        let wanted = if item.data.settings.build == "process" {
            get("support_material_style").and_then(Value::as_str).unwrap_or("snug")
        } else {
            "snug"
        };
        let style = if has_body && wanted == "organic" { "snug" } else { wanted };
        branched = style == "organic";
        settings.insert("support_material_style".into(), json!(style));
        if !automatic {
            // Ohne automatische Suche bestimmt die Schwelle nur noch den seitlichen Beschnitt des Kontakts.
            // Mit 89 Grad bleibt auch der schmale Kontakt an steilen Schraegen stehen.
            settings.insert("support_material_threshold".into(), json!(89));
            settings.insert("support_material_buildplate_only".into(), json!(false));
        }
        if layers <= 0.0 {
            settings.insert("support_material_interface_layers".into(), json!(2));
        }
        // Der breite Fuss der ersten Schicht liefe in die Aeste daneben.
        if has_body {
            settings.insert("support_material_first_layer_expansion".into(), json!(0));
        }
    }

    // Eigene Einstellungen gelten auch fuer Stuetzen, die Prusa selbst druckt.
    if !targets.is_empty() || everywhere {
        settings.extend(super::overrides::forwarded(resolved));
    }

    let mut notes: Vec<String> = Vec::new();
    if automatic {
        notes.push("zusätzlich stützt der Prozess automatisch, weil dort Stützen überall eingeschaltet sind".into());
    } else if everywhere {
        notes.push("automatische Prusa-Stützen sind für dieses Modell aus, sie würden die eigenen Formen kreuzen".into());
    }
    if let Some(reason) = plan.reason {
        notes.push(reason.into());
    } else if plan.fallback > 0 {
        notes.push(format!("{} Stellen ohne freien Weg werden als Pfeiler gestützt", plan.fallback));
    }
    if plan.substituted > 0 {
        notes.push(format!("{} Fächer/Knotenbleche ohne passende Gruppe oder Wand werden als einzelne, möglichst gerade Stütze gedruckt", plan.substituted));
    }
    if plan.skipped > 0 {
        notes.push(format!("{} Stellen erreichen das Druckbett nicht und bleiben ohne Stütze", plan.skipped));
    }
    if gap == 0.0 && tools < 2 {
        notes.push("Kontaktabstand 0 verschmilzt Stützen und Bauteil bei nur einem Material".into());
    }

    let bottom_gap = plain(get("support_material_bottom_contact_distance")).filter(|g| *g != 0.0).unwrap_or(gap);
    let raft = plain(get("raft_layers")).unwrap_or(0.0) > 0.0;
    let world = world_of(item);
    let undersides = generate::undersides(&world, &plan.native, &item.data.settings);
    let mut checks: Vec<Check> = targets
        .into_iter()
        .zip(undersides)
        .map(|(target, underside)| Check::Pillar {
            underside,
            x: target.x,
            y: target.y,
            surface: target.surface,
            spacing: target.spacing,
            low: target.low,
            high: target.high,
            bottom: target.bottom,
            gap,
            bottom_gap,
            layer: thickest,
            raft,
            branched,
        })
        .collect();

    let mut body = None;
    if has_body && get("support_material_interface_pattern").and_then(Value::as_str) == Some("concentric") {
        notes.push("Kontaktmuster „konzentrisch“: die eigenen Stützen drucken ihre Kontaktschicht als Linien".into());
    }
    if has_body {
        let mut parts = Vec::new();
        if !plan.pads.is_empty() {
            // Als zweites Volumen gewinnt die Kontaktlage dort, wo sie den Ast ueberlappt.
            let (vertices, triangles) = listed(&boxes_mesh(&plan.pads));
            parts.push(project::Volume { kind: project::VolumeKind::ModelPart, vertices, triangles, settings: with_interface_tool(contact_settings(resolved, plan), resolved) });
        }
        if !plan.strips.is_empty() {
            let (vertices, triangles) = listed(&boxes_mesh(&plan.strips));
            let mut full = with_interface_tool(contact_settings(resolved, plan), resolved);
            full.insert("fill_density".into(), percentage(100.0));
            full.insert("fill_pattern".into(), json!("rectilinear"));
            parts.push(project::Volume { kind: project::VolumeKind::ModelPart, vertices, triangles, settings: full });
        }
        if !plan.lines.is_empty() {
            // Jede Kontaktbahn ist so breit wie eine Bahn: eine einzelne Wand, keine Fuellung, keine Decklage.
            let (vertices, triangles) = listed(&boxes_mesh(&plan.lines));
            parts.push(project::Volume { kind: project::VolumeKind::ModelPart, vertices, triangles, settings: with_interface_tool(line_settings(resolved, plan), resolved) });
        }
        let mut object_settings = model.settings.clone();
        object_settings.extend(body_settings(resolved));
        // Das volle Netz entsteht erst hier, bei der Übergabe an die Engine.
        let body_mesh = plan.body_mesh();
        let main = if !body_mesh.is_empty() { body_mesh } else if !plan.pads.is_empty() { boxes_mesh(&plan.pads) } else if !plan.strips.is_empty() { boxes_mesh(&plan.strips) } else { boxes_mesh(&plan.lines) };
        let (vertices, triangles) = listed(&main);
        body = Some(project::Model {
            id: None,
            path: String::new(),
            inline: Some(project::Inline { vertices, triangles }),
            name: format!("Simpliy-Stuetze {}", item.input.id),
            matrix: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            signature: None,
            paint: project::Paint::default(),
            volumes: parts,
            ranges: model.ranges.iter().map(project::Range::height_only).collect(),
            settings: object_settings,
        });
        let undersides = generate::undersides(&world, plan.routes.iter().map(|route| &route.support), &item.data.settings);
        checks.extend(body_checks(plan, undersides));
    }
    Ok(Made { volumes, settings, checks, notes, body })
}

fn listed(mesh: &Triangles) -> (Vec<[f32; 3]>, Vec<[u32; 3]>) {
    (
        mesh.vertices.chunks_exact(3).map(|v| [v[0], v[1], v[2]]).collect(),
        mesh.indices.chunks_exact(3).map(|t| [t[0], t[1], t[2]]).collect(),
    )
}

struct Target {
    x: f64,
    y: f64,
    surface: f64,
    bottom: f64,
    spacing: f64,
    low: f64,
    high: f64,
}

fn enforcers(item: &Item, plan: &ModelPlan, layer: f64) -> Result<(Vec<project::Volume>, Vec<Target>), String> {
    if plan.native.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }
    let settings = &item.data.settings;
    let margin = 2.0 * layer;
    let ceilings = generate::ceilings(&world_of(item), &plan.native, settings);
    let targets: Vec<Target> = plan
        .native
        .iter()
        .zip(ceilings)
        .map(|(p, (low, high))| Target { x: p.x, y: p.y, surface: p.surface_z, bottom: p.bottom_z, spacing: p.width(settings.spacing), low, high })
        .collect();
    let boxes = targets
        .iter()
        .map(|t| Pillar {
            x: t.x,
            y: t.y,
            // Etwas breiter als das Raster, damit zwischen Nachbarn keine Naht bleibt.
            width: 2.0 * (t.spacing / 2.0 + 0.01),
            low: (t.bottom + 0.01).max(t.low - margin),
            high: t.high + margin,
        })
        .collect();
    let place = item.input.placed();
    let back = place.inverse().ok_or("Modelltransformation ist nicht invertierbar.")?;
    let mirrored = place.determinant() < 0.0;
    let volumes = separated(boxes)
        .iter()
        .map(|group| {
            let (world, mut triangles) = listed(&pillar_mesh(group));
            let vertices = world.iter().map(|v| back.apply(v.map(f64::from)).map(|c| c as f32)).collect();
            if mirrored {
                triangles.iter_mut().for_each(|t| t.swap(1, 2));
            }
            project::Volume { kind: project::VolumeKind::SupportEnforcer, vertices, triangles, settings: Map::new() }
        })
        .collect();
    Ok((volumes, targets))
}

/// Beruehrende Schalen in einem Netz schneidet die Engine mehrdeutig, deshalb getrennte Koerper.
fn separated(boxes: Vec<Pillar>) -> Vec<Vec<Pillar>> {
    let apart = |a: &Pillar, b: &Pillar| {
        let reach = a.width / 2.0 + b.width / 2.0 + 0.01;
        (a.x - b.x).abs() > reach || (a.y - b.y).abs() > reach || a.low > b.high + 0.01 || b.low > a.high + 0.01
    };
    let mut groups: Vec<Vec<Pillar>> = Vec::new();
    for item in boxes {
        match groups.iter().position(|group| group.iter().all(|other| apart(&item, other))) {
            Some(at) => groups[at].push(item),
            None => groups.push(vec![item]),
        }
    }
    groups
}

/// Project protected support footprints upward: native automatic contacts must stay away
/// from our separate bodies. A G-code collision/floating check still decides acceptance.
fn automatic_blockers(item: &Item, plan: &ModelPlan) -> Option<Vec<project::Volume>> {
    let mut boxes = Vec::new();
    for branch in &plan.branches {
        for pair in branch.windows(2) {
            let (a,b)=(pair[0],pair[1]);
            let pieces=((b[0]-a[0]).hypot(b[1]-a[1])/2.0).ceil().max(1.0) as usize;
            if pieces>500 || boxes.len()+pieces>500 { return None; }
            for i in 0..pieces {
                let t=(i as f64+0.5)/pieces as f64;
                boxes.push(Pillar {x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,
                    width:2.0*(a[3].max(b[3])+3.0),low:0.0,high:1000.0});
            }
        }
    }
    // Contact pads can extend beyond the thin branch itself.
    for route in &plan.routes {
        if boxes.len()>=500 { return None; }
        let width=route.support.width(item.data.settings.spacing).max(2.0)+6.0;
        boxes.push(Pillar{x:route.support.x,y:route.support.y,width,low:0.0,high:1000.0});
    }
    if boxes.is_empty() { return None; }
    let affine=item.input.placed();let back=affine.inverse()?;let mirrored=affine.determinant()<0.0;
    Some(separated(boxes).iter().map(|group| {
        let (world,mut triangles)=listed(&pillar_mesh(group));
        let vertices=world.iter().map(|v|back.apply(v.map(f64::from)).map(|c|c as f32)).collect();
        if mirrored { triangles.iter_mut().for_each(|t|t.swap(1,2)); }
        project::Volume { kind:project::VolumeKind::SupportBlocker,vertices,triangles,settings:Map::new() }
    }).collect())
}

fn percentage(value: f64) -> Value {
    json!({"value": value, "is_percent": true})
}

fn length(value: f64) -> Value {
    json!({"value": value, "is_percent": false})
}

fn support_speed(resolved: &Map<String, Value>) -> (f64, f64) {
    let base = plain(resolved.get("support_material_speed")).unwrap_or(0.0);
    let contact = absolute(resolved.get("support_material_interface_speed"), base);
    (base, if contact != 0.0 { contact } else { base })
}

/// Wie Prusas organische Stuetzen: eine Wand, hohl, Stuetzen-Tempo.
/// Die Kontaktlage ist ein eigenes Volumen. Deckel im hohlen Ast wuerden nur in der Luft haengen.
/// Kontakt-Extruder (support_material_interface_extruder): Kontaktbahnen und -polster, z. B. loesliches Material.
fn with_interface_tool(mut settings: Map<String, Value>, resolved: &Map<String, Value>) -> Map<String, Value> {
    let tool = plain(resolved.get("support_material_interface_extruder")).unwrap_or(0.0) as i64;
    if tool > 0 {
        for key in ["extruder", "perimeter_extruder", "infill_extruder", "solid_infill_extruder"] {
            settings.insert(key.into(), json!(tool));
        }
    }
    settings
}

fn line_settings(resolved: &Map<String, Value>, plan: &ModelPlan) -> Map<String, Value> {
    let width = plan.env.line_width;
    let (_, contact) = support_speed(resolved);
    [
        ("perimeters", json!(1)),
        ("perimeter_generator", json!("arachne")),
        ("fill_density", percentage(0.0)),
        ("top_solid_layers", json!(0)),
        ("bottom_solid_layers", json!(0)),
        ("thin_walls", json!(true)),
        ("perimeter_extrusion_width", length(width)),
        ("external_perimeter_extrusion_width", length(width)),
        ("perimeter_speed", json!(contact)),
        ("external_perimeter_speed", length(contact)),
        ("small_perimeter_speed", length(contact)),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value))
    .collect()
}

fn body_settings(resolved: &Map<String, Value>) -> Map<String, Value> {
    let (speed, contact) = support_speed(resolved);
    let wanted = [
        ("support_material", json!("none")),
        ("raft_layers", json!(0)),
        ("perimeters", json!(1)),
        ("fill_density", percentage(0.0)),
        ("top_solid_layers", json!(0)),
        ("bottom_solid_layers", json!(1)),
        ("top_solid_min_thickness", json!(0)),
        ("bottom_solid_min_thickness", json!(0)),
        ("ensure_vertical_shell_thickness", json!("disabled")),
        ("perimeter_generator", json!("classic")),
        ("thin_walls", json!(false)),
        ("gap_fill_enabled", json!(false)),
        ("extra_perimeters", json!(false)),
        ("extra_perimeters_on_overhangs", json!(false)),
        ("overhangs", json!(false)),
        ("enable_dynamic_overhang_speeds", json!(false)),
        ("perimeter_speed", json!(speed)),
        ("external_perimeter_speed", length(speed)),
        ("small_perimeter_speed", length(speed)),
        ("bridge_speed", json!(speed)),
        ("solid_infill_speed", length(contact)),
        ("top_solid_infill_speed", length(contact)),
        ("fuzzy_skin", json!("none")),
        ("ironing", json!(false)),
        ("xy_size_compensation", json!(0)),
        ("elefant_foot_compensation", json!(0)),
        ("brim_type", json!("no_brim")),
        ("seam_position", json!("nearest")),
        ("external_perimeters_first", json!(false)),
        ("top_fill_pattern", json!("rectilinear")),
    ];
    let mut out: Map<String, Value> = wanted.into_iter().map(|(key, value)| (key.to_owned(), value)).collect();
    // Eigene Einstellungen: mehr Waende und optionale Fuellung der Stuetzkoerper.
    let walls = plain(resolved.get(super::overrides::BODY_WALLS)).unwrap_or(1.0).clamp(1.0, 4.0);
    out.insert("perimeters".into(), json!(walls as i64));
    let infill = plain(resolved.get(super::overrides::BODY_INFILL)).unwrap_or(0.0).clamp(0.0, 100.0);
    if infill > 0.0 {
        out.insert("fill_density".into(), percentage(infill));
        if let Some(pattern) = resolved.get(super::overrides::BODY_PATTERN).and_then(Value::as_str) {
            out.insert("fill_pattern".into(), json!(pattern));
        }
    }
    let width = resolved.get("support_material_extrusion_width");
    let amount = plain(width).unwrap_or(0.0);
    if amount > 0.0 {
        let value = if is_percent(width) { percentage(amount) } else { length(amount) };
        out.insert("perimeter_extrusion_width".into(), value.clone());
        out.insert("external_perimeter_extrusion_width".into(), value);
    }
    let tool = plain(resolved.get("support_material_extruder")).unwrap_or(0.0) as i64;
    if tool > 0 {
        for key in ["extruder", "perimeter_extruder", "infill_extruder", "solid_infill_extruder"] {
            out.insert(key.into(), json!(tool));
        }
    }
    out
}

/// Wie Prusas "Support material interface": Linien ohne Wand, quer zur Stuetze, Abstand aus dem Prozess.
fn contact_settings(resolved: &Map<String, Value>, plan: &ModelPlan) -> Map<String, Value> {
    let width = plan.env.line_width;
    let spacing = width - plan.env.layer * (1.0 - PI / 4.0);
    let density = (spacing / (spacing + plain(resolved.get("support_material_interface_spacing")).unwrap_or(0.0))).min(1.0);
    let solid = density > 0.95;
    let (_, speed) = support_speed(resolved);
    let angle = plain(resolved.get("support_material_angle")).unwrap_or(0.0) + 90.0;
    let wanted = [
        ("perimeters", json!(0)),
        ("fill_density", percentage(if solid { 100.0 } else { crate::util::round_up(density * 100.0) })),
        ("fill_pattern", json!(if solid { "rectilinear" } else { "alignedrectilinear" })),
        ("fill_angle", json!(if angle >= 360.0 { angle - 360.0 } else { angle })),
        ("top_solid_layers", json!(0)),
        ("bottom_solid_layers", json!(0)),
        ("solid_infill_below_area", json!(0)),
        ("solid_infill_every_layers", json!(0)),
        ("automatic_infill_combination", json!(false)),
        ("infill_every_layers", json!(1)),
        ("infill_anchor", length(0.0)),
        ("infill_anchor_max", length(0.0)),
        ("infill_overlap", length(0.0)),
        ("infill_speed", json!(speed)),
        ("solid_infill_speed", length(speed)),
        ("bridge_speed", json!(speed)),
        ("infill_extrusion_width", length(width)),
        ("solid_infill_extrusion_width", length(width)),
    ];
    wanted.into_iter().map(|(key, value)| (key.to_owned(), value)).collect()
}

/// Jede Spitze und jeder Ast alle paar Millimeter.
fn body_checks(plan: &ModelPlan, undersides: Vec<Vec<[f64; 3]>>) -> Vec<Check> {
    let layer = plan.env.layer;
    let mut checks: Vec<Check> = plan
        .routes
        .iter()
        .zip(undersides)
        .map(|(route, underside)| Check::Tip {
            underside,
            gap: plan.env.gap,
            bottom_gap: plan.env.bottom_gap,
            x: route.support.x,
            y: route.support.y,
            surface: route.support.surface_z,
            z: route.tip,
            r: route
                .support
                .shape
                .as_ref()
                .and_then(|shape| shape.get("tipWidth"))
                .and_then(super::types::number)
                .filter(|w| *w != 0.0)
                .map_or(0.9, |w| w / 2.0),
            layer,
            width: plan.env.line_width,
            samples: route.samples.clone(),
        })
        .collect();
    for branch in &plan.branches {
        let mut previous = f64::INFINITY;
        for pair in branch.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            let z = a[2] + (b[2] - a[2]) * 0.5;
            if (previous - z).abs() < 3.0 || z < 2.0 * layer {
                continue;
            }
            previous = z;
            checks.push(Check::Branch { x: a[0] + (b[0] - a[0]) * 0.5, y: a[1] + (b[1] - a[1]) * 0.5, z, r: a[3] + (b[3] - a[3]) * 0.5, layer });
        }
    }
    checks
}
