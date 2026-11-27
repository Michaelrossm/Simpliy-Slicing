//! Kontrollierte G-Code-Nachbearbeitung fuer Prozesszonen: Werte, die die Engine nicht je Hoehenbereich kennt
//! (Temperatur, Bett, Luefter, Leerfahrt-, Stuetz- und Retract-Geschwindigkeit), werden nach dem gemeinsamen
//! nativen Slicing je Bauteil, Schicht, Werkzeug und Bahntyp gesetzt. Es wird nichts geschaetzt: Was nicht eindeutig
//! zuzuordnen ist (z. B. zwei Bauteile mit verschiedener Temperatur im selben Werkzeug und derselben Schicht),
//! fuehrt zu einer Fehlermeldung statt zu einem stillen Kompromiss.
//!
//! Voraussetzung: Der G-Code traegt Objektmarken (`gcode_label_objects = octoprint`), Z kommt aus `;Z:`.
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Values {
    pub temperature: Option<f64>,
    pub bed_temperature: Option<f64>,
    pub min_fan: Option<f64>,
    pub max_fan: Option<f64>,
    pub bridge_fan: Option<f64>,
    pub travel_speed: Option<f64>,
    pub support_speed: Option<f64>,
    pub support_interface_speed: Option<f64>,
    pub retract_speed: Option<f64>,
    pub deretract_speed: Option<f64>,
    /// Flow (extrusion_multiplier): Faktor Zone / Hauptprozess wird auf die Extrusionsmenge angewendet.
    pub extrusion_multiplier: Option<f64>,
    pub pressure_advance: Option<f64>,
    pub default_acceleration: Option<f64>,
    pub perimeter_acceleration: Option<f64>,
    pub external_perimeter_acceleration: Option<f64>,
    pub infill_acceleration: Option<f64>,
    pub solid_infill_acceleration: Option<f64>,
    pub top_solid_infill_acceleration: Option<f64>,
    pub bridge_acceleration: Option<f64>,
}

