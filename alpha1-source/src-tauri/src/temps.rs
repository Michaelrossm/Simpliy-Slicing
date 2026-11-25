//! Temperatur-Sollwerte pro Schicht: Die Engine kennt nur Schicht 1 und ab Schicht 2.
//! Weitere Sollwerte (ab einer bestimmten Schicht) setzt Simpliy nach dem Slicen an den Schichtwechseln ein.
use serde::Deserialize;

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct Setpoints {
    /// Je Werkzeug: (Schicht, Temperatur). M104 T<n> S<t>.
    #[serde(default)]
    pub tools: Vec<Vec<(u32, f64)>>,
    /// Druckbett: M140 S<t>.
    #[serde(default)]
    pub bed: Vec<(u32, f64)>,
    /// Bauraum: M141 S<t>.
    #[serde(default)]
    pub chamber: Vec<(u32, f64)>,
}

impl Setpoints {
    fn commands(&self, layer: u32) -> Vec<String> {
        let at = |list: &[(u32, f64)]| list.iter().rev().find(|(l, _)| *l == layer).map(|(_, t)| t.round() as i64);
        let mut out = Vec::new();
        for (tool, list) in self.tools.iter().enumerate() {
            if let Some(t) = at(list) {
                out.push(format!("M104 T{tool} S{t} ; Simpliy-Sollwert Schicht {layer}"));
            }
        }
        if let Some(t) = at(&self.bed) {
            out.push(format!("M140 S{t} ; Simpliy-Sollwert Schicht {layer}"));
        }
        if let Some(t) = at(&self.chamber) {
            out.push(format!("M141 S{t} ; Simpliy-Sollwert Schicht {layer}"));
        }
        out
    }

    fn is_empty(&self) -> bool {
        self.tools.iter().all(Vec::is_empty) && self.bed.is_empty() && self.chamber.is_empty()
    }
}

/// Fuegt die Befehle nach dem Schichtwechsel der Engine (";LAYER_CHANGE" samt ";Z:"/";HEIGHT:") ein.
pub fn apply(text: &str, setpoints: &Setpoints) -> String {
    if setpoints.is_empty() {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len() + 1024);
    let mut layer = 0u32;
    let mut pending = false;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_end();
        if pending && !(trimmed.starts_with(";Z:") || trimmed.starts_with(";HEIGHT:")) {
            pending = false;
            for command in setpoints.commands(layer) {
                out.push_str(&command);
                out.push('\n');
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
    fn setpoints_are_set_at_their_layer() {
        let mut text = String::new();
        for n in 1..=5 {
            text.push_str(&format!(";LAYER_CHANGE\n;Z:{n}\n;HEIGHT:0.2\nG1 Z{n}\n"));
        }
        let s = Setpoints { tools: vec![vec![(3, 255.0)], vec![(4, 240.0)]], bed: vec![(5, 90.0)], chamber: vec![(3, 45.0)] };
        let out = apply(&text, &s);
        assert!(out.contains(";Z:3\n;HEIGHT:0.2\nM104 T0 S255 ; Simpliy-Sollwert Schicht 3\nM141 S45"));
        assert!(out.contains(";Z:4\n;HEIGHT:0.2\nM104 T1 S240"));
        assert!(out.contains(";Z:5\n;HEIGHT:0.2\nM140 S90"));
        assert_eq!(out.matches("Simpliy-Sollwert").count(), 4);
        assert_eq!(apply(&text, &Setpoints::default()), text);
    }
}
