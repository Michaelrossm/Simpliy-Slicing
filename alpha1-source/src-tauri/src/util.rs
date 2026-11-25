//! Kleine Bausteine fuer die Rechenkerne.
use std::{
    collections::HashMap,
    hash::{BuildHasherDefault, Hasher},
};

/// Schneller Hash fuer eigene Zahlenschluessel (Rasterzellen). Nicht fuer fremde Texte.
#[derive(Default)]
pub struct CellHasher(u64);

impl CellHasher {
    fn add(&mut self, value: u64) {
        self.0 = (self.0.rotate_left(5) ^ value).wrapping_mul(0x517c_c1b7_2722_0a95);
    }
}

impl Hasher for CellHasher {
    fn finish(&self) -> u64 {
        self.0 ^ (self.0 >> 32)
    }
    fn write(&mut self, bytes: &[u8]) {
        bytes.iter().for_each(|b| self.add(u64::from(*b)));
    }
    fn write_i32(&mut self, v: i32) {
        self.add(v as u32 as u64);
    }
    fn write_i64(&mut self, v: i64) {
        self.add(v as u64);
    }
    fn write_u32(&mut self, v: u32) {
        self.add(u64::from(v));
    }
    fn write_u64(&mut self, v: u64) {
        self.add(v);
    }
    fn write_usize(&mut self, v: usize) {
        self.add(v as u64);
    }
}

pub type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<CellHasher>>;

pub fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    (x * x + y * y + z * z).sqrt()
}

/// Halbe runden nach oben, auch im Negativen (nicht wie `f64::round`).
pub fn round_up(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// 3x4-Lage: drei Zeilen und Verschiebung.
#[derive(Clone, Copy)]
pub struct Affine {
    pub rows: [[f64; 3]; 3],
    pub offset: [f64; 3],
}

impl Affine {
    pub fn apply(&self, p: [f64; 3]) -> [f64; 3] {
        [0, 1, 2].map(|a| self.rows[a][0] * p[0] + self.rows[a][1] * p[1] + self.rows[a][2] * p[2] + self.offset[a])
    }

    pub fn determinant(&self) -> f64 {
        let r = &self.rows;
        r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0])
            + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0])
    }

    pub fn inverse(&self) -> Option<Affine> {
        let det = self.determinant();
        if !det.is_finite() || det.abs() < 1e-12 {
            return None;
        }
        let r = &self.rows;
        let rows = [
            [r[1][1] * r[2][2] - r[1][2] * r[2][1], r[0][2] * r[2][1] - r[0][1] * r[2][2], r[0][1] * r[1][2] - r[0][2] * r[1][1]],
            [r[1][2] * r[2][0] - r[1][0] * r[2][2], r[0][0] * r[2][2] - r[0][2] * r[2][0], r[0][2] * r[1][0] - r[0][0] * r[1][2]],
            [r[1][0] * r[2][1] - r[1][1] * r[2][0], r[0][1] * r[2][0] - r[0][0] * r[2][1], r[0][0] * r[1][1] - r[0][1] * r[1][0]],
        ]
        .map(|row| row.map(|v| v / det));
        let o = self.offset;
        let offset = [0, 1, 2].map(|a| -(rows[a][0] * o[0] + rows[a][1] * o[1] + rows[a][2] * o[2]));
        Some(Affine { rows, offset })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inverse_brings_a_mirrored_rotated_point_back() {
        let place = Affine { rows: [[0.0, -1.0, 0.0], [-1.2, 0.0, 0.0], [0.0, 0.0, 0.8]], offset: [125.0, 105.0, 3.0] };
        let back = place.inverse().unwrap().apply(place.apply([4.0, -7.0, 9.5]));
        for (got, want) in back.iter().zip([4.0, -7.0, 9.5]) {
            assert!((got - want).abs() < 1e-12);
        }
    }
}