impl Values {
    fn over(&self, base: &Values) -> Values {
        let pick = |own: Option<f64>, main: Option<f64>| own.or(main);
        Values {
            temperature: pick(self.temperature, base.temperature),
            bed_temperature: pick(self.bed_temperature, base.bed_temperature),
            min_fan: pick(self.min_fan, base.min_fan),
            max_fan: pick(self.max_fan, base.max_fan),
            bridge_fan: pick(self.bridge_fan, base.bridge_fan),
            travel_speed: pick(self.travel_speed, base.travel_speed),
            support_speed: pick(self.support_speed, base.support_speed),
            support_interface_speed: pick(self.support_interface_speed, base.support_interface_speed),
            retract_speed: pick(self.retract_speed, base.retract_speed),
            deretract_speed: pick(self.deretract_speed, base.deretract_speed),
            extrusion_multiplier: pick(self.extrusion_multiplier, base.extrusion_multiplier),
            pressure_advance: pick(self.pressure_advance, base.pressure_advance),
            default_acceleration: pick(self.default_acceleration, base.default_acceleration),
            perimeter_acceleration: pick(self.perimeter_acceleration, base.perimeter_acceleration),
            external_perimeter_acceleration: pick(self.external_perimeter_acceleration, base.external_perimeter_acceleration),
            infill_acceleration: pick(self.infill_acceleration, base.infill_acceleration),
            solid_infill_acceleration: pick(self.solid_infill_acceleration, base.solid_infill_acceleration),
            top_solid_infill_acceleration: pick(self.top_solid_infill_acceleration, base.top_solid_infill_acceleration),
            bridge_acceleration: pick(self.bridge_acceleration, base.bridge_acceleration),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Zone {
    pub from: f64,
    pub to: f64,
    pub name: String,
    pub values: Values,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Object {
    /// Nummer in der Objektmarke des G-Codes (`; printing object <name> id:0 copy 0`) = Reihenfolge der Modelle im Auftrag.
    pub index: usize,
    /// Nur für Meldungen.
    pub name: String,
    pub zones: Vec<Zone>,
}

/// Grenzen, die die Engine schon berücksichtigt hat und die eine Zone nicht aushebeln darf (0 / None = unbekannt).
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Limits {
    /// Maschinenlimit XY in mm/s (kleinster Wert aus machine_max_feedrate_x/y)
    pub max_feed_xy: Option<f64>,
    /// Maschinenlimit Extruder in mm/s
    pub max_feed_e: Option<f64>,
    /// Maximaler Volumenstrom in mm³/s (Prozess und Material, der kleinere Wert; 0 = unbegrenzt)
    pub max_volumetric: Option<f64>,
    /// Mindestschichtzeit in s (Kühlung): Wurde eine Schicht dafür verlangsamt, wird dort nicht beschleunigt.
    pub min_layer_time: Option<f64>,
    /// Maschinenlimit der Beschleunigung beim Drucken in mm/s²
    pub max_accel: Option<f64>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ZonePost {
    pub limits: Limits,
    /// G-Code-Dialekt (gcode_flavor): bestimmt die Befehle für Beschleunigung und Pressure Advance.
    pub flavor: String,
    /// Werte des Hauptprozesses je Werkzeug fuer die Temperatur, sonst gemeinsam.
    pub base: Values,
    pub base_temperatures: Vec<f64>,
    pub objects: Vec<Object>,
}

impl ZonePost {
    pub fn is_empty(&self) -> bool {
        self.objects.iter().all(|o| o.zones.is_empty())
    }

    /// Wirksame Werte eines Bauteils in der Schicht mit Oberkante `z` (Zone: von < z <= bis).
    fn effective(&self, object: usize, z: f64) -> Values {
        let zone = self.objects.iter().find(|o| o.index == object).and_then(|o| o.zones.iter().rev().find(|zone| z > zone.from + 1e-6 && z <= zone.to + 1e-6));
        zone.map_or_else(|| self.base.clone(), |zone| zone.values.over(&self.base))
    }

    fn base_temperature(&self, tool: usize) -> Option<f64> {
        self.base_temperatures.get(tool).copied().or(self.base.temperature)
    }
}

fn number(text: &str) -> Option<f64> {
    text.parse().ok()
}

fn word(line: &str, letter: char) -> Option<f64> {
    let code = line.split(';').next().unwrap_or("");
    code.split_whitespace().skip(1).find_map(|w| w.strip_prefix(letter).and_then(number))
}

/// Nummer aus „<Marke> <Name> id:<n> copy <k>“. Namen können Leerzeichen enthalten, deshalb von hinten gesucht.
fn object_id(line: &str, prefix: &str) -> Option<usize> {
    let rest = line.strip_prefix(prefix)?.trim();
    let at = rest.rfind(" id:")?;
    rest[at + 4..].split_whitespace().next()?.parse().ok()
}

fn tool_of(line: &str) -> Option<usize> {
    let code = line.split(';').next()?.trim();
    code.strip_prefix('T').and_then(|n| n.trim().parse().ok())
}

/// Beschleunigung der Bahnart: Pro Bahnart der eigene Wert, sonst die Standardbeschleunigung.
fn accel_for(kind: &str, v: &Values) -> Option<f64> {
    let own = if kind.starts_with("External perimeter") {
        v.external_perimeter_acceleration.or(v.perimeter_acceleration)
    } else if kind.starts_with("Perimeter") || kind.starts_with("Overhang perimeter") {
        v.perimeter_acceleration
    } else if kind.starts_with("Internal infill") {
        v.infill_acceleration
    } else if kind.starts_with("Solid infill") {
        v.solid_infill_acceleration
    } else if kind.starts_with("Top solid infill") {
        v.top_solid_infill_acceleration
    } else if kind.starts_with("Bridge infill") {
        v.bridge_acceleration
    } else {
        None
    };
    own.or(v.default_acceleration).filter(|a| *a > 0.0)
}

fn accel_command(flavor: &str, value: f64) -> Result<String, String> {
    match flavor {
        "klipper" => Ok(format!("SET_VELOCITY_LIMIT ACCEL={}", fmt(value))),
        "marlin2" | "reprapfirmware" => Ok(format!("M204 P{}", fmt(value))),
        "marlin" | "reprap" | "repetier" | "sprinter" | "smoothie" => Ok(format!("M204 S{}", fmt(value))),
        other => Err(format!("Beschleunigung je Zone: Dialekt „{other}“ wird nicht unterstützt.")),
    }
}

fn pressure_command(flavor: &str, value: f64) -> Result<String, String> {
    match flavor {
        "klipper" => Ok(format!("SET_PRESSURE_ADVANCE ADVANCE={}", fmt(value))),
        "reprapfirmware" => Ok(format!("M572 D0 S{}", fmt(value))),
        "marlin2" | "marlin" => Ok(format!("M900 K{}", fmt(value))),
        other => Err(format!("Pressure Advance je Zone: Dialekt „{other}“ wird nicht unterstützt.")),
    }
}

fn fmt(value: f64) -> String {
    let text = format!("{value:.3}");
    text.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// Ersetzt den Wert eines Buchstabens (z. B. E) in einer Bewegungszeile, Kommentare bleiben erhalten.
fn with_word(line: &str, letter: char, value: f64) -> String {
    let (code, comment) = match line.find(';') {
        Some(at) => (&line[..at], &line[at..]),
        None => (line, ""),
    };
    let words: Vec<String> = code.split_whitespace().map(|w| if w.starts_with(letter) && number(&w[1..]).is_some() { format!("{letter}{value:.5}") } else { w.to_owned() }).collect();
    if comment.is_empty() { words.join(" ") } else { format!("{} {}", words.join(" "), comment) }
}

/// Setzt oder ersetzt F in einer Bewegungszeile, Kommentare bleiben erhalten.
fn with_feed(line: &str, feed: f64) -> String {
    let (code, comment) = match line.find(';') {
        Some(at) => (&line[..at], &line[at..]),
        None => (line, ""),
    };
    let mut words: Vec<String> = code.split_whitespace().filter(|w| !(w.starts_with('F') && number(&w[1..]).is_some())).map(str::to_owned).collect();
    words.push(format!("F{}", fmt(feed)));
    if comment.is_empty() { words.join(" ") } else { format!("{} {}", words.join(" "), comment) }
}

/// Luefterwert (0..255) nach den Werten der Zone umrechnen. Aus bleibt aus.
fn fan(value: f64, base: &Values, wanted: &Values) -> f64 {
    if value <= 0.0 {
        return 0.0;
    }
    let pct = value / 255.0 * 100.0;
    let close = |a: Option<f64>| a.is_some_and(|a| (a - pct).abs() < 0.6);
    let target = if close(base.bridge_fan) && base.bridge_fan != base.max_fan && base.bridge_fan != base.min_fan {
        wanted.bridge_fan.unwrap_or(pct)
    } else {
        match (base.min_fan, base.max_fan, wanted.min_fan, wanted.max_fan) {
            (Some(b0), Some(b1), Some(w0), Some(w1)) => {
                if (b1 - b0).abs() < 1e-6 { w1 } else { (w0 + (pct - b0) / (b1 - b0) * (w1 - w0)).clamp(w0.min(w1), w0.max(w1)) }
            }
            _ => pct,
        }
    };
    (target.clamp(0.0, 100.0) / 100.0 * 255.0).round()
}

#[derive(Default)]
struct Layer {
    z: f64,
    /// Höhe über der gedruckten Unterkante des Bauteils (ohne Raft): Darauf beziehen sich die Zonen, wie bei den nativen Bereichen.
    model_z: f64,
    height: f64,
    has_model: bool,
    /// Druckzeit der Schicht nach dem Engine-Slicing (Strecke / Vorschub), zur Erkennung von Kühl-Verlangsamung
    seconds: f64,
    /// Bauteile mit Werkzeug, die in dieser Schicht drucken
    present: Vec<(usize, usize)>,
}

/// Erster Durchlauf: welche Bauteile drucken in welcher Schicht mit welchem Werkzeug?
fn survey(lines: &[&str]) -> Vec<Layer> {
    let mut layers: Vec<Layer> = Vec::new();
    let (mut tool, mut object) = (0usize, None::<usize>);
    let mut kind_now = String::new();
    let (mut sx, mut sy, mut sf) = (0.0f64, 0.0f64, 0.0f64);
    for line in lines {
        let line = line.trim_end();
        if line.starts_with("G1") || line.starts_with("G0") {
            if let Some(f) = word(line, 'F') { sf = f; }
            let (nx, ny) = (word(line, 'X').unwrap_or(sx), word(line, 'Y').unwrap_or(sy));
            let distance = (nx - sx).hypot(ny - sy);
            if distance > 0.0 && sf > 0.0 {
                if let Some(layer) = layers.last_mut() { layer.seconds += distance / (sf / 60.0); }
            }
            sx = nx;
            sy = ny;
        }
        if line.starts_with(";LAYER_CHANGE") {
            layers.push(Layer::default());
        } else if let Some(z) = line.strip_prefix(";Z:").and_then(|v| number(v.trim())) {
            if let Some(layer) = layers.last_mut() { layer.z = z; layer.model_z = z; }
        } else if let Some(h) = line.strip_prefix(";HEIGHT:").and_then(|v| number(v.trim())) {
            if let Some(layer) = layers.last_mut() { layer.height = h; }
        } else if let Some(kind) = line.strip_prefix(";TYPE:") {
            kind_now = kind.trim().to_owned();
        } else if let Some(id) = object_id(line, "; printing object ") {
            object = Some(id);
        } else if line.starts_with("; stop printing object") {
            object = None;
        } else if let Some(t) = tool_of(line) {
            tool = t;
        }
        if let (Some(id), Some(layer)) = (object, layers.last_mut()) {
            if line.starts_with("G1") && word(line, 'E').is_some() && !layer.present.contains(&(id, tool)) {
                layer.present.push((id, tool));
            }
        }
        // Bauteilbahnen (keine Stützen/Raft/Skirt/Turm) markieren die erste Bauteilschicht
        if line.starts_with("G1") && word(line, 'E').is_some_and(|e| e != 0.0) && object.is_some() {
            let own = !(kind_now.starts_with("Support material") || kind_now.starts_with("Skirt") || kind_now.starts_with("Wipe tower") || kind_now.starts_with("Custom"));
            if own { if let Some(layer) = layers.last_mut() { layer.has_model = true; } }
        }
    }
    // Raft: Die Unterkante des Bauteils liegt über den Raft-Schichten. Bezug der Zonen ist diese Unterkante.
    if let Some(first) = layers.iter().find(|l| l.has_model) {
        let bottom = if first.height > 0.0 { (first.z - first.height).max(0.0) } else { 0.0 };
        for layer in &mut layers { layer.model_z = layer.z - bottom; }
    }
    layers
}

/// Je Schicht ein einziger Wert: Bauteile, die sich in Bett oder Luefter widersprechen, sind ein Fehler.
struct Plan {
    bed: Option<f64>,
    fan: Values,
    pressure: Option<f64>,
    temperature: BTreeMap<usize, f64>,
}

fn plan(post: &ZonePost, layer: &Layer) -> Result<Plan, String> {
    let mut found = Plan { bed: post.base.bed_temperature, fan: post.base.clone(), pressure: post.base.pressure_advance, temperature: BTreeMap::new() };
    let mut first = true;
    let mut who = String::new();
    let label = |id: usize| post.objects.iter().find(|o| o.index == id).map_or_else(|| format!("Objekt {id}"), |o| o.name.clone());
    for (id, tool) in &layer.present {
        let name = label(*id);
        let v = post.effective(*id, layer.model_z);
        let same = |a: Option<f64>, b: Option<f64>| match (a, b) { (Some(a), Some(b)) => (a - b).abs() < 1e-6, (None, None) => true, _ => false };
        if first {
            found.bed = v.bed_temperature;
            found.fan = v.clone();
            found.pressure = v.pressure_advance;
            who = name.clone();
            first = false;
        } else if !same(v.bed_temperature, found.bed) {
            return Err(format!("Schicht Z={}: Bauteile „{who}“ und „{name}“ brauchen verschiedene Betttemperaturen ({:?} / {:?} °C). Das Bett kann nur einen Wert haben.", fmt(layer.z), found.bed, v.bed_temperature));
        } else if !same(v.pressure_advance, found.pressure) {
            return Err(format!("Schicht Z={}: Bauteile „{who}“ und „{name}“ brauchen verschiedenes Pressure Advance. Es gilt je Werkzeug und Schicht nur ein Wert.", fmt(layer.z)));
        } else if !(same(v.min_fan, found.fan.min_fan) && same(v.max_fan, found.fan.max_fan) && same(v.bridge_fan, found.fan.bridge_fan)) {
            return Err(format!("Schicht Z={}: Bauteile „{who}“ und „{name}“ brauchen verschiedene Lüfterwerte. Der Lüfter gilt für die ganze Schicht; die Zonen müssen sich hier angleichen.", fmt(layer.z)));
        }
        if let Some(t) = v.temperature.or_else(|| post.base_temperature(*tool)) {
            match found.temperature.get(tool) {
                Some(have) if (have - t).abs() > 1e-6 => {
                    return Err(format!("Schicht Z={}: Bauteile mit Werkzeug T{tool} brauchen verschiedene Düsentemperaturen ({} / {} °C). Ein Werkzeug hat nur eine Temperatur; bitte anderes Werkzeug zuweisen oder die Zonen angleichen.", fmt(layer.z), fmt(*have), fmt(t)));
                }
                _ => { found.temperature.insert(*tool, t); }
            }
        }
    }
    Ok(found)
}

/// Höhe der gedruckten Unterkante des Bauteils über dem Bett (mm): 0 ohne Raft, sonst die tatsächliche Raft-Höhe der Engine.
/// Nach dieser Höhe richten sich alle Zonen (siehe `Layer::model_z`).
pub fn part_bottom(text: &str) -> f64 {
    let lines: Vec<&str> = text.lines().collect();
    survey(&lines).iter().find(|l| l.has_model).map_or(0.0, |first| if first.height > 0.0 { (first.z - first.height).max(0.0) } else { 0.0 })
}

/// Wendet die Zonenwerte auf den G-Code an. Ohne Zonen bleibt der Text unveraendert.
pub fn apply(text: &str, post: &ZonePost) -> Result<String, String> {
    if post.is_empty() {
        return Ok(text.to_owned());
    }
    let lines: Vec<&str> = text.lines().collect();
    let layers = survey(&lines);
    let plans: Vec<Plan> = layers.iter().map(|l| plan(post, l)).collect::<Result<_, _>>()?;

    let mut out = String::with_capacity(text.len() + 4096);
    let (mut layer_at, mut in_layer) = (0usize, false);
    let (mut tool, mut object) = (0usize, None::<usize>);
    let (mut kind, mut relative) = (String::new(), false);
    let (mut e_now, mut orig_feed, mut sent_feed) = (0.0f64, f64::NAN, f64::NAN);
    let mut last_bed = post.base.bed_temperature.unwrap_or(f64::NAN);
    let (mut width, mut height_now) = (0.0f64, 0.0f64);
    let uses_accel = post.objects.iter().flat_map(|o| &o.zones).any(|z| {
        let v = &z.values;
        [v.default_acceleration, v.perimeter_acceleration, v.external_perimeter_acceleration, v.infill_acceleration, v.solid_infill_acceleration, v.top_solid_infill_acceleration, v.bridge_acceleration].iter().any(|a| a.is_some())
    });
    let mut after: Option<String> = None;
    let mut last_pa = post.base.pressure_advance;
    let mut last_accel: Option<f64> = None;
    let (mut orig_e, mut out_e) = (0.0f64, 0.0f64);
    let mut last_temp: BTreeMap<usize, f64> = BTreeMap::new();
    let mut pending_temps: Vec<String> = Vec::new();
    for line in &lines {
        let trimmed = line.trim_end();
        let mut emit = |s: &str| { out.push_str(s); out.push('\n'); };
        if trimmed.starts_with(";LAYER_CHANGE") {
            if in_layer { layer_at += 1; }
            in_layer = true;
            emit(line);
            continue;
        }
        if trimmed.starts_with(";Z:") && in_layer {
            emit(line);
            if let Some(p) = plans.get(layer_at) {
                if let Some(bed) = p.bed {
                    if last_bed.is_nan() || (bed - last_bed).abs() > 1e-6 {
                        emit(&format!("M140 S{} ; Zone: Bett", fmt(bed)));
                    }
                    last_bed = bed;
                }
                for (t, want) in &p.temperature {
                    let have = last_temp.get(t).copied().or_else(|| post.base_temperature(*t));
                    if have.is_some_and(|h| (h - want).abs() > 1e-6) {
                        let command = if have.is_some_and(|h| want > &h) { "M109" } else { "M104" };
                        pending_temps.push(format!("{command} S{} T{t} ; Zone: Düse", fmt(*want)));
                    }
                    last_temp.insert(*t, *want);
                }
            }
            if let Some(p) = plans.get(layer_at) {
                if let Some(pa) = p.pressure {
                    if last_pa.map_or(true, |l| (l - pa).abs() > 1e-9) {
                        emit(&format!("{} ; Zone: Pressure Advance", pressure_command(&post.flavor, pa)?));
                    }
                    last_pa = Some(pa);
                }
            }
            for command in pending_temps.drain(..) { emit(&command); }
            continue;
        }
        if let Some(id) = object_id(trimmed, "; printing object ") {
            object = Some(id);
        } else if trimmed.starts_with("; stop printing object") {
            object = None;
        } else if let Some(t) = tool_of(trimmed) {
            tool = t;
        } else if let Some(k) = trimmed.strip_prefix(";TYPE:") {
            kind = k.trim().to_owned();
            if uses_accel && in_layer {
                if let Some(id) = object {
                    let values = post.effective(id, layers.get(layer_at).map_or(0.0, |l| l.model_z));
                    if let Some(mut a) = accel_for(&kind, &values) {
                        if let Some(max) = post.limits.max_accel.filter(|m| *m > 0.0) { a = a.min(max); }
                        if last_accel.map_or(true, |l| (l - a).abs() > 1e-6) {
                            after = Some(format!("{} ; Zone: Beschleunigung ({kind})", accel_command(&post.flavor, a)?));
                            last_accel = Some(a);
                        }
                    }
                }
            }
        } else if let Some(v) = trimmed.strip_prefix(";WIDTH:") {
            width = number(v.trim()).unwrap_or(width);
        } else if let Some(v) = trimmed.strip_prefix(";HEIGHT:") {
            height_now = number(v.trim()).unwrap_or(height_now);
        } else if trimmed.starts_with("M83") {
            relative = true;
        } else if trimmed.starts_with("M82") {
            relative = false;
        } else if trimmed.starts_with("G92") {
            if let Some(e) = word(trimmed, 'E') { e_now = e; orig_e = e; out_e = e; }
        }
        let _ = (&object, tool);

        // Luefter je Schicht
        if trimmed.starts_with("M106") && in_layer {
            if let (Some(p), Some(s)) = (plans.get(layer_at), word(trimmed, 'S')) {
                let new = fan(s, &post.base, &p.fan);
                if (new - s).abs() > 0.5 && word(trimmed, 'P').is_none() {
                    emit(&format!("M106 S{} ; Zone (vorher S{})", fmt(new), fmt(s)));
                    continue;
                }
            }
        }
        if trimmed.starts_with("G1") || trimmed.starts_with("G0") {
            let (x, y, z, e, f) = (word(trimmed, 'X'), word(trimmed, 'Y'), word(trimmed, 'Z'), word(trimmed, 'E'), word(trimmed, 'F'));
            if let Some(f) = f { orig_feed = f; }
            // Außerhalb eines Bauteilblocks (Leerfahrt zum Bauteil): Werte des ersten Bauteils der Schicht
            // Eine einzelne Objektmarke gilt über Schichten hinweg: Zone immer aus der aktuellen Schicht bestimmen.
            let layer_z = layers.get(layer_at).map_or(0.0, |l| l.model_z);
            let own = object.filter(|_| in_layer).map(|id| post.effective(id, layer_z));
            let values = own.as_ref().or(plans.get(layer_at).filter(|_| in_layer).map(|p| &p.fan)).unwrap_or(&post.base);
            let moves_xy = x.is_some() || y.is_some();
            let mut text_line = trimmed.to_owned();
            let mut rewritten = false;
            if let Some(e_value) = e {
                // Flow: Extrusionsmenge der Bahnen mit dem Faktor Zone / Hauptprozess skalieren (Retracts bleiben unverändert)
                let factor = match (values.extrusion_multiplier, post.base.extrusion_multiplier) {
                    (Some(zone), Some(main)) if main > 0.0 && (zone - main).abs() > 1e-9 && own.is_some() => zone / main,
                    _ => 1.0,
                };
                let extruding = moves_xy && z.is_none();
                if relative {
                    if extruding && e_value > 0.0 && (factor - 1.0).abs() > 1e-9 {
                        text_line = with_word(&text_line, 'E', e_value * factor);
                        rewritten = true;
                    }
                } else {
                    let delta = e_value - orig_e;
                    orig_e = e_value;
                    out_e += if extruding && delta > 0.0 { delta * factor } else { delta };
                    if (out_e - e_value).abs() > 1e-9 {
                        text_line = with_word(&text_line, 'E', out_e);
                        rewritten = true;
                    }
                }
            }
            let mut wanted: Option<f64> = None;
            if let Some(e_value) = e {
                let delta = if relative { e_value } else { e_value - e_now };
                if !relative { e_now = e_value; }
                if !moves_xy && z.is_none() {
                    // reine Extruderbewegung: Retract oder Rueckfuehrung
                    wanted = if delta < 0.0 { values.retract_speed } else if delta > 0.0 { values.deretract_speed } else { None }.map(|v| v * 60.0);
                } else if kind.starts_with("Support material interface") {
                    wanted = values.support_interface_speed.map(|v| v * 60.0);
                } else if kind.starts_with("Support material") {
                    wanted = values.support_speed.map(|v| v * 60.0);
                }
            } else if moves_xy {
                wanted = values.travel_speed.map(|v| v * 60.0);
            }
            // Grenzen der Engine bleiben bestehen: Maschinenlimit, Volumenstrom, Kühl-Verlangsamung
            let mut capped = wanted;
            if let Some(w) = wanted {
                let limits = &post.limits;
                let mut cap = f64::INFINITY;
                if e.is_none() && moves_xy { cap = cap.min(limits.max_feed_xy.map_or(f64::INFINITY, |v| v * 60.0)); }
                if e.is_some() && !moves_xy && z.is_none() { cap = cap.min(limits.max_feed_e.map_or(f64::INFINITY, |v| v * 60.0)); }
                if e.is_some() && moves_xy {
                    if let Some(volumetric) = limits.max_volumetric.filter(|v| *v > 0.0) {
                        if width > 0.0 && height_now > 0.0 { cap = cap.min(volumetric / (width * height_now) * 60.0); }
                    }
                    // In einer von der Kühlung verlangsamten Schicht nicht schneller als die Engine
                    let slowed = limits.min_layer_time.filter(|m| *m > 0.0).zip(layers.get(layer_at)).is_some_and(|(min, l)| l.seconds > 0.0 && l.seconds <= min * 1.02 + 1e-6);
                    if slowed && !orig_feed.is_nan() { cap = cap.min(orig_feed); }
                }
                if cap.is_finite() { capped = Some(w.min(cap)); }
            }
            let want = capped.or(if orig_feed.is_nan() { None } else { Some(orig_feed) });
            if let Some(want) = want {
                // Tatsächliche Geschwindigkeit dieser Zeile: eigenes F oder das zuletzt gesendete
                let actual = f.unwrap_or(sent_feed);
                if actual.is_nan() || (actual - want).abs() > 1e-6 {
                    emit(&with_feed(&text_line, want));
                    sent_feed = want;
                    continue;
                }
                sent_feed = actual;
            } else if let Some(f) = f {
                sent_feed = f;
            }
            if rewritten { emit(&text_line); } else { emit(line); }
            continue;
        }
        emit(line);
        if let Some(command) = after.take() { emit(&command); }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post() -> ZonePost {
        ZonePost {
            limits: Limits::default(),
            flavor: String::new(),
            base: Values { temperature: Some(210.0), bed_temperature: Some(60.0), min_fan: Some(35.0), max_fan: Some(100.0), bridge_fan: Some(100.0), ..Values::default() },
            base_temperatures: vec![210.0],
            objects: vec![Object {
                index: 0,
                name: "a".into(),
                zones: vec![Zone { from: 0.4, to: 0.8, name: "heiss".into(), values: Values { temperature: Some(235.0), bed_temperature: Some(80.0), min_fan: Some(0.0), max_fan: Some(50.0), travel_speed: Some(200.0), support_speed: Some(25.0), retract_speed: Some(60.0), ..Values::default() } }],
            }],
        }
    }

    const SAMPLE: &str = "M83\nT0\n;LAYER_CHANGE\n;Z:0.2\n; printing object a id:0 copy 0\n;TYPE:Perimeter\nG1 X10 Y10 E0.5 F1800\n; stop printing object a id:0 copy 0\n;LAYER_CHANGE\n;Z:0.6\nM106 S255\n; printing object a id:0 copy 0\n;TYPE:Support material\nG1 X20 Y10 E0.4 F3000\nG1 E-0.8 F2100\nG1 X40 Y40 F9000\nG1 E0.8 F1500\nG1 X50 Y40 E0.5\n; stop printing object a id:0 copy 0\n;LAYER_CHANGE\n;Z:1.0\nM106 S255\n; printing object a id:0 copy 0\n;TYPE:Perimeter\nG1 X10 Y10 E0.5 F1800\n; stop printing object a id:0 copy 0\n";

    #[test]
    fn zone_values_apply_only_inside_the_zone() {
        let out = apply(SAMPLE, &post()).unwrap();
        // Düse und Bett wechseln beim Eintritt in die Zone und zurück danach
        let lines: Vec<&str> = out.lines().collect();
        let at = |needle: &str| lines.iter().position(|l| l.contains(needle)).unwrap_or_else(|| panic!("fehlt: {needle}\n{out}"));
        assert!(at("M109 S235 T0") > at(";Z:0.6"), "Temperatur gleich nach dem Schichtwechsel");
        assert!(lines.iter().any(|l| l.starts_with("M140 S80")));
        assert!(lines.iter().any(|l| l.starts_with("M104 S210 T0")), "zurück auf Basis:\n{out}");
        assert!(lines.iter().any(|l| l.starts_with("M140 S60")));
        // Lüfter 255 (100 %) -> 50 % = 128 nur in der Zone, danach wieder 255
        assert!(out.contains("M106 S128 ; Zone (vorher S255)"), "{out}");
        assert_eq!(out.matches("M106 S255").count(), 1);
        // Stützgeschwindigkeit 25 mm/s = 1500, Retract 60 mm/s = 3600, Leerfahrt 200 mm/s = 12000
        assert!(out.contains("G1 X20 Y10 E0.4 F1500"));
        assert!(out.contains("G1 E-0.8 F3600"));
        assert!(out.contains("G1 X40 Y40 F12000"));
        // Rückführung ohne eigene Zonenvorgabe behält ihre Geschwindigkeit, Folgezeile ihre eigene
        assert!(out.contains("G1 E0.8 F1500"), "{out}");
        // Schicht 1 (außerhalb): unverändert
        assert!(out.contains("G1 X10 Y10 E0.5 F1800"));
    }

    #[test]
    fn feedrate_inheritance_is_kept_correct() {
        // Die Folgezeile ohne F würde sonst die geänderte Leerfahrt-Geschwindigkeit erben.
        let text = ";LAYER_CHANGE\n;Z:0.6\n; printing object a id:0 copy 0\nG1 X1 Y1 F3000\nG1 X5 Y5 F9000\nG1 X9 Y9 E1\n; stop printing object a id:0 copy 0\n";
        let mut p = post();
        p.objects[0].zones[0].values.travel_speed = Some(100.0);
        let out = apply(text, &p).unwrap();
        assert!(out.contains("G1 X5 Y5 F6000"), "{out}");
        assert!(out.contains("G1 X9 Y9 E1 F9000"), "Folgezeile muss ihre ursprüngliche Geschwindigkeit zurückbekommen:\n{out}");
    }

    #[test]
    fn conflicting_objects_are_refused_with_a_message() {
        let mut p = post();
        p.objects.push(Object { index: 1, name: "b".into(), zones: vec![] });
        let text = ";LAYER_CHANGE\n;Z:0.6\n; printing object a id:0 copy 0\nG1 X1 Y1 E1 F3000\n; stop printing object a id:0 copy 0\n; printing object b id:1 copy 0\nG1 X5 Y5 E1\n; stop printing object b id:1 copy 0\n";
        let error = apply(text, &p).unwrap_err();
        assert!(error.contains("Betttemperaturen") || error.contains("Düsentemperaturen"), "{error}");
    }

    #[test]
    fn zones_are_measured_from_the_part_bottom_not_from_the_raft() {
        // Raft 0,6 mm (zwei Stützschichten), Bauteil ab Z 0,8: Zone 0,4..0,8 über dem Bauteil = Z 1,0..1,4
        let text = ";LAYER_CHANGE
;Z:0.3
;HEIGHT:0.3
; printing object a id:0 copy 0
;TYPE:Support material
G1 X1 Y1 E1 F1800
; stop printing object a id:0 copy 0
;LAYER_CHANGE
;Z:0.6
;HEIGHT:0.3
; printing object a id:0 copy 0
;TYPE:Support material interface
G1 X2 Y1 E1 F1800
; stop printing object a id:0 copy 0
;LAYER_CHANGE
;Z:0.8
;HEIGHT:0.2
; printing object a id:0 copy 0
;TYPE:Perimeter
G1 X3 Y1 E1 F1800
; stop printing object a id:0 copy 0
;LAYER_CHANGE
;Z:1.2
;HEIGHT:0.4
; printing object a id:0 copy 0
;TYPE:Perimeter
G1 X4 Y1 E1 F1800
; stop printing object a id:0 copy 0
";
        let mut p = post();
        p.objects[0].zones[0].from = 0.2;
        p.objects[0].zones[0].to = 0.6;
        let out = apply(text, &p).unwrap();
        // Bauteil-Unterkante = 0,6 (Raft) -> Zonen-Höhe der Schicht Z 1,2 ist 0,6 (in der Zone), Z 0,8 ist 0,2 (noch nicht)
        let layer = |z: &str| out.split(&format!(";Z:{z}")).nth(1).unwrap().split(";LAYER_CHANGE").next().unwrap().to_owned();
        assert!(layer("1.2").contains("M109 S235"), "Zone beginnt über der Raft-Oberkante:
{out}");
        assert!(!layer("0.8").contains("M109 S235") && !layer("0.6").contains("M109 S235"), "{out}");
    }

    #[test]
    fn limits_of_the_engine_are_not_exceeded() {
        let text = ";LAYER_CHANGE
;Z:0.6
;HEIGHT:0.2
; printing object a id:0 copy 0
;TYPE:Support material
;WIDTH:0.5
G1 X20 Y10 E0.4 F3000
G1 X40 Y40 F9000
G1 E-0.8 F2100
; stop printing object a id:0 copy 0
";
        let mut p = post();
        p.objects[0].zones[0].values.support_speed = Some(300.0); // 300 mm/s Stütze
        p.objects[0].zones[0].values.travel_speed = Some(900.0);
        p.objects[0].zones[0].values.retract_speed = Some(500.0);
        p.limits = Limits { max_feed_xy: Some(200.0), max_feed_e: Some(80.0), max_volumetric: Some(12.0), min_layer_time: None, max_accel: None };
        let out = apply(text, &p).unwrap();
        // Volumenstrom: 12 / (0,5 * 0,2) = 120 mm/s = 7200 mm/min (nicht 300 mm/s)
        assert!(out.contains("G1 X20 Y10 E0.4 F7200"), "{out}");
        assert!(out.contains("G1 X40 Y40 F12000"), "Maschinenlimit XY 200 mm/s:
{out}");
        assert!(out.contains("G1 E-0.8 F4800"), "Maschinenlimit E 80 mm/s:
{out}");
    }

    #[test]
    fn a_layer_slowed_by_the_cooling_is_not_sped_up() {
        let text = ";LAYER_CHANGE
;Z:0.6
;HEIGHT:0.2
; printing object a id:0 copy 0
;TYPE:Support material
;WIDTH:0.4
G1 X10 Y0 F3000
G1 X20 Y0 E0.4 F1200
; stop printing object a id:0 copy 0
";
        let mut p = post();
        p.objects[0].zones[0].values.support_speed = Some(100.0);
        p.limits.min_layer_time = Some(15.0); // Schicht dauert 20 s oder weniger: von der Kühlung bestimmt
        let out = apply(text, &p).unwrap();
        assert!(out.contains("G1 X20 Y0 E0.4 F1200"), "Kühl-Verlangsamung bleibt:
{out}");
    }

    fn flow_post() -> ZonePost {
        let mut p = post();
        p.flavor = "marlin2".into();
        p.base.extrusion_multiplier = Some(1.0);
        p.base.pressure_advance = Some(0.0);
        p.base.perimeter_acceleration = Some(1000.0);
        p.base.default_acceleration = Some(800.0);
        let zone = &mut p.objects[0].zones[0].values;
        *zone = Values { extrusion_multiplier: Some(0.9), pressure_advance: Some(0.05), perimeter_acceleration: Some(3000.0), ..Values::default() };
        p
    }

    #[test]
    fn flow_scales_only_extrusions_in_the_zone_absolute_and_relative() {
        // absolut: Retract und Rückführung bleiben als Differenz erhalten, danach geht E weiter ohne Sprung
        let absolute = ";LAYER_CHANGE
;Z:0.2
;HEIGHT:0.2
; printing object a id:0 copy 0
;TYPE:Perimeter
G1 X1 Y0 E1.0 F1800
;LAYER_CHANGE
;Z:0.6
;HEIGHT:0.2
G1 X2 Y0 E2.0
G1 E1.0 F2100
G1 E2.0
G1 X3 Y0 E3.0
;LAYER_CHANGE
;Z:1.0
;HEIGHT:0.2
G1 X4 Y0 E4.0
";
        let out = apply(absolute, &flow_post()).unwrap();
        // Schicht 0.2 (außerhalb): unverändert; Zone: Δ 1.0 -> 0.9
        assert!(out.contains("G1 X1 Y0 E1.0 F1800"), "{out}");
        assert!(out.contains("G1 X2 Y0 E1.90000"), "{out}");
        assert!(out.contains("G1 E0.90000 F2100"), "Retract bleibt -1.0: {out}");
        assert!(out.contains("G1 E1.90000"), "{out}");
        assert!(out.contains("G1 X3 Y0 E2.80000"), "{out}");
        // Danach wieder ungefaktort, E läuft mit dem Versatz weiter (Schicht 1.0: Δ 1.0)
        assert!(out.contains("G1 X4 Y0 E3.80000"), "{out}");
        // relativ
        let relative = "M83
;LAYER_CHANGE
;Z:0.2
;HEIGHT:0.2
; printing object a id:0 copy 0
G1 X1 Y0 E0.5 F1800
;LAYER_CHANGE
;Z:0.6
;HEIGHT:0.2
G1 X2 Y0 E1.0 F1800
G1 E-0.8 F2100
";
        let out = apply(relative, &flow_post()).unwrap();
        assert!(out.contains("G1 X2 Y0 E0.90000 F1800") && out.contains("G1 E-0.8 F2100"), "{out}");
    }

    #[test]
    fn acceleration_and_pressure_advance_follow_the_zone_and_return() {
        let text = ";LAYER_CHANGE
;Z:0.2
;HEIGHT:0.2
; printing object a id:0 copy 0
;TYPE:Perimeter
G1 X1 Y0 E1 F1800
;TYPE:Internal infill
G1 X2 Y0 E2
;LAYER_CHANGE
;Z:0.6
;HEIGHT:0.2
;TYPE:Perimeter
G1 X3 Y0 E3
;TYPE:Internal infill
G1 X4 Y0 E4
;LAYER_CHANGE
;Z:1.0
;HEIGHT:0.2
;TYPE:Perimeter
G1 X5 Y0 E5
";
        let out = apply(text, &flow_post()).unwrap();
        let lines: Vec<&str> = out.lines().collect();
        let at = |needle: &str| lines.iter().position(|l| l.contains(needle)).unwrap_or_else(|| panic!("fehlt {needle}:
{out}"));
        assert!(out.contains("M204 P1000 ; Zone: Beschleunigung (Perimeter)"), "{out}");
        assert!(out.contains("M204 P3000 ; Zone: Beschleunigung (Perimeter)"), "Zone: Wände 3000 mm/s²
{out}");
        assert!(out.contains("M204 P800"), "Infill ohne Zonenwert: Standardbeschleunigung des Hauptprozesses
{out}");
        assert!(out.contains("M900 K0.05 ; Zone: Pressure Advance"), "{out}");
        assert!(lines.iter().filter(|l| l.starts_with("M900 K0 ")).count() == 1, "Rückkehr auf K0 nach der Zone
{out}");
        // nach der Zone (Schicht 1.0) wieder die Wandbeschleunigung des Hauptprozesses
        let last_perimeter = lines.iter().rposition(|l| l.starts_with("M204 P1000")).unwrap();
        assert!(last_perimeter > at(";Z:1.0"), "{out}");
        // unbekannter Dialekt: klarer Fehler statt falscher Befehle
        let mut other = flow_post();
        other.flavor = "mach3".into();
        assert!(apply(text, &other).unwrap_err().contains("Dialekt"));
    }

    #[test]
    fn without_zones_nothing_changes() {
        assert_eq!(apply(SAMPLE, &ZonePost::default()).unwrap(), SAMPLE);
    }
}
