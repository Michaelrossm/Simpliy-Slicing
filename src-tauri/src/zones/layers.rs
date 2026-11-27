//! Schichtanalyse: G-Code in Kopf, Schichten und Fuss zerlegen und das Schichtraster pruefen.
//! Grundlage sind die tatsaechlichen Z-Werte (`;Z:`) und Hoehen (`;HEIGHT:`) aus dem erzeugten G-Code.

/// Zahlentoleranz fuer Rundung im G-Code (mm). Echte Schichtunterschiede sind viel groesser.
pub const TOL: f64 = 1e-3;

pub struct Layer<'a> {
    pub z: f64,
    pub height: f64,
    pub block: &'a str,
    /// Byteposition des Blocks im Quelltext (fuer den Zustand davor).
    pub at: usize,
}

pub struct Parsed<'a> {
    pub text: &'a str,
    pub head: &'a str,
    pub layers: Vec<Layer<'a>>,
    pub foot: &'a str,
}

fn value_after(block: &str, key: &str) -> Option<f64> {
    block.lines().take(5).find_map(|l| l.strip_prefix(key)).and_then(|v| v.trim().parse().ok())
}

pub fn parse(text: &str) -> Parsed<'_> {
    let marks: Vec<usize> = text.match_indices(";LAYER_CHANGE\n").map(|(i, _)| i).collect();
    let Some(&first) = marks.first() else { return Parsed {text, head: text, layers: Vec::new(), foot: ""} };
    let mut layers = Vec::new();
    let mut foot = "";
    for (n, &start) in marks.iter().enumerate() {
        let mut end = marks.get(n + 1).copied().unwrap_or(text.len());
        if n + 1 == marks.len() {
            // End-G-Code der letzten Schicht beginnt beim filamentspezifischen End-G-Code oder dem ersten Custom-Abschnitt.
            let block = &text[start..end];
            let cut = ["; Filament-specific end gcode", ";TYPE:Custom", "; filament end gcode"].iter().filter_map(|m| block.find(m)).min();
            if let Some(c) = cut {
                foot = &text[start + c..end];
                end = start + c;
            }
        }
        let block = &text[start..end];
        if let Some(z) = value_after(block, ";Z:") {
            layers.push(Layer {z, height: value_after(block, ";HEIGHT:").unwrap_or(0.0), block, at: start});
        }
    }
    Parsed {text, head: &text[..first], layers, foot}
}

impl Parsed<'_> {
    /// Kurzbeschreibung fuer Fehlermeldungen: erste Schicht und vorherrschende Schichthoehe.
    pub fn describe(&self) -> String {
        let first = self.layers.first().map_or(0.0, |l| l.z);
        let mut heights: Vec<f64> = self.layers.iter().skip(1).map(|l| l.height).collect();
        heights.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let normal = heights.get(heights.len() / 2).copied().unwrap_or(first);
        let variable = heights.first().zip(heights.last()).is_some_and(|(a, b)| (b - a).abs() > TOL);
        format!("erste Schicht {} mm, Schichthöhe {} mm{}", mm(first), mm(normal), if variable { " (variabel)" } else { "" })
    }

    /// Letzte Schicht mit z < grenze.
    pub fn below(&self, z: f64) -> Option<f64> {
        self.layers.iter().map(|l| l.z).filter(|v| *v < z - TOL).fold(None, |a, v| Some(a.map_or(v, |m: f64| m.max(v))))
    }
}

pub fn mm(v: f64) -> String {
    format!("{v:.2}").replace('.', ",")
}

/// Pruefung des gemeinsamen Schichtrasters im Bereich einer Zone. `first`/`last`: Z der ersten/letzten Zonenschicht.
pub fn check_grid(base: &Parsed, part: &Parsed, first: f64, last: f64, name: &str) -> Result<(), String> {
    let within = |p: &Parsed| -> Vec<f64> { p.layers.iter().map(|l| l.z).filter(|z| *z >= first - TOL && *z <= last + TOL).collect() };
    let (a, b) = (within(base), within(part));
    let same = a.len() == b.len() && a.iter().zip(&b).all(|(x, y)| (x - y).abs() <= TOL);
    let start_ok = match (base.below(first), part.below(first)) {
        (Some(x), Some(y)) => (x - y).abs() <= TOL,
        (None, None) => true,
        _ => false,
    };
    let first_ok = match (base.layers.first(), part.layers.first()) {
        (Some(x), Some(y)) => (x.z - y.z).abs() <= TOL,
        _ => false,
    };
    if same && start_ok && first_ok {
        return Ok(());
    }
    Err(format!(
        "Die Schichthöhen der beteiligten Prozesse passen nicht zusammen. Hauptprozess: {}. Zonen-Prozess „{name}“: {}. Bitte gleiche Schichthöhen (und gleiche erste Schicht) verwenden.",
        base.describe(),
        part.describe()
    ))
}
