//! Druckerzustand aus G-Code ableiten und den Uebergang zwischen zwei Quellen berechnen.
//! Ist ein Zustand nicht sicher interpretierbar, wird der Uebergang abgelehnt statt geraten.
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct State {
    pub rel_xyz: bool,
    pub rel_e: bool,
    /// Extruderzaehler (absolut; bei relativer Extrusion mitgefuehrt).
    pub e: Option<f64>,
    /// Aktuell zurueckgezogene Filamentlaenge.
    pub retracted: f64,
    pub nozzle: Option<f64>,
    pub bed: Option<f64>,
    pub chamber: Option<f64>,
    pub fan: Option<f64>,
    pub tool_change: bool,
    pub firmware_retract: bool,
    /// Letzte Zeile je Befehl, der Druckverhalten setzt (Beschleunigung, Ruck, Vorschub-/Flussfaktor, Pressure Advance).
    pub carry: BTreeMap<String, String>,
}

const CARRY: [&str; 6] = ["M204", "M205", "M220", "M221", "M900", "M572"];

fn arg(code: &str, prefix: char) -> Option<f64> {
    code.split_whitespace().skip(1).find_map(|p| p.strip_prefix(prefix)).and_then(|v| v.parse().ok())
}

impl State {
    pub fn scan(text: &str) -> State {
        let mut s = State::default();
        for line in text.lines() {
            let code = line.split(';').next().unwrap_or("").trim();
            if code.is_empty() {
                continue;
            }
            let command = code.split_whitespace().next().unwrap_or("");
            match command {
                "G90" => s.rel_xyz = false,
                "G91" => s.rel_xyz = true,
                "M82" => s.rel_e = false,
                "M83" => s.rel_e = true,
                "G10" | "G11" => s.firmware_retract = true,
                "M104" | "M109" => s.nozzle = arg(code, 'S').or(s.nozzle),
                "M140" | "M190" => s.bed = arg(code, 'S').or(s.bed),
                "M141" | "M191" => s.chamber = arg(code, 'S').or(s.chamber),
                "M106" => s.fan = arg(code, 'S').or(Some(255.0)),
                "M107" => s.fan = Some(0.0),
                "G92" => {
                    if let Some(e) = arg(code, 'E') {
                        s.e = Some(e);
                    }
                }
                "G0" | "G1" => s.motion(code),
                c if c.len() >= 2 && c.starts_with('T') && c[1..].chars().all(|ch| ch.is_ascii_digit()) => s.tool_change = true,
                _ => {}
            }
            if CARRY.contains(&command) {
                s.carry.insert(command.to_owned(), code.to_owned());
            }
        }
        s
    }

    fn motion(&mut self, code: &str) {
        let Some(e) = arg(code, 'E') else { return };
        let delta = if self.rel_e { e } else { e - self.e.unwrap_or(0.0) };
        self.e = Some(if self.rel_e { self.e.unwrap_or(0.0) + e } else { e });
        let planar = arg(code, 'X').is_some() || arg(code, 'Y').is_some();
        if planar {
            if delta > 0.0 {
                self.retracted = 0.0;
            }
        } else if delta < 0.0 {
            self.retracted += -delta;
        } else {
            self.retracted = (self.retracted - delta).max(0.0);
        }
    }
}

/// Befehle fuer den Wechsel vom aktuellen Zustand `cur` (bisher ausgegebener G-Code) auf den, den die neue Quelle erwartet.
pub fn transition(cur: &State, new: &State) -> Result<Vec<String>, String> {
    if cur.rel_xyz || new.rel_xyz {
        return Err("relative XYZ-Koordinaten (G91) am Übergang".into());
    }
    if cur.rel_e != new.rel_e {
        return Err("absolute und relative Extrusion (M82/M83) unterscheiden sich".into());
    }
    if cur.tool_change || new.tool_change {
        return Err("Werkzeugwechsel (T…) werden in Zonen noch nicht unterstützt".into());
    }
    if cur.firmware_retract || new.firmware_retract {
        return Err("Firmware-Retraktion (G10/G11) wird in Zonen noch nicht unterstützt".into());
    }
    let mut out = Vec::new();
    // Retraktion: Das Filament soll physisch so stehen, wie die neue Quelle es erwartet.
    let diff = cur.retracted - new.retracted;
    if diff.abs() > 5.0 {
        return Err(format!("Retraktionszustand passt nicht ({:.2} mm gegen {:.2} mm)", cur.retracted, new.retracted));
    }
    if diff.abs() > 1e-4 {
        if cur.rel_e {
            out.push(format!("G1 E{diff:.5} F1800 ; Simpliy-Zone: Retraktionszustand angleichen"));
        } else {
            out.push(format!("G1 E{:.5} F1800 ; Simpliy-Zone: Retraktionszustand angleichen", cur.e.unwrap_or(0.0) + diff));
        }
    }
    if !new.rel_e {
        if let Some(e) = new.e {
            out.push(format!("G92 E{e:.5} ; Simpliy-Zone: Extruderzaehler der Quelle"));
        }
    }
    let mut set = |value: Option<f64>, old: Option<f64>, make: &dyn Fn(i64) -> String| {
        if let Some(v) = value {
            if old.is_none_or(|o| (o - v).abs() > 1e-6) {
                out.push(make(v.round() as i64));
            }
        }
    };
    set(new.nozzle, cur.nozzle, &|v| format!("M104 S{v} ; Simpliy-Zone: Duese"));
    set(new.bed, cur.bed, &|v| format!("M140 S{v} ; Simpliy-Zone: Bett"));
    set(new.chamber, cur.chamber, &|v| format!("M141 S{v} ; Simpliy-Zone: Kammer"));
    set(new.fan, cur.fan, &|v| format!("M106 S{v} ; Simpliy-Zone: Luefter"));
    for (command, line) in &new.carry {
        if cur.carry.get(command) != Some(line) {
            out.push(format!("{line} ; Simpliy-Zone: Zustand"));
        }
    }
    Ok(out)
}
