//! Was Wegsuche, Kopf und Fuss gemeinsam brauchen: Feld, Schichtgrenzen, Abstaende.
use super::{
    contact::resting_foot,
    field::SolidField,
    types::Shape,
};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

pub type Point = [f64; 4]; // x, y, z, Radius
pub type Block = [f64; 6]; // x0, y0, z0, x1, y1, z1

const SLOPED_FLOOR: f64 = 0.75; // Hoehenunterschied unter dem Fuss je mm Radius, rund 25 Grad

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bed {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Env {
    pub layer: f64,
    pub first_layer: f64,
    /// Wechselnde Schichthoehen.
    pub variable: bool,
    pub gap: f64,
    pub bottom_gap: f64,
    pub xy_gap: f64,
    pub line_width: f64,
    pub interfaces: f64,
    /// Luft zwischen den Linien der Kontaktlage.
    pub spacing: f64,
    /// Luft zwischen den Kontaktbahnen der obersten Schicht (wie die oberste Stuetzlage der Engine).
    pub contact_gap: f64,
    /// Kontaktschicht wie Prusa: Winkel der Stuetze (Kontakt quer dazu), Muster "grid", Schleife um den Kontakt.
    pub angle: f64,
    pub grid: bool,
    pub loops: bool,
    /// Untere Kontaktlagen (support_material_bottom_interface_layers, -1 = wie oben) und deren Bahnabstand.
    pub bottom_layers: f64,
    pub bottom_pitch: f64,
    pub raft: bool,
}

pub fn directions<const N: usize>() -> [[f64; 2]; N] {
    std::array::from_fn(|i| {
        let angle = i as f64 * PI / (N / 2) as f64;
        [angle.cos(), angle.sin()]
    })
}

pub struct Landing {
    pub foot: Point,
    pub floor: f64,
    pub pad: Vec<Block>,
}

pub struct TipStart {
    pub top: f64,
    pub r: f64,
}

pub struct Context<'a> {
    pub field: &'a SolidField,
    pub env: Env,
    pub bed: Bed,
    pub bed_only: bool,
    pub above: f64,
    pub below: f64,
    pub around16: [[f64; 2]; 16],
    pub around24: [[f64; 2]; 24],
}

impl<'a> Context<'a> {
    pub fn new(field: &'a SolidField, env: Env, bed: Bed, bed_only: bool) -> Self {
        // Geschnitten wird auf halber Schicht. Bei wechselnden Schichthoehen gilt eine ganze Schicht Reserve.
        let slack = if env.variable { env.layer } else { env.layer / 2.0 };
        // Material zaehlt nur auf den Schnittebenen. Entscheidend ist die letzte verbotene Ebene,
        // nicht Abstand plus halbe Schicht, sonst wird aus 0,1 mm Abstand 0,2 mm.
        let band = |gap: f64| {
            if env.variable {
                gap + slack - 1e-4
            } else {
                ((gap / env.layer - 1e-6).ceil().max(1.0) - 0.5) * env.layer + 1e-4
            }
        };
        Context {
            field,
            env,
            bed,
            bed_only,
            above: band(env.gap),
            below: band(env.bottom_gap),
            around16: directions(),
            around24: directions(),
        }
    }

    pub fn boundary_below(&self, z: f64) -> f64 {
        let Env { layer, first_layer, variable, .. } = self.env;
        if variable {
            z
        } else if z < first_layer - 1e-6 {
            0.0
        } else {
            first_layer + ((z - first_layer) / layer + 1e-6).floor() * layer
        }
    }

    pub fn boundary_above(&self, z: f64) -> f64 {
        let Env { layer, first_layer, variable, .. } = self.env;
        if variable || z <= 1e-6 {
            z
        } else if z <= first_layer + 1e-6 {
            first_layer
        } else {
            first_layer + ((z - first_layer) / layer - 1e-6).ceil() * layer
        }
    }

    pub fn on_bed(&self, x: f64, y: f64, r: f64) -> bool {
        x - r >= self.bed.min_x && x + r <= self.bed.max_x && y - r >= self.bed.min_y && y + r <= self.bed.max_y
    }

    pub fn clear(&self, a: Point, b: Point) -> bool {
        self.clear_by(a, b, self.env.xy_gap)
    }

    /// Aststueck zwischen zwei Kreisen. In Teilstuecken, damit kein Hindernis dazwischen passt.
    pub fn clear_by(&self, a: Point, b: Point, xy_gap: f64) -> bool {
        let moved = (b[0] - a[0]).hypot(b[1] - a[1]);
        let parts = (moved / 0.8).ceil().max(1.0);
        for i in 0..parts as usize {
            let i = i as f64;
            let f = (i + 0.5) / parts;
            let r = a[3] + (b[3] - a[3]) * f + (b[3] - a[3]).abs() / parts / 2.0 + moved / parts / 2.0;
            let (x, y) = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
            if !self.on_bed(x, y, r) {
                return false;
            }
            let za = a[2] + (b[2] - a[2]) * (i / parts);
            let zb = a[2] + (b[2] - a[2]) * ((i + 1.0) / parts);
            let low = za.min(zb);
            // Direkt auf dem Bett gibt es darunter nichts einzuhalten.
            let from = if low <= 1e-6 { 0.001 } else { low - self.below };
            if !self.field.free(x, y, r + xy_gap, from, za.max(zb) + self.above) {
                return false;
            }
        }
        true
    }

