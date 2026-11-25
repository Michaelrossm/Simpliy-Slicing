//! Hindernisfeld der Wegsuche: Ist ein waagerechter Kreis ueber ein Z-Band frei von Material?
//! Weltkoordinaten, Z oben, Normalen nach aussen.
use crate::util::FastMap;
use std::{cell::RefCell, rc::Rc};

const CELL: f64 = 3.0;
const RAY_CELL: f64 = 0.5; // feineres Raster fuer senkrechte Strahlen
/// Versatz, damit kein Strahl auf einer gemeinsamen Dreieckskante liegt.
pub const NUDGE: [f64; 2] = [1.3e-5, 0.7e-5];

fn cell_of(v: f64) -> i32 {
    (v / CELL).floor() as i32
}

pub struct Solid<'a> {
    pub vertices: &'a [f64],
    pub indices: &'a [u32],
}

struct Post {
    x: f64,
    y: f64,
    half: f64,
    low: f64,
    high: f64,
    round: bool,
}

struct Scratch {
    seen: Vec<u32>,
    stamp: u32,
    rays: FastMap<(i32, i32), Rc<[u32]>>,
}

#[derive(Clone, Copy)]
pub struct PostShape {
    pub x: f64,
    pub y: f64,
    pub half: f64,
    pub low: f64,
    pub high: f64,
    /// Kreis (fremder Ast) statt Quadrat (Pfeiler).
    pub round: bool,
}

pub struct SolidField {
    p: Vec<[f64; 9]>,
    low: Vec<f64>,
    high: Vec<f64>,
    /// Doppelte XY-Flaeche, positiv = zeigt nach oben.
    up: Vec<f64>,
    cells: FastMap<(i32, i32), Vec<u32>>,
    posts: Vec<Post>,
    post_cells: FastMap<(i32, i32), Vec<u32>>,
    scratch: RefCell<Scratch>,
}

impl SolidField {
    pub fn new(solids: &[Solid]) -> Self {
        let total = solids.iter().map(|s| s.indices.len() / 3).sum();
        let mut field = SolidField {
            p: Vec::with_capacity(total),
            low: Vec::with_capacity(total),
            high: Vec::with_capacity(total),
            up: Vec::with_capacity(total),
            cells: FastMap::default(),
            posts: Vec::new(),
            post_cells: FastMap::default(),
            scratch: RefCell::new(Scratch { seen: vec![0; total], stamp: 0, rays: FastMap::default() }),
        };
        for solid in solids {
            for face in solid.indices.chunks_exact(3) {
                let mut p = [0.0; 9];
                for k in 0..3 {
                    p[k * 3..k * 3 + 3].copy_from_slice(&solid.vertices[face[k] as usize * 3..face[k] as usize * 3 + 3]);
                }
                let t = field.p.len() as u32;
                field.low.push(p[2].min(p[5]).min(p[8]));
                field.high.push(p[2].max(p[5]).max(p[8]));
                field.up.push((p[3] - p[0]) * (p[7] - p[1]) - (p[4] - p[1]) * (p[6] - p[0]));
                for ix in cell_of(p[0].min(p[3]).min(p[6]))..=cell_of(p[0].max(p[3]).max(p[6])) {
                    for iy in cell_of(p[1].min(p[4]).min(p[7]))..=cell_of(p[1].max(p[4]).max(p[7])) {
                        field.cells.entry((ix, iy)).or_default().push(t);
                    }
                }
                field.p.push(p);
            }
        }
        field
    }

    pub fn add_post(&mut self, shape: PostShape) {
        let PostShape { x, y, half, low, high, round } = shape;
        let at = self.posts.len() as u32;
        self.posts.push(Post { x, y, half, low, high, round });
        for ix in cell_of(x - half)..=cell_of(x + half) {
            for iy in cell_of(y - half)..=cell_of(y + half) {
                self.post_cells.entry((ix, iy)).or_default().push(at);
            }
        }
    }

