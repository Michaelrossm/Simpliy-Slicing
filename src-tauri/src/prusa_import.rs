//! Prusa-Dateien lesen: 3.0-Konfiguration (JSON, 3MF), 3.0-Presets (YAML) und 2.x-ini.
//! Hier wird nur gelesen und aufgeloest. Welcher Wert in Drucker, Prozess oder Material gehoert,
//! entscheidet die Oberflaeche anhand des Engine-Katalogs.
use serde_json::{json, Map, Value};
use std::io::{Cursor, Read};

/// Ein eingelesenes Preset: Art (printer, print, filament, tool), Name, Eltern und eigene Werte.
#[derive(Debug, Clone, PartialEq)]
pub struct Preset {
    pub kind: String,
    pub name: String,
    pub inherits: Vec<String>,
    pub values: Map<String, Value>,
}

pub enum Source {
    /// Vollstaendige 3.0-Konfiguration wie `--save` sie schreibt.
    Config(Value),
    Presets(Vec<Preset>),
}

pub fn read(filename: &str, data: &[u8]) -> Result<(Source, Vec<String>), String> {
    let ext = std::path::Path::new(filename).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mut notes = Vec::new();
    let source = match ext.as_str() {
        "json" => Source::Config(config_of(serde_json::from_slice(data).map_err(|e| format!("JSON ungültig: {e}"))?)?),
        "3mf" => from_3mf(data, &mut notes)?,
        "yaml" | "yml" => Source::Presets(yaml_presets(&String::from_utf8_lossy(data), &mut notes)?),
        "ini" | "cfg" => Source::Presets(ini_presets(&String::from_utf8_lossy(data))?),
        _ => return Err("Erlaubt: .json, .3mf (PrusaSlicer 3.0), .yaml (3.0-Preset), .ini (Profil oder Paket)".into()),
    };
    Ok((source, notes))
}

fn config_of(value: Value) -> Result<Value, String> {
    let value = match value.get("config_containers").and_then(|c| c.get(0)) {
        Some(first) => first.clone(),
        None => value,
    };
    if !value["configuration"].is_object() {
        return Err("Keine PrusaSlicer-3.0-Konfiguration (Feld \"configuration\" fehlt)".into());
    }
    Ok(value)
}

fn from_3mf(data: &[u8], notes: &mut Vec<String>) -> Result<Source, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| format!("3MF ungültig: {e}"))?;
    let mut read_entry = |name: &str| -> Option<String> {
        let mut file = archive.by_name(name).ok()?;
        if file.size() > 64 << 20 {
            return None;
        }
        let mut text = String::new();
        file.read_to_string(&mut text).ok()?;
        Some(text)
    };
    if let Some(text) = read_entry("Metadata/PrusaSlicer3_project.json") {
        return Ok(Source::Config(config_of(serde_json::from_str(&text).map_err(|e| e.to_string())?)?));
    }
    if let Some(text) = read_entry("Metadata/Slic3r_PE.config") {
        notes.push("3MF aus PrusaSlicer 2.x: Werte werden gegen 3.0 geprüft".into());
        let values = ini_values(&text);
        return Ok(Source::Presets(vec![Preset { kind: "config".into(), name: "3MF-Projekt".into(), inherits: vec![], values }]));
    }
    Err("Das 3MF enthält keine PrusaSlicer-Konfiguration".into())
}

fn ini_values(text: &str) -> Map<String, Value> {
    let mut values = Map::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with(';') || line.starts_with('#') || line.starts_with('[') {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            if !key.trim().is_empty() {
                values.insert(key.trim().into(), json!(value.trim()));
            }
        }
    }
    values
}

