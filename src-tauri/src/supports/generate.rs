//! Stuetzpunkte finden: automatisch im Raster oder an einem angeklickten Punkt.
use super::{
    contact::CONTACT_RADIUS,
    placement::Surface,
    types::{is_body, Settings, Support},
};
use crate::util::{hypot3, FastMap};
use std::{
    f64::consts::PI,
    sync::{Arc, Mutex},
};

const EPS: f64 = 1e-8;
const MAX_RISE: f64 = 2.75; // tan 70 Grad: steilste Unterseite, die noch zum selben Pfeiler gehoert
const SAMPLES: i32 = 4;
const PROBE_STEP: f64 = 0.3; // mm zwischen den Pruefpunkten
const SAME_UNDERSIDE: f64 = 2.6; // mm, so weit weicht dieselbe Unterseite um den Punkt hoechstens ab

struct Face {
    id: usize,
    a: [f64; 3],
    b: [f64; 3],
    c: [f64; 3],
    nz: f64,
    denom: f64,
    min: [f64; 3],
    max: [f64; 3],
    area_xy: f64,
}

impl Face {
    fn height_at(&self, x: f64, y: f64) -> Option<f64> {
        if self.denom.abs() < EPS || x < self.min[0] - EPS || x > self.max[0] + EPS || y < self.min[1] - EPS || y > self.max[1] + EPS {
            return None;
        }
        let (a, b, c) = (&self.a, &self.b, &self.c);
        let (rx, ry) = (x - a[0], y - a[1]);
        let u = (rx * (c[1] - a[1]) - ry * (c[0] - a[0])) / self.denom;
        let v = ((b[0] - a[0]) * ry - (b[1] - a[1]) * rx) / self.denom;
        if u < -1e-7 || v < -1e-7 || u + v > 1.0 + 1e-7 {
            return None;
        }
        Some(a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]))
    }
}

/// Grobe XY-Faecher, sehr grosse Dreiecke gelten ueberall.
struct Lookup {
    pitch: f64,
    buckets: FastMap<(i64, i64), Vec<u32>>,
    spanning: Vec<u32>,
}

impl Lookup {
    fn at(&self, x: f64, y: f64) -> impl Iterator<Item = u32> + '_ {
        let key = ((x / self.pitch).floor() as i64, (y / self.pitch).floor() as i64);
        self.buckets.get(&key).map_or(&[][..], Vec::as_slice).iter().chain(&self.spanning).copied()
    }
}

/// Modell in Bettlage, einmal ausgewertet.
pub struct World {
    pub vertices: Vec<f64>,
    pub indices: Vec<u32>,
    faces: Vec<Face>,
    lookup: Mutex<Option<Arc<Lookup>>>,
}

impl World {
    pub(crate) fn estimated_bytes(&self) -> usize {
        let base = self.vertices.capacity() * std::mem::size_of::<f64>()
            + self.indices.capacity() * std::mem::size_of::<u32>()
            + self.faces.capacity() * std::mem::size_of::<Face>();
        let lookup = self.lookup.lock().unwrap_or_else(|e| e.into_inner());
        base.saturating_add(lookup.as_ref().map_or(0, |index| {
            index.spanning.capacity() * std::mem::size_of::<u32>()
                + index.buckets.capacity() * std::mem::size_of::<((i64, i64), Vec<u32>)>()
                + index.buckets.values().map(|v| v.capacity() * std::mem::size_of::<u32>()).sum::<usize>()
        }))
    }
    pub fn new(vertices: Vec<f64>, indices: Vec<u32>) -> World {
        let mut faces = Vec::with_capacity(indices.len() / 3);
        for (id, face) in indices.chunks_exact(3).enumerate() {
            let [a, b, c] = [0, 1, 2].map(|k| [0, 1, 2].map(|n| vertices[face[k] as usize * 3 + n]));
            let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let (nx, ny, nz) = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
            let norm = hypot3(nx, ny, nz);
            if norm < EPS {
                continue;
            }
            let denom = u[0] * v[1] - u[1] * v[0];
            faces.push(Face {
                id,
                a,
                b,
                c,
                nz: nz / norm,
                denom,
                min: [0, 1, 2].map(|n| a[n].min(b[n]).min(c[n])),
                max: [0, 1, 2].map(|n| a[n].max(b[n]).max(c[n])),
                area_xy: denom.abs() * 0.5,
            });
        }
        World { vertices, indices, faces, lookup: Mutex::new(None) }
    }

