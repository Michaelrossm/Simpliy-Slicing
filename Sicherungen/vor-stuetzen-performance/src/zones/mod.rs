//! Prozesse mit Z-Bereich (mehrere Prozesse mit Z-Bereichen auf einem Bauteil): Das ganze Bauteil wird je Zonen-Prozess einmal mit dessen
//! Einstellungen gesliced. Danach setzt Simpliy den G-Code aus den Schichten der Quellen zusammen.
//!
//! Regeln (dokumentiert, siehe ENTWICKLUNGSSTAND.md):
//! * Eine Schicht (Oberkante z) gehoert zur Zone, wenn `von < z <= bis` gilt (halboffen). Damit hat jede Schicht genau
//!   einen Besitzer; angrenzende Zonen ergeben weder Luecke noch doppelte Schicht.
//! * Das Schichtraster (erste Schicht, alle Z-Werte im Zonenbereich) muss in Hauptprozess und Zone uebereinstimmen,
//!   sonst wird abgelehnt. Es werden keine Extrusionswerte geschaetzt oder angepasst.
//! * Ueberlappende Zonen sind ein Fehler.
//! * Bei jedem Quellenwechsel wird der Druckerzustand geprueft und nachgefuehrt (siehe `state`); unsichere Wechsel
//!   werden abgelehnt.
mod layers;
mod state;

use layers::{check_grid, parse, TOL};
use serde::Deserialize;
use state::{transition, State};

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Zone {
    /// Ab dieser Z-Hoehe (mm, exklusiv: die Schicht mit Oberkante = „von“ gehoert noch nicht zur Zone).
    #[serde(default)]
    pub from: Option<f64>,
    /// Bis zu dieser Z-Hoehe (mm, inklusiv).
    #[serde(default)]
    pub to: Option<f64>,
    /// Name des Zonen-Prozesses (fuer Meldungen und Kommentare).
    #[serde(default)]
    pub name: String,
}

pub struct Merged {
    pub text: String,
    /// Protokoll jedes Quellenwechsels (auch als Kommentar im G-Code).
    pub log: Vec<String>,
}

#[derive(Clone, Copy)]
struct Entry {
    z: f64,
    source: usize,
    index: usize,
}

