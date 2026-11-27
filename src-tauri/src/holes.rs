//! Bohrungen im Netz erkennen und ihren Durchmesser fuer den Druck anpassen.
//!
//! Gedruckte Loecher werden zu klein (Strangbreite, Schrumpf). Statt zu raten, zeigt Simpliy die erkannten Bohrungen mit
//! Durchmesser und Lage und kann sie um ein Mass vergroessern (als Kopie, die Originaldatei bleibt). Erkennung wie bei den
//! Ueberhangflaechen: glatte Flaechenstuecke (Kantenwinkel <= 35°), Zylinderanpassung, nach innen zeigende Normalen und fast
//! voller Umfang (Luecke <= 60°); Rundungen und Bogenstuecke zaehlen nicht.
use super::*;
use crate::{mesh::Mesh, supports::surface_kinds::{fit_cylinder, Facet}, util::FastMap};
use serde::Serialize;

const SMOOTH_DOT: f64 = 0.819_152; // cos 35°
const MIN_FACETS: usize = 8;
const MAX_GAP_DEG: f64 = 60.0;

#[derive(Clone, Debug, Serialize)]
pub struct Hole {
    pub diameter: f64,
    pub axis: [f64; 3],
    /// "senkrecht", "waagerecht" oder "schraeg" (zur Druckrichtung Z).
    pub orientation: &'static str,
    /// Laenge entlang der Achse in mm.
    pub depth: f64,
    pub centre: [f64; 3],
    #[serde(skip)]
    pub vertices: Vec<u32>,
}

fn root(parent: &mut [u32], mut f: usize) -> usize {
    while parent[f] as usize != f {
        parent[f] = parent[parent[f] as usize];
        f = parent[f] as usize;
    }
    f
}

pub fn detect(mesh: &Mesh) -> Vec<Hole> {
    let tris = &mesh.triangles;
    let p = |i: u32| mesh.vertices[i as usize].map(f64::from);
    let facets: Vec<Option<Facet>> = tris
        .iter()
        .map(|t| {
            let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
            let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            let l = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            (l > 1e-12).then(|| Facet {
                centre: [0, 1, 2].map(|k| (a[k] + b[k] + c[k]) / 3.0),
                normal: [n[0] / l, n[1] / l, n[2] / l],
                area: l / 2.0,
            })
        })
        .collect();
    // Nachbarschaft ueber gemeinsame Kanten; glatte Uebergaenge verbinden
    let mut parent: Vec<u32> = (0..tris.len() as u32).collect();
    let mut edge_owner: FastMap<(u32, u32), usize> = FastMap::default();
    for (f, t) in tris.iter().enumerate() {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            let key = (a.min(b), a.max(b));
            if let Some(&g) = edge_owner.get(&key) {
                if let (Some(x), Some(y)) = (&facets[f], &facets[g]) {
                    let d: f64 = (0..3).map(|i| x.normal[i] * y.normal[i]).sum();
                    if d >= SMOOTH_DOT {
                        let (ra, rb) = (root(&mut parent, f), root(&mut parent, g));
                        parent[ra] = rb as u32;
                    }
                }
            } else {
                edge_owner.insert(key, f);
            }
        }
    }
    let mut patches: FastMap<usize, Vec<usize>> = FastMap::default();
    for f in 0..tris.len() {
        if facets[f].is_some() {
            let r = root(&mut parent, f);
            patches.entry(r).or_default().push(f);
        }
    }
    let mut holes = Vec::new();
    for (_, members) in patches {
        if members.len() < MIN_FACETS {
            continue;
        }
        let list: Vec<Facet> = members.iter().filter_map(|&f| facets[f].as_ref().map(|x| Facet {centre: x.centre, normal: x.normal, area: x.area})).collect();
        let Some(fit) = fit_cylinder(&list) else { continue };
        if !fit.concave || fit.gap > MAX_GAP_DEG || !(0.5..=50.0).contains(&fit.radius) {
            continue;
        }
        let mut vertices: Vec<u32> = members.iter().flat_map(|&f| tris[f]).collect();
        vertices.sort_unstable();
        vertices.dedup();
        let along: Vec<f64> = vertices.iter().map(|&v| {
            let q = p(v);
            (0..3).map(|k| (q[k] - fit.centre[k]) * fit.axis[k]).sum::<f64>()
        }).collect();
        let depth = along.iter().cloned().fold(f64::NEG_INFINITY, f64::max) - along.iter().cloned().fold(f64::INFINITY, f64::min);
        let tilt = fit.axis[2].abs();
        holes.push(Hole {
            diameter: 2.0 * fit.radius,
            axis: fit.axis,
            orientation: if tilt > 0.95 { "senkrecht" } else if tilt < 0.2 { "waagerecht" } else { "schraeg" },
            depth,
            centre: fit.centre,
            vertices,
        });
    }
    holes.sort_by(|a, b| b.diameter.partial_cmp(&a.diameter).unwrap_or(std::cmp::Ordering::Equal));
    holes
}

