//! Liest Prusa-FFF-G-Code fuer Vorschau und Stuetzenpruefung.
//! Werte sind die befohlenen Wege, keine Messung am Drucker.
use crate::packet::Packet;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    f64::consts::PI,
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::SystemTime,
};

pub const MAX_BYTES: u64 = 250 * 1024 * 1024;
pub const ROLE_LIMIT: usize = 64;

#[derive(Default)]
pub struct Layer {
    pub z: Option<f64>,
    /// Ende der druckenden Wege dieser Schicht.
    pub end: u32,
    pub travel_end: u32,
}

/// Spalten statt Einzelobjekte: rund 60 Byte je Weg.
#[derive(Default)]
pub struct Preview {
    pub from: Vec<f32>,
    pub to: Vec<f32>,
    pub width: Vec<f32>,
    pub height: Vec<f32>,
    pub speed: Vec<f32>,
    pub flow: Vec<f32>,
    pub fan: Vec<f32>,
    pub temperature: Vec<f32>,
    pub tool: Vec<f32>,
    pub role: Vec<u32>,
    /// 1 for paths generated from a Simpliy support object; not sent to the UI.
    pub support_origin: Vec<u8>,
    pub travel: Vec<f32>,
    pub roles: Vec<String>,
    pub layers: Vec<Layer>,
    pub diameter: f64,
    pub assumed_diameter: bool,
    pub arcs: u32,
    pub summary: Value,
}

/// Zahl ab Textanfang: [+-]? (Ziffern [. Ziffern] | . Ziffern)
fn leading_number(text: &str) -> Option<(f64, usize)> {
    let bytes = text.as_bytes();
    let mut i = usize::from(matches!(bytes.first(), Some(b'+' | b'-')));
    let digits = |i: &mut usize| {
        let start = *i;
        while bytes.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i > start
    };
    let whole = digits(&mut i);
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        let fraction = digits(&mut i);
        if !whole && !fraction {
            return None;
        }
    } else if !whole {
        return None;
    }
    text[..i].parse().ok().map(|value| (value, i))
}

/// `M106 S128`: Buchstabe am Wortanfang, dahinter die Zahl.
fn parameter(code: &str, letter: u8) -> Option<(f64, &str)> {
    let bytes = code.as_bytes();
    for at in 0..bytes.len() {
        if bytes[at] != letter || (at > 0 && bytes[at - 1].is_ascii_alphanumeric()) {
            continue;
        }
        let rest = code[at + 1..].trim_start();
        if let Some((value, length)) = leading_number(rest) {
            return Some((value, &rest[..length]));
        }
    }
    None
}

#[derive(Clone, Copy, Default)]
struct Words {
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
    e: Option<f64>,
    f: Option<f64>,
    i: Option<f64>,
    j: Option<f64>,
}

fn words(code: &str) -> Words {
    let mut out = Words::default();
    let bytes = code.as_bytes();
    let mut at = 0;
    while at < bytes.len() {
        let letter = bytes[at];
        at += 1;
        if !b"XYZEFIJKR".contains(&letter) {
            continue;
        }
        let mut start = at;
        while bytes.get(start).is_some_and(u8::is_ascii_whitespace) {
            start += 1;
        }
        let Some((value, length)) = code.get(start..).and_then(leading_number) else { continue };
        let slot = match letter {
            b'X' => &mut out.x,
            b'Y' => &mut out.y,
            b'Z' => &mut out.z,
            b'E' => &mut out.e,
            b'F' => &mut out.f,
            b'I' => &mut out.i,
            b'J' => &mut out.j,
            _ => {
                at = start + length;
                continue;
            }
        };
        *slot = Some(value);
        at = start + length;
    }
    out
}

