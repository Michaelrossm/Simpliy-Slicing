//! Eigene Stuetzen. Alles Rechnende liegt hier, die Oberflaeche zeichnet nur.
mod contact;
mod contact_lines;
mod context;
mod edit;
mod field;
mod generate;
pub mod input;
pub mod inspect;
pub mod job;
mod meshes;
mod overrides;
mod placement;
pub mod plan;
mod shapes;
pub mod surface_kinds;
#[cfg(test)]
mod job_tests;
#[cfg(test)]
mod shapes_tests;
#[cfg(test)]
mod performance_tests;
#[cfg(test)]
pub(crate) mod test_support;
mod types;

pub use context::Bed;
pub use edit::{Op, Pick};
pub use types::schema;

use crate::{mesh::Mesh, packet::Packet, shading};
use input::{world_of, Item, ModelInput};
use meshes::{boxes_mesh, pillar_mesh, Pillar};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

type PillarKey = Vec<[u64; 5]>;
struct PillarGroup {
    geometry: PillarKey,
    revision: u64,
}

static PILLAR_GROUPS: Mutex<(u64, BTreeMap<String, PillarGroup>)> = Mutex::new((0, BTreeMap::new()));

fn pillar_revision(id: &str, geometry: &PillarKey) -> u64 {
    let mut cache = PILLAR_GROUPS.lock().unwrap();
    if let Some(found) = cache.1.get(id).filter(|found| &found.geometry == geometry) {
        return found.revision;
    }
    if cache.1.len() >= 4096 {
        cache.1.clear();
    }
    cache.0 += 1;
    let revision = cache.0;
    if geometry.len() <= 1024 {
        cache.1.insert(id.into(), PillarGroup { geometry: geometry.clone(), revision });
    }
    revision
}

#[derive(Clone, Deserialize)]
pub struct Plate {
    pub bed: Bed,
    pub models: Vec<ModelInput>,
    /// Werkzeuge des Druckers, nur fuers Slicen.
    #[serde(default = "one")]
    pub tools: usize,
    /// Modell, dessen tiefste Punkte markiert werden.
    #[serde(default)]
    pub marks: Option<String>,
}

fn one() -> usize {
    1
}

pub fn items_of(bed: Bed, models: Vec<ModelInput>, load: &job::LoadMesh) -> Result<Vec<Item>, String> {
    models
        .into_iter()
        .map(|input| {
            let mesh: Arc<Mesh> = load(&input.path)?;
            Item::new(input, mesh, bed)
        })
        .collect()
}

/// Alles, was Ansicht und Werkzeugfenster fuer eine Platte brauchen.
pub fn view(plate: Plate, known_pillars: HashMap<String, u64>, known_bodies: HashMap<String, u64>, optimize: bool, load: &job::LoadMesh) -> Result<Vec<u8>, String> {
    plan::begin_view();
    let result = view_inner(plate, &known_pillars, &known_bodies, optimize, load);
    plan::end_view();
    result
}

