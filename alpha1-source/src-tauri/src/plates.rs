//! Platten heissen "Platte 1, 2, ...", solange der Nutzer sie nicht selbst benennt.
use serde_json::{json, Value};
use std::collections::HashSet;

fn is_default_pattern(name: &str) -> bool {
    name.trim()
        .strip_prefix("Platte ")
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

/// `named` setzt die Oberflaeche beim Umbenennen. Aeltere Arbeitsbereiche haben es nicht, dort zaehlt das Muster.
fn has_own_name(plate: &Value) -> bool {
    let name = plate["name"].as_str().unwrap_or_default().trim();
    !name.is_empty() && (plate["named"] == json!(true) || !is_default_pattern(name))
}

/// Beim Start: Standardnamen von links nach rechts ab 1, eigene Namen bleiben und werden uebersprungen.
pub fn renumber(workspace: &mut Value) {
    let Some(plates) = workspace.get_mut("plates").and_then(Value::as_array_mut) else { return };
    if plates.iter().any(|plate| !plate.is_object()) {
        return;
    }
    let taken: HashSet<String> =
        plates.iter().filter(|p| has_own_name(p)).filter_map(|p| p["name"].as_str().map(str::to_owned)).collect();
    let mut number = 0;
    for plate in plates.iter_mut() {
        if has_own_name(plate) {
            continue;
        }
        let name = loop {
            number += 1;
            let name = format!("Platte {number}");
            if !taken.contains(&name) {
                break name;
            }
        };
        plate["name"] = json!(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(mut workspace: Value) -> Vec<String> {
        renumber(&mut workspace);
        workspace["plates"].as_array().unwrap().iter().map(|p| p["name"].as_str().unwrap().to_owned()).collect()
    }

    #[test]
    fn a_single_default_plate_is_always_plate_one() {
        assert_eq!(names(json!({"plates": [{"id": "b", "name": "Platte 2"}]})), ["Platte 1"]);
    }

    #[test]
    fn own_names_stay_and_default_names_close_the_gaps() {
        let plates = json!({"plates": [
            {"id": "a", "name": "Platte 4"}, {"id": "b", "name": "Halter links"}, {"id": "c", "name": "Platte 9"},
            {"id": "d", "name": "Platte 2", "named": true}, {"id": "e", "name": ""}
        ]});
        assert_eq!(names(plates), ["Platte 1", "Halter links", "Platte 3", "Platte 2", "Platte 4"]);
    }

    #[test]
    fn a_workspace_without_plates_is_left_alone() {
        let mut workspace = json!({"schema": 1});
        renumber(&mut workspace);
        assert_eq!(workspace, json!({"schema": 1}));
    }
}