/// G1, M106, T0, M204.1
fn command(code: &str) -> Option<&str> {
    let bytes = code.as_bytes();
    if !matches!(bytes.first(), Some(b'G' | b'M' | b'T')) {
        return None;
    }
    let mut end = 1;
    while bytes.get(end).is_some_and(u8::is_ascii_digit) {
        end += 1;
    }
    if end == 1 {
        return None;
    }
    if bytes.get(end) == Some(&b'.') && bytes.get(end + 1).is_some_and(u8::is_ascii_digit) {
        end += 2;
        while bytes.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
    }
    bytes.get(end).map_or(true, u8::is_ascii_whitespace).then(|| &code[..end])
}

struct Machine {
    position: [f64; 3],
    e: f64,
    feed: f64,
    xy_absolute: bool,
    e_absolute: bool,
    width: f64,
    height: f64,
    tool: usize,
    fan: f64,
    temperature: f64,
    temperatures: HashMap<usize, f64>,
    kind: String,
}

impl Machine {
    fn new() -> Self {
        Machine {
            position: [0.0; 3],
            e: 0.0,
            feed: 0.0,
            xy_absolute: true,
            e_absolute: true,
            width: 0.42,
            height: 0.2,
            tool: 0,
            fan: 0.0,
            temperature: 0.0,
            temperatures: HashMap::new(),
            kind: "Custom".into(),
        }
    }
}

