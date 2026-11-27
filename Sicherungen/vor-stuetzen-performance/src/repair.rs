//! Netzpruefung und Reparatur: verschweissen, entartete und doppelte Dreiecke entfernen,
//! Loecher schliessen, Normalen ausrichten. Das Original bleibt unveraendert.
use crate::{
    mesh::Mesh,
    util::{hypot3, FastMap},
};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

const MAX_RAY_SHELLS: usize = 60; // Hohlraum-Erkennung kostet Huellen mal Dreiecke

type Point = [f64; 3];
type Triangle = [u32; 3];

struct Side {
    t: usize,
    a: u32,
    b: u32,
}

fn edges_of(triangles: &[Triangle]) -> Vec<Vec<Side>> {
    let mut index: FastMap<(u32, u32), usize> = FastMap::default();
    let mut edges: Vec<Vec<Side>> = Vec::new();
    for (t, triangle) in triangles.iter().enumerate() {
        for k in 0..3 {
            let (a, b) = (triangle[k], triangle[(k + 1) % 3]);
            let at = *index.entry((a.min(b), a.max(b))).or_insert_with(|| {
                edges.push(Vec::with_capacity(2));
                edges.len() - 1
            });
            edges[at].push(Side { t, a, b });
        }
    }
    edges
}

fn volume_of<'a>(points: &[Point], triangles: impl Iterator<Item = &'a Triangle>) -> f64 {
    let mut sum = 0.0;
    for t in triangles {
        let [a, b, c] = t.map(|i| points[i as usize]);
        sum += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    sum / 6.0
}

#[derive(Clone, Debug, Serialize)]
pub struct Stats {
    pub triangles: usize,
    pub open: usize,
    pub shared: usize,
    pub flipped: usize,
    pub volume: f64,
    pub closed: bool,
}

fn stats(points: &[Point], triangles: &[Triangle]) -> Stats {
    let (mut open, mut shared, mut flipped) = (0, 0, 0);
    for edge in edges_of(triangles) {
        match edge.len() {
            1 => open += 1,
            2 if edge[0].a == edge[1].a => flipped += 1,
            2 => {}
            _ => shared += 1,
        }
    }
    let volume = volume_of(points, triangles.iter());
    let closed = open == 0 && shared == 0 && flipped == 0 && volume > 0.0;
    Stats { triangles: triangles.len(), open, shared, flipped, volume, closed }
}

fn points_of(mesh: &Mesh) -> Vec<Point> {
    mesh.vertices.iter().map(|v| v.map(f64::from)).collect()
}

pub fn analyse(mesh: &Mesh) -> Stats {
    stats(&points_of(mesh), &mesh.triangles)
}

fn weld(points: &[Point], triangles: &[Triangle], tolerance: f64) -> (Vec<Point>, Vec<Triangle>, usize) {
    let mut cells: FastMap<[i64; 3], Vec<u32>> = FastMap::default();
    let mut kept: Vec<Point> = Vec::new();
    let mut map = Vec::with_capacity(points.len());
    for p in points {
        let cell = p.map(|v| (v / tolerance).floor() as i64);
        let mut found = None;
        'search: for x in -1..=1 {
            for y in -1..=1 {
                for z in -1..=1 {
                    for &at in cells.get(&[cell[0] + x, cell[1] + y, cell[2] + z]).map_or(&[][..], Vec::as_slice) {
                        let q = kept[at as usize];
                        if hypot3(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tolerance {
                            found = Some(at);
                            break 'search;
                        }
                    }
                }
            }
        }
        map.push(found.unwrap_or_else(|| {
            let at = kept.len() as u32;
            cells.entry(cell).or_default().push(at);
            kept.push(*p);
            at
        }));
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut removed = 0;
    for triangle in triangles {
        let t = triangle.map(|i| map[i as usize]);
        let mut key = t;
        key.sort_unstable();
        if t[0] == t[1] || t[1] == t[2] || t[2] == t[0] || !seen.insert(key) {
            removed += 1;
            continue;
        }
        out.push(t);
    }
    (kept, out, removed)
}

/// Nachbarn gleich orientieren. Liefert die zusammenhaengenden Huellen.
fn orient(triangles: &mut [Triangle]) -> (Vec<Vec<usize>>, usize) {
    let mut neighbours: Vec<Vec<(usize, bool)>> = vec![Vec::new(); triangles.len()];
    for edge in edges_of(triangles) {
        if edge.len() != 2 {
            continue;
        }
        let same = edge[0].a == edge[1].a;
        neighbours[edge[0].t].push((edge[1].t, same));
        neighbours[edge[1].t].push((edge[0].t, same));
    }
    let mut flip: Vec<Option<bool>> = vec![None; triangles.len()];
    let mut shells = Vec::new();
    for start in 0..triangles.len() {
        if flip[start].is_some() {
            continue;
        }
        flip[start] = Some(false);
        let mut shell = Vec::new();
        let mut queue = vec![start];
        while let Some(t) = queue.pop() {
            shell.push(t);
            let current = flip[t] == Some(true);
            for &(next, same) in &neighbours[t] {
                if flip[next].is_none() {
                    flip[next] = Some(current != same);
                    queue.push(next);
                }
            }
        }
        shells.push(shell);
    }
    let mut flipped = 0;
    for (triangle, flip) in triangles.iter_mut().zip(flip) {
        if flip == Some(true) {
            triangle.reverse();
            flipped += 1;
        }
    }
    (shells, flipped)
}

fn turn(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

fn triangulate_loop(points: &mut Vec<Point>, ring: &[u32]) -> Vec<Triangle> {
    let mut n = [0.0f64; 3];
    for i in 0..ring.len() {
        let (p, q) = (points[ring[i] as usize], points[ring[(i + 1) % ring.len()] as usize]);
        n[0] += (p[1] - q[1]) * (p[2] + q[2]);
        n[1] += (p[2] - q[2]) * (p[0] + q[0]);
        n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    }
    let mut axis = 0;
    for a in 1..3 {
        if n[a].abs() > n[axis].abs() {
            axis = a;
        }
    }
    let sign = if n[axis] < 0.0 { -1.0 } else { 1.0 };
    let flat: Vec<[f64; 2]> = ring.iter().map(|&i| [points[i as usize][(axis + 1) % 3], points[i as usize][(axis + 2) % 3]]).collect();
    let mut left: Vec<usize> = (0..ring.len()).collect();
    let mut out = Vec::new();
    while left.len() > 3 {
        let count = left.len();
        let ear = (0..count).find(|&i| {
            let (a, b, c) = (left[(i + count - 1) % count], left[i], left[(i + 1) % count]);
            let (p, q, r) = (flat[a], flat[b], flat[c]);
            turn(p, q, r) * sign > 1e-12
                && !left.iter().any(|&o| {
                    o != a && o != b && o != c
                        && turn(p, q, flat[o]) * sign >= 0.0
                        && turn(q, r, flat[o]) * sign >= 0.0
                        && turn(r, p, flat[o]) * sign >= 0.0
                })
        });
        if let Some(i) = ear {
            out.push([ring[left[(i + count - 1) % count]], ring[left[i]], ring[left[(i + 1) % count]]]);
            left.remove(i);
            continue;
        }
        // Verdrehter Rand: Faecher um einen neuen Mittelpunkt.
        let centre = [0, 1, 2].map(|k| left.iter().fold(0.0, |sum, &i| sum + points[ring[i] as usize][k]) / count as f64);
        let at = points.len() as u32;
        points.push(centre);
        for i in 0..count {
            out.push([ring[left[i]], ring[left[(i + 1) % count]], at]);
        }
        return out;
    }
    out.push([ring[left[0]], ring[left[1]], ring[left[2]]]);
    out
}

fn fill_holes(points: &mut Vec<Point>, triangles: &mut Vec<Triangle>) -> usize {
    // Der Rand laeuft gegen die Richtung des vorhandenen Dreiecks.
    let border: Vec<(u32, u32)> = edges_of(triangles).iter().filter(|e| e.len() == 1).map(|e| (e[0].b, e[0].a)).collect();
    let mut outgoing: HashMap<u32, Vec<usize>> = HashMap::new();
    for (step, &(from, _)) in border.iter().enumerate() {
        outgoing.entry(from).or_default().push(step);
    }
    let mut used = vec![false; border.len()];
    let mut holes = 0;
    for start in 0..border.len() {
        if used[start] {
            continue;
        }
        let mut path = vec![border[start].0];
        let mut place = HashMap::from([(border[start].0, 0usize)]);
        let mut step = Some(start);
        while let Some(at_step) = step {
            used[at_step] = true;
            let to = border[at_step].1;
            if let Some(&at) = place.get(&to) {
                // Ein geschlossener Teilring; beruehrende Loecher werden einzeln geschlossen.
                let ring = path.split_off(at);
                for v in &ring {
                    place.remove(v);
                }
                if ring.len() >= 3 {
                    let closing = triangulate_loop(points, &ring);
                    triangles.extend(closing);
                    holes += 1;
                }
                if path.is_empty() {
                    break;
                }
            }
            place.insert(to, path.len());
            path.push(to);
            step = outgoing.get(&to).and_then(|list| list.iter().copied().find(|&s| !used[s]));
        }
    }
    holes
}

/// Aussenhuellen zeigen nach aussen, Hohlraeume nach innen.
fn outward(points: &[Point], triangles: &mut [Triangle], shells: &[Vec<usize>]) -> usize {
    let boxes: Vec<(Point, Point)> = shells
        .iter()
        .map(|shell| {
            let (mut min, mut max) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
            for &t in shell {
                for v in triangles[t] {
                    for a in 0..3 {
                        min[a] = min[a].min(points[v as usize][a]);
                        max[a] = max[a].max(points[v as usize][a]);
                    }
                }
            }
            (min, max)
        })
        .collect();
    let mut flipped = 0;
    for (i, shell) in shells.iter().enumerate() {
        let mut depth = 0;
        if shells.len() <= MAX_RAY_SHELLS {
            let p = points[triangles[shell[0]][0] as usize];
            for (j, other) in shells.iter().enumerate() {
                if i == j || !(0..3).all(|a| boxes[j].0[a] < boxes[i].0[a] && boxes[j].1[a] > boxes[i].1[a]) {
                    continue;
                }
                // Strahl nach +Z, minimal versetzt, damit er keine Kante genau trifft.
                let at = [p[0] + 1.234e-5, p[1] + 2.718e-5];
                let mut hits = 0;
                for &t in other {
                    let [a, b, c] = triangles[t].map(|v| points[v as usize]);
                    let (pa, pb, pc) = ([a[0], a[1]], [b[0], b[1]], [c[0], c[1]]);
                    let area = turn(pa, pb, pc);
                    if area == 0.0 {
                        continue;
                    }
                    let (u, v) = (turn(at, pb, pc) / area, turn(pa, at, pc) / area);
                    let w = 1.0 - u - v;
                    if u >= 0.0 && v >= 0.0 && w >= 0.0 && u * a[2] + v * b[2] + w * c[2] > p[2] {
                        hits += 1;
                    }
                }
                if hits % 2 == 1 {
                    depth += 1;
                }
            }
        }
        let volume = volume_of(points, shell.iter().map(|&t| &triangles[t]));
        if volume == 0.0 || (volume > 0.0) == (depth % 2 == 0) {
            continue;
        }
        for &t in shell {
            triangles[t].reverse();
        }
        flipped += shell.len();
    }
    flipped
}

#[derive(Debug, Serialize)]
pub struct Report {
    pub before: Stats,
    pub after: Stats,
    pub removed: usize,
    pub holes: usize,
    pub flipped: usize,
    #[serde(skip)]
    pub mesh: Mesh,
}

pub fn repair(mesh: &Mesh, tolerance: f64) -> Result<Report, String> {
    if !(tolerance.is_finite() && tolerance > 0.0) {
        return Err("Toleranz muss größer als 0 sein".into());
    }
    let input = points_of(mesh);
    let before = stats(&input, &mesh.triangles);
    let (mut points, mut triangles, removed) = weld(&input, &mesh.triangles, tolerance);
    let (_, first) = orient(&mut triangles);
    let holes = fill_holes(&mut points, &mut triangles);
    let (shells, second) = orient(&mut triangles);
    let flipped = first + second + outward(&points, &mut triangles, &shells);
    Ok(Report {
        before,
        after: stats(&points, &triangles),
        removed,
        holes,
        flipped,
        mesh: Mesh { vertices: points.iter().map(|p| p.map(|v| v as f32)).collect(), triangles },
    })
}

pub fn to_stl(mesh: &Mesh) -> Vec<u8> {
    let mut out = vec![0u8; 80];
    out.extend_from_slice(&(mesh.triangles.len() as u32).to_le_bytes());
    for triangle in &mesh.triangles {
        out.extend_from_slice(&[0u8; 12]);
        for &index in triangle {
            for value in mesh.vertices[index as usize] {
                out.extend_from_slice(&value.to_le_bytes());
            }
        }
        out.extend_from_slice(&[0, 0]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cube() -> Mesh {
        Mesh {
            vertices: vec![[0., 0., 0.], [10., 0., 0.], [10., 10., 0.], [0., 10., 0.], [0., 0., 10.], [10., 0., 10.], [10., 10., 10.], [0., 10., 10.]],
            triangles: vec![[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]],
        }
    }

    #[test]
    fn a_missing_side_is_closed_and_turned_outward() {
        let mut broken = cube();
        broken.triangles.truncate(10);
        assert!(!analyse(&broken).closed);
        broken.triangles.iter_mut().for_each(|t| t.reverse());
        let fixed = repair(&broken, 0.001).unwrap();
        assert!(fixed.after.closed, "{fixed:?}");
        assert_eq!(fixed.holes, 1);
        assert!((fixed.after.volume - 1000.0).abs() < 1e-3);
        assert!(Mesh::from_stl(&to_stl(&fixed.mesh)).is_ok());
    }

    #[test]
    fn cavities_stay_hollow() {
        let mut mesh = cube();
        let inner = cube();
        mesh.vertices.extend(inner.vertices.iter().map(|v| v.map(|c| c * 0.4 + 3.0)));
        mesh.triangles.extend(inner.triangles.iter().map(|&[a, b, c]| [a + 8, c + 8, b + 8]));
        assert!((repair(&mesh, 0.001).unwrap().after.volume - 936.0).abs() < 1e-2);
    }

    #[test]
    fn missing_and_flipped_faces_are_fixed() {
        for damage in 0..4 {
            let mut mesh = cube();
            match damage {
                0 => { mesh.triangles.remove(0); }
                1 => { mesh.triangles.drain(..2); }
                2 => mesh.triangles[0].reverse(),
                _ => mesh.triangles.iter_mut().for_each(|t| t.reverse()),
            }
            let after = repair(&mesh, 0.001).unwrap().after;
            assert!(after.closed && (after.volume - 1000.0).abs() < 1e-3, "{damage} {after:?}");
        }
    }

    #[test]
    fn duplicates_are_removed() {
        let mut mesh = cube();
        mesh.triangles.push(mesh.triangles[0]);
        let fixed = repair(&mesh, 0.001).unwrap();
        assert_eq!(fixed.removed, 1);
        assert!(fixed.after.closed);
    }
}
