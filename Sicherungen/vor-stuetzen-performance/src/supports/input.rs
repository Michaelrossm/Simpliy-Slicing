//! Was die Oberflaeche je Modell uebergibt, und das Modell in Bettlage.
use super::{context::Bed, generate::World, types::Data};
use crate::{mesh::Mesh, util::Affine};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    sync::{Arc, Mutex, Weak},
};

#[derive(Clone, Deserialize, Serialize)]
pub struct Part {
    pub vertices: Vec<[f64; 3]>,
    pub triangles: Vec<[u32; 3]>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInput {
    pub id: String,
    pub path: String,
    /// Kennung der Lage, wie sie im Arbeitsbereich steht.
    pub signature: String,
    pub rows: [[f64; 3]; 3],
    pub offset: [f64; 3],
    #[serde(default)]
    pub cut: bool,
    /// Angefuegte Koerper in Modellkoordinaten, sie sind auch Hindernisse.
    #[serde(default)]
    pub parts: Vec<Part>,
    #[serde(default)]
    pub stored: Value,
    /// Wirksame Prozesswerte.
    #[serde(default)]
    pub resolved: Map<String, Value>,
    #[serde(default)]
    pub range_heights: Vec<Value>,
    /// Höhenbereiche mit eigener Schichthöhe: [von, bis, Höhe] in mm über der gedruckten Unterkante.
    #[serde(default)]
    pub range_spans: Vec<[f64; 3]>,
}

impl ModelInput {
    pub fn placed(&self) -> Affine {
        Affine { rows: self.rows, offset: self.offset }
    }

    pub fn check(&self) -> Result<(), String> {
        let finite = self.rows.iter().flatten().chain(&self.offset).all(|v| v.is_finite());
        let parts_fit = self.parts.iter().all(|part| {
            part.triangles.iter().flatten().all(|&i| (i as usize) < part.vertices.len())
                && part.vertices.iter().flatten().all(|v| v.is_finite())
        });
        if finite && parts_fit {
            Ok(())
        } else {
            Err("Modelllage ist beschädigt".into())
        }
    }
}

/// Ein Modell der Anfrage samt Netz.
#[derive(Clone)]
pub struct Item {
    pub input: ModelInput,
    pub mesh: Arc<Mesh>,
    pub data: Data,
    pub stale: bool,
    pub bed: Bed,
}

impl Item {
    pub fn new(mut input: ModelInput, mesh: Arc<Mesh>, bed: Bed) -> Result<Item, String> {
        input.check()?;
        let mut data = aligned(&input);
        // Erzeugung und Form nach den Prusa-Stuetzeinstellungen des Prozesses (wenn eingeschaltet).
        data.settings = data.settings.from_process(&input.resolved);
        // Eigene Stuetz-Einstellungen gelten vor den Prozesswerten (alles auf „Prozess“ aendert nichts).
        super::overrides::apply(&mut input.resolved, &data.settings);
        let stale = data.count() > 0 && !input.signature.is_empty() && data.signature != input.signature;
        Ok(Item { input, mesh, data, stale, bed })
    }
}

/// Reines Verschieben auf dem Bett macht Stuetzen nicht ungueltig: Sie wandern mit.
pub fn aligned(input: &ModelInput) -> Data {
    let mut data = Data::read(&input.stored);
    if data.signature.is_empty() || input.signature.is_empty() || data.signature == input.signature {
        return data;
    }
    let parse = |text: &str| serde_json::from_str::<Value>(text).ok();
    let (Some(old), Some(now)) = (parse(&data.signature), parse(&input.signature)) else { return data };
    let at = |list: &Value, i: usize| list[3][i].as_f64();
    let same = |i: usize| numbers_equal(&old[i], &now[i]);
    if at(&old, 2) != at(&now, 2) || ![0, 1, 2, 4].into_iter().all(same) {
        return data;
    }
    let (Some(x0), Some(y0), Some(x1), Some(y1)) = (at(&old, 0), at(&old, 1), at(&now, 0), at(&now, 1)) else { return data };
    for support in data.automatic.iter_mut().chain(data.manual.iter_mut()) {
        support.x += x1 - x0;
        support.y += y1 - y0;
    }
    data.signature = input.signature.clone();
    data
}

/// 1 und 1.0 sind dasselbe.
fn numbers_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(p), Value::Number(q)) => p.as_f64() == q.as_f64(),
        (Value::Array(p), Value::Array(q)) => p.len() == q.len() && p.iter().zip(q).all(|(x, y)| numbers_equal(x, y)),
        _ => a == b,
    }
}

struct Known {
    mesh: Weak<Mesh>,
    place: u64,
    world: Arc<World>,
}

const KEPT_WORLDS: usize = 12;
static WORLDS: Mutex<Vec<Known>> = Mutex::new(Vec::new());

/// Bei Mausbewegungen wird dasselbe Modell immer wieder gebraucht.
pub fn world_of(item: &Item) -> Arc<World> {
    let affine = item.input.placed();
    let mut hasher = DefaultHasher::new();
    for value in affine.rows.iter().flatten().chain(&affine.offset) {
        value.to_bits().hash(&mut hasher);
    }
    let place = hasher.finish();
    let find = |known: &[Known]| {
        known
            .iter()
            .find(|k| k.place == place && k.mesh.upgrade().is_some_and(|mesh| Arc::ptr_eq(&mesh, &item.mesh)))
            .map(|k| Arc::clone(&k.world))
    };
    if let Some(world) = find(&WORLDS.lock().unwrap_or_else(|e| e.into_inner())) {
        return world;
    }
    let vertices = item
        .mesh
        .vertices
        .iter()
        .flat_map(|v| affine.apply(v.map(f64::from)))
        .collect();
    let mirrored = affine.determinant() < 0.0;
    let indices = item
        .mesh
        .triangles
        .iter()
        .flat_map(|&[a, b, c]| if mirrored { [a, c, b] } else { [a, b, c] })
        .collect();
    let world = Arc::new(World::new(vertices, indices));
    let mut known = WORLDS.lock().unwrap_or_else(|e| e.into_inner());
    known.retain(|k| k.mesh.strong_count() > 0);
    if known.len() >= KEPT_WORLDS {
        known.remove(0);
    }
    known.push(Known { mesh: Arc::downgrade(&item.mesh), place, world: Arc::clone(&world) });
    world
}
