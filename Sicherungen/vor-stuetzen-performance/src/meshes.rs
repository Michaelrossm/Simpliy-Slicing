//! Geladene Netze. Die Rechenkerne brauchen sie nach dem Anzeigen noch einmal.
use crate::mesh::Mesh;
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex, OnceLock},
    time::SystemTime,
};

type Stamp = Option<(u64, Option<SystemTime>)>;

struct Known {
    mesh: Arc<Mesh>,
    stamp: Stamp,
}

fn all() -> &'static Mutex<HashMap<String, Known>> {
    static MESHES: OnceLock<Mutex<HashMap<String, Known>>> = OnceLock::new();
    MESHES.get_or_init(Default::default)
}

fn stamp_of(path: &str) -> Stamp {
    fs::metadata(path).ok().map(|meta| (meta.len(), meta.modified().ok()))
}

pub fn keep(path: &str, mesh: Mesh) -> Arc<Mesh> {
    let mesh = Arc::new(mesh);
    let known = Known { mesh: Arc::clone(&mesh), stamp: stamp_of(path) };
    all().lock().unwrap_or_else(|e| e.into_inner()).insert(path.to_owned(), known);
    mesh
}

/// Das angezeigte Netz, auch wenn sich die Datei inzwischen geaendert hat.
pub fn loaded(path: &str) -> Result<Arc<Mesh>, String> {
    all()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(path)
        .map(|known| Arc::clone(&known.mesh))
        .ok_or_else(|| "Modell ist nicht geladen".to_owned())
}

/// Nur solange die Datei dieselbe ist.
pub fn fresh(path: &str) -> Option<Arc<Mesh>> {
    let now = stamp_of(path)?;
    let known = all().lock().unwrap_or_else(|e| e.into_inner());
    known.get(path).filter(|known| known.stamp == Some(now)).map(|known| Arc::clone(&known.mesh))
}
