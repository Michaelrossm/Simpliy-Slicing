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
pub(crate) mod test_support;
mod types;

pub use context::Bed;
pub use edit::{Op, Pick};
pub use types::schema;

use crate::{mesh::Mesh, packet::Packet, shading};
use input::{world_of, Item, ModelInput};
use meshes::{pillar_mesh, Pillar};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

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
pub fn view(plate: Plate, load: &job::LoadMesh) -> Result<Vec<u8>, String> {
    let marks = plate.marks.clone();
    let items = items_of(plate.bed, plate.models, load)?;
    let clock = std::time::Instant::now();
    let plans = plan::plate(&items)?;
    plan::profile(&format!("view: Plan {} ms", clock.elapsed().as_millis()));
    let mut packet = Packet::new();
    let mut models = Vec::new();
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
        let mut pads = plan.pads.clone();
        pads.append(&plan.strips);
        pads.append(&plan.lines);
        for (name, mesh) in [("pillars", pillar_mesh(&shown)), ("pads", pads)] {
            packet.f32(&format!("{i}.{name}.vertices"), &mesh.vertices);
            packet.u32(&format!("{i}.{name}.indices"), &mesh.indices);
        }
        plan::profile(&format!("view: Pfeiler/Polster {} ms ({} Pfeiler)", clock.elapsed().as_millis(), shown.len()));
        let (positions, normals) = shading::smooth(&plan.body.vertices, &plan.body.indices);
        packet.f32(&format!("{i}.body.positions"), &positions);
        packet.f32(&format!("{i}.body.normals"), &normals);
        plan::profile(&format!("view: Koerper {} ms ({} Ecken)", clock.elapsed().as_millis(), plan.body.indices.len()));
        if marks.as_deref() == Some(item.input.id.as_str()) {
            let world = world_of(item);
            let surface = placement::Surface::analyse(&world.vertices, &world.indices, item.data.settings.effective_angle());
            let points: Vec<f32> = surface.local_minima(0.3).into_iter().take(500).flatten().map(|v| v as f32).collect();
            packet.f32(&format!("{i}.minima"), &points);
        }
        models.push(json!({
            "id": item.input.id,
            "count": item.data.count(),
            "stale": item.stale,
            "fallback": plan.fallback,
            "substituted": plan.substituted,
            "skipped": plan.skipped,
        }));
    }
    plan::profile(&format!("view: fertig {} ms", clock.elapsed().as_millis()));
    packet.finish(json!({"models": models}))
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
    mesh.append(&plans[at].body);
    mesh.append(&plans[at].pads);
    mesh.append(&plans[at].strips);
    Ok(mesh.to_stl())
}
