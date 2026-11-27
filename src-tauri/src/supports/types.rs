//! Gespeicherte Daten der Stuetzen. Das JSON im Arbeitsbereich bleibt wie seit 0.10 (schema 1).
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};

pub const STYLES: [(&str, &str); 5] =
    [("pillar", "Pfeiler"), ("mini", "Mini"), ("tree", "Baum"), ("fan", "Fächer"), ("gusset", "Knotenblech")];
pub const MAX_STORED: usize = 10_000_000;
/// Fuellmuster, die fuer Stuetzkoerper angeboten werden.
pub const BODY_PATTERNS: [&str; 6] = ["rectilinear", "grid", "triangles", "honeycomb", "gyroid", "concentric"];
/// Schmal, sonst nimmt ein Ersatzpfeiler den Nachbaraesten den Weg.
pub const FALLBACK_WIDTH: f64 = 2.4;

/// Pfeiler und Mini, die auf dem Teil stehen, baut das Programm als gerade Saeule.
/// Prusa legt deren unterste Lage auf gekruemmte Flaechen, eine Bahn haengt dann in der Luft.
pub fn is_column(support: &Support) -> bool {
    matches!(support.style(), Some("pillar" | "mini")) && support.bottom_z > 1e-6 && support.extra.get("__internal_retry_native") != Some(&Value::Bool(true))
}

pub fn is_body(style: Option<&str>) -> bool {
    matches!(style, Some("tree" | "fan" | "gusset"))
}

/// Masse der Formen.
#[derive(Clone, Copy, Debug)]
pub struct Shape {
    pub body_width: f64,
    pub tip_width: f64,
    pub contact_width: f64,
    pub tip_height: f64,
    pub base_width: f64,
    pub base_height: f64,
    pub branch_angle: f64,
    pub thicken: f64,
    pub fan_count: f64,
}

/// Name, Vorgabe, kleinster, groesster Wert.
pub const SHAPE: [(&str, f64, f64, f64); 9] = [
    ("bodyWidth", 3.0, 1.2, 20.0),    // Durchmesser eines einzelnen Astes
    ("tipWidth", 1.8, 0.8, 10.0),     // Durchmesser des Halses
    ("contactWidth", 4.0, 1.2, 12.0), // Kontaktflaeche wie ein Prusa-Pfeiler
    ("tipHeight", 1.5, 0.3, 10.0),
    ("baseWidth", 7.0, 1.2, 40.0),   // Fuss auf dem Bett
    ("baseHeight", 2.0, 0.3, 10.0),
    ("branchAngle", 40.0, 10.0, 55.0), // gegen die Senkrechte
    ("thicken", 30.0, 0.0, 200.0),     // % mehr Querschnitt je Spitze
    ("fanCount", 7.0, 2.0, 15.0),
];

/// Wie eine Zahleneingabe gelesen wird: Zahl, Zahl als Text oder Wahrheitswert.
pub fn number(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) if s.trim().is_empty() => Some(0.0),
        Value::String(s) => s.trim().parse().ok().filter(|v: &f64| v.is_finite()),
        Value::Bool(b) => Some(f64::from(u8::from(*b))),
        Value::Null => Some(0.0),
        _ => None,
    }
}

impl Shape {
    pub fn of(stored: Option<&Map<String, Value>>) -> Shape {
        let v = SHAPE.map(|(name, default, low, high)| {
            stored.and_then(|map| map.get(name)).and_then(number).map_or(default, |v| v.clamp(low, high))
        });
        Shape {
            body_width: v[0],
            tip_width: v[1],
            contact_width: v[2],
            tip_height: v[3],
            base_width: v[4],
            base_height: v[5],
            branch_angle: v[6],
            thicken: v[7],
            fan_count: v[8],
        }
    }

    pub fn values(&self) -> [f64; 9] {
        [
            self.body_width,
            self.tip_width,
            self.contact_width,
            self.tip_height,
            self.base_width,
            self.base_height,
            self.branch_angle,
            self.thicken,
            self.fan_count,
        ]
    }