/// Alle erkannten Bohrungen im Durchmesser um `delta` mm vergroessern (Wandpunkte radial nach aussen, Randpunkte inklusive).
pub fn adjust(mesh: &Mesh, delta: f64) -> (Mesh, usize) {
    let holes = detect(mesh);
    let mut out = mesh.clone();
    let mut moved: FastMap<u32, ()> = FastMap::default();
    for hole in &holes {
        for &v in &hole.vertices {
            if moved.insert(v, ()).is_some() {
                continue;
            }
            let q = mesh.vertices[v as usize].map(f64::from);
            let d = [q[0] - hole.centre[0], q[1] - hole.centre[1], q[2] - hole.centre[2]];
            let along = d[0] * hole.axis[0] + d[1] * hole.axis[1] + d[2] * hole.axis[2];
            let radial = [d[0] - along * hole.axis[0], d[1] - along * hole.axis[1], d[2] - along * hole.axis[2]];
            let l = (radial[0] * radial[0] + radial[1] * radial[1] + radial[2] * radial[2]).sqrt();
            if l < 1e-9 {
                continue;
            }
            for k in 0..3 {
                out.vertices[v as usize][k] = (q[k] + radial[k] / l * delta / 2.0) as f32;
            }
        }
    }
    (out, holes.len())
}

#[tauri::command]
pub async fn hole_scan(engine_path: String, path: String) -> Result<Value, String> {
    blocking(move || {
        let mesh = engine::Engine::open(&engine_path)?.cached_mesh(&path)?;
        let holes = detect(&mesh);
        Ok(json!({"holes": holes}))
    })
    .await
}

