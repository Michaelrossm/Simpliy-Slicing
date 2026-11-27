//! Kopf und Fuss nach dem Prinzip der Prusa-Stuetzen: Die Kontaktlage folgt der echten Flaeche,
//! wird am Teil beschnitten und jede Schicht steht auf der darunter.
use super::{
    context::{Block, Context, Point},
    field::NUDGE,
    types::Shape,
};
use std::f64::consts::SQRT_2;

const CELL: f64 = 0.35;
const RISE: f64 = 2.75; // tan 70 Grad: steilste Flaeche, die noch dazugehoert
const GROWTH: f64 = 1.2; // mm Verbreiterung je mm Hoehe, rund 50 Grad
const OVERLAP: f64 = 0.004; // damit die Engine Nachbarquader sicher vereinigt
/// So weit um den gesetzten Punkt wird Kontakt gebaut und geprueft.
pub const CONTACT_RADIUS: f64 = 0.9;
/// So viele Schichten unter dem Kontaktabstand zaehlt eine Bahn noch als Kontakt.
pub const CONTACT_LAYERS: f64 = 2.6;
/// So weit daneben darf die Bahn liegen, an Schraegen haelt der XY-Abstand sie auf.
pub const CONTACT_REACH: f64 = 0.5;

#[derive(Clone, Copy)]
struct Raster {
    n: usize,
    size: f64,
    half: f64,
}

impl Raster {
    fn new(half: f64) -> Self {
        let n = crate::util::round_up(2.0 * half / CELL).max(2.0) as usize;
        Raster { n, size: 2.0 * half / n as f64, half }
    }

    fn middle(&self, i: usize) -> f64 {
        -self.half + (i as f64 + 0.5) * self.size
    }
}

/// Zellen, die in einem vollen Quadrat aus `span` Zellen liegen.
fn opened(mask: &[bool], n: usize, span: usize) -> Vec<bool> {
    let mut out = vec![false; mask.len()];
    for j in 0..=n - span {
        for i in 0..=n - span {
            if (j..j + span).all(|b| mask[b * n + i..b * n + i + span].iter().all(|&on| on)) {
                (j..j + span).for_each(|b| out[b * n + i..b * n + i + span].fill(true));
            }
        }
    }
    out
}

struct Slab {
    low: f64,
    high: f64,
    mask: Vec<bool>,
}

/// Gleiche Zeilen und gleiche Schichten zusammenfassen: eine ebene Flaeche wird ein einziger Quader.
fn boxes_of(slabs: Vec<Slab>, raster: Raster, left: f64, front: f64) -> Vec<Block> {
    let Raster { n, size, .. } = raster;
    let mut runs: Vec<Slab> = Vec::new();
    for slab in slabs {
        match runs.last_mut() {
            Some(last) if (last.high - slab.low).abs() < 1e-6 && last.mask == slab.mask => last.high = slab.high,
            _ => runs.push(slab),
        }
    }
    let mut boxes = Vec::new();
    for Slab { low, high, mask } in runs {
        let mut used = vec![false; mask.len()];
        let open = |used: &[bool], at: usize| mask[at] && !used[at];
        for j in 0..n {
            for i in 0..n {
                let at = j * n + i;
                if !open(&used, at) {
                    continue;
                }
                let mut w = 1;
                while i + w < n && open(&used, at + w) {
                    w += 1;
                }
                let mut d = 1;
                while j + d < n && (0..w).all(|k| open(&used, at + d * n + k)) {
                    d += 1;
                }
                for a in 0..d {
                    used[at + a * n..at + a * n + w].fill(true);
                }
                boxes.push([
                    left + i as f64 * size - OVERLAP,
                    front + j as f64 * size - OVERLAP,
                    low,
                    left + (i + w) as f64 * size + OVERLAP,
                    front + (j + d) as f64 * size + OVERLAP,
                    high + 1e-4,
                ]);
            }
        }
    }
    boxes
}

pub struct Head {
    pub dense: Vec<Block>,
    /// Streifen schmaler als zwei Linien des Kontaktmusters: voll gedruckt, sonst faellt die Linie mal hinein, mal nicht.
    pub strips: Vec<Block>,
    pub stem: Vec<Block>,
    /// Pruefpunkte fuer den G-Code.
    pub samples: Vec<[f64; 3]>,
    /// Anteil mit Kontakt um den gesetzten Punkt.
    pub reached: f64,
}