    /// Dreiecke, die ein senkrechter Strahl hier treffen kann. Je Feinzelle einmal ausgesiebt.
    fn under_ray(&self, x: f64, y: f64) -> Rc<[u32]> {
        let cell = ((x / RAY_CELL).floor() as i32, (y / RAY_CELL).floor() as i32);
        if let Some(list) = self.scratch.borrow().rays.get(&cell) {
            return Rc::clone(list);
        }
        let x0 = f64::from(cell.0) * RAY_CELL - 1e-6;
        let y0 = f64::from(cell.1) * RAY_CELL - 1e-6;
        let (x1, y1) = (x0 + RAY_CELL + 2e-6, y0 + RAY_CELL + 2e-6);
        let mut found = Vec::new();
        for &t in self.cells.get(&(cell_of(x), cell_of(y))).map_or(&[][..], Vec::as_slice) {
            if self.up[t as usize].abs() < 1e-9 {
                continue; // senkrechte Waende trifft er nicht
            }
            let p = &self.p[t as usize];
            if p[0].max(p[3]).max(p[6]) < x0 || p[0].min(p[3]).min(p[6]) > x1 {
                continue;
            }
            if p[1].max(p[4]).max(p[7]) < y0 || p[1].min(p[4]).min(p[7]) > y1 {
                continue;
            }
            found.push(t);
        }
        let list: Rc<[u32]> = found.into();
        self.scratch.borrow_mut().rays.insert(cell, Rc::clone(&list));
        list
    }

    /// Schnitt der senkrechten Linie mit Dreieck t: Hoehe und +1 hinein | -1 hinaus.
    fn hit(&self, t: u32, x: f64, y: f64) -> Option<(f64, i32)> {
        let (p, d) = (&self.p[t as usize], self.up[t as usize]);
        let (rx, ry) = (x - p[0], y - p[1]);
        let u = (rx * (p[7] - p[1]) - ry * (p[6] - p[0])) / d;
        let v = ((p[3] - p[0]) * ry - (p[4] - p[1]) * rx) / d;
        if u < -1e-9 || v < -1e-9 || u + v > 1.0 + 1e-9 {
            return None;
        }
        Some((p[2] + u * (p[5] - p[2]) + v * (p[8] - p[2]), if d < 0.0 { 1 } else { -1 }))
    }

    /// Alle Schnitte, von unten nach oben. Deckungsgleiche Flaechen zweier Koerper zaehlen beide.
    pub fn crossings(&self, x: f64, y: f64) -> Vec<(f64, i32)> {
        let mut hits: Vec<(f64, i32)> = self.under_ray(x, y).iter().filter_map(|&t| self.hit(t, x, y)).collect();
        hits.sort_by(|a, b| a.0.total_cmp(&b.0));
        hits
    }

    pub fn inside(&self, x: f64, y: f64, z: f64) -> bool {
        let (x, y) = (x + NUDGE[0], y + NUDGE[1]);
        let mut depth = 0;
        for &t in self.under_ray(x, y).iter() {
            if let Some((at, sign)) = self.hit(t, x, y) {
                if at < z {
                    depth += sign;
                }
            }
        }
        depth > 0
    }

    /// Hoechste Oberseite unter z, sonst 0 (Druckbett).
    pub fn floor_below(&self, x: f64, y: f64, z: f64) -> f64 {
        let (x, y) = (x + NUDGE[0], y + NUDGE[1]);
        let mut floor = 0.0;
        for &t in self.under_ray(x, y).iter() {
            if let Some((at, sign)) = self.hit(t, x, y) {
                if at < z && sign < 0 && at > floor {
                    floor = at;
                }
            }
        }
        floor
    }

