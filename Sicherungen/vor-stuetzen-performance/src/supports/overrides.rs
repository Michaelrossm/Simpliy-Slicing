//! Eigene Stuetz-Einstellungen von Simpliy ueberschreiben Prozesswerte fuer die Simpliy-Stuetzen.
//! Alles, was der Nutzer nicht aendert (0, -1 oder „process“), bleibt wie im Prozess. Die Werte werden vor der
//! Planung in die Prozesswerte geschrieben (mit denselben Schluesseln wie Prusa), damit Ansicht und Slicing
//! dieselben Zahlen benutzen. Koerper-Einstellungen gehen ueber interne Schluessel `simpliy_support_*`.
use super::{plan::env_of, types::Settings};
use serde_json::{json, Map, Value};
use std::f64::consts::PI;

pub const BODY_WALLS: &str = "simpliy_support_body_walls";
pub const BODY_INFILL: &str = "simpliy_support_body_infill";
pub const BODY_PATTERN: &str = "simpliy_support_body_pattern";
/// Liste der durch Simpliy-Einstellungen ueberschriebenen Prusa-Schluessel (nur diese gehen an die Engine).
pub const CHANGED: &str = "simpliy_support_overridden";

pub fn apply(resolved: &mut Map<String, Value>, s: &Settings) {
    let mut changed: Vec<&str> = Vec::new();
    let mut set = |key: &'static str, value: Value| {
        changed.push(key);
        resolved.insert(key.to_owned(), value);
    };
    if s.contact_layers > 0 {
        set("support_material_interface_layers", json!(s.contact_layers));
    }
    if s.contact_pattern != "process" {
        set("support_material_interface_pattern", json!(s.contact_pattern));
    }
    match s.contact_loops.as_str() {
        "on" => set("support_material_interface_contact_loops", json!(true)),
        "off" => set("support_material_interface_contact_loops", json!(false)),
        _ => {}
    }
    if s.contact_angle >= 0.0 {
        set("support_material_angle", json!(s.contact_angle));
    }
    if s.contact_speed > 0.0 {
        set("support_material_interface_speed", json!(s.contact_speed));
    }
    if s.contact_z >= 0.0 {
        set("support_material_contact_distance", json!(s.contact_z));
        set("support_material_bottom_contact_distance", json!(0));
    }
    if s.xy_gap > 0.0 {
        set("support_material_xy_spacing", json!(s.xy_gap));
    }
    if s.body_speed > 0.0 {
        set("support_material_speed", json!(s.body_speed));
    }
    if s.line_width > 0.0 {
        set("support_material_extrusion_width", json!(s.line_width));
    }
    if s.contact_density > 0.0 {
        // Dichte aus dem Linienabstand: dichte = Bahn / (Bahn + Abstand), Bahn wie im Kontaktbau.
        let env = env_of(resolved, &[]);
        let line = env.line_width - env.layer * (1.0 - PI / 4.0);
        let spacing = (line * (100.0 / s.contact_density.clamp(1.0, 100.0) - 1.0)).max(0.0);
        changed.push("support_material_interface_spacing");
        resolved.insert("support_material_interface_spacing".to_owned(), json!(spacing));
    }
    resolved.insert(CHANGED.to_owned(), json!(changed));
    resolved.insert(BODY_WALLS.to_owned(), json!(s.body_walls));
    resolved.insert(BODY_INFILL.to_owned(), json!(s.body_infill));
    resolved.insert(BODY_PATTERN.to_owned(), json!(s.body_pattern));
}