pub struct HeadInput<'a> {
    pub x: f64,
    pub y: f64,
    pub r: f64,
    pub top: f64,
    pub neck_low: f64,
    pub surface: f64,
    pub shape: &'a Shape,
    /// Gesetzter Punkt, wenn die Spitze daneben steht.
    pub target: Option<[f64; 3]>,
}

/// None = kein brauchbarer Kontakt, dann stuetzt Prusa die Stelle.
pub fn contact_head(ctx: &Context, tip: HeadInput) -> Option<Head> {
    let env = ctx.env;
    let (layer, interfaces, line_width) = (env.layer, env.interfaces, env.line_width);
    let HeadInput { x, y, r, surface, .. } = tip;
    let half = r.max(tip.shape.contact_width / 2.0).max(line_width * 1.5);
    let raster = Raster::new(half);
    let Raster { n, size, .. } = raster;
    let cells = n * n;
    let mut ceiling = vec![f64::NAN; cells];
    let mut distance = vec![0.0; cells];

    let (mut lowest, mut highest) = (f64::INFINITY, f64::NEG_INFINITY);
    for j in 0..n {
        for i in 0..n {
            let (mx, my) = (raster.middle(i), raster.middle(j));
            let (px, py) = (x + mx, y + my);
            let at = j * n + i;
            let away = mx.hypot(my);
            distance[at] = (away - r).max(0.0);
            if !ctx.on_bed(px, py, size / 2.0) {
                continue;
            }
            let mut best = f64::NAN;
            let mut nearest = away * RISE + 0.3;
            for (z, sign) in ctx.field.crossings(px + NUDGE[0], py + NUDGE[1]) {
                if sign < 0 || (z - surface).abs() > nearest {
                    continue;
                }
                nearest = (z - surface).abs();
                best = z;
            }
            if best.is_nan() {
                continue;
            }
            ceiling[at] = best;
            lowest = lowest.min(best);
            highest = highest.max(best);
        }
    }
    if lowest == f64::INFINITY {
        return None;
    }

    // Liegt der Punkt auf der Aussenkante einer Schraege, bliebe unter ihr nur ein Keil schmaler als eine Bahn.
    // Dann darf die Kontaktlage zwei Bahnen breit ueber die Kante hinaus.
    let rim: Vec<f64> = {
        let on_rim = (0..cells).any(|at| distance[at] == 0.0 && ceiling[at].is_nan()) && highest - lowest > line_width;
        let reach = (2.0 * line_width / size).ceil() as usize; // zwei Bahnen, eine allein verschluckt die Engine
        (0..cells)
            .map(|at| {
                if !on_rim || !ceiling[at].is_nan() {
                    return f64::NAN;
                }
                let (i, j) = (at % n, at / n);
                let mut high = f64::NAN;
                for b in j.saturating_sub(reach)..=(j + reach).min(n - 1) {
                    for a in i.saturating_sub(reach)..=(i + reach).min(n - 1) {
                        if i.abs_diff(a).pow(2) + j.abs_diff(b).pow(2) <= reach * reach {
                            high = high.max(ceiling[b * n + a]); // max uebergeht NaN
                        }
                    }
                }
                high
            })
            .collect()
    };

    // Unten so weit anfangen, dass die Verbreiterung die ganze Kontaktflaeche erreicht.
    let spread = (half * SQRT_2 - r).max(0.0) / GROWTH;
    let contact_low = ctx.boundary_below(tip.top.min(lowest - ctx.above + 2e-4).max(0.0));
    let lowest_start = tip.top.min(contact_low - interfaces * layer - spread);
    let start = ctx.boundary_above(tip.neck_low.max(lowest_start).max(0.0));
    let end = highest - ctx.above + 2e-4;
    let mut levels = vec![start];
    let mut level = start;
    while level + layer <= end + 1e-6 && levels.len() < 600 {
        level = if level < 1e-6 { env.first_layer } else { level + layer };
        levels.push(level);
    }
    if levels.len() < 2 {
        return None;
    }

    let diagonal = size * 0.71;
    let mut top = vec![0usize; cells]; // Anzahl freier Schichten je Zelle
    let from = (start + 0.001).max(0.001);
    let side = diagonal.max(env.xy_gap + size / 4.0);
    for j in 0..n {
        for i in 0..n {
            let at = j * n + i;
            if ceiling[at].is_nan() && rim[at].is_nan() && distance[at] > 0.0 {
                continue;
            }
            let (px, py) = (x + raster.middle(i), y + raster.middle(j));
            // Wie Prusa: Alle Schichten bis zum Kontaktabstand beschneiden seitlich um den XY-Abstand.
            let free = |k: usize| ctx.field.free(px, py, side, from, levels[k] + ctx.above);
            let limit = if !ceiling[at].is_nan() {
                ceiling[at] - ctx.above + 2e-4
            } else if rim[at].is_nan() {
                tip.top + 1e-6
            } else {
                (rim[at] - ctx.above + 2e-4).max(tip.top + 1e-6)
            };
            let mut high = levels.len() - 1;
            while high > 0 && levels[high] > limit {
                high -= 1;
            }
            if high < 1 {
                continue;
            }
            if free(high) {
                top[at] = high;
                continue;
            }
            let mut low = 0;
            while high - low > 1 {
                let mid = (low + high) / 2;
                if free(mid) {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            top[at] = low;
        }
    }

    // Schicht fuer Schicht von unten: Eine Zelle gibt es nur, wenn darunter etwas traegt.
    let mut masks: Vec<Vec<bool>> = Vec::with_capacity(levels.len());
    let mut reached = vec![0usize; cells];
    let mut below = vec![false; cells];
    let mut carrying = vec![false; cells];
    let line_cells = ((line_width / size).round() as usize).clamp(1, n);
    for k in 1..levels.len() {
        let mut mask = vec![false; cells];
        let in_neck = levels[k] <= tip.top + 1e-6;
        let allowed = (levels[k] - start) * GROWTH + size / 2.0;
        // Duenne Schichten wachsen weniger als eine Zelle, dicke mehr.
        let reach = ((levels[k] - levels[k - 1]) * GROWTH / size).ceil().max(1.0) as usize;
        for j in 0..n {
            for i in 0..n {
                let at = j * n + i;
                if top[at] < k {
                    continue;
                }
                let mut on = (in_neck && distance[at] == 0.0) || below[at];
                if !on && distance[at] <= allowed {
                    on = (j.saturating_sub(reach)..=(j + reach).min(n - 1))
                        .any(|b| carrying[b * n + i.saturating_sub(reach)..=b * n + (i + reach).min(n - 1)].contains(&true));
                }
                if on {
                    mask[at] = true;
                    reached[at] = k;
                }
            }
        }
        below.copy_from_slice(&mask);
        // Was schmaler als eine Bahn ist, traegt die naechste Schicht nur senkrecht.
        carrying = opened(&mask, n, line_cells);
        masks.push(mask);
    }

    let mut samples = Vec::new();
    let mut dense_from = f64::INFINITY;
    for at in 0..cells {
        let k = reached[at];
        // Nur Zellen, die wirklich bis unter die Flaeche kommen, bestimmen die Kontaktlagen.
        if k == 0 || ceiling[at].is_nan() || levels[k] < ceiling[at] - env.gap - 2.0 * layer - env.xy_gap * RISE {
            continue;
        }
        dense_from = dense_from.min(levels[k] - interfaces * layer);
        samples.push(([x + raster.middle(at % n), y + raster.middle(at / n), levels[k]], at));
    }
    if (samples.len() as f64) * size * size < line_width * line_width {
        return None;
    }
    // Schmaler als eine Bahn druckt die Engine nicht. Das zaehlt beim Ausweichen nicht als Kontakt.
    let mut printed = vec![0usize; cells];
    if tip.target.is_some() {
        let span = ((line_width / size).ceil() as usize).clamp(1, n);
        for (k, mask) in masks.iter().enumerate() {
            for j in 0..=n - span {
                for i in 0..=n - span {
                    let block = |b: usize| b * n + i..b * n + i + span;
                    if (j..j + span).all(|b| mask[block(b)].iter().all(|&on| on)) {
                        (j..j + span).for_each(|b| printed[block(b)].fill(k + 1));
                    }
                }
            }
        }
    }
    // Der angeklickte Punkt selbst braucht Kontakt, nicht nur der Rand daneben.
    let (mut middle_cells, mut touched) = (0usize, 0usize);
    for at in 0..cells {
        let outside = match tip.target {
            Some([tx, ty, tz]) => {
                let away = (x + raster.middle(at % n) - tx).hypot(y + raster.middle(at / n) - ty);
                // Nur die Flaeche des Punktes, nicht die Decke einer Bohrung daneben.
                away > CONTACT_RADIUS || (ceiling[at] - tz).abs() > away * GROWTH + 0.3
            }
            None => distance[at] > 0.0,
        };
        if outside || ceiling[at].is_nan() {
            continue;
        }
        middle_cells += 1;
        // Ausweichen lohnt nur mit echtem Kontakt, gemessen wie in der Pruefung am G-Code.
        let touches = if tip.target.is_some() {
            let low = ceiling[at] - env.gap - CONTACT_LAYERS * layer - 0.02;
            let span = (CONTACT_REACH / size).ceil() as usize;
            let (i, j) = (at % n, at / n);
            (j.saturating_sub(span)..=(j + span).min(n - 1)).any(|b| {
                (i.saturating_sub(span)..=(i + span).min(n - 1)).any(|a| {
                    let k = printed[b * n + a];
                    let away = (i.abs_diff(a) as f64).hypot(j.abs_diff(b) as f64) * size;
                    k > 0 && away <= CONTACT_REACH && (low..=ceiling[at] + 0.02).contains(&levels[k])
                })
            })
        } else {
            let k = reached[at];
            k > 0 && levels[k] >= ceiling[at] - env.gap - 3.0 * layer - env.xy_gap
        };
        if touches {
            touched += 1;
        }
    }
    let wanted = if tip.target.is_some() { 0.4 } else { 0.2 };
    if middle_cells == 0 || (touched as f64) < middle_cells as f64 * wanted {
        return None;
    }

    let (mut dense, mut strips, mut stem) = (Vec::new(), Vec::new(), Vec::new());
    let pattern_cells = ((2.0 * (line_width + env.spacing) / size).ceil() as usize).clamp(1, n);
    let full: Vec<Vec<bool>> = {
        let narrow: Vec<Vec<bool>> = masks
            .iter()
            .map(|mask| mask.iter().zip(opened(mask, n, pattern_cells)).map(|(&on, wide)| on && !wide).collect())
            .collect();
        let mut full = narrow.clone();
        // Auch die Schicht darunter voll, sonst haengt ein Streifen ueber einer Luecke des Musters.
        for k in 1..masks.len() {
            for at in (0..cells).filter(|&at| narrow[k][at]) {
                let (i, j) = (at % n, at / n);
                for b in j.saturating_sub(1)..=(j + 1).min(n - 1) {
                    for a in i.saturating_sub(1)..=(i + 1).min(n - 1) {
                        full[k - 1][b * n + a] |= masks[k - 1][b * n + a];
                    }
                }
            }
        }
        full
    };
    for (k, (mask, full)) in masks.into_iter().zip(full).enumerate() {
        if !mask.contains(&true) {
            continue;
        }
        let (low, high) = (levels[k], levels[k + 1]);
        if low < dense_from - 1e-6 {
            stem.push(Slab { low, high, mask });
            continue;
        }
        let loose: Vec<bool> = mask.iter().zip(&full).map(|(&on, &full)| on && !full).collect();
        if loose.contains(&true) {
            dense.push(Slab { low, high, mask: loose });
        }
        if full.contains(&true) {
            strips.push(Slab { low, high, mask: full });
        }
    }
    if dense.is_empty() && strips.is_empty() {
        return None;
    }
    // Pruefpunkte: Zellen im Inneren, gleichmaessig verteilt.
    let inner: Vec<[f64; 3]> = samples
        .iter()
        .filter(|(_, at)| {
            let (i, j) = (at % n, at / n);
            i >= 1 && j >= 1 && i + 2 <= n && j + 2 <= n && [at - 1, at + 1, at - n, at + n].iter().all(|&next| reached[next] > 0)
        })
        .map(|(point, _)| *point)
        .collect();
    let step = inner.len().div_ceil(12).max(1);
    Some(Head {
        strips: boxes_of(strips, raster, x - half, y - half),
        dense: boxes_of(dense, raster, x - half, y - half),
        stem: boxes_of(stem, raster, x - half, y - half),
        samples: inner.into_iter().step_by(step).collect(),
        reached: touched as f64 / middle_cells as f64,
    })
}

/// Fuellt von der echten Oberflaeche bis zum Ende des Asts. None = dort kann er nicht stehen.
pub fn resting_foot(ctx: &Context, foot: Point) -> Option<Vec<Block>> {
    let [x, y, bottom, r] = foot;
    let (env, field) = (ctx.env, ctx.field);
    // Wie Prusa breiter als der Ast, sonst verschwinden die ersten schmalen Streifen an Schraegen.
    let wide = (r + env.line_width / 2.0).max((3.0 * env.line_width).min(2.0 * r));
    let raster = Raster::new(wide);
    let Raster { n, size, .. } = raster;
    let mut starts = vec![f64::INFINITY; n * n];
    let (mut in_disc, mut held) = (0usize, 0usize);
    let mut lowest = bottom;
    let limit = ctx.boundary_below(bottom + 1e-6);
    for j in 0..n {
        for i in 0..n {
            let (mx, my) = (raster.middle(i), raster.middle(j));
            let away = mx.hypot(my);
            if away > wide {
                continue;
            }
            let inner = away <= r;
            if inner {
                in_disc += 1;
            }
            let (px, py) = (x + mx, y + my);
            let middle_floor = field.floor_below(px, py, bottom + env.layer);
            let mut floor = middle_floor;
            // Die hoechste Ecke der Zelle bestimmt den Abstand.
            let look = size / 2.0;
            for (a, b) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                let corner = field.floor_below(px + a * look, py + b * look, bottom + env.layer);
                if corner - middle_floor < look * 2.0 * RISE {
                    floor = floor.max(corner);
                }
            }
            // Tiefer als die eigene Breite ist kein Fuss mehr, sondern eine Kante ins Leere.
            if floor <= 0.0 || bottom - floor > 2.0 * r + 1.5 {
                continue;
            }
            // Zwischen Zellmitte und hoechster Ecke: An der Schichttreppe bleibt so der Abstand, ohne Luft darunter.
            let z = ctx.boundary_above(middle_floor + 0.7 * (floor - middle_floor) + ctx.below - 2e-4);
            if z > limit + env.layer + 1e-6 {
                continue;
            }
            if z < bottom - 1e-6 {
                let middle_z = (z + bottom) / 2.0;
                if field.inside(px, py, middle_z) {
                    continue;
                }
                // Die Verbreiterung darf nicht an Waenden kleben.
                if !inner && !field.free(px, py, size / 2.0, middle_z, bottom + ctx.above) {
                    continue;
                }
            }
            if z < bottom - 1e-6 {
                // Neben einer Stufe oder Wand gilt der XY-Abstand, flacher Grund zaehlt nicht als Seite.
                let aside = env.xy_gap + size / 2.0;
                let from = z + if floor - middle_floor < 0.02 { 0.01 } else { aside * 0.47 };
                if from < bottom && !field.free(px, py, aside, from, bottom) {
                    continue;
                }
                starts[j * n + i] = z;
                lowest = lowest.min(z);
            }
            // Erst nach dem XY-Abstand: In einer runden Bohrung bleibt sonst nur ein Streifen, der nicht traegt.
            if inner {
                held += 1;
            }
        }
    }
    if (held as f64) < in_disc as f64 * 0.55 {
        return None;
    }
    let mut slabs = Vec::new();
    let mut z = lowest;
    while z < bottom - 1e-6 {
        slabs.push(Slab { low: z, high: bottom.min(z + env.layer), mask: starts.iter().map(|v| *v <= z + 1e-6).collect() });
        z += env.layer;
    }
    Some(boxes_of(slabs, raster, x - wide, y - wide))
}