pub fn parse(text: &str, mut progress: impl FnMut(f64)) -> Result<Preview, String> {
    let found = text.lines().find_map(|line| {
        let rest = line.strip_prefix(';')?.trim_start().strip_prefix("filament_diameter")?.trim_start().strip_prefix('=')?;
        leading_number(rest.trim_start()).map(|(value, _)| value)
    });
    let mut out = Preview { assumed_diameter: found.is_none(), diameter: found.unwrap_or(1.75), ..Preview::default() };
    let area = PI * (out.diameter / 2.0).powi(2);
    let mut m = Machine::new();
    let mut role_ids: HashMap<String, u32> = HashMap::new();
    let mut role: Option<u32> = None;
    let mut printing = false;
    let mut own_support = false;
    let mut support_ids = std::collections::HashSet::<i64>::new();
    let mut layer = Layer::default();
    let mut points: Vec<[f64; 3]> = Vec::new();
    let mut meta: [Option<&str>; 4] = [None; 4];
    const META: [&str; 4] =
        ["estimated printing time (normal mode)", "filament used [mm]", "filament used [cm3]", "filament used [g]"];
    let mut read = 0usize;

    for (number, raw) in text.split('\n').enumerate() {
        read += raw.len() + 1;
        if number % 50_000 == 49_999 {
            progress(read as f64 / text.len().max(1) as f64);
        }
        let line = raw.trim();
        if let Some(comment) = line.strip_prefix(';') {
            if let Some(name) = comment.strip_prefix(" printing object ") {
                own_support = name.starts_with("Simpliy-Stuetze");
            } else if comment.starts_with(" stop printing object ") {
                own_support = false;
            } else if comment == "LAYER_CHANGE" {
                if printing {
                    close_layer(&mut out, layer);
                }
                printing = true;
                layer = Layer::default();
            } else if let Some(kind) = comment.strip_prefix("TYPE:") {
                m.kind = kind.trim().to_owned();
                role = None;
            } else if let Some(value) = comment.strip_prefix("WIDTH:").and_then(|v| v.trim().parse::<f64>().ok()) {
                if value.is_finite() && value > 0.0 {
                    m.width = value;
                }
            } else if let Some(value) = comment.strip_prefix("HEIGHT:").and_then(|v| v.trim().parse::<f64>().ok()) {
                if value.is_finite() && value > 0.0 {
                    m.height = value;
                }
            } else if let Some(entry) = raw.trim_end().strip_prefix("; ") {
                for (slot, key) in meta.iter_mut().zip(META) {
                    if slot.is_none() {
                        *slot = entry.strip_prefix(key).and_then(|rest| rest.strip_prefix(" = ")).map(str::trim);
                    }
                }
            }
            continue;
        }
        let code = line.split(';').next().unwrap_or_default().trim();
        if code.is_empty() {
            continue;
        }
        let upper;
        let code = if code.bytes().any(|b| b.is_ascii_lowercase()) {
            upper = code.to_ascii_uppercase();
            upper.as_str()
        } else {
            code
        };
        let Some(cmd) = command(code) else { continue };
        match cmd {
            "M486" => {
                if let Some((id, _)) = parameter(code, b'S') {
                    let id = id as i64;
                    if code.contains("SIMPLIY-STUETZE") { support_ids.insert(id); }
                    own_support = support_ids.contains(&id);
                }
            },
            "G90" => m.xy_absolute = true,
            "G91" => m.xy_absolute = false,
            "M82" => m.e_absolute = true,
            "M83" => m.e_absolute = false,
            "M107" => m.fan = 0.0,
            "M106" => {
                if parameter(code, b'P').map_or(true, |(p, _)| p == 0.0) {
                    m.fan = match parameter(code, b'S') {
                        Some((value, text)) if value <= 1.0 && text.contains('.') => value * 100.0,
                        Some((value, _)) => value / 2.55,
                        None => 100.0,
                    };
                }
            }
            "M104" | "M109" => {
                if let Some((value, _)) = parameter(code, b'S').filter(|(value, _)| *value > 0.0) {
                    let at = parameter(code, b'T').map_or(m.tool, |(t, _)| t as usize);
                    m.temperatures.insert(at, value);
                    if at == m.tool {
                        m.temperature = value;
                    }
                }
            }
            "G92" => {
                let w = words(code);
                for (slot, value) in m.position.iter_mut().zip([w.x, w.y, w.z]) {
                    if let Some(value) = value {
                        *slot = value;
                    }
                }
                m.e = w.e.unwrap_or(m.e);
            }
            "G0" | "G1" | "G2" | "G3" => {
                let w = words(code);
                let [x, y, z] = m.position;
                let target = |value: Option<f64>, now: f64| value.map_or(now, |v| if m.xy_absolute { v } else { now + v });
                let next = [target(w.x, x), target(w.y, y), target(w.z, z)];
                let next_e = w.e.map_or(m.e, |v| if m.e_absolute { v } else { m.e + v });
                let pushed = next_e - m.e;
                m.feed = w.f.unwrap_or(m.feed);
                let speed = m.feed / 60.0;
                let mut distance = crate::util::hypot3(next[0] - x, next[1] - y, next[2] - z);
                points.clear();
                points.push(next);
                if cmd == "G2" || cmd == "G3" {
                    if w.i.is_some() || w.j.is_some() {
                        let (cx, cy) = (x + w.i.unwrap_or(0.0), y + w.j.unwrap_or(0.0));
                        let radius = (x - cx).hypot(y - cy);
                        let start = (y - cy).atan2(x - cx);
                        let mut sweep = (next[1] - cy).atan2(next[0] - cx) - start;
                        if cmd == "G2" && sweep >= 0.0 {
                            sweep -= 2.0 * PI;
                        } else if cmd == "G3" && sweep <= 0.0 {
                            sweep += 2.0 * PI;
                        }
                        if radius > 1e-7 && ((next[0] - cx).hypot(next[1] - cy) - radius).abs() < (radius * 0.02).max(0.1) {
                            let steps = (sweep.abs() * radius / 0.25).ceil().clamp(1.0, 500.0) as usize;
                            points.clear();
                            for i in 1..=steps {
                                let t = i as f64 / steps as f64;
                                let angle = start + sweep * t;
                                points.push(if i == steps {
                                    next
                                } else {
                                    [cx + radius * angle.cos(), cy + radius * angle.sin(), z + (next[2] - z) * t]
                                });
                            }
                            distance = (radius * sweep).hypot(next[2] - z);
                        } else {
                            out.arcs += 1;
                        }
                    } else {
                        out.arcs += 1;
                    }
                }
                if printing && distance > 1e-6 && m.kind != "Custom" {
                    let extruding = pushed > 1e-8;
                    let mut from = m.position;
                    if extruding {
                        let id = *role.get_or_insert_with(|| {
                            *role_ids.entry(m.kind.clone()).or_insert_with(|| {
                                out.roles.push(m.kind.clone());
                                out.roles.len() as u32 - 1
                            })
                        });
                        let flow = if speed > 0.0 { pushed * area * speed / distance } else { 0.0 };
                        for &point in &points {
                            out.from.extend(from.map(|v| v as f32));
                            out.to.extend(point.map(|v| v as f32));
                            out.width.push(m.width as f32);
                            out.height.push(m.height as f32);
                            out.speed.push(speed as f32);
                            out.flow.push(flow as f32);
                            out.fan.push(m.fan as f32);
                            out.temperature.push(m.temperature as f32);
                            out.tool.push(m.tool as f32);
                            out.role.push(id);
                            out.support_origin.push(u8::from(own_support));
                            from = point;
                        }
                        layer.z = Some(next[2]);
                    } else {
                        for &point in &points {
                            out.travel.extend(from.iter().chain(&point).map(|v| *v as f32));
                            from = point;
                        }
                    }
                }
                m.position = next;
                m.e = next_e;
            }
            _ => {
                if let Some(index) = cmd.strip_prefix('T').and_then(|n| n.parse::<usize>().ok()) {
                    m.tool = index;
                    m.temperature = m.temperatures.get(&index).copied().unwrap_or(m.temperature);
                }
            }
        }
    }
    if printing {
        close_layer(&mut out, layer);
    }
    if out.layers.is_empty() {
        return Err("Keine darstellbaren Prusa-FFF-Schichten gefunden.".into());
    }
    let shown = |index: usize, unit: &str| match meta[index] {
        Some(value) if !value.is_empty() => format!("{value}{unit}"),
        _ => String::new(),
    };
    out.summary = json!({"time": shown(0, ""), "length": shown(1, " mm"), "volume": shown(2, " cm3"), "weight": shown(3, " g")});
    Ok(out)
}