    /// Ist der Kreis im ganzen Band [z0, z1] frei?
    pub fn free(&self, x: f64, y: f64, radius: f64, z0: f64, z1: f64) -> bool {
        {
            let mut guard = self.scratch.borrow_mut();
            let scratch = &mut *guard;
            scratch.stamp = scratch.stamp.wrapping_add(1);
            if scratch.stamp == 0 {
                scratch.seen.fill(0);
                scratch.stamp = 1;
            }
            for ix in cell_of(x - radius)..=cell_of(x + radius) {
                for iy in cell_of(y - radius)..=cell_of(y + radius) {
                    if !self.posts.is_empty() {
                        if let Some(list) = self.post_cells.get(&(ix, iy)) {
                            if list.iter().any(|&i| self.hits_post(&self.posts[i as usize], x, y, radius, z0, z1)) {
                                return false;
                            }
                        }
                    }
                    let Some(list) = self.cells.get(&(ix, iy)) else { continue };
                    for &t in list {
                        let t = t as usize;
                        if self.high[t] <= z0 || self.low[t] >= z1 || scratch.seen[t] == scratch.stamp {
                            continue;
                        }
                        scratch.seen[t] = scratch.stamp;
                        if self.hits_triangle(t, x, y, radius, z0, z1) {
                            return false;
                        }
                    }
                }
            }
        }
        !self.inside(x, y, (z0 + z1) / 2.0)
    }

    fn hits_post(&self, post: &Post, x: f64, y: f64, radius: f64, z0: f64, z1: f64) -> bool {
        if post.high <= z0 || post.low >= z1 {
            return false;
        }
        let (dx, dy) = ((x - post.x).abs(), (y - post.y).abs());
        let distance = if post.round {
            dx.hypot(dy) - post.half
        } else {
            (dx - post.half).max(0.0).hypot((dy - post.half).max(0.0))
        };
        distance < radius
    }

    fn hits_triangle(&self, t: usize, x: f64, y: f64, radius: f64, z0: f64, z1: f64) -> bool {
        let p = &self.p[t];
        if p[0].min(p[3]).min(p[6]) >= x + radius || p[0].max(p[3]).max(p[6]) <= x - radius {
            return false;
        }
        if p[1].min(p[4]).min(p[7]) >= y + radius || p[1].max(p[4]).max(p[7]) <= y - radius {
            return false;
        }
        // Ein Dreieck, an zwei Ebenen geschnitten, hat hoechstens fuenf Ecken.
        let mut polygon = [[0.0; 3]; 8];
        for k in 0..3 {
            polygon[k] = [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]];
        }
        let mut count = 3;
        if self.low[t] < z0 {
            (polygon, count) = clip(&polygon[..count], z0, 1.0);
        }
        if self.high[t] > z1 {
            (polygon, count) = clip(&polygon[..count], z1, -1.0);
        }
        if count == 0 {
            return false;
        }
        let (mut positive, mut negative) = (false, false);
        for i in 0..count {
            let (a, b) = (polygon[i], polygon[(i + 1) % count]);
            let (ex, ey, rx, ry) = (b[0] - a[0], b[1] - a[1], x - a[0], y - a[1]);
            let len2 = ex * ex + ey * ey;
            let at = if len2 != 0.0 { ((rx * ex + ry * ey) / len2).clamp(0.0, 1.0) } else { 0.0 };
            if (rx - ex * at).powi(2) + (ry - ey * at).powi(2) < radius * radius {
                return true;
            }
            let side = ex * ry - ey * rx;
            if side > 1e-12 {
                positive = true;
            } else if side < -1e-12 {
                negative = true;
            }
        }
        // Mittelpunkt innerhalb der Flaeche. Eine senkrechte Wand hat keine.
        positive != negative && self.up[t].abs() > 1e-9
    }
}

fn clip(polygon: &[[f64; 3]], z: f64, sign: f64) -> ([[f64; 3]; 8], usize) {
    let mut out = [[0.0; 3]; 8];
    let mut count = 0;
    for i in 0..polygon.len() {
        let (a, b) = (polygon[i], polygon[(i + 1) % polygon.len()]);
        let (da, db) = ((a[2] - z) * sign, (b[2] - z) * sign);
        if da >= 0.0 && count < out.len() {
            out[count] = a;
            count += 1;
        }
        if (da >= 0.0) != (db >= 0.0) && count < out.len() {
            let f = da / (da - db);
            out[count] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, z];
            count += 1;
        }
    }
    (out, count)
}
