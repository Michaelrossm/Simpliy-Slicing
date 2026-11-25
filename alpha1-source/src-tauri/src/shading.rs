//! Runde Flaechen glatt, echte Kanten scharf. Dreiecksnummern bleiben gleich (wichtig fuer Malen und Klicken).
use crate::util::hypot3;

const CREASE_DEGREES: f64 = 35.0;

/// Eine Normale je Dreiecksecke.
pub fn normals(vertices: &[f32], indices: &[u32]) -> Vec<f32> {
    let crease = CREASE_DEGREES.to_radians().cos();
    let faces = indices.len() / 3;
    let points = vertices.len() / 3;
    let mut unit = vec![0.0f32; faces * 3];
    let mut weight = vec![0.0f32; indices.len()];
    let mut start = vec![0u32; points + 1];
    for f in 0..faces {
        let p = [0, 1, 2].map(|k| [0, 1, 2].map(|a| f64::from(vertices[indices[f * 3 + k] as usize * 3 + a])));
        let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        let cross = |a: [f64; 3], b: [f64; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
        let length = hypot3(n[0], n[1], n[2]);
        let length = if length == 0.0 { 1.0 } else { length };
        for a in 0..3 {
            unit[f * 3 + a] = (n[a] / length) as f32;
        }
        // Nach Eckwinkel gewichten, sonst ziehen schmale CAD-Dreiecke die Schattierung schief.
        for k in 0..3 {
            let (a, b) = (sub(p[(k + 1) % 3], p[k]), sub(p[(k + 2) % 3], p[k]));
            let c = cross(a, b);
            weight[f * 3 + k] = hypot3(c[0], c[1], c[2]).atan2(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) as f32;
            start[indices[f * 3 + k] as usize + 1] += 1;
        }
    }
    for i in 0..points {
        start[i + 1] += start[i];
    }
    let mut cursor = start[..points].to_vec();
    let mut around = vec![0u32; indices.len()];
    for (corner, &vertex) in indices.iter().enumerate() {
        around[cursor[vertex as usize] as usize] = corner as u32;
        cursor[vertex as usize] += 1;
    }

    let mut out = Vec::with_capacity(indices.len() * 3);
    for (corner, &vertex) in indices.iter().enumerate() {
        let own = corner / 3 * 3;
        let mut sum = [0.0f64; 3];
        for &other in &around[start[vertex as usize] as usize..start[vertex as usize + 1] as usize] {
            let face = other as usize / 3 * 3;
            let dot: f64 = (0..3).map(|a| f64::from(unit[face + a]) * f64::from(unit[own + a])).sum();
            if dot < crease {
                continue;
            }
            let w = f64::from(weight[other as usize]);
            for a in 0..3 {
                sum[a] += f64::from(unit[face + a]) * w;
            }
        }
        let length = hypot3(sum[0], sum[1], sum[2]);
        for a in 0..3 {
            out.push(if length != 0.0 { (sum[a] / length) as f32 } else { unit[own + a] });
        }
    }
    out
}

/// Punkte je Ecke plus Normalen, fertig zum Zeichnen.
pub fn smooth(vertices: &[f32], indices: &[u32]) -> (Vec<f32>, Vec<f32>) {
    let positions = indices.iter().flat_map(|&i| vertices[i as usize * 3..i as usize * 3 + 3].iter().copied()).collect();
    (positions, normals(vertices, indices))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn right_angles_stay_sharp_and_gentle_bends_get_smooth() {
        let bend = |z: f32| normals(&[0., 0., 0., 1., 0., 0., 0., 1., 0., -1., 0., z], &[0, 1, 2, 0, 2, 3]);
        assert!((bend(5.0)[2] - 1.0).abs() < 1e-5);
        let gentle = bend(0.2);
        assert!(gentle[2] < 0.9999 && gentle[2] > 0.95);
    }
}