    pub fn to_map(self) -> Map<String, Value> {
        SHAPE.iter().zip(self.values()).map(|((name, ..), value)| ((*name).to_owned(), json!(value))).collect()
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Support {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub bottom_z: f64,
    pub top_z: f64,
    pub surface_z: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub landing: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Map<String, Value>>,
    /// Kante oder tiefster Punkt statt Flaeche.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placed: Option<String>,
    /// Zweiter Versuch mit schlankem Ast, nur waehrend der Planung.
    #[serde(skip)]
    pub slim: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Support {
    pub fn style(&self) -> Option<&str> {
        self.style.as_deref()
    }

    pub fn width(&self, spacing: f64) -> f64 {
        self.size.filter(|s| *s > 0.0).unwrap_or(spacing)
    }

    fn valid(&self) -> bool {
        [self.x, self.y, self.bottom_z, self.top_z, self.surface_z].iter().all(|v| v.is_finite())
            && self.top_z > self.bottom_z
            && self.bottom_z >= -0.01
    }
}

fn only_true<'de, D: Deserializer<'de>>(input: D) -> Result<bool, D::Error> {
    Ok(Value::deserialize(input)? == Value::Bool(true))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub placement: String,
    pub spacing: f64,
    pub overhang_angle: f64,
    pub shaft_diameter: f64,
    pub tip_diameter: f64,
    pub tip_length: f64,
    pub foot_diameter: f64,
    pub foot_height: f64,
    pub contact_gap: f64,
    pub min_height: f64,
    pub bed_z: f64,
    pub build: String,
    pub style: String,
    pub existing: String,
    #[serde(deserialize_with = "only_true")]
    pub detect_surfaces: bool,
    #[serde(deserialize_with = "only_true")]
    pub detect_edges: bool,
    #[serde(deserialize_with = "only_true")]
    pub detect_minima: bool,
    pub min_area: f64,
    pub mini_width: f64,
    /// Regel: niedrigere Stuetzen werden Mini.
    pub mini_below: f64,
    /// Regel: groessere Flaechen ueber dem Bett bekommen Pfeiler.
    pub pillar_area: f64,
    #[serde(deserialize_with = "only_true")]
    pub heatmap: bool,
    pub body_width: f64,
    pub tip_width: f64,
    pub contact_width: f64,
    pub tip_height: f64,
    pub base_width: f64,
    pub base_height: f64,
    pub branch_angle: f64,
    pub thicken: f64,
    pub fan_count: f64,
    pub max_supports: u32,
    pub radial_segments: u32,
    // ---- Druck der Stuetzen: ueberschreiben Werte des Prozesses (0, -1 oder „process“ = Wert aus dem Prozess)
    /// Erzeugung und Form nach den Prusa-Stuetzeinstellungen des Prozesses richten (Ueberhangwinkel, nur Druckbett, Kontaktabstand,
    /// Astwinkel, Spitzen- und Astdurchmesser). Aus: die eigenen Werte gelten.
    pub use_process: bool,
    /// Fuellmuster und Dichte der Stuetzkoerper aus Prusas Stuetzmuster und -abstand ableiten.
    pub body_like_prusa: bool,
    /// Schmale ebene Streifen knapp unter der Schwelle (Fasen) nicht stuetzen, bis zu dieser Breite in mm (0 = aus).
    pub chamfer_max: f64,
    /// Wie viel Grad steiler als die Schwelle ein Streifen noch als Fase gilt.
    pub chamfer_tol: f64,
    /// Zusaetzlich druckbarer Ueberhang in Grad (Drucker/Kuehlung): senkt die Schwelle, es wird weniger gestuetzt.
    pub printable_extra: f64,
    /// Zusatzwinkel aus den Prusa-Ueberhangparametern des Prozesses ableiten (dynamische Ueberhangtempi, Ueberhang-Luefter).
    pub printable_auto: bool,
    /// Aus dem Prozess berechneter Zusatzwinkel (nur Anzeige/Rechnung, wird bei jeder Planung neu bestimmt).
    pub printable_bonus: f64,
    /// Kleine Bohrungen (waagerechte Zylinderdecken) bis zu diesem Durchmesser in mm nicht stuetzen (0 = aus).
    pub bore_max: f64,
    /// Kontaktflaeche: Anzahl Kontaktlagen oben (0 = Prozess).
    pub contact_layers: u32,
    /// Kontaktflaeche: Fuelldichte in % (0 = Prozess, ergibt sich aus dem Linienabstand).
    pub contact_density: f64,
    /// Kontaktflaeche: „process“, „rectilinear“ oder „grid“.
    pub contact_pattern: String,
    /// Kontaktflaeche: Kontaktschleifen „process“, „on“ oder „off“.
    pub contact_loops: String,
    /// Kontaktflaeche: Winkel der Kontaktbahnen in Grad (-1 = Prozess).
    pub contact_angle: f64,
    /// Kontaktflaeche: Tempo in mm/s (0 = Prozess).
    pub contact_speed: f64,
    /// Kontaktabstand in Z in mm (-1 = Prozess).
    pub contact_z: f64,
    /// Seitlicher Abstand zum Teil in mm (0 = Prozess).
    pub xy_gap: f64,
    /// Tempo der Stuetzkoerper in mm/s (0 = Prozess).
    pub body_speed: f64,
    /// Bahnbreite der Stuetzen in mm (0 = Prozess).
    pub line_width: f64,
    /// Waende der Stuetzkoerper (1 wie bisher).
    pub body_walls: u32,
    /// Fuellung der Stuetzkoerper in % (0 = hohl wie bisher).
    pub body_infill: f64,
    /// Fuellmuster der Stuetzkoerper (nur mit Fuellung).
    pub body_pattern: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Settings {
    fn default() -> Self {
        let shape = Shape::of(None);
        Settings {
            placement: "everywhere".into(),
            spacing: 4.0,
            overhang_angle: 45.0,
            shaft_diameter: 2.0,
            tip_diameter: 0.9,
            tip_length: 1.2,
            foot_diameter: 3.6,
            foot_height: 0.8,
            contact_gap: 0.2,
            min_height: 0.8,
            bed_z: 0.0,
            build: "snug".into(),
            style: "pillar".into(),
            existing: "replace".into(),
            detect_surfaces: true,
            detect_edges: false,
            detect_minima: false,
            min_area: 0.0,
            mini_width: 2.0,
            mini_below: 5.0,
            pillar_area: 400.0,
            heatmap: false,
            body_width: shape.body_width,
            tip_width: shape.tip_width,
            contact_width: shape.contact_width,
            tip_height: shape.tip_height,
            base_width: shape.base_width,
            base_height: shape.base_height,
            branch_angle: shape.branch_angle,
            thicken: shape.thicken,
            fan_count: shape.fan_count,
            max_supports: MAX_STORED as u32,
            radial_segments: 10,
            use_process: true,
            chamfer_max: 3.0,
            chamfer_tol: 5.0,
            printable_extra: 0.0,
            printable_auto: false,
            printable_bonus: 0.0,
            bore_max: 0.0,
            body_like_prusa: false,
            contact_layers: 0,
            contact_density: 0.0,
            contact_pattern: "process".into(),
            contact_loops: "process".into(),
            contact_angle: -1.0,
            contact_speed: 0.0,
            contact_z: -1.0,
            xy_gap: 0.0,
            body_speed: 0.0,
            line_width: 0.0,
            body_walls: 1,
            body_infill: 0.0,
            body_pattern: "rectilinear".into(),
            extra: Map::new(),
        }
    }
}

impl Settings {
    pub fn shape(&self) -> Shape {
        Shape {
            body_width: self.body_width,
            tip_width: self.tip_width,
            contact_width: self.contact_width,
            tip_height: self.tip_height,
            base_width: self.base_width,
            base_height: self.base_height,
            branch_angle: self.branch_angle,
            thicken: self.thicken,
            fan_count: self.fan_count,
        }
    }

    /// Wirksame Einstellungen: Mit `use_process` kommen Erzeugung und Form aus den Prusa-Stuetzeinstellungen des Prozesses,
    /// damit die eigenen Stuetzen den Prusa-Stuetzen moeglichst nahekommen. Fehlende oder ungueltige Prozesswerte lassen die
    /// eigenen Werte stehen. Ausschalten behaelt die zuletzt uebernommenen Werte als eigene Werte.
    /// Ueberhangschwelle, mit der wirklich gestuetzt wird: eigene Schwelle minus zusaetzlich druckbarer Winkel.
    pub fn effective_angle(&self) -> f64 {
        (self.overhang_angle - self.printable_extra - self.printable_bonus).clamp(10.0, 89.9)
    }

    /// Zusatzwinkel aus den Prusa-Ueberhangparametern (Naeherung): dynamische Ueberhangtempi +5°, Ueberhang-Wandlogik +3°,
    /// kraeftiger Ueberhang-Luefter (>= 80 % in den Stufen 25–75 %) +4°; hoechstens 15°.
    fn printable_bonus_from(resolved: &Map<String, Value>) -> f64 {
        use super::plan::plain;
        let truthy = |key: &str| matches!(resolved.get(key), Some(Value::Bool(true))) || matches!(resolved.get(key), Some(Value::Number(n)) if n.as_f64() == Some(1.0));
        let mut bonus = 0.0;
        if truthy("enable_dynamic_overhang_speeds") {
            bonus += 5.0;
        }
        if truthy("overhangs") {
            bonus += 3.0;
        }
        let fans: Vec<f64> = ["overhang_fan_speed_1", "overhang_fan_speed_2", "overhang_fan_speed_3"].iter().filter_map(|k| plain(resolved.get(*k))).collect();
        if fans.len() == 3 && fans.iter().all(|f| *f >= 80.0) {
            bonus += 4.0;
        }
        f64::min(bonus, 15.0)
    }

    pub fn from_process(&self, resolved: &Map<String, Value>) -> Settings {
        let mut s = self.clone();
        s.printable_bonus = if self.printable_auto { Self::printable_bonus_from(resolved) } else { 0.0 };
        if !self.use_process {
            return s;
        }
        use super::plan::{absolute, plain};
        let get = |key: &str| resolved.get(key);
        let truthy = |key: &str| matches!(get(key), Some(Value::Bool(true))) || matches!(get(key), Some(Value::Number(n)) if n.as_f64() == Some(1.0))
            || matches!(get(key), Some(Value::String(t)) if t == "1" || t == "true");
        // Prusa: Schwelle 0 = automatisch; dann bleibt der eigene Winkel.
        if let Some(angle) = plain(get("support_material_threshold")).filter(|a| *a > 0.0 && *a < 90.0) {
            s.overhang_angle = angle;
        }
        if get("support_material_buildplate_only").is_some() {
            s.placement = if truthy("support_material_buildplate_only") { "buildplate" } else { "everywhere" }.into();
        }
        if let Some(gap) = plain(get("support_material_contact_distance")).filter(|g| *g >= 0.0 && g.is_finite()) {
            s.contact_gap = gap;
        }
        let shape = |name: &str, value: Option<f64>, target: &mut f64| {
            if let (Some(v), Some((_, _, low, high))) = (value.filter(|v| *v > 0.0 && v.is_finite()), SHAPE.iter().find(|(n, ..)| *n == name)) {
                *target = v.clamp(*low, *high);
            }
        };
        shape("branchAngle", plain(get("support_tree_angle")), &mut s.branch_angle);
        shape("tipWidth", plain(get("support_tree_tip_diameter")), &mut s.tip_width);
        shape("bodyWidth", plain(get("support_tree_branch_diameter")), &mut s.body_width);
        if s.body_like_prusa {
            // Muster und Dichte wie Prusas Stuetzen: Dichte ~ Bahnbreite / Linienabstand (Gitter doppelt, Waben anderthalbfach).
            let pattern = get("support_material_pattern").and_then(Value::as_str).unwrap_or("rectilinear");
            let (name, factor) = match pattern {
                "rectilinear-grid" => ("grid", 2.0),
                "honeycomb" => ("honeycomb", 1.5),
                _ => ("rectilinear", 1.0),
            };
            let layer = plain(get("layer_height")).unwrap_or(0.2).max(0.02);
            let width = absolute(get("support_material_extrusion_width"), layer).max(plain(get("nozzle_diameter")).unwrap_or(0.4));
            if let Some(spacing) = plain(get("support_material_spacing")).filter(|v| *v > 0.0) {
                s.body_infill = (width / spacing * factor * 100.0).clamp(5.0, 100.0).round();
                s.body_pattern = name.into();
            }
        }
        s
    }

    pub fn check(&self) -> Result<(), String> {
        let range = |name: &str, value: f64, low: f64, high: f64| {
            if value.is_finite() && value >= low && value <= high {
                Ok(())
            } else {
                Err(format!("{name}: {low} bis {high}"))
            }
        };
        let choice = |name: &str, value: &str, allowed: &[&str]| {
            if allowed.contains(&value) {
                Ok(())
            } else {
                Err(format!("{name}: „{value}“ ist keine gültige Auswahl"))
            }
        };
        choice("placement", &self.placement, &["everywhere", "buildplate"])?;
        choice("build", &self.build, &["snug", "process"])?;
        choice("existing", &self.existing, &["replace", "add"])?;
        choice("style", &self.style, &["auto", "pillar", "mini", "tree", "fan", "gusset"])?;
        choice("contactPattern", &self.contact_pattern, &["process", "rectilinear", "grid", "concentric"])?;
        choice("contactLoops", &self.contact_loops, &["process", "on", "off"])?;
        choice("bodyPattern", &self.body_pattern, &BODY_PATTERNS)?;
        for (name, value) in [
            ("spacing", self.spacing),
            ("shaftDiameter", self.shaft_diameter),
            ("tipDiameter", self.tip_diameter),
            ("footDiameter", self.foot_diameter),
        ] {
            if !(value.is_finite() && value > 0.0) {
                return Err(format!("{name}: muss größer als 0 sein"));
            }
        }
        for (name, value) in [
            ("tipLength", self.tip_length),
            ("footHeight", self.foot_height),
            ("contactGap", self.contact_gap),
            ("minHeight", self.min_height),
        ] {
            range(name, value, 0.0, f64::MAX)?;
        }
        range("bedZ", self.bed_z, f64::MIN, f64::MAX)?;
        range("overhangAngle", self.overhang_angle, 0.0, 89.9)?;
        range("maxSupports", f64::from(self.max_supports), 1.0, 10_000_000.0)?;
        range("radialSegments", f64::from(self.radial_segments), 6.0, 64.0)?;
        range("miniWidth", self.mini_width, 0.8, 6.0)?;
        range("boreMax", self.bore_max, 0.0, 40.0)?;
        range("chamferMax", self.chamfer_max, 0.0, 10.0)?;
        range("chamferTol", self.chamfer_tol, 0.0, 30.0)?;
        range("printableExtra", self.printable_extra, 0.0, 30.0)?;
        range("contactLayers", f64::from(self.contact_layers), 0.0, 8.0)?;
        range("contactDensity", self.contact_density, 0.0, 100.0)?;
        range("contactAngle", self.contact_angle, -1.0, 180.0)?;
        range("contactSpeed", self.contact_speed, 0.0, 500.0)?;
        range("contactZ", self.contact_z, -1.0, 2.0)?;
        range("xyGap", self.xy_gap, 0.0, 5.0)?;
        range("bodySpeed", self.body_speed, 0.0, 500.0)?;
        range("lineWidth", self.line_width, 0.0, 2.0)?;
        range("bodyWalls", f64::from(self.body_walls), 1.0, 4.0)?;
        range("bodyInfill", self.body_infill, 0.0, 100.0)?;
        range("minArea", self.min_area, 0.0, 100_000.0)?;
        range("miniBelow", self.mini_below, 0.0, 100.0)?;
        range("pillarArea", self.pillar_area, 1.0, 1_000_000.0)?;
        for ((name, _, low, high), value) in SHAPE.iter().zip(self.shape().values()) {
            range(name, value, *low, *high)?;
        }
        Ok(())
    }

    pub fn changed(&self, key: &str, value: Value) -> Result<Settings, String> {
        let mut map = serde_json::to_value(self).map_err(|e| e.to_string())?;
        if map.get(key).is_none() {
            return Err(format!("{key}: unbekannte Einstellung"));
        }
        map[key] = value;
        let next: Settings = serde_json::from_value(map).map_err(|_| format!("{key}: ungültiger Wert"))?;
        next.check()?;
        Ok(next)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Data {
    pub schema: u32,
    pub settings: Settings,
    pub signature: String,
    pub automatic: Vec<Support>,
    pub manual: Vec<Support>,
    #[serde(default)]
    pub incomplete: bool,
    /// Stellen (x, y, Kontakthoehe) automatischer Stuetzen, die von Hand geloescht wurden: Neuberechnung setzt sie nicht wieder.
    #[serde(default)]
    pub erased: Vec<[f64; 3]>,
}

impl Data {
    /// Unlesbares faellt weg, statt den Arbeitsbereich unbrauchbar zu machen.
    pub fn read(stored: &Value) -> Data {
        let mut data = Data {
            schema: 1,
            settings: Settings::default(),
            signature: String::new(),
            automatic: Vec::new(),
            manual: Vec::new(),
            incomplete: false,
            erased: Vec::new(),
        };
        if stored.get("schema").and_then(Value::as_f64) != Some(1.0) {
            return data;
        }
        if let Some(settings) = stored
            .get("settings")
            .and_then(|s| Settings::deserialize(s).ok())
            .filter(|s| s.check().is_ok())
        {
            data.settings = settings;
        }
        let list = |key: &str| -> Vec<Support> {
            stored.get(key).and_then(Value::as_array).map_or_else(Vec::new, |items| {
                items.iter().take(MAX_STORED).filter_map(|p| Support::deserialize(p).ok()).filter(Support::valid).collect()
            })
        };
        data.automatic = list("automatic");
        data.manual = list("manual");
        data.signature = stored.get("signature").and_then(Value::as_str).unwrap_or_default().to_owned();
        data.incomplete = stored.get("incomplete") == Some(&Value::Bool(true));
        data.erased = stored
            .get("erased")
            .and_then(Value::as_array)
            .map_or_else(Vec::new, |items| items.iter().filter_map(|p| serde_json::from_value::<[f64; 3]>(p.clone()).ok()).filter(|p| p.iter().all(|v| v.is_finite())).take(MAX_STORED).collect());
        data
    }

    pub fn count(&self) -> usize {
        self.automatic.len() + self.manual.len()
    }

    pub fn all(&self) -> Vec<Support> {
        self.automatic.iter().chain(&self.manual).cloned().collect()
    }
}

/// Was die Oberflaeche zum Zeichnen des Werkzeugfensters braucht.
/// Nur diese Prozesswerte braucht die Planung, mehr schickt die Oberflaeche nicht.
const PROCESS_KEYS: [&str; 36] = [
    "layer_height", "first_layer_height", "nozzle_diameter", "extrusion_width", "external_perimeter_extrusion_width",
    "raft_layers", "support_material", "support_material_style", "support_material_speed", "support_material_extruder",
    "support_material_angle", "support_material_extrusion_width", "support_material_xy_spacing",
    "support_material_contact_distance", "support_material_bottom_contact_distance",
    "support_material_interface_layers", "support_material_interface_spacing", "support_material_interface_speed",
    "support_material_spacing", "support_material_interface_pattern", "support_material_interface_contact_loops",
    "support_material_interface_extruder", "support_material_bottom_interface_layers",
    // Erzeugung und Form nach Prusa (Settings::from_process)
    "support_material_threshold", "support_material_buildplate_only", "support_material_pattern", "support_tree_angle",
    "support_tree_tip_diameter", "support_tree_branch_diameter", "support_material_with_sheath", "dont_support_bridges",
    // Ueberhangfaehigkeit des Druckers (Settings::printable_bonus_from)
    "enable_dynamic_overhang_speeds", "overhangs", "overhang_fan_speed_1", "overhang_fan_speed_2", "overhang_fan_speed_3",
];

pub fn schema() -> Value {
    let styles: Map<String, Value> = STYLES.iter().map(|(id, name)| ((*id).to_owned(), json!(name))).collect();
    let limits: Map<String, Value> = SHAPE.iter().map(|(name, _, low, high)| ((*name).to_owned(), json!([low, high]))).collect();
    json!({"defaults": Settings::default(), "styles": styles, "limits": limits, "keys": &PROCESS_KEYS[..]})
}