    fn lookup(&self, spacing: f64) -> Arc<Lookup> {
        let pitch = (spacing * 2.0).max(2.0);
        let mut cached = self.lookup.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(lookup) = cached.as_ref().filter(|l| l.pitch == pitch) {
            return Arc::clone(lookup);
        }
        let mut buckets: FastMap<(i64, i64), Vec<u32>> = FastMap::default();
        let mut spanning = Vec::new();
        for (at, face) in self.faces.iter().enumerate() {
            if face.area_xy < EPS {
                continue;
            }
            let cell = |v: f64| (v / pitch).floor() as i64;
            let (ax, bx, ay, by) = (cell(face.min[0]), cell(face.max[0]), cell(face.min[1]), cell(face.max[1]));
            if (bx - ax + 1).saturating_mul(by - ay + 1) > 144 {
                spanning.push(at as u32);
                continue;
            }
            for ix in ax..=bx {
                for iy in ay..=by {
                    buckets.entry((ix, iy)).or_default().push(at as u32);
                }
            }
        }
        let lookup = Arc::new(Lookup { pitch, buckets, spanning });
        *cached = Some(Arc::clone(&lookup));
        lookup
    }

    fn faces_at<'a>(&'a self, lookup: &'a Lookup, x: f64, y: f64) -> impl Iterator<Item = &'a Face> + 'a {
        lookup.at(x, y).map(|at| &self.faces[at as usize])
    }
}

/// Jede Stuetze behaelt die Einstellungen, mit denen sie entstand.
pub fn styled(mut support: Support, s: &Settings, area: f64) -> Support {
    let mut style = s.style.as_str();
    if style == "auto" {
        style = if support.surface_z - support.bottom_z < s.mini_below {
            "mini"
        } else if support.landing.as_deref() == Some("bed") && area >= s.pillar_area {
            "pillar"
        } else {
            "tree"
        };
    }
    support.size = None;
    support.shape = None;
    match style {
        "mini" => support.size = Some(s.mini_width),
        "pillar" => support.size = Some(s.spacing),
        _ => support.shape = Some(s.shape().to_map()),
    }
    support.style = Some(style.to_owned());
    support
}

/// Liegt der Punkt schon in einem anderen Koerper? Beide Seiten fragen: Genau auf einer Aussenkante zaehlt er als innen.
fn inside_before_surface(faces: &[&Face], x: f64, y: f64, surface: f64) -> bool {
    [(1.3, 0.7), (-1.3, -0.7), (0.7, -1.3), (-0.7, 1.3)].iter().any(|(a, b)| {
        let (px, py) = (x + a * 1e-5, y + b * 1e-5);
        let mut winding = 0;
        for face in faces {
            if face.nz.abs() < 1e-5 || face.min[2] >= surface - 1e-4 {
                continue;
            }
            if face.height_at(px, py).is_some_and(|z| z < surface - 1e-4) {
                winding += if face.nz < 0.0 { 1 } else { -1 };
            }
        }
        winding > 0
    })
}