/// Die ueberschriebenen Werte in der Form, wie sie die Engine je Objekt erwartet. Damit wirken die Einstellungen auch
/// fuer Stuetzen, die Prusa selbst druckt (Pfeiler auf dem Teil). „grid“ kennt nur der eigene Kontaktbau.
pub fn forwarded(resolved: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(keys) = resolved.get(CHANGED).and_then(Value::as_array) else { return out };
    for key in keys.iter().filter_map(Value::as_str) {
        let Some(value) = resolved.get(key) else { continue };
        let typed = match key {
            "support_material_interface_speed" | "support_material_xy_spacing" | "support_material_extrusion_width" => {
                json!({"value": value.as_f64().unwrap_or(0.0), "is_percent": false})
            }
            "support_material_interface_pattern" => match value.as_str() {
                Some(p @ ("auto" | "rectilinear" | "concentric")) => json!(p),
                _ => continue,
            },
            _ => value.clone(),
        };
        out.insert(key.to_owned(), typed);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Map<String, Value> {
        serde_json::from_value(json!({
            "layer_height": 0.2, "nozzle_diameter": 0.4, "support_material_interface_layers": 0, "support_material_speed": 50,
            "support_material_interface_spacing": 0.2, "support_material_contact_distance": 0.2
        })).unwrap()
    }

    #[test]
    fn defaults_change_nothing_of_the_process() {
        let mut resolved = base();
        let before = resolved.clone();
        apply(&mut resolved, &Settings::default());
        for (key, value) in &before {
            assert_eq!(resolved.get(key), Some(value), "{key}");
        }
    }

    #[test]
    fn overrides_replace_process_values() {
        let mut resolved = base();
        let s = Settings {
            contact_layers: 3, contact_pattern: "grid".into(), contact_loops: "on".into(), contact_angle: 45.0, contact_speed: 25.0,
            contact_z: 0.1, xy_gap: 0.8, body_speed: 40.0, line_width: 0.5, body_walls: 2, body_infill: 20.0, body_pattern: "gyroid".into(),
            ..Settings::default()
        };
        apply(&mut resolved, &s);
        assert_eq!(resolved["support_material_interface_layers"], 3);
        assert_eq!(resolved["support_material_interface_pattern"], "grid");
        assert_eq!(resolved["support_material_interface_contact_loops"], true);
        assert_eq!(resolved["support_material_angle"], 45.0);
        assert_eq!(resolved["support_material_interface_speed"], 25.0);
        assert_eq!(resolved["support_material_contact_distance"], 0.1);
        assert_eq!(resolved["support_material_xy_spacing"], 0.8);
        assert_eq!(resolved["support_material_speed"], 40.0);
        assert_eq!(resolved["support_material_extrusion_width"], 0.5);
        assert_eq!(resolved[BODY_WALLS], 2);
        assert_eq!(resolved[BODY_INFILL], 20.0);
        assert_eq!(resolved[BODY_PATTERN], "gyroid");
    }

    #[test]
    fn forwarded_values_have_engine_types_and_only_changed_keys() {
        let mut resolved = base();
        assert!(forwarded(&{
            apply(&mut resolved, &Settings::default());
            resolved.clone()
        }).is_empty());
        let mut resolved = base();
        apply(&mut resolved, &Settings {contact_speed: 25.0, contact_pattern: "grid".into(), contact_layers: 3, xy_gap: 0.6, ..Settings::default()});
        let out = forwarded(&resolved);
        assert_eq!(out["support_material_interface_speed"], json!({"value": 25.0, "is_percent": false}));
        assert_eq!(out["support_material_xy_spacing"], json!({"value": 0.6, "is_percent": false}));
        assert_eq!(out["support_material_interface_layers"], 3);
        assert!(!out.contains_key("support_material_interface_pattern"), "grid kennt Prusa nicht");
        assert!(!out.contains_key("support_material_speed"));
    }

    #[test]
    fn contact_density_becomes_line_spacing() {
        let mut resolved = base();
        apply(&mut resolved, &Settings {contact_density: 100.0, ..Settings::default()});
        assert_eq!(resolved["support_material_interface_spacing"], 0.0);
        let mut half = base();
        apply(&mut half, &Settings {contact_density: 50.0, ..Settings::default()});
        let spacing = half["support_material_interface_spacing"].as_f64().unwrap();
        assert!(spacing > 0.2 && spacing < 0.6, "{spacing}");
    }

    #[test]
    fn process_values_drive_generation_and_shape_when_switched_on() {
        let resolved: Map<String, Value> = serde_json::from_value(json!({
            "support_material_threshold": 35, "support_material_buildplate_only": true, "support_material_contact_distance": 0.15,
            "support_tree_angle": 50, "support_tree_tip_diameter": 1.2, "support_tree_branch_diameter": 4.0,
            "layer_height": 0.2, "nozzle_diameter": 0.4, "support_material_pattern": "rectilinear-grid", "support_material_spacing": 2.0,
        })).unwrap();
        let own = Settings::default();
        let s = own.from_process(&resolved);
        assert_eq!((s.overhang_angle, s.placement.as_str(), s.contact_gap), (35.0, "buildplate", 0.15));
        assert_eq!((s.branch_angle, s.tip_width, s.body_width), (50.0, 1.2, 4.0));
        assert_eq!(s.body_infill, own.body_infill, "ohne body_like_prusa bleibt die Koerperfuellung eigen");
        let like = Settings {body_like_prusa: true, ..Settings::default()}.from_process(&resolved);
        assert_eq!(like.body_pattern, "grid");
        assert_eq!(like.body_infill, 40.0); // 0.4 / 2.0 * 2 (Gitter) = 40 %
        // Ausschalten: eigene Werte bleiben
        let off = Settings {use_process: false, ..Settings::default()}.from_process(&resolved);
        assert_eq!((off.overhang_angle, off.branch_angle), (Settings::default().overhang_angle, Settings::default().branch_angle));
        // Schwelle 0 = automatisch: eigener Winkel bleibt; ungueltige Werte werden ignoriert
        let auto: Map<String, Value> = serde_json::from_value(json!({"support_material_threshold": 0, "support_tree_angle": 0})).unwrap();
        let kept = Settings::default().from_process(&auto);
        assert_eq!((kept.overhang_angle, kept.branch_angle), (Settings::default().overhang_angle, Settings::default().branch_angle));
        // Ergebnis ist immer gueltig
        assert!(s.check().is_ok() && like.check().is_ok());
        let extreme: Map<String, Value> = serde_json::from_value(json!({"support_tree_angle": 89, "support_tree_branch_diameter": 90})).unwrap();
        assert!(Settings::default().from_process(&extreme).check().is_ok());
    }

    #[test]
    fn printable_angle_follows_extra_and_prusa_overhang_parameters() {
        let good: Map<String, Value> = serde_json::from_value(json!({
            "enable_dynamic_overhang_speeds": true, "overhangs": true,
            "overhang_fan_speed_1": 100, "overhang_fan_speed_2": 100, "overhang_fan_speed_3": 100,
        })).unwrap();
        let plain = Settings::default().from_process(&good);
        assert_eq!(plain.printable_bonus, 0.0, "ohne Schalter kein Zusatzwinkel");
        assert_eq!(plain.effective_angle(), 45.0);
        let auto = Settings {printable_auto: true, ..Settings::default()}.from_process(&good);
        assert_eq!(auto.printable_bonus, 12.0);
        assert_eq!(auto.effective_angle(), 33.0);
        let manual = Settings {printable_extra: 8.0, ..Settings::default()}.from_process(&good);
        assert_eq!(manual.effective_angle(), 37.0);
        // Bonus wird nicht gestapelt, wenn die Planung wiederholt laeuft
        assert_eq!(auto.from_process(&good).effective_angle(), 33.0);
        // Grenzen
        assert_eq!(Settings {printable_extra: 30.0, overhang_angle: 20.0, ..Settings::default()}.effective_angle(), 10.0);
        assert!(Settings {printable_extra: 31.0, ..Settings::default()}.check().is_err());
        let weak: Map<String, Value> = serde_json::from_value(json!({"overhang_fan_speed_1": 50, "overhang_fan_speed_2": 100, "overhang_fan_speed_3": 100})).unwrap();
        assert_eq!(Settings {printable_auto: true, ..Settings::default()}.from_process(&weak).printable_bonus, 0.0);
    }

    #[test]
    fn invalid_values_are_rejected_by_check() {
        assert!(Settings {body_walls: 0, ..Settings::default()}.check().is_err());
        assert!(Settings {contact_pattern: "x".into(), ..Settings::default()}.check().is_err());
        assert!(Settings {contact_density: 120.0, ..Settings::default()}.check().is_err());
        assert!(Settings::default().check().is_ok());
    }
}
