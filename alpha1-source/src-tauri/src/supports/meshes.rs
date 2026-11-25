//! Netze der Stuetzen: Aeste, Quader, Pfeiler. Geschlossene Schalen, Normalen nach aussen.
use super::types::Support;

#[derive(Clone, Debug, Default)]
pub struct Triangles {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
}

impl Triangles {
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }

    pub fn append(&mut self, other: &Triangles) {
        let base = (self.vertices.len() / 3) as u32;
        self.vertices.extend_from_slice(&other.vertices);
        self.indices.extend(other.indices.iter().map(|i| i + base));
    }

    pub fn to_stl(&self) -> Vec<u8> {
        let mut out = vec![0u8; 80];
        out[..19].copy_from_slice(b"Simpliy supports   ");
        out.extend_from_slice(&((self.indices.len() / 3) as u32).to_le_bytes());
        for face in self.indices.chunks_exact(3) {
            let [a, b, c] = [0, 1, 2].map(|k| [0, 1, 2].map(|axis| self.vertices[face[k] as usize * 3 + axis]));
            let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
            let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            for value in n.map(|w| if length > 0.0 { w / length } else { 0.0 }).iter().chain(&a).chain(&b).chain(&c) {
                out.extend_from_slice(&value.to_le_bytes());
            }
            out.extend_from_slice(&[0, 0]);
        }
        out
    }
}

/// Aeste aus waagerechten Ringen. Ueberlappungen vereinigt die Engine beim Schneiden.
pub fn branch_mesh(branches: &[Vec<[f64; 4]>], sides: u32) -> Triangles {
    let mut mesh = Triangles::default();
    for branch in branches {
        let mut sorted = branch.clone();
        sorted.sort_by(|a, b| a[2].total_cmp(&b[2]));
        let mut rings: Vec<[f64; 4]> = Vec::with_capacity(sorted.len());
        for point in sorted {
            if rings.last().map_or(true, |last| point[2] - last[2] > 1e-4) {
                rings.push(point);
            }
        }
        if rings.len() < 2 {
            continue;
        }
        let start = (mesh.vertices.len() / 3) as u32;
        for [x, y, z, r] in &rings {
            for k in 0..sides {
                let angle = f64::from(k) / f64::from(sides) * std::f64::consts::PI * 2.0;
                mesh.vertices.extend([(x + r * angle.cos()) as f32, (y + r * angle.sin()) as f32, *z as f32]);
            }
        }
        for j in 0..rings.len() as u32 - 1 {
            for k in 0..sides {
                let (a, b) = (start + j * sides + k, start + j * sides + (k + 1) % sides);
                mesh.indices.extend([a, b, b + sides, a, b + sides, a + sides]);
            }
        }
        let last = start + (rings.len() as u32 - 1) * sides;
        for k in 1..sides - 1 {
            mesh.indices.extend([start, start + k + 1, start + k, last, last + k, last + k + 1]);
        }
    }
    mesh
}

pub fn boxes_mesh(boxes: &[[f64; 6]]) -> Triangles {
    const FACES: [u32; 36] = [
        0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ];
    let mut mesh = Triangles::default();
    for (i, &[a, b, c, d, e, f]) in boxes.iter().enumerate() {
        let corners = [[a, b, c], [d, b, c], [d, e, c], [a, e, c], [a, b, f], [d, b, f], [d, e, f], [a, e, f]];
        mesh.vertices.extend(corners.iter().flatten().map(|v| *v as f32));
        mesh.indices.extend(FACES.iter().map(|k| i as u32 * 8 + k));
    }
    mesh
}

pub struct Pillar {
    pub x: f64,
    pub y: f64,
    pub low: f64,
    pub high: f64,
    pub width: f64,
}

impl Pillar {
    pub fn of(support: &Support, spacing: f64) -> Pillar {
        Pillar { x: support.x, y: support.y, low: support.bottom_z, high: support.top_z, width: support.width(spacing) }
    }
}

/// Gerade quadratische Saeulen mit flachen Enden, je ein Mittelpunkt in den Deckeln.
pub fn pillar_mesh(pillars: &[Pillar]) -> Triangles {
    let mut mesh = Triangles::default();
    for &Pillar { x, y, low, high, width } in pillars {
        if ![x, y, low, high].iter().all(|v| v.is_finite()) || high <= low {
            continue;
        }
        let half = width / 2.0;
        let base = (mesh.vertices.len() / 3) as u32;
        for z in [low, high] {
            for (dx, dy) in [(-half, -half), (half, -half), (half, half), (-half, half)] {
                mesh.vertices.extend([(x + dx) as f32, (y + dy) as f32, z as f32]);
            }
        }
        for i in 0..4 {
            let next = (i + 1) % 4;
            let (lo, hi) = (base, base + 4);
            mesh.indices.extend([lo + i, lo + next, hi + next, lo + i, hi + next, hi + i]);
        }
        for z in [low, high] {
            mesh.vertices.extend([x as f32, y as f32, z as f32]);
        }
        for i in 0..4 {
            let next = (i + 1) % 4;
            mesh.indices.extend([base + 8, base + next, base + i, base + 9, base + 4 + i, base + 4 + next]);
        }
    }
    mesh
}

#[cfg(test)]
mod tests {
    use super::*;

    fn volume(mesh: &Triangles) -> f64 {
        mesh.indices
            .chunks_exact(3)
            .map(|face| {
                let [a, b, c] = [0, 1, 2].map(|k| [0, 1, 2].map(|axis| f64::from(mesh.vertices[face[k] as usize * 3 + axis])));
                (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
            })
            .sum()
    }

    #[test]
    fn every_shell_points_outward() {
        let branch = volume(&branch_mesh(&[vec![[0.0, 0.0, 5.0, 1.0], [0.0, 0.0, 0.0, 1.0]]], 16));
        assert!(branch > 14.0 && branch < 16.0, "{branch}");
        assert!((volume(&boxes_mesh(&[[0.0, 0.0, 0.0, 2.0, 3.0, 4.0]])) - 24.0).abs() < 1e-5);
        let pillar = pillar_mesh(&[Pillar { x: 10.0, y: 20.0, low: 2.0, high: 8.0, width: 4.0 }]);
        assert_eq!(pillar.indices.len(), 48);
        assert!((volume(&pillar) - 96.0).abs() < 1e-3);
        assert_eq!(u32::from_le_bytes(pillar.to_stl()[80..84].try_into().unwrap()), 16);
    }
}