/// Bett oder hoechste Oberseite unter dem Ueberhang.
fn landing_below(faces: &[&Face], x: f64, y: f64, target: f64, s: &Settings) -> Option<(f64, &'static str)> {
    let (mut floor, mut landing) = (s.bed_z, "bed");
    for face in faces {
        if face.nz <= 1e-5 || face.max[2] < floor - 1e-5 || face.min[2] >= target - 1e-5 {
            continue;
        }
        if let Some(z) = face.height_at(x, y) {
            if z > floor + 1e-5 && z < target - s.contact_gap - 1e-4 {
                floor = z;
                landing = "model";
            }
        }
    }
    // Baum, Faecher und Knotenblech koennen um das Modell herum aufs Bett.
    if s.placement == "buildplate" && landing == "model" && !is_body(Some(&s.style)) && s.style != "auto" {
        return None;
    }
    Some((floor, landing))
}

struct Spot {
    x: f64,
    y: f64,
    z: f64,
    face: i64,
}

fn assemble(faces: &[&Face], spot: &Spot, s: &Settings, source: &str, id: String) -> Option<Support> {
    let Spot { x, y, z, face } = *spot;
    if inside_before_surface(faces, x, y, z) {
        return None;
    }
    let top = z - s.contact_gap;
    let (bottom, landing) = landing_below(faces, x, y, z, s)?;
    if top - bottom < s.min_height - EPS {
        return None;
    }
    Some(Support {
        id,
        x,
        y,
        bottom_z: bottom,
        top_z: top,
        surface_z: z,
        landing: Some(landing.to_owned()),
        source: Some(source.to_owned()),
        face_id: Some(face),
        style: None,
        size: None,
        shape: None,
        placed: None,
        slim: false,
        extra: serde_json::Map::new(),
    })
}

pub struct Generated {
    pub supports: Vec<Support>,
    pub truncated: bool,
}

