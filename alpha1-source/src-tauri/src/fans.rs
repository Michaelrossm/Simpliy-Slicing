//! Zusaetzliche Luefter: Jeder Luefter hat eine Nummer (M106 P<n>) und Sollwerte pro Schicht.
//! Die Engine kennt nur den Bauteilluefter. Simpliy setzt die Befehle nach dem Slicen an den Schichtwechseln ein.
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Fan {
    /// Lueftnummer fuer M106 P<n>.
    pub index: u32,
    #[serde(default)]
    pub name: String,
    /// (Schicht ab 1, Drehzahl in Prozent). Gilt ab dieser Schicht bis zum naechsten Sollwert.
    #[serde(default)]
    pub setpoints: Vec<(u32, f64)>,
}

impl Fan {
    /// Drehzahl (0..255) auf Schicht `layer`; vor dem ersten Sollwert aus.
    fn pwm(&self, layer: u32) -> u32 {
        let percent = self
            .setpoints
            .iter()
            .filter(|(from, _)| *from <= layer)
            .max_by_key(|(from, _)| *from)
            .map_or(0.0, |(_, p)| *p);
        (percent.clamp(0.0, 100.0) * 255.0 / 100.0).round() as u32
    }
}

/// Fuegt nach jedem Schichtwechsel der Engine (";LAYER_CHANGE" samt ";Z:"/";HEIGHT:") die Befehle der Luefter ein,
/// deren Drehzahl sich aendert. Am Druckende werden alle zusaetzlichen Luefter ausgeschaltet.
pub fn apply(text: &str, fans: &[Fan]) -> String {
    let fans: Vec<&Fan> = fans.iter().filter(|f| !f.setpoints.is_empty()).collect();
    if fans.is_empty() {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len() + 4096);
    let mut current: Vec<Option<u32>> = vec![None; fans.len()];
    let mut layer = 0u32;
    let mut pending = false;
    let mut finished = false;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end();
        if pending && !(trimmed.starts_with(";Z:") || trimmed.starts_with(";HEIGHT:")) {
            pending = false;
            for (k, fan) in fans.iter().enumerate() {
                let pwm = fan.pwm(layer);
                if current[k] != Some(pwm) {
                    out.push_str(&format!("M106 P{} S{pwm} ; Simpliy-Luefter {}\n", fan.index, fan.name));
                    current[k] = Some(pwm);
                }
            }
        }
        if !finished && trimmed.starts_with("; filament used [mm]") {
            finished = true;
            for fan in &fans {
                out.push_str(&format!("M106 P{} S0 ; Simpliy-Luefter aus\n", fan.index));
            }
        }
        out.push_str(line);
        if trimmed == ";LAYER_CHANGE" {
            layer += 1;
            pending = true;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fans_follow_their_setpoints() {
        let fan = Fan { index: 2, name: "Gehaeuse".into(), setpoints: vec![(1, 0.0), (3, 50.0), (5, 100.0)] };
        let mut text = String::new();
        for n in 1..=6 {
            text.push_str(&format!(";LAYER_CHANGE\n;Z:{n}\n;HEIGHT:0.2\nG1 Z{n}\n"));
        }
        text.push_str("M107\n; filament used [mm] = 1\n");
        let out = apply(&text, &[fan]);
        let commands: Vec<&str> = out.lines().filter(|l| l.starts_with("M106")).collect();
        assert_eq!(commands, ["M106 P2 S0 ; Simpliy-Luefter Gehaeuse", "M106 P2 S128 ; Simpliy-Luefter Gehaeuse", "M106 P2 S255 ; Simpliy-Luefter Gehaeuse", "M106 P2 S0 ; Simpliy-Luefter aus"]);
        // Der Befehl steht nach ;Z/;HEIGHT der dritten Schicht, vor deren erster Bewegung.
        assert!(out.contains(";Z:3\n;HEIGHT:0.2\nM106 P2 S128"));
        assert!(out.contains("M106 P2 S0 ; Simpliy-Luefter aus\n; filament used"));
    }

    #[test]
    fn without_fans_nothing_changes() {
        assert_eq!(apply(";LAYER_CHANGE\nG1\n", &[]), ";LAYER_CHANGE\nG1\n");
    }
}