/// Bohrungen um `delta` mm vergroessern und als neue STL-Datei speichern (die Originaldatei bleibt).
#[tauri::command]
pub async fn hole_adjust(engine_path: String, path: String, delta: f64) -> Result<Value, String> {
    if !(delta.is_finite() && delta > 0.0 && delta <= 2.0) {
        return Err("Das Aufmaß muss zwischen 0 und 2 mm liegen.".into());
    }
    blocking(move || {
        let mesh = engine::Engine::open(&engine_path)?.cached_mesh(&path)?;
        let (adjusted, count) = adjust(&mesh, delta);
        if count == 0 {
            return Ok(json!({"path": null, "adjusted": 0}));
        }
        let data = repair::to_stl(&adjusted);
        mesh::Mesh::from_stl(&data)?;
        let folder = data_path()?.with_file_name("repaired");
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let target = folder.join(format!("{}.stl", uid("holes")));
        fs::write(&target, data).map_err(|e| e.to_string())?;
        Ok(json!({"path": target.to_string_lossy(), "adjusted": count}))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    /// Platte mit Bohrung (nur Wand und Deckel/Boden-Ringe), senkrechte Achse Z, `segments` Seiten.
    fn plate_with_hole(radius: f64, segments: usize, vertical: bool) -> Mesh {
        let mut vertices = Vec::new();
        let mut triangles = Vec::new();
        let rot = |p: [f64; 3]| if vertical { p } else { [p[2], p[1], p[0]] };
        let ring = |r: f64, z: f64, vertices: &mut Vec<[f32; 3]>| -> usize {
            let first = vertices.len();
            for i in 0..segments {
                let a = 2.0 * PI * i as f64 / segments as f64;
                vertices.push(rot([r * a.cos(), r * a.sin(), z]).map(|v| v as f32));
            }
            first
        };
        let (inner_top, inner_bottom) = (ring(radius, 3.0, &mut vertices), ring(radius, 0.0, &mut vertices));
        let (outer_top, outer_bottom) = (ring(15.0, 3.0, &mut vertices), ring(15.0, 0.0, &mut vertices));
        let mut quad = |a: usize, b: usize, c: usize, d: usize, triangles: &mut Vec<[u32; 3]>, want_inward: bool| {
            for t in [[a, b, c], [a, c, d]] {
                let tri = [t[0] as u32, t[1] as u32, t[2] as u32];
                let q = |i: u32| vertices[i as usize].map(f64::from);
                let (pa, pb, pc) = (q(tri[0]), q(tri[1]), q(tri[2]));
                let n = [(pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]), (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]), (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])];
                let c3 = [(pa[0] + pb[0] + pc[0]) / 3.0, (pa[1] + pb[1] + pc[1]) / 3.0, (pa[2] + pb[2] + pc[2]) / 3.0];
                // nach innen = Richtung Achse (Achse: Z oder X)
                let axis = if vertical { [0.0, 0.0, 1.0] } else { [1.0, 0.0, 0.0] };
                let along = c3[0] * axis[0] + c3[1] * axis[1] + c3[2] * axis[2];
                let radial = [c3[0] - along * axis[0], c3[1] - along * axis[1], c3[2] - along * axis[2]];
                let inward = -(n[0] * radial[0] + n[1] * radial[1] + n[2] * radial[2]);
                let flip = want_inward != (inward > 0.0);
                triangles.push(if flip { [tri[0], tri[2], tri[1]] } else { tri });
            }
        };
        for i in 0..segments {
            let j = (i + 1) % segments;
            quad(inner_bottom + i, inner_bottom + j, inner_top + j, inner_top + i, &mut triangles, true); // Lochwand
            quad(inner_top + i, inner_top + j, outer_top + j, outer_top + i, &mut triangles, false); // Oberseite
            quad(inner_bottom + i, outer_bottom + i, outer_bottom + j, inner_bottom + j, &mut triangles, false); // Unterseite
        }
        Mesh {vertices, triangles}
    }

    #[test]
    fn vertical_and_horizontal_holes_are_found_with_diameter() {
        for vertical in [true, false] {
            let holes = detect(&plate_with_hole(2.5, 36, vertical));
            assert_eq!(holes.len(), 1, "{vertical}");
            assert!((holes[0].diameter - 5.0).abs() < 0.1, "{}", holes[0].diameter);
            assert_eq!(holes[0].orientation, if vertical { "senkrecht" } else { "waagerecht" });
            assert!((holes[0].depth - 3.0).abs() < 0.1);
        }
    }

    #[test]
    fn coarse_or_partial_walls_are_not_holes() {
        // Nur ein Viertelbogen (Rundung): kein voller Umfang
        let mesh = plate_with_hole(2.5, 36, true);
        let quarter = Mesh {vertices: mesh.vertices.clone(), triangles: mesh.triangles.iter().filter(|t| {
            let c = t.iter().map(|&i| mesh.vertices[i as usize]).fold([0.0f32; 2], |a, v| [a[0] + v[0], a[1] + v[1]]);
            c[0] > 0.0 && c[1] > 0.0
        }).copied().collect()};
        assert!(detect(&quarter).is_empty());
    }

    #[test]
    fn adjusting_widens_the_hole_by_the_given_diameter() {
        let mesh = plate_with_hole(2.5, 36, true);
        let (wider, count) = adjust(&mesh, 0.3);
        assert_eq!(count, 1);
        let found = detect(&wider);
        assert!((found[0].diameter - 5.3).abs() < 0.05, "{}", found[0].diameter);
        // Aussenring (Radius 15) bleibt unveraendert
        let max_r = wider.vertices.iter().map(|v| f64::from(v[0]).hypot(f64::from(v[1]))).fold(0.0, f64::max);
        assert!((max_r - 15.0).abs() < 1e-3);
    }
}