/// `only`: nur die Ueberhangflaeche dieses Dreiecks fuellen.
pub fn automatic(world: &World, s: &Settings, only: Option<usize>) -> Generated {
    let lookup = world.lookup(s.spacing);
    let pitch = if s.style == "mini" { s.mini_width.max(1.0) } else { s.spacing };
    let angle = s.effective_angle();
    let analysed = (s.detect_edges || s.detect_minima || s.min_area > 0.0 || s.bore_max > 0.0 || s.chamfer_max > 0.0 || s.style == "auto" || only.is_some())
        .then(|| Surface::analyse(&world.vertices, &world.indices, angle));
    let mut wanted = -1;
    if let (Some(face), Some(surface)) = (only, &analysed) {
        wanted = surface.region.get(face).copied().unwrap_or(-1);
        if wanted < 0 {
            return Generated { supports: Vec::new(), truncated: false };
        }
    }

    // Kleine Bohrungen (Rundbogen) druckt man ohne Stuetzen; Flaechenerkennung wie in SSC Cleaner.
    // Fasen (schmale Streifen knapp unter der Schwelle) druckt der Drucker selbsttragend.
    let skipped: Vec<i64> = match (&analysed, only) {
        (Some(surface), None) => {
            let mut list = super::surface_kinds::small_bores(surface, s.bore_max);
            list.extend(super::surface_kinds::chamfers(surface, angle, s.chamfer_tol, s.chamfer_max));
            list
        }
        _ => Vec::new(),
    };
    let threshold = -(angle * PI / 180.0).cos();
    let lowest = s.bed_z + s.min_height + s.contact_gap;
    let max_candidates = (s.max_supports as usize * 12).max(15_000);
    let mut slot_of: FastMap<(i64, i64), usize> = FastMap::default();
    let mut cells: Vec<((i64, i64), Vec<Spot>)> = Vec::new();
    let mut candidates = 0;
    let mut truncated = false;

    'outer: for face in &world.faces {
        if face.nz > threshold + 1e-9 || face.area_xy < EPS || face.max[2] <= lowest + 1e-5 {
            continue;
        }
        match &analysed {
            Some(surface) => {
                let region = surface.region[face.id];
                let used = if only.is_some() {
                    region == wanted
                } else {
                    s.detect_surfaces && surface.region_area.get(&region).copied().unwrap_or(0.0) >= s.min_area && !skipped.contains(&region)
                };
                if !used {
                    continue;
                }
            }
            None if !s.detect_surfaces => continue,
            None => {}
        }
        let cell = |v: f64| (v / pitch).floor() as i64;
        let (x0, x1, y0, y1) = (cell(face.min[0]), cell(face.max[0]), cell(face.min[1]), cell(face.max[1]));
        let mut add = |x: f64, y: f64, key: (i64, i64)| -> bool {
            let Some(z) = face.height_at(x, y).filter(|z| *z > lowest + 1e-5) else { return false };
            candidates += 1;
            let slot = *slot_of.entry(key).or_insert_with(|| {
                cells.push((key, Vec::new()));
                cells.len() - 1
            });
            let levels = &mut cells[slot].1;
            if !levels.iter().any(|level| (level.z - z).abs() < 1e-5) {
                levels.push(Spot { x, y, z, face: face.id as i64 });
            }
            true
        };
        // Auch riesige Dreiecke und feinste Raster duerfen die Rechnung nicht sprengen.
        if (x1 - x0 + 1).saturating_mul(y1 - y0 + 1) > (max_candidates * 16) as i64 {
            truncated = true;
            break;
        }
        let (mut found, mut added) = (false, 0usize);
        for ix in x0..=x1 {
            for iy in y0..=y1 {
                if add((ix as f64 + 0.5) * pitch, (iy as f64 + 0.5) * pitch, (ix, iy)) {
                    found = true;
                    added += 1;
                    if added >= max_candidates {
                        truncated = true;
                        break 'outer;
                    }
                }
            }
        }
        // Eine kleine einzelne Flaeche kann schmaler sein als das Raster.
        if !found && face.area_xy >= pitch * pitch * 0.18 {
            let x = (face.a[0] + face.b[0] + face.c[0]) / 3.0;
            let y = (face.a[1] + face.b[1] + face.c[1]) / 3.0;
            add(x, y, (cell(x), cell(y)));
        }
        if candidates >= max_candidates {
            truncated = true;
            break;
        }
    }

    let mut supports: Vec<Support> = Vec::new();
    let limit = s.max_supports as usize;
    'cells: for ((ix, iy), levels) in &mut cells {
        levels.sort_by(|a, b| a.z.total_cmp(&b.z));
        let Some(first) = levels.first() else { continue };
        let (x, y) = (first.x, first.y);
        let mut faces: Vec<&Face> = world.faces_at(&lookup, x, y).collect();
        let mut at = (x, y);
        for (level, spot) in levels.iter().enumerate() {
            if (spot.x, spot.y) != at {
                at = (spot.x, spot.y);
                faces = world.faces_at(&lookup, spot.x, spot.y).collect();
            }
            if let Some(support) = assemble(&faces, spot, s, "automatic", format!("auto-{ix}-{iy}-{level}")) {
                let area = analysed
                    .as_ref()
                    .and_then(|surface| surface.region_area.get(&surface.region[spot.face as usize]))
                    .copied()
                    .unwrap_or(0.0);
                supports.push(styled(support, s, area));
            }
            if supports.len() >= limit {
                truncated = true;
                break 'cells;
            }
        }
    }

    if let (Some(surface), None) = (&analysed, only) {
        let mut extra: Vec<([f64; 3], &str)> = Vec::new();
        if s.detect_minima {
            extra.extend(surface.local_minima(lowest).into_iter().map(|p| (p, "min")));
        }
        if s.detect_edges {
            extra.extend(surface.low_edges(pitch, lowest).into_iter().map(|p| (p, "edge")));
        }
        for ([x, y, z], kind) in extra {
            if supports.len() >= limit {
                truncated = true;
                break;
            }
            let near = if kind == "min" { pitch * 0.35 } else { pitch * 0.7 };
            if supports.iter().any(|p| (p.surface_z - z).abs() < pitch && (p.x - x).hypot(p.y - y) < near) {
                continue;
            }
            let faces: Vec<&Face> = world.faces_at(&lookup, x, y).filter(|f| f.min[2] < z - 1e-4).collect();
            let id = format!("auto-{kind}-{}", supports.len());
            if let Some(support) = assemble(&faces, &Spot { x, y, z, face: -1 }, s, "automatic", id) {
                let mut made = styled(support, s, 0.0);
                made.placed = Some(kind.to_owned());
                supports.push(made);
            }
        }
    }
    Generated { supports, truncated }
}