/// Einzelprofil (ohne Abschnitte, wie "Export Config") oder Paket mit [print:Name], [filament:Name], [printer:Name].
pub fn ini_presets(text: &str) -> Result<Vec<Preset>, String> {
    let mut list: Vec<Preset> = vec![Preset { kind: "config".into(), name: String::new(), inherits: vec![], values: Map::new() }];
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let head = line[1..line.len() - 1].trim();
            let (kind, name) = head.split_once(':').unwrap_or((head, ""));
            list.push(Preset { kind: kind.trim().to_ascii_lowercase(), name: name.trim().into(), inherits: vec![], values: Map::new() });
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let (key, value) = (key.trim(), value.trim());
            let last = list.last_mut().unwrap();
            if key == "inherits" {
                last.inherits = value.split(';').map(|v| v.trim().trim_matches('"').to_owned()).filter(|v| !v.is_empty()).collect();
            } else if !key.is_empty() {
                last.values.insert(key.into(), json!(value));
            }
        }
    }
    list.retain(|p| !p.values.is_empty() || !p.inherits.is_empty());
    // Abschnitte wie [presets] oder [physical_printer:...] sind keine Druckwerte.
    list.retain(|p| matches!(p.kind.as_str(), "config" | "print" | "filament" | "printer"));
    if list.is_empty() {
        return Err("Keine Einstellungen gefunden".into());
    }
    resolve_local(&mut list);
    Ok(list)
}

/// `inherits` auf Presets derselben Datei aufloesen. Uebrig bleiben nur Namen ausserhalb der Datei.
fn resolve_local(list: &mut [Preset]) {
    for _ in 0..8 {
        let mut changed = false;
        for i in 0..list.len() {
            let Some(parent_name) = list[i].inherits.first().cloned() else { continue };
            let Some(j) = list.iter().position(|p| p.kind == list[i].kind && p.name == parent_name) else { continue };
            if i == j || !list[j].inherits.is_empty() {
                continue;
            }
            let mut merged = list[j].values.clone();
            merged.extend(list[i].values.clone());
            list[i].values = merged;
            list[i].inherits.remove(0);
            changed = true;
        }
        if !changed {
            break;
        }
    }
}

/// Der Teil von YAML, den Prusa-3.0-Presets nutzen. Mehrere Dokumente mit `---`.
pub fn yaml_presets(text: &str, notes: &mut Vec<String>) -> Result<Vec<Preset>, String> {
    let mut out = Vec::new();
    for doc in text.split("\n---") {
        let mut preset = Preset { kind: String::new(), name: String::new(), inherits: vec![], values: Map::new() };
        let mut section = "";
        let mut list_key: Option<String> = None;
        for raw in doc.lines() {
            let without = strip_comment(raw);
            if without.trim().is_empty() || without.trim() == "---" {
                continue;
            }
            let indent = without.len() - without.trim_start().len();
            let line = without.trim();
            // Prusa schreibt Listen der obersten Ebene ohne Einrueckung.
            if indent == 0 && section == "inherits" {
                if let Some(item) = line.strip_prefix("- ") {
                    preset.inherits.push(scalar(item));
                    continue;
                }
            }
            if indent == 0 && section == "skip" && line.starts_with("- ") {
                continue;
            }
            if indent == 0 {
                list_key = None;
                let Some((key, value)) = line.split_once(':') else { continue };
                let value = value.trim();
                section = match key.trim() {
                    "kind" => {
                        preset.kind = scalar(value);
                        ""
                    }
                    "name" => {
                        preset.name = scalar(value);
                        ""
                    }
                    "id" if preset.name.is_empty() => {
                        preset.name = scalar(value);
                        ""
                    }
                    "inherits" => "inherits",
                    "values" => "values",
                    "variants" => {
                        notes.push(format!("„{}“: bedingte Varianten (je Drucker oder Düse) nicht übernommen", preset.name));
                        "skip"
                    }
                    _ => "",
                };
                continue;
            }
            match section {
                "inherits" => {
                    if let Some(item) = line.strip_prefix("- ") {
                        preset.inherits.push(scalar(item));
                    }
                }
                "values" if (indent <= 2 && !line.starts_with("- ")) || list_key.is_none() => {
                    if let Some((key, value)) = line.split_once(':') {
                        let value = value.trim();
                        if value.is_empty() || value == "|" || value == ">" {
                            list_key = Some(key.trim().to_owned());
                            preset.values.insert(key.trim().into(), json!([]));
                        } else {
                            list_key = None;
                            preset.values.insert(key.trim().into(), yaml_scalar(value));
                        }
                    }
                }
                "values" => {
                    let key = list_key.clone().unwrap();
                    let slot = preset.values.get_mut(&key).unwrap();
                    if let Some(item) = line.strip_prefix("- ") {
                        if let Some(items) = slot.as_array_mut() {
                            items.push(yaml_scalar(item));
                        }
                    } else {
                        // Mehrzeiliger Text (Skripte).
                        let text = match slot {
                            Value::String(s) => format!("{s}\n{line}"),
                            _ => line.to_owned(),
                        };
                        *slot = json!(text);
                    }
                }
                _ => {}
            }
        }
        if !preset.kind.is_empty() && (!preset.values.is_empty() || !preset.inherits.is_empty()) {
            out.push(preset);
        }
    }
    if out.is_empty() {
        return Err("Kein PrusaSlicer-3.0-Preset gefunden (kind, name, values)".into());
    }
    Ok(out)
}