/// Schichten nur mit Leerfahrten zeigt die Vorschau nicht.
fn close_layer(out: &mut Preview, mut layer: Layer) {
    layer.end = out.role.len() as u32;
    layer.travel_end = (out.travel.len() / 6) as u32;
    let (end, travel_end) = out.layers.last().map_or((0, 0), |last| (last.end, last.travel_end));
    if layer.end == end {
        out.travel.truncate(travel_end as usize * 6);
        return;
    }
    out.layers.push(layer);
}

impl Preview {
    pub fn count(&self) -> usize {
        self.role.len()
    }

    pub fn packet(&self) -> Result<Vec<u8>, String> {
        let layers: Vec<Value> =
            self.layers.iter().map(|l| json!({"z": l.z, "end": l.end, "travelEnd": l.travel_end})).collect();
        let mut packet = Packet::new();
        packet.f32("from", &self.from);
        packet.f32("to", &self.to);
        packet.f32("width", &self.width);
        packet.f32("height", &self.height);
        packet.f32("speed", &self.speed);
        packet.f32("flow", &self.flow);
        packet.f32("fan", &self.fan);
        packet.f32("temperature", &self.temperature);
        packet.f32("tool", &self.tool);
        packet.u32("role", &self.role);
        packet.f32("travel", &self.travel);
        // Rollen je Schicht zaehlen hier, nicht bei jedem Reglerzug.
        let width = self.roles.len().min(ROLE_LIMIT);
        let mut counts = vec![0u32; self.layers.len() * width];
        let mut start = 0;
        for (l, layer) in self.layers.iter().enumerate() {
            for &role in &self.role[start..layer.end as usize] {
                counts[l * width + (role as usize).min(width - 1)] += 1;
            }
            start = layer.end as usize;
        }
        packet.u32("roleCounts", &counts);
        packet.finish(json!({
            "layers": layers, "roles": self.roles, "summary": self.summary, "diameter": self.diameter,
            "assumedDiameter": self.assumed_diameter, "arcs": self.arcs, "count": self.count(),
        }))
    }
}

struct Known {
    path: String,
    stamp: (u64, Option<SystemTime>),
    preview: Arc<Preview>,
}

