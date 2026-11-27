//! Alles, was das Werkzeug aendert oder unter der Maus zeigt.
use super::{
    generate,
    input::{world_of, Item},
    meshes::{pillar_mesh, Pillar, Triangles},
    plan,
    types::{is_body, number, Data, Settings, Support, MAX_STORED, SHAPE},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

const CUT: &str = "Nach dem Schneiden passen die Stützen nicht mehr. Bitte „Alle Stützen entfernen“ oder den Schnitt zurücknehmen.";
const NO_SPOT: &str = "An dieser Stelle liegt keine unterstützbare Unterseite.";
const NOT_FOUND: &str = "Keine Stütze an dieser Stelle gefunden.";
/// Aendern sich diese Werte nicht, werden automatische Stuetzen sofort neu gerechnet.
const KEEP_SUPPORTS: [&str; 3] = ["build", "existing", "heatmap"];

#[derive(Clone, Deserialize)]
pub struct Pick {
    /// surface | bed | pillar
    pub kind: String,
    pub xyz: [f64; 3],
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum Op {
    Generate { stamp: String },
    /// `keep`: nur die Einstellung merken, vorhandene automatische Stuetzen nicht neu erzeugen (Reiter Manuell).
    Setting { key: String, value: Value, stamp: String, #[serde(default)] keep: bool },
    Refresh,
    Add { point: Pick, id: String },
    Fill { point: Pick, id: String },
    Select { point: Pick },
    Move { support: String, point: Pick, stamp: String },
    Take { point: Pick },
    Edit { point: Pick, area: bool, stamp: String },
    EditAll { stamp: String },
    Remove { point: Pick, area: bool },
    /// Wischen: alle Stuetzen unter den beruehrten Punkten (ein Neuplan fuer den ganzen Strich).
    Wipe { points: Vec<Pick> },
}

#[derive(Default)]
pub struct Edited {
    /// None = nichts geaendert.
    pub data: Option<Data>,
    pub notice: Option<String>,
    pub error: bool,
    pub selected: Option<Support>,
}

impl Edited {
    fn changed(data: Data) -> Edited {
        Edited { data: Some(data), ..Edited::default() }
    }

    fn refused(text: &str) -> Edited {
        Edited { notice: Some(text.into()), error: true, ..Edited::default() }
    }

    fn with_notice(mut self, text: String) -> Edited {
        self.notice = Some(text);
        self
    }

    pub fn to_json(&self) -> Value {
        json!({"data": self.data, "notice": self.notice, "error": self.error, "selected": self.selected})
    }
}

pub fn apply(items: &[Item], at: usize, op: Op) -> Result<Edited, String> {
    let item = items.get(at).ok_or("Modell fehlt")?;
    Ok(match op {
        Op::Generate { stamp } => {
            if item.input.cut {
                return Err("Bei geschnittenen Modellen ist die eigene Stützenerzeugung noch nicht verfügbar.".into());
            }
            let before = item.data.manual.len();
            let mut fresh_item = item.clone();
            fresh_item.data.erased.clear(); // Ausdruecklich neu erzeugen: Geloeschtes kommt wieder.
            let (data, truncated) = automatic(&fresh_item, &stamp);
            let mut text = format!("{} Stützen erzeugt.", data.automatic.len());
            if before > data.manual.len() {
                text += " Alte manuelle Stützen wegen Modelländerung verworfen.";
            }
            if truncated {
                text += " Begrenzung erreicht, Ergebnis unvollständig.";
            }
            Edited::changed(data).with_notice(text)
        }
        Op::Setting { key, value, stamp, keep } => setting(item, &key, value, &stamp, keep)?,
        Op::Refresh => {
            if !item.stale {
                return Ok(Edited::default());
            }
            let (data, dropped) = refreshed(item)?;
            let mut text = "Stützen an das geänderte Modell angepasst".to_owned();
            if dropped > 0 {
                text += &format!(", {dropped} manuelle ohne passende Unterseite entfernt");
            }
            Edited::changed(data).with_notice(text)
        }
        Op::Add { point, id } => {
            let Some(made) = new_support(item, &point, &item.data.settings, &id) else { return Ok(Edited::refused(NO_SPOT)) };
            let mut data = current(item)?;
            data.manual.push(made);
            Edited::changed(data)
        }
        Op::Fill { point, id } => {
            let added = fill(item, &point, &id)?;
            if added.is_empty() {
                return Ok(Edited::refused("Hier ist keine freie Überhangfläche für weitere Stützen."));
            }
            let mut data = current(item)?;
            let count = added.len();
            data.manual.extend(added);
            data.manual.truncate(MAX_STORED);
            Edited::changed(data).with_notice(format!("{count} Stützen gesetzt."))
        }
        Op::Select { point } => match support_at(items, at, &point)? {
            Some(found) => Edited {
                selected: Some(found),
                notice: Some("Jetzt die neue Kontaktstelle anklicken.".into()),
                ..Edited::default()
            },
            None => Edited::refused(NOT_FOUND),
        },
        Op::Move { support, point, stamp } => {
            let Some(old) = item.data.all().into_iter().find(|p| p.id == support) else { return Ok(Edited::refused(NOT_FOUND)) };
            move_contact(item, &old, &point, &stamp).map_or_else(|| Edited::refused(NO_SPOT), Edited::changed)
        }
        Op::Take { point } => match support_at(items, at, &point)? {
            Some(found) => take(item, &found)?,
            None => Edited::refused(NOT_FOUND),
        },
        Op::Edit { point, area, stamp } => match selection(items, at, &point, area)? {
            Some((_, chosen)) => Edited::changed(restyled(item, &chosen, &stamp)),
            None => Edited::refused(NOT_FOUND),
        },
        Op::EditAll { stamp } => {
            if item.stale || item.data.count() == 0 {
                return Ok(Edited::default());
            }
            Edited::changed(restyled(item, &item.data.all(), &stamp))
        }
        Op::Wipe { points } => {
            let mut chosen: Vec<Support> = Vec::new();
            for point in points.iter().take(2000) {
                for found in wiped(items, at, point)? {
                    if !chosen.iter().any(|c| c.id == found.id) {
                        chosen.push(found);
                    }
                }
            }
            if chosen.is_empty() {
                return Ok(Edited::refused(NOT_FOUND));
            }
            let count = chosen.len();
            Edited::changed(without(&item.data, &chosen)).with_notice(format!("{count} Stützen entfernt."))
        }
        Op::Remove { point, area } => match selection(items, at, &point, area)? {
            Some((_, chosen)) => Edited::changed(without(&item.data, &chosen)),
            None => Edited::refused(NOT_FOUND),
        },
    })
}

fn setting(item: &Item, key: &str, value: Value, stamp: &str, keep: bool) -> Result<Edited, String> {
    let settings = item.data.settings.changed(key, value)?.from_process(&item.input.resolved);
    let regenerate = !keep && !item.data.automatic.is_empty() && settings.existing == "replace" && !KEEP_SUPPORTS.contains(&key);
    let mut changed = item.clone();
    changed.data.settings = settings;
    if !regenerate || item.input.cut {
        return Ok(Edited::changed(changed.data));
    }
    let (data, _) = automatic(&changed, stamp);
    let count = data.automatic.len();
    Ok(Edited::changed(data).with_notice(format!("Einstellung geändert: {count} Stützen neu erzeugt.")))
}

fn take(item: &Item, found: &Support) -> Result<Edited, String> {
    let mut map = serde_json::to_value(&item.data.settings).map_err(|e| e.to_string())?;
    let style = found.style().unwrap_or("pillar");
    map["style"] = json!(style);
    if let Some(shape) = &found.shape {
        for (name, ..) in SHAPE {
            if let Some(value) = shape.get(name).and_then(number) {
                map[name] = json!(value);
            }
        }
    }
    if let (Some(size), "mini") = (found.size, style) {
        map["miniWidth"] = json!(size);
    }
    let settings: Settings = serde_json::from_value(map).map_err(|e| e.to_string())?;
    settings.check()?;
    Ok(Edited::changed(Data { settings, ..item.data.clone() }).with_notice("Einstellungen der Stütze übernommen.".into()))
}

/// Automatische Stuetzen neu rechnen, manuelle behalten bzw. mit dem Modell umsetzen.
pub fn automatic(item: &Item, stamp: &str) -> (Data, bool) {
    let old = &item.data;
    let world = world_of(item);
    let made = generate::automatic(&world, &old.settings, None);
    let fresh = old.signature == item.input.signature;
    let manual = if fresh { old.manual.clone() } else { moved_manual(item, &world) };
    let spacing_here = old.settings.spacing;
    let mut list: Vec<Support> = made
        .supports
        .into_iter()
        .filter(|s| !old.erased.iter().any(|e| (e[0] - s.x).hypot(e[1] - s.y) < spacing_here * 0.6 && (e[2] - s.surface_z).abs() < spacing_here.max(1.0)))
        .collect();
    if old.settings.existing == "add" && fresh {
        let spacing = old.settings.spacing;
        let mut merged = old.automatic.clone();
        for mut new in list {
            let reach = new.width(spacing).min(spacing) * 0.8;
            let taken = old
                .automatic
                .iter()
                .chain(&manual)
                .any(|q| (q.surface_z - new.surface_z).abs() < spacing && (q.x - new.x).hypot(q.y - new.y) < reach);
            if !taken {
                new.id = format!("{}-{stamp}", new.id);
                merged.push(new);
            }
        }
        merged.truncate(MAX_STORED);
        list = merged;
    }
    let data = Data {
        signature: item.input.signature.clone(),
        automatic: list,
        manual,
        incomplete: made.truncated,
        ..old.clone()
    };
    (data, made.truncated)
}

fn moved_manual(item: &Item, world: &generate::World) -> Vec<Support> {
    let old = &item.data;
    let back = serde_json::from_str::<Value>(&old.signature).ok().and_then(|signature| {
        let rows: [[f64; 3]; 3] = serde_json::from_value(signature[2].clone()).ok()?;
        let offset: [f64; 3] = serde_json::from_value(signature[3].clone()).ok()?;
        crate::util::Affine { rows, offset }.inverse()
    });
    let forward = item.input.placed();
    let mut out = Vec::new();
    for p in &old.manual {
        let mut point = [p.x, p.y, p.surface_z];
        // Ohne gespeicherte Lage gelten die Punkte unveraendert.
        if let Some(back) = &back {
            point = forward.apply(back.apply(point));
        }
        let mut options = old.settings.clone();
        options.style = p.style().unwrap_or("pillar").to_owned();
        if let Some(mut made) = generate::at_surface(world, point, &options, &p.id) {
            made.style = p.style.clone();
            made.size = p.size;
            made.shape = p.shape.clone();
            out.push(made);
            continue;
        }
        // Kanten und tiefste Punkte haben keine Flaeche zum Anklicken: nur umsetzen.
        if p.placed.is_none() {
            continue;
        }
        let floor = (p.bottom_z + point[2] - p.surface_z).max(0.0);
        let mut moved = p.clone();
        (moved.x, moved.y, moved.surface_z) = (point[0], point[1], point[2]);
        moved.bottom_z = floor.min(point[2] - 0.3);
        moved.top_z = point[2] - old.settings.contact_gap;
        out.push(moved);
    }
    out
}

/// Nach Drehen, Skalieren oder Netzaenderung die Stuetzen nachziehen.
pub fn refreshed(item: &Item) -> Result<(Data, usize), String> {
    if item.input.cut {
        return Err(CUT.into());
    }
    let world = world_of(item);
    let old = &item.data;
    let made = (!old.automatic.is_empty()).then(|| generate::automatic(&world, &old.settings, None));
    let manual = moved_manual(item, &world);
    let dropped = old.manual.len() - manual.len();
    let data = Data {
        signature: item.input.signature.clone(),
        incomplete: made.as_ref().is_some_and(|m| m.truncated),
        automatic: made.map_or_else(Vec::new, |m| m.supports),
        manual,
        erased: Vec::new(), // Das Modell hat sich bewegt: alte Stellen gelten nicht mehr.
        ..old.clone()
    };
    Ok((data, dropped))
}

fn current(item: &Item) -> Result<Data, String> {
    if item.stale {
        return Ok(refreshed(item)?.0);
    }
    Ok(Data { signature: item.input.signature.clone(), ..item.data.clone() })
}

fn new_support(item: &Item, point: &Pick, settings: &Settings, id: &str) -> Option<Support> {
    let world = world_of(item);
    let [x, y, _] = point.xyz;
    if point.kind == "surface" {
        if let Some(made) = generate::at_surface(&world, point.xyz, settings, id) {
            return Some(made);
        }
    }
    // Auch ein Klick auf eine Oberseite kann eine Unterseite direkt darunter meinen.
    generate::at_xy(&world, x, y, settings, id)
}

/// Ganze Ueberhangflaeche unter dem angeklickten Punkt.
fn fill(item: &Item, point: &Pick, id: &str) -> Result<Vec<Support>, String> {
    if point.kind != "surface" {
        return Ok(Vec::new());
    }
    let world = world_of(item);
    let seed_settings = Settings { style: "tree".into(), min_height: 0.0, ..item.data.settings.clone() };
    let Some(face) = generate::at_surface(&world, point.xyz, &seed_settings, id).and_then(|seed| seed.face_id) else {
        return Ok(Vec::new());
    };
    let found = generate::automatic(&world, &item.data.settings, Some(face as usize)).supports;
    let all = current(item)?.all();
    Ok(found
        .into_iter()
        .filter(|p| {
            let reach = p.width(4.0).min(4.0) * 0.7;
            !all.iter().any(|q| (q.surface_z - p.surface_z).abs() < 2.0 && (q.x - p.x).hypot(q.y - p.y) < reach)
        })
        .enumerate()
        .map(|(i, p)| Support { id: format!("{id}-{i}"), source: Some("manual".into()), ..p })
        .collect())
}

fn move_contact(item: &Item, old: &Support, point: &Pick, stamp: &str) -> Option<Data> {
    let options = Settings { style: old.style().unwrap_or("pillar").to_owned(), ..item.data.settings.clone() };
    let id = if old.id.starts_with("manual") { old.id.clone() } else { format!("manual-{}-{stamp}", old.id) };
    let mut made = new_support(item, point, &options, &id)?;
    made.style = old.style.clone();
    made.size = old.size;
    made.shape = old.shape.clone();
    let mut data = without(&item.data, std::slice::from_ref(old));
    data.manual.push(made);
    Some(data)
}

/// Aenderungen machen Stuetzen manuell, damit Neu-Erzeugen sie nicht verwirft.
fn restyled(item: &Item, chosen: &[Support], stamp: &str) -> Data {
    let ids: HashSet<&str> = chosen.iter().map(|p| p.id.as_str()).collect();
    let edited: Vec<Support> = item
        .data
        .all()
        .into_iter()
        .filter(|p| ids.contains(p.id.as_str()))
        .map(|p| {
            let mut made = generate::styled(p, &item.data.settings, 0.0);
            made.source = Some("manual".into());
            if !made.id.starts_with("manual") {
                made.id = format!("manual-{}-{stamp}", made.id);
            }
            made
        })
        .collect();
    let mut data = without(&item.data, chosen);
    data.manual.extend(edited);
    data
}

fn without(data: &Data, chosen: &[Support]) -> Data {
    let ids: HashSet<&str> = chosen.iter().map(|p| p.id.as_str()).collect();
    let mut out = data.clone();
    for p in data.automatic.iter().filter(|p| ids.contains(p.id.as_str())) {
        out.erased.push([p.x, p.y, p.surface_z]);
    }
    out.automatic.retain(|p| !ids.contains(p.id.as_str()));
    out.manual.retain(|p| !ids.contains(p.id.as_str()));
    out
}

/// Alle Stuetzen, die raeumlich zusammenhaengen.
pub fn connected(list: &[Support], start: &Support) -> Vec<Support> {
    let mut left: Vec<&Support> = list.iter().filter(|p| p.id != start.id).collect();
    let mut found = vec![start.clone()];
    let mut next = 0;
    while next < found.len() {
        let at = found[next].clone();
        let reach = at.size.unwrap_or(0.0).max(4.0) * 1.8;
        left.retain(|p| {
            if (p.x - at.x).hypot(p.y - at.y) > reach || (p.surface_z - at.surface_z).abs() > reach {
                return true;
            }
            found.push((*p).clone());
            false
        });
        next += 1;
    }
    found
}

/// Naechste Stuetze zum Klick: Pfeilerkoerper, Ast oder Kontaktflaeche.
fn support_at(items: &[Item], at: usize, point: &Pick) -> Result<Option<Support>, String> {
    let item = &items[at];
    if item.stale {
        return Ok(None);
    }
    // Für die Auswahl reicht die zuletzt fertige Planung derselben Modelle (sonst vollständig planen).
    let plans = match plan::recent(items) { Some(found) if found.len() == items.len() => found, _ => plan::plate(items)? };
    let group_index = &plans[at].group_index;
    let [x, y, z] = point.xyz;
    let on_ground = point.kind == "bed";
    let mut best = None;
    let mut score = f64::INFINITY;
    for p in item.data.all() {
        let half = p.width(item.data.settings.spacing) / 2.0;
        let flat = (p.x - x).hypot(p.y - y);
        let d = if group_index.by_contact(&p.id).is_some() {
            if point.kind == "pillar" {
                flat + (p.surface_z - z).abs() * 0.25
            } else {
                let d = flat + if on_ground { 0.0 } else { (p.surface_z - z).abs() * 0.5 };
                if d > 4.0 {
                    continue;
                }
                d
            }
        } else {
            if flat > half * 1.5 + 0.5 {
                continue;
            }
            if !on_ground && (z < p.bottom_z - 0.5 || z > p.surface_z + half * 2.75) {
                continue;
            }
            flat
        };
        if d < score {
            score = d;
            best = Some(p);
        }
    }
    Ok(best)
}

/// Pinsel: die naechste Stuetze unter dem Punkt und, auf der Ueberhangflaeche, alle Kontakte im Pinselkreis.
fn wiped(items: &[Item], at: usize, point: &Pick) -> Result<Vec<Support>, String> {
    let item = &items[at];
    let mut out: Vec<Support> = support_at(items, at, point)?.into_iter().collect();
    if point.kind == "surface" {
        let radius = (item.data.settings.spacing * 2.5).max(3.0);
        let [x, y, z] = point.xyz;
        for p in item.data.all() {
            if (p.x - x).hypot(p.y - y) <= radius && (p.surface_z - z).abs() <= radius * 1.5 + 0.5 && !out.iter().any(|o| o.id == p.id) {
                out.push(p);
            }
        }
    }
    Ok(out)
}

fn selection(items: &[Item], at: usize, point: &Pick, area: bool) -> Result<Option<(Support, Vec<Support>)>, String> {
    Ok(support_at(items, at, point)?.map(|found| {
        let chosen = if area { connected(&items[at].data.all(), &found) } else { vec![found.clone()] };
        (found, chosen)
    }))
}

pub struct Hover {
    pub meta: Value,
    pub mesh: Triangles,
}

/// Was unter der Maus passieren wuerde.
pub fn hover(items: &[Item], at: usize, mode: &str, moving: bool, point: &Pick) -> Result<Option<Hover>, String> {
    let item = items.get(at).ok_or("Modell fehlt")?;
    if item.input.cut {
        return Ok(None);
    }
    let settings = &item.data.settings;
    let (found, shown, label) = match mode {
        "add" | "move" if mode == "add" || moving => {
            let Some(made) = new_support(item, point, settings, "preview") else { return Ok(None) };
            (made.clone(), vec![made], "Vorschau".to_owned())
        }
        "fill" => {
            let added = fill(item, point, "preview")?;
            let Some(first) = added.first().cloned() else { return Ok(None) };
            let count = added.len();
            (first, added, format!("{count} Stützen"))
        }
        "wipe" => {
            let chosen = wiped(items, at, point)?;
            let Some(found) = chosen.first().cloned() else { return Ok(None) };
            let label = format!("Entfernen ({})", chosen.len());
            (found, chosen, label)
        }
        _ => {
            let Some((found, chosen)) = selection(items, at, point, mode.ends_with("area"))? else { return Ok(None) };
            let word = if mode.starts_with("remove") { "Entfernen" } else { "Auswahl" };
            let label = format!("{word} ({})", chosen.len());
            (found, chosen, label)
        }
    };
    // Formen nur als kurze Marke am Kontakt, sonst saehe die Vorschau wie ein Pfeiler aus.
    let marker = |p: &Support| {
        let mut pillar = Pillar::of(p, settings.spacing);
        if is_body(p.style()) {
            pillar.width = p.shape.as_ref().and_then(|s| s.get("tipWidth")).and_then(number).filter(|w| *w > 0.0).unwrap_or(2.0);
            pillar.low = p.bottom_z.max(p.top_z - 2.0);
        }
        pillar
    };
    let mark = marker(&found);
    let meta = json!({"label": label, "x": mark.x, "y": mark.y, "low": mark.low, "high": mark.high, "width": mark.width, "count": shown.len()});
    Ok(Some(Hover { meta, mesh: pillar_mesh(&shown.iter().map(marker).collect::<Vec<_>>()) }))
}