/// Setzt den G-Code zusammen. `base` ist der Hauptprozess, `parts` die Zonen.
pub fn merge(base: &str, parts: &[(Zone, String)]) -> Result<Merged, String> {
    let mut sources = vec![parse(base)];
    for (_, text) in parts {
        sources.push(parse(text));
    }
    if sources[0].layers.is_empty() {
        return Err("Der G-Code des Hauptprozesses enthält keine Schichten.".into());
    }
    let label = |n: usize| if n == 0 { "Hauptprozess".to_owned() } else { format!("Zone „{}“", parts[n - 1].0.name) };

    // 1. Zonenschichten bestimmen und pruefen
    let mut spans: Vec<(usize, f64, f64)> = Vec::new(); // (Quelle, erste Z, letzte Z)
    for (n, (zone, _)) in parts.iter().enumerate() {
        let source = n + 1;
        let from = zone.from.unwrap_or(0.0);
        let mine: Vec<f64> = sources[source].layers.iter().map(|l| l.z)
            .filter(|z| *z > from + TOL && zone.to.is_none_or(|t| *z <= t + TOL)).collect();
        let (Some(&first), Some(&last)) = (mine.first(), mine.last()) else { continue };
        if sources[0].layers.first().is_some_and(|l| first <= l.z + TOL) {
            return Err(format!("Zone „{}“ beginnt in der ersten Schicht. Eine Zone muss über der ersten Schicht beginnen (Skirt, Brim und Haftung gehören zum Hauptprozess).", zone.name));
        }
        check_grid(&sources[0], &sources[source], first, last, &zone.name)?;
        spans.push((source, first, last));
    }
    for (i, a) in spans.iter().enumerate() {
        for b in &spans[i + 1..] {
            if a.1 <= b.2 + TOL && b.1 <= a.2 + TOL {
                return Err(format!("Die Zonen „{}“ und „{}“ überlappen sich (Z {:.2}–{:.2} mm und {:.2}–{:.2} mm). Bitte die Bereiche trennen.",
                    parts[a.0 - 1].0.name, parts[b.0 - 1].0.name, a.1, a.2, b.1, b.2));
            }
        }
    }

    // 2. Zeitleiste: Hauptprozess, im Zonenbereich die Zonenschichten
    let owner = |z: f64| spans.iter().find(|s| z >= s.1 - TOL && z <= s.2 + TOL).map(|s| s.0);
    let mut timeline: Vec<Entry> = Vec::new();
    for (i, l) in sources[0].layers.iter().enumerate() {
        match owner(l.z) {
            None => timeline.push(Entry {z: l.z, source: 0, index: i}),
            Some(source) => {
                if let Some(j) = sources[source].layers.iter().position(|m| (m.z - l.z).abs() <= TOL) {
                    timeline.push(Entry {z: l.z, source, index: j});
                }
            }
        }
    }

    // 3. Ausgabe mit gepruefter Zustandsuebergabe
    let mut out = String::with_capacity(base.len() + parts.iter().map(|p| p.1.len()).sum::<usize>() / 2);
    out.push_str(sources[0].head);
    let mut log = Vec::new();
    let mut current = 0usize;
    for (n, entry) in timeline.iter().enumerate() {
        let layer = &sources[entry.source].layers[entry.index];
        if entry.source != current {
            let cur = State::scan(&out);
            let new = State::scan(&sources[entry.source].text[..layer.at]);
            let reason = if entry.source == 0 { "Zonenende" } else { "Zonenbeginn" };
            let commands = transition(&cur, &new).map_err(|why| format!("Übergang bei Z {:.2} mm (Schicht {}) von {} zu {} nicht sicher: {why}.", entry.z, n + 1, label(current), label(entry.source)))?;
            let note = format!("Wechsel {} -> {} bei Z={:.2} mm, Schicht {}, Grund: {reason}", label(current), label(entry.source), entry.z, n + 1);
            out.push_str(&format!("; Simpliy-Zone: {note}\n"));
            for command in &commands {
                out.push_str(command);
                out.push('\n');
            }
            log.push(format!("{note}; Befehle: {}", if commands.is_empty() { "keine".to_owned() } else { commands.join(" | ") }));
            current = entry.source;
        }
        out.push_str(layer.block);
    }
    out.push_str(sources[0].foot);
    Ok(Merged {text: out, log})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(z: f64, h: f64, e: f64, tag: &str) -> String {
        let z = (z * 1000.0).round() / 1000.0;
        format!(";LAYER_CHANGE\n;Z:{z}\n;HEIGHT:{h}\nG1 Z{z} F720\nG1 X10 Y10 E{e} ; {tag}\n")
    }

    fn gcode(tag: &str, h: f64, temp: i32, layers: usize) -> String {
        let mut s = format!("; head\nM82\nG90\nG28\nM104 S{temp}\n");
        for i in 0..layers {
            s.push_str(&layer(h * (i + 1) as f64, h, (i + 1) as f64, tag));
        }
        s.push_str("; Filament-specific end gcode\nM104 S0\n");
        s
    }

    fn z(name: &str, from: Option<f64>, to: Option<f64>) -> Zone {
        Zone {from, to, name: name.into()}
    }

    fn tags(out: &str) -> Vec<&str> {
        out.lines().filter(|l| l.starts_with("G1 X10")).map(|l| l.rsplit("; ").next().unwrap()).collect()
    }

    #[test]
    fn same_grid_zone_replaces_layers_exactly_once() {
        let base = gcode("B", 0.2, 210, 10);
        let part = gcode("Z", 0.2, 200, 10);
        let out = merge(&base, &[(z("P2", Some(1.0), Some(1.4)), part)]).unwrap().text;
        // Grenze exakt auf Schichtgrenze: 1.0 bleibt Hauptprozess, 1.2 und 1.4 gehoeren der Zone
        assert_eq!(tags(&out), ["B", "B", "B", "B", "B", "Z", "Z", "B", "B", "B"]);
        assert_eq!(out.matches("G28").count(), 1);
        assert_eq!(out.matches("; Filament-specific end gcode").count(), 1);
    }

    #[test]
    fn boundary_between_layers_is_assigned_once() {
        let base = gcode("B", 0.2, 210, 10);
        let part = gcode("Z", 0.2, 200, 10);
        // von 1.1 liegt zwischen den Schichten 1.0 und 1.2: erste Zonenschicht ist 1.2
        let out = merge(&base, &[(z("P2", Some(1.1), Some(1.5)), part)]).unwrap().text;
        assert_eq!(tags(&out), ["B", "B", "B", "B", "B", "Z", "Z", "B", "B", "B"]);
    }

    #[test]
    fn different_layer_heights_are_rejected_with_clear_message() {
        let base = gcode("B", 0.2, 210, 10);
        let part = gcode("Z", 0.15, 200, 13);
        let err = merge(&base, &[(z("Fein", Some(1.0), Some(1.4)), part)]).err().unwrap();
        assert!(err.contains("passen nicht zusammen") && err.contains("0,20") && err.contains("0,15") && err.contains("Fein"), "{err}");
    }

    #[test]
    fn different_first_layer_is_rejected() {
        let base = gcode("B", 0.2, 210, 10);
        let mut part = String::from("; head\nM82\nG90\nM104 S200\n");
        part.push_str(&layer(0.3, 0.3, 1.0, "Z"));
        for i in 1..10 {
            part.push_str(&layer(0.3 + 0.2 * i as f64, 0.2, 1.0 + i as f64, "Z"));
        }
        part.push_str("; Filament-specific end gcode\n");
        assert!(merge(&base, &[(z("P2", Some(1.0), Some(1.4)), part)]).is_err());
    }

    #[test]
    fn variable_layer_heights_must_match_actual_z() {
        let var = |tag: &str, shift: f64| {
            let mut s = String::from("; head\nM82\nG90\n");
            for (i, zz) in [0.2, 0.4, 0.6, 0.75 + shift, 0.9 + shift, 1.1 + shift].iter().enumerate() {
                s.push_str(&layer(*zz, 0.15, (i + 1) as f64, tag));
            }
            s.push_str("; Filament-specific end gcode\n");
            s
        };
        assert!(merge(&var("B", 0.0), &[(z("P2", Some(0.5), Some(1.0)), var("Z", 0.0))]).is_ok());
        assert!(merge(&var("B", 0.0), &[(z("P2", Some(0.5), Some(1.0)), var("Z", 0.05))]).is_err());
    }

    #[test]
    fn adjacent_zones_have_no_gap_or_duplicate_and_overlap_is_an_error() {
        let base = gcode("B", 0.2, 210, 12);
        let a = gcode("A", 0.2, 200, 12);
        let b = gcode("C", 0.2, 190, 12);
        let out = merge(&base, &[(z("A", Some(0.6), Some(1.0)), a.clone()), (z("C", Some(1.0), Some(1.4)), b.clone())]).unwrap().text;
        assert_eq!(tags(&out), ["B", "B", "B", "A", "A", "C", "C", "B", "B", "B", "B", "B"]);
        let err = merge(&base, &[(z("A", Some(0.6), Some(1.2)), a), (z("C", Some(1.0), Some(1.4)), b)]).err().unwrap();
        assert!(err.contains("überlappen"), "{err}");
    }

    #[test]
    fn separate_zones_and_order_does_not_matter() {
        let base = gcode("B", 0.2, 210, 12);
        let a = gcode("A", 0.2, 200, 12);
        let c = gcode("C", 0.2, 190, 12);
        let one = merge(&base, &[(z("A", Some(0.4), Some(0.8)), a.clone()), (z("C", Some(1.4), Some(1.8)), c.clone())]).unwrap().text;
        let two = merge(&base, &[(z("C", Some(1.4), Some(1.8)), c), (z("A", Some(0.4), Some(0.8)), a)]).unwrap().text;
        assert_eq!(tags(&one), tags(&two));
    }

    #[test]
    fn extruder_counter_temperature_and_fan_carried_absolute() {
        let base = gcode("B", 0.2, 210, 10);
        let part = gcode("Z", 0.2, 200, 10);
        let m = merge(&base, &[(z("P2", Some(1.0), Some(1.4)), part)]).unwrap();
        assert!(m.text.contains("; Simpliy-Zone: Wechsel Hauptprozess -> Zone „P2“"));
        assert!(m.text.contains("M104 S200 ; Simpliy-Zone: Duese") && m.text.contains("G92 E5.00000"));
        assert!(m.text.contains("M104 S210 ; Simpliy-Zone: Duese"));
        assert_eq!(m.log.len(), 2);
    }

    #[test]
    fn relative_extrusion_gets_no_g92() {
        let rel = |tag: &str, temp: i32| {
            let mut s = format!("; head\nM83\nG90\nM104 S{temp}\n");
            for i in 0..8 {
                s.push_str(&format!(";LAYER_CHANGE\n;Z:{:.1}\n;HEIGHT:0.2\nG1 X10 Y10 E0.5 ; {tag}\n", 0.2 * (i + 1) as f64));
            }
            s.push_str("; Filament-specific end gcode\n");
            s
        };
        let out = merge(&rel("B", 210), &[(z("P2", Some(0.6), Some(1.0)), rel("Z", 200))]).unwrap().text;
        assert!(!out.contains("G92 E"));
        assert!(out.contains("M104 S200"));
    }

    #[test]
    fn retraction_difference_is_corrected_physically() {
        let mk = |tag: &str, retracted: bool| {
            let mut s = String::from("; head\nM82\nG90\n");
            for i in 0..8 {
                let e = (i + 1) as f64 * 10.0;
                s.push_str(&format!(";LAYER_CHANGE\n;Z:{:.1}\n;HEIGHT:0.2\nG1 X10 Y10 E{e} ; {tag}\n", 0.2 * (i + 1) as f64));
                if retracted {
                    s.push_str(&format!("G1 E{:.1} F2400\n", e - 0.8));
                }
            }
            s.push_str("; Filament-specific end gcode\n");
            s
        };
        // Hauptprozess endet zurueckgezogen (0.8), Zone erwartet entspannt: es muss um 0.8 nach vorn gefahren werden.
        let out = merge(&mk("B", true), &[(z("P2", Some(0.6), Some(1.0)), mk("Z", false))]).unwrap().text;
        assert!(out.contains("Retraktionszustand angleichen"), "{out}");
    }

    #[test]
    fn unsafe_states_are_rejected() {
        let base = gcode("B", 0.2, 210, 10);
        let rel_xyz = gcode("Z", 0.2, 200, 10).replacen("G90\n", "G91\n", 1);
        assert!(merge(&base, &[(z("P2", Some(1.0), Some(1.4)), rel_xyz)]).err().unwrap().contains("G91"));
        let mixed = gcode("Z", 0.2, 200, 10).replacen("M82\n", "M83\n", 1);
        assert!(merge(&base, &[(z("P2", Some(1.0), Some(1.4)), mixed)]).err().unwrap().contains("M82/M83"));
        let tools = gcode("Z", 0.2, 200, 10).replacen("G28\n", "G28\nT1\n", 1);
        assert!(merge(&base, &[(z("P2", Some(1.0), Some(1.4)), tools)]).err().unwrap().contains("Werkzeugwechsel"));
    }

    #[test]
    fn zone_starting_in_first_layer_is_rejected_and_no_zone_is_identity() {
        let base = gcode("B", 0.2, 210, 10);
        let part = gcode("Z", 0.2, 200, 10);
        assert!(merge(&base, &[(z("P2", None, Some(1.0)), part)]).err().unwrap().contains("ersten Schicht"));
        assert_eq!(merge(&base, &[]).unwrap().text, base);
    }

    #[test]
    fn open_ended_zone_runs_to_the_top_and_keeps_footer_once() {
        let base = gcode("B", 0.2, 210, 5);
        let out = merge(&base, &[(z("P2", Some(0.6), None), gcode("Z", 0.2, 200, 5))]).unwrap().text;
        assert_eq!(out.matches("; B").count(), 3);
        assert_eq!(out.matches("; Z").count(), 2);
        assert!(out.ends_with("; Filament-specific end gcode\nM104 S0\n"));
    }

    #[test]
    fn pressure_advance_is_carried() {
        let pa = |tag: &str, k: &str| {
            let mut s = format!("; head\nM82\nG90\nM900 K{k}\n");
            for i in 0..6 {
                s.push_str(&layer(0.2 * (i + 1) as f64, 0.2, (i + 1) as f64, tag));
            }
            s.push_str("; Filament-specific end gcode\n");
            s
        };
        let out = merge(&pa("B", "0.05"), &[(z("P2", Some(0.4), Some(0.8)), pa("Z", "0.10"))]).unwrap().text;
        assert!(out.contains("M900 K0.10 ; Simpliy-Zone: Zustand"));
        assert!(out.contains("M900 K0.05 ; Simpliy-Zone: Zustand"));
    }
}