fn view_inner(plate: Plate, known_pillars: &HashMap<String, u64>, known_bodies: &HashMap<String, u64>, optimize: bool, load: &job::LoadMesh) -> Result<Vec<u8>, String> {
    let marks = plate.marks.clone();
    let items = items_of(plate.bed, plate.models, load)?;
    let clock = std::time::Instant::now();
    let plans = plan::plate_with_strategy(&items, optimize)?;
    plan::profile(&format!("view: Plan {} ms", clock.elapsed().as_millis()));
    let mut packet = Packet::new();
    let mut models = Vec::new();
    let mut transferred_pillars = 0;
    for (i, (item, plan)) in items.iter().zip(plans.iter()).enumerate() {
        let spacing = item.data.settings.spacing;
        // Etwas schmaler gezeichnet, damit einzelne Pfeiler erkennbar bleiben.
        let shown: Vec<Pillar> = plan
            .native
            .iter()
            .map(|support| {
                let size = support.width(spacing);
                Pillar { width: (size * 0.6).max(size - 0.5), ..Pillar::of(support, spacing) }
            })
            .collect();
        let mut cells = BTreeMap::<(i64, i64), PillarKey>::new();
        for pillar in &shown {
            if pillar.high <= pillar.low {
                continue;
            }
            let cell = ((pillar.x / 16.0).floor() as i64, (pillar.y / 16.0).floor() as i64);
            cells.entry(cell).or_default().push([pillar.x, pillar.y, pillar.low, pillar.high, pillar.width].map(f64::to_bits));
        }
        let mut groups = Vec::new();
        for ((x, y), mut geometry) in cells {
            geometry.sort_unstable();
            let id = format!("{}:{x}:{y}", item.input.id);
            let revision = pillar_revision(&id, &geometry);
            let array = format!("{i}.pillars.{}", groups.len());
            if known_pillars.get(&id) != Some(&revision) {
                transferred_pillars += geometry.len();
                let boxes: Vec<f32> = geometry.into_iter().flat_map(|bits| {
                    let [x, y, low, high, width] = bits.map(f64::from_bits);
                    [x, y, (low + high) / 2.0, width, width, high - low].map(|v| v as f32)
                }).collect();
                packet.f32(&array, &boxes);
            }
            groups.push(json!({"id": id, "revision": revision, "array": array}));
        }
        // Quader nur als sechs Zahlen; der Viewport zeichnet sie als Instanzen eines Einheitswürfels.
        if known_bodies.get(&item.input.id) != Some(&plan.geometry_revision) {
            let flat = |list: &[&[[f64; 6]]]| -> Vec<f32> { list.iter().flat_map(|l| l.iter()).flat_map(|b| b.iter().map(|v| *v as f32)).collect() };
            packet.f32(&format!("{i}.pads.boxes"), &flat(&[&plan.pads, &plan.strips, &plan.lines]));
            packet.f32(&format!("{i}.solids.boxes"), &flat(&[&plan.solids]));
            let (positions, normals) = shading::smooth(&plan.body.vertices, &plan.body.indices);
            packet.f32(&format!("{i}.body.positions"), &positions);
            packet.f32(&format!("{i}.body.normals"), &normals);
        }
        if marks.as_deref() == Some(item.input.id.as_str()) {
            let world = world_of(item);
            let surface = placement::Surface::analyse(&world.vertices, &world.indices, item.data.settings.effective_angle());
            let points: Vec<f32> = surface.local_minima(0.3).into_iter().take(500).flatten().map(|v| v as f32).collect();
            packet.f32(&format!("{i}.minima"), &points);
        }
        models.push(json!({
            "id": item.input.id,
            "geometryRevision": plan.geometry_revision,
            "pillarGroups": groups,
            "count": item.data.count(),
            "stale": item.stale,
            "fallback": plan.fallback,
            "substituted": plan.substituted,
            "skipped": plan.skipped,
        }));
    }
    let done = packet.finish(json!({"models": models, "transferredPillars": transferred_pillars}));
    plan::profile(&format!("view: fertig {} ms, {} Pfeiler übertragen, {} Bytes", clock.elapsed().as_millis(), transferred_pillars, done.as_ref().map_or(0, Vec::len)));
    done
}

#[derive(Deserialize)]
pub struct EditRequest {
    pub plate: Plate,
    pub id: String,
    pub op: Op,
}

fn position(items: &[Item], id: &str) -> Result<usize, String> {
    items.iter().position(|item| item.input.id == id).ok_or_else(|| "Modell fehlt".to_owned())
}

pub fn apply_edit(request: EditRequest, load: &job::LoadMesh) -> Result<Value, String> {
    let items = items_of(request.plate.bed, request.plate.models, load)?;
    let at = position(&items, &request.id)?;
    Ok(edit::apply(&items, at, request.op)?.to_json())
}

#[derive(Deserialize)]
pub struct HoverRequest {
    pub plate: Plate,
    pub id: String,
    pub mode: String,
    #[serde(default)]
    pub moving: bool,
    pub point: Pick,
}

pub fn hover(request: HoverRequest, load: &job::LoadMesh) -> Result<Vec<u8>, String> {
    let items = items_of(request.plate.bed, request.plate.models, load)?;
    let at = position(&items, &request.id)?;
    let mut packet = Packet::new();
    match edit::hover(&items, at, &request.mode, request.moving, &request.point)? {
        Some(found) => {
            packet.f32("vertices", &found.mesh.vertices);
            packet.u32("indices", &found.mesh.indices);
            packet.finish(found.meta)
        }
        None => packet.finish(Value::Null),
    }
}

/// STL aus dem, was gedruckt wird: Pfeiler, Aeste, Kontaktlagen.
pub fn export_stl(plate: Plate, id: &str, load: &job::LoadMesh) -> Result<Vec<u8>, String> {
    let items = items_of(plate.bed, plate.models, load)?;
    let at = position(&items, id)?;
    let item = &items[at];
    if item.stale {
        return Err("Modell wurde verändert. Stützen bitte erneut erzeugen.".into());
    }
    if item.data.count() == 0 {
        return Err("Keine gültigen Stützen vorhanden.".into());
    }
    let plans = plan::plate(&items)?;
    let spacing = item.data.settings.spacing;
    let pillars: Vec<Pillar> = plans[at].native.iter().map(|support| Pillar::of(support, spacing)).collect();
    let mut mesh = pillar_mesh(&pillars);
    mesh.append(&plans[at].body_mesh());
    mesh.append(&boxes_mesh(&plans[at].pads));
    mesh.append(&boxes_mesh(&plans[at].strips));
    Ok(mesh.to_stl())
}