static LAST: Mutex<Option<Known>> = Mutex::new(None);

/// Pruefung und Vorschau brauchen dieselbe Datei nacheinander.
pub fn load(path: &str, progress: impl FnMut(f64)) -> Result<Arc<Preview>, String> {
    let file = Path::new(path);
    if !file.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("gcode")) {
        return Err("Nur G-Code-Dateien werden unterstützt".into());
    }
    let meta = fs::metadata(file).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err("G-Code für die Vorschau zu groß (maximal 250 MB)".into());
    }
    let stamp = (meta.len(), meta.modified().ok());
    if let Some(known) = LAST.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if known.path == path && known.stamp == stamp {
            return Ok(Arc::clone(&known.preview));
        }
    }
    let bytes = fs::read(file).map_err(|e| format!("G-Code konnte nicht gelesen werden: {e}"))?;
    let text = String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
    let preview = Arc::new(parse(&text, progress)?);
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(Known { path: path.to_owned(), stamp, preview: Arc::clone(&preview) });
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = "; filament_diameter = 1.75\nG90\nM83\n;LAYER_CHANGE\nG1 X50 Y50 F6000\n;TYPE:External perimeter\n;WIDTH:0.45\n;HEIGHT:0.2\nG1 Z0.2\nM106 S127.5\nM104 S215\nG1 X60 E0.4 F1800\nG1 Y60\n;TYPE:Custom\nG1 X0 Y0 E1\n; estimated printing time (normal mode) = 1m 2s\n; filament used [mm] = 12.5\n";

    #[test]
    fn support_paths_keep_object_origin_for_octoprint_and_rrf_labels() {
        let g=";LAYER_CHANGE\n;TYPE:Support material\n; printing object model id:0 copy 0\nG1 X1 E1\n; printing object Simpliy-Stuetze a id:1 copy 0\nG1 X2 E2\n; stop printing object Simpliy-Stuetze a id:1 copy 0\nG1 X3 E3\n";
        assert_eq!(parse(g, |_| {}).unwrap().support_origin, vec![0,1,0]);
        let r=";LAYER_CHANGE\n;TYPE:Support material\nM486 S2 A\"Simpliy-Stuetze a\"\nG1 X1 E1\nM486 S-1\nG1 X2 E2\nM486 S2\nG1 X3 E3\n";
        assert_eq!(parse(r, |_| {}).unwrap().support_origin, vec![1,0,1]);
    }

    #[test]
    fn moves_roles_and_values_are_read() {
        let p = parse(SOURCE, |_| {}).unwrap();
        assert_eq!((p.count(), p.layers.len()), (1, 1));
        assert_eq!(p.roles, ["External perimeter"]);
        assert_eq!((p.width[0], p.height[0], p.speed[0], p.temperature[0]), (0.45, 0.2, 30.0, 215.0));
        assert!((p.fan[0] - 50.0).abs() < 1e-4);
        assert!((f64::from(p.flow[0]) - 0.4 * PI * 0.875 * 0.875 * 30.0 / 10.0).abs() < 1e-5);
        assert_eq!(p.travel.len(), 12);
        assert_eq!(p.summary["length"], "12.5 mm");
        assert_eq!(p.summary["time"], "1m 2s");
    }

    #[test]
    fn arcs_become_short_pieces_and_empty_layers_vanish() {
        let source = "G90\nM83\n;TYPE:Perimeter\n;LAYER_CHANGE\nG1 X10 Y0\n;LAYER_CHANGE\nG3 X0 Y10 I-10 J0 E1 F600\nT1\nG1 X1Y10E.2\n";
        let p = parse(source, |_| {}).unwrap();
        assert_eq!(p.layers.len(), 1);
        assert!(p.count() > 50);
        assert_eq!(p.travel.len(), 0);
        assert_eq!(*p.tool.last().unwrap(), 1.0);
        assert!(p.assumed_diameter);
        assert!(parse("G1 X1 E1\n", |_| {}).is_err());
    }
}