fn strip_comment(line: &str) -> &str {
    let mut quote = None;
    for (i, c) in line.char_indices() {
        match (quote, c) {
            (None, '\'' | '"') => quote = Some(c),
            (Some(q), c) if c == q => quote = None,
            (None, '#') if i == 0 || line[..i].ends_with(' ') => return &line[..i],
            _ => {}
        }
    }
    line
}

fn scalar(value: &str) -> String {
    let v = value.trim();
    if v.len() >= 2 && ((v.starts_with('\'') && v.ends_with('\'')) || (v.starts_with('"') && v.ends_with('"'))) {
        return v[1..v.len() - 1].replace("''", "'");
    }
    v.to_owned()
}

fn yaml_scalar(value: &str) -> Value {
    let text = scalar(value);
    let quoted = value.trim().starts_with('\'') || value.trim().starts_with('"');
    if !quoted {
        match text.as_str() {
            "true" => return json!(true),
            "false" => return json!(false),
            _ => {}
        }
        if let Ok(n) = text.parse::<f64>() {
            return json!(n);
        }
    }
    json!(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ini_bundle_resolves_inherits_inside_the_file() {
        let text = "[print:Basis]\nlayer_height = 0.2\nperimeters = 2\n[print:Fein]\ninherits = Basis\nlayer_height = 0.1\n[presets]\nprint = Fein\n";
        let list = ini_presets(text).unwrap();
        let fine = list.iter().find(|p| p.name == "Fein").unwrap();
        assert_eq!(fine.values["layer_height"], json!("0.1"));
        assert_eq!(fine.values["perimeters"], json!("2"));
        assert!(fine.inherits.is_empty());
        assert!(list.iter().all(|p| p.kind != "presets"));
    }

    #[test]
    fn ini_keeps_parents_from_outside_the_file() {
        let list = ini_presets("[filament:Mein PLA]\ninherits = Prusament PLA\ntemperature = 205\n").unwrap();
        assert_eq!(list[0].inherits, vec!["Prusament PLA".to_owned()]);
    }

    #[test]
    fn yaml_preset_reads_values_lists_and_inherits() {
        let mut notes = Vec::new();
        let text = "kind: filament\ninherits:\n- 'Fiberlogy Easy ABS'\nname: Mein ABS # Kommentar\nvalues:\n  temperature: 247\n  filament_colour: '#112233'\n  compatible:\n  - 0.4\n  - 0.6\nvariants:\n- condition: x\n";
        let list = yaml_presets(text, &mut notes).unwrap();
        assert_eq!(list[0].name, "Mein ABS");
        assert_eq!(list[0].inherits, vec!["Fiberlogy Easy ABS".to_owned()]);
        assert_eq!(list[0].values["temperature"], json!(247.0));
        assert_eq!(list[0].values["filament_colour"], json!("#112233"));
        assert_eq!(list[0].values["compatible"], json!([0.4, 0.6]));
        assert_eq!(notes.len(), 1);
    }

    #[test]
    fn json_takes_the_first_container_of_a_project() {
        let project = json!({"config_containers": [{"configuration": {"print_settings": {"layer_height": 0.2}}, "preset": {}}]});
        assert_eq!(config_of(project).unwrap()["configuration"]["print_settings"]["layer_height"], json!(0.2));
        assert!(config_of(json!({"x": 1})).is_err());
    }
}
