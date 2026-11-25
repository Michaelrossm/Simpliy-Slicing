//! Wo gestuetzt wird: zusammenhaengende Flaechen, freie Unterkanten, tiefste Punkte.
use crate::util::{hypot3, round_up, FastMap};
use std::f64::consts::PI;

const EPS: f64 = 1e-9;

pub struct Surface {
    points: Vec<f64>,
    corner: Vec<u32>,
    edges: Vec<Vec<u32>>, // Dreiecksseiten je Kante, in der Reihenfolge des Netzes
    /// Je Dreieck die Ueberhangflaeche, -1 = keine.
    pub region: Vec<i64>,
    pub region_area: FastMap<i64, f64>,
    overhang_angle: f64,
}

fn root(parent: &mut [u32], mut f: usize) -> usize {
    while parent[f] as usize != f {
        parent[f] = parent[parent[f] as usize];
        f = parent[f] as usize;
    }
    f
}

impl Surface {
    pub fn analyse(vertices: &[f64], indices: &[u32], overhang_angle: f64) -> Surface {
        let threshold = -(overhang_angle * PI / 180.0).cos() + 1e-9;
        let faces = indices.len() / 3;
        // STL liefert je Dreieck eigene Punkte, deshalb nach Lage verschweissen.
        let mut ids: FastMap<[i64; 3], u32> = FastMap::default();
        let mut points = Vec::new();
        let mut corner = Vec::with_capacity(indices.len());
        for &index in indices {
            let p = &vertices[index as usize * 3..index as usize * 3 + 3];
            let key = [0, 1, 2].map(|a| round_up(p[a] * 1e4) as i64);
            let id = *ids.entry(key).or_insert_with(|| {
                points.extend_from_slice(p);
                (points.len() / 3 - 1) as u32
            });
            corner.push(id);
        }

        let mut area = vec![0.0f64; faces];
        let mut hangs = vec![false; faces];
        for f in 0..faces {
            let [a, b, c] = [0, 1, 2].map(|k| corner[f * 3 + k] as usize * 3);
            let u = [points[b] - points[a], points[b + 1] - points[a + 1], points[b + 2] - points[a + 2]];
            let v = [points[c] - points[a], points[c + 1] - points[a + 1], points[c + 2] - points[a + 2]];
            let z = u[0] * v[1] - u[1] * v[0];
            let length = hypot3(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], z);
            area[f] = length / 2.0;
            let nz = if length > EPS { f64::from((z / length) as f32) } else { 0.0 };
            hangs[f] = nz <= threshold && area[f] > EPS && points[a + 2].max(points[b + 2]).max(points[c + 2]) > 0.02;
        }

        let mut edge_of: FastMap<(u32, u32), usize> = FastMap::default();
        let mut edges: Vec<Vec<u32>> = Vec::new();
        for f in 0..faces {
            for k in 0..3 {
                let (a, b) = (corner[f * 3 + k], corner[f * 3 + (k + 1) % 3]);
                let at = *edge_of.entry((a.min(b), a.max(b))).or_insert_with(|| {
                    edges.push(Vec::with_capacity(2));
                    edges.len() - 1
                });
                edges[at].push((f * 3 + k) as u32);
            }
        }