/// Stuetze an einem angeklickten Punkt der Unterseite.
pub fn at_surface(world: &World, point: [f64; 3], s: &Settings, id: &str) -> Option<Support> {
    let [x, y, z] = point;
    let mut best: Option<(&Face, f64)> = None;
    let mut distance = f64::INFINITY;
    for face in &world.faces {
        // Von Hand darf auch flacher gestuetzt werden, aber keine Oberseite.
        if face.nz >= -1e-4 {
            continue;
        }
        if let Some(actual) = face.height_at(x, y) {
            if (actual - z).abs() < distance {
                distance = (actual - z).abs();
                best = Some((face, actual));
            }
        }
    }
    let (face, height) = best?;
    if distance > (s.contact_gap * 2.0).max(0.4) {
        return None;
    }
    manual(world, &Spot { x, y, z: height, face: face.id as i64 }, s, id)
}

/// Klick aufs Bett: die tiefste freie Unterseite darueber.
pub fn at_xy(world: &World, x: f64, y: f64, s: &Settings, id: &str) -> Option<Support> {
    let mut choice: Option<Spot> = None;
    for face in &world.faces {
        if face.nz >= -1e-4 {
            continue;
        }
        let Some(z) = face.height_at(x, y) else { continue };
        if z <= s.bed_z + s.contact_gap + s.min_height + 1e-4 || choice.as_ref().is_some_and(|c| z >= c.z) {
            continue;
        }
        choice = Some(Spot { x, y, z, face: face.id as i64 });
    }
    manual(world, &choice?, s, id)
}

fn manual(world: &World, spot: &Spot, s: &Settings, id: &str) -> Option<Support> {
    let lookup = world.lookup(s.spacing);
    let faces: Vec<&Face> = world.faces_at(&lookup, spot.x, spot.y).collect();
    assemble(&faces, spot, s, "manual", id.to_owned()).map(|made| styled(made, s, 0.0))
}

/// Hoehenbereich der Unterseite ueber der ganzen Pfeilerflaeche, nicht nur in der Mitte.
pub fn ceilings(world: &World, supports: &[Support], s: &Settings) -> Vec<(f64, f64)> {
    let lookup = world.lookup(s.spacing);
    supports
        .iter()
        .map(|p| {
            let step = p.width(s.spacing) / 2.0 / f64::from(SAMPLES);
            let (mut low, mut high) = (p.surface_z, p.surface_z);
            for i in -SAMPLES..=SAMPLES {
                for k in -SAMPLES..=SAMPLES {
                    let (x, y) = (p.x + f64::from(i) * step, p.y + f64::from(k) * step);
                    let mut nearest = None;
                    let mut distance = f64::from(i).hypot(f64::from(k)) * step * MAX_RISE + 0.2;
                    for face in world.faces_at(&lookup, x, y) {
                        if face.nz >= -1e-4 {
                            continue;
                        }
                        let Some(z) = face.height_at(x, y).filter(|z| *z > p.bottom_z) else { continue };
                        if (z - p.surface_z).abs() <= distance {
                            nearest = Some(z);
                            distance = (z - p.surface_z).abs();
                        }
                    }
                    if let Some(z) = nearest {
                        low = low.min(z);
                        high = high.max(z);
                    }
                }
            }
            (low, high)
        })
        .collect()
}