    /// Kontaktscheibe so hoch wie moeglich, aber mit vollem Abstand.
    pub fn tip(&self, x: f64, y: f64, surface: f64, shape: &Shape) -> Option<TipStart> {
        let least = 1.1 * self.env.line_width;
        let wanted = least.max(shape.tip_width / 2.0);
        let start = self.boundary_below(surface - self.above + 2e-4);
        let radii = [wanted, least];
        for &r in &radii[..if wanted > least { 2 } else { 1 }] {
            if !self.on_bed(x, y, r) {
                continue;
            }
            // An einer Schraege muss die Scheibe bis unter ihre tiefste Stelle.
            let last = surface - self.env.gap - 2.75 * r - 2.0 * self.env.layer;
            let mut top = start;
            while top > self.env.layer && top >= last {
                if self.field.free(x, y, r, top - self.env.layer, top + self.above) {
                    return Some(TipStart { top, r });
                }
                top -= self.env.layer;
            }
        }
        None
    }

    /// Verjuengte Spitze nach unten.
    pub fn neck(&self, x: f64, y: f64, start: &TipStart, shape: &Shape) -> Vec<Point> {
        let mut at = [x, y, start.top, start.r];
        let mut points = vec![at];
        let body = start.r.max(shape.body_width / 2.0);
        let stop = (start.top - shape.tip_height).max(0.0);
        while at[2] > stop + 1e-6 {
            let z = stop.max(at[2] - 0.5);
            let share = (start.top - z) / shape.tip_height;
            // Am Hals zaehlt der senkrechte Abstand, seitlich liegt er naturgemaess nah an der Schraege.
            let next = [start.r + (body - start.r) * share, at[3]]
                .into_iter()
                .map(|r| [x, y, z, r])
                .find(|candidate| self.clear_by(at, *candidate, 0.0));
            let Some(next) = next else { break };
            points.push(next);
            at = next;
        }
        points
    }

    /// Auflage auf dem Modell direkt unter `at`.
    pub fn landing(&self, at: Point) -> Option<Landing> {
        if self.bed_only {
            return None;
        }
        let [x, y, z, r] = at;
        let mut floor = self.field.floor_below(x, y, z);
        let mut lowest = floor;
        for [dx, dy] in self.around16 {
            let here = self.field.floor_below(x + dx * r * 0.8, y + dy * r * 0.8, z);
            floor = floor.max(here);
            lowest = lowest.min(here);
        }
        // Auf einer Schraege haengt der Fuss halb in der Luft oder streift: woanders hin, sonst Prusa-Pfeiler.
        if floor <= 0.0 || floor - lowest > r * SLOPED_FLOOR {
            return None;
        }
        let limit = (z + 1e-6).min(floor + self.env.bottom_gap + 3.0 * self.env.layer + r);
        let radii = [r, r.min(1.1 * self.env.line_width)];
        for &radius in &radii[..if radii[0] == radii[1] { 1 } else { 2 }] {
            let mut bottom = self.boundary_above(floor + self.below - 2e-4);
            while bottom <= limit {
                let foot = [x, y, z.min(bottom), radius];
                if z - bottom >= 1e-6 {
                    if !self.clear_by(at, foot, 0.0) {
                        bottom += self.env.layer;
                        continue;
                    }
                    // Seitlich darf der Ast erst ganz unten, an der Auflage selbst, nah ans Teil.
                    let above = z.min(bottom + r + 1.0);
                    if z - above > 1e-3 && !self.clear(at, [x, y, above, r]) {
                        break;
                    }
                }
                if let Some(pad) = resting_foot(self, foot) {
                    return Some(Landing { foot, floor, pad });
                }
                break;
            }
        }
        None
    }

    /// Fuss aufweiten, soweit Platz ist.
    pub fn flare(&self, points: &[Point], shape: &Shape, room: f64) -> Option<Vec<Point>> {
        let end = *points.last()?;
        let from = [end[0], end[1], shape.base_height.min(points[0][2]), end[3]];
        let mut r = room.min(shape.base_width / 2.0);
        while r > end[3] + 0.1 {
            let ground = [end[0], end[1], 0.0, r];
            if self.clear(from, ground) {
                return Some(vec![from, ground]);
            }
            r -= 0.5;
        }
        None
    }
}