        let mut parent: Vec<u32> = (0..faces as u32).collect();
        for sides in &edges {
            let mut open = sides.iter().map(|side| (*side / 3) as usize).filter(|&f| hangs[f]);
            let Some(first) = open.next() else { continue };
            for other in open {
                let from = root(&mut parent, other);
                parent[from] = root(&mut parent, first) as u32;
            }
        }
        let mut region = vec![-1i64; faces];
        let mut region_area: FastMap<i64, f64> = FastMap::default();
        for f in 0..faces {
            if hangs[f] {
                region[f] = root(&mut parent, f) as i64;
                *region_area.entry(region[f]).or_insert(0.0) += area[f];
            }
        }
        Surface { points, corner, edges, region, region_area, overhang_angle }
    }

    fn point(&self, id: usize) -> [f64; 3] {
        [self.points[id], self.points[id + 1], self.points[id + 2]]
    }

    /// Freie Unterkanten: Beide Nachbarflaechen steigen von der Kante weg und keine ist selbst ein Ueberhang.
    pub fn low_edges(&self, spacing: f64, min_z: f64) -> Vec<[f64; 3]> {
        let flattest = (self.overhang_angle * PI / 180.0).tan();
        let mut out = Vec::new();
        for sides in &self.edges {
            if sides.len() != 2 || sides.iter().any(|side| self.region[(*side / 3) as usize] >= 0) {
                continue;
            }
            let (f, k) = ((sides[0] / 3) as usize, (sides[0] % 3) as usize);
            let a = self.point(self.corner[f * 3 + k] as usize * 3);
            let b = self.point(self.corner[f * 3 + (k + 1) % 3] as usize * 3);
            if a[2].min(b[2]) <= min_z {
                continue;
            }
            let run = (b[0] - a[0]).hypot(b[1] - a[1]);
            if run < 1e-4 || (b[2] - a[2]).abs() > run * flattest {
                continue;
            }
            let ridge = sides.iter().all(|side| {
                let (g, j) = ((*side / 3) as usize, (*side % 3) as usize);
                let c = self.point(self.corner[g * 3 + (j + 2) % 3] as usize * 3);
                let t = ((c[0] - a[0]) * (b[0] - a[0]) + (c[1] - a[1]) * (b[1] - a[1])) / (run * run);
                c[2] > a[2] + (b[2] - a[2]) * t + 1e-4
            });
            if !ridge {
                continue;
            }
            let count = round_up(run / spacing).max(1.0);
            for i in 0..count as usize {
                let t = (i as f64 + 0.5) / count;
                out.push([0, 1, 2].map(|n| a[n] + (b[n] - a[n]) * t));
            }
        }
        out
    }

    /// Tiefste Punkte, unter denen der Druck in der Luft beginnen wuerde.
    pub fn local_minima(&self, min_z: f64) -> Vec<[f64; 3]> {
        let count = self.points.len() / 3;
        let mut around: Vec<Vec<u32>> = vec![Vec::new(); count];
        for face in self.corner.chunks_exact(3) {
            for k in 0..3 {
                let (a, b) = (face[k], face[(k + 1) % 3]);
                around[a as usize].push(b);
                around[b as usize].push(a);
            }
        }
        let mut visited = vec![false; count];
        let mut out = Vec::new();
        for v in 0..count {
            let z = self.points[v * 3 + 2];
            if visited[v] || z <= min_z || around[v].is_empty() {
                continue;
            }
            // Gleich hohe Nachbarn bilden ein gemeinsames Plateau.
            let mut plateau = vec![v];
            visited[v] = true;
            let mut lowest = true;
            let mut next = 0;
            while next < plateau.len() {
                for &n in &around[plateau[next]] {
                    let n = n as usize;
                    let height = self.points[n * 3 + 2];
                    if height < z - 1e-4 {
                        lowest = false;
                    } else if height <= z + 1e-4 && !visited[n] {
                        visited[n] = true;
                        plateau.push(n);
                    }
                }
                next += 1;
            }
            if !lowest {
                continue;
            }
            let size = plateau.len() as f64;
            let (mut x, mut y) = (0.0, 0.0);
            for &n in &plateau {
                x += self.points[n * 3] / size;
                y += self.points[n * 3 + 1] / size;
            }
            let (mut best, mut nearest) = (plateau[0], f64::INFINITY);
            for &n in &plateau {
                let d = (self.points[n * 3] - x).hypot(self.points[n * 3 + 1] - y);
                if d < nearest {
                    nearest = d;
                    best = n;
                }
            }
            out.push([self.points[best * 3], self.points[best * 3 + 1], z]);
        }
        out
    }
}