/// Echte Unterseite rund um jeden gesetzten Punkt, fuer die Pruefung am G-Code.
/// Unabhaengig davon, was dort gebaut wurde.
pub fn undersides<'a>(world: &World, supports: impl IntoIterator<Item = &'a Support>, s: &Settings) -> Vec<Vec<[f64; 3]>> {
    let lookup = world.lookup(s.spacing);
    let steps = (CONTACT_RADIUS / PROBE_STEP).round() as i32;
    supports
        .into_iter()
        .map(|p| {
            let mut points = Vec::new();
            for i in -steps..=steps {
                for k in -steps..=steps {
                    let (dx, dy) = (f64::from(i) * PROBE_STEP, f64::from(k) * PROBE_STEP);
                    if dx.hypot(dy) > CONTACT_RADIUS + 1e-6 {
                        continue;
                    }
                    let (x, y) = (p.x + dx + 1.3e-5, p.y + dy + 0.7e-5);
                    let nearest = world
                        .faces_at(&lookup, x, y)
                        .filter(|face| face.nz < -1e-4)
                        .filter_map(|face| face.height_at(x, y))
                        .filter(|z| (z - p.surface_z).abs() < SAME_UNDERSIDE)
                        .min_by(|a, b| (a - p.surface_z).abs().total_cmp(&(b - p.surface_z).abs()));
                    if let Some(z) = nearest {
                        points.push([x, y, z]);
                    }
                }
            }
            points
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{super::test_support::boxes, *};

    fn settings() -> Settings {
        Settings::default()
    }

    #[test]
    fn supports_end_below_an_overhang_at_the_gap() {
        let world = boxes(&[[20.0, 20.0, 4.0, 20.0, 20.0, 12.0]]);
        let made = automatic(&world, &settings(), None);
        assert!(!made.supports.is_empty() && !made.truncated);
        for s in &made.supports {
            assert_eq!(s.bottom_z, 0.0);
            assert!((s.surface_z - s.top_z - 0.2).abs() < 1e-6);
            assert_eq!(s.surface_z, 10.0);
        }
        assert!(at_xy(&world, 20.0, 20.0, &settings(), "m").is_some());
    }

    #[test]
    fn a_cube_on_the_bed_needs_none() {
        assert!(automatic(&boxes(&[[20.0, 20.0, 20.0, 20.0, 20.0, 10.0]]), &settings(), None).supports.is_empty());
    }

    #[test]
    fn the_limit_is_reported() {
        let limited = Settings { max_supports: 2, ..settings() };
        let made = automatic(&boxes(&[[20.0, 20.0, 4.0, 20.0, 20.0, 12.0]]), &limited, None);
        assert_eq!(made.supports.len(), 2);
        assert!(made.truncated);
    }

    #[test]
    fn stacked_overhangs_get_their_own_supports() {
        let world = boxes(&[[20.0, 20.0, 4.0, 20.0, 20.0, 12.0], [20.0, 20.0, 4.0, 20.0, 20.0, 22.0]]);
        let mut centre: Vec<Support> =
            automatic(&world, &settings(), None).supports.into_iter().filter(|p| p.x == 18.0 && p.y == 18.0).collect();
        centre.sort_by(|a, b| a.top_z.total_cmp(&b.top_z));
        assert_eq!(centre.len(), 2);
        assert_eq!((centre[0].bottom_z, centre[0].surface_z), (0.0, 10.0));
        assert_eq!((centre[1].bottom_z, centre[1].surface_z), (14.0, 20.0));
        let bed_only = Settings { placement: "buildplate".into(), ..settings() };
        assert!(automatic(&world, &bed_only, None).supports.iter().all(|p| p.landing.as_deref() != Some("model")));
    }

    #[test]
    fn lowest_points_exclude_the_bed() {
        let world = boxes(&[[10.0, 10.0, 10.0, 20.0, 20.0, 15.0], [10.0, 10.0, 10.0, 50.0, 50.0, 5.0]]);
        let found = Surface::analyse(&world.vertices, &world.indices, 45.0).local_minima(0.3);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0][2], 10.0);
    }
}
