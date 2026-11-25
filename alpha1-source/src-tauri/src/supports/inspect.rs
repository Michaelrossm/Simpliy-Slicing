//! Kontrolle an den echten Bahnen. Dichte Kontaktlagen sind kein Muss: Prusa laesst sie an steilen Stellen teils weg.
use super::contact::{CONTACT_LAYERS, CONTACT_REACH};
use crate::{gcode::Preview, util::FastMap};

const CELL: f64 = 5.0;
/// Darunter hat der gesetzte Punkt praktisch keinen Kontakt. Prusa selbst schafft an steilen Kanten um 30 %.
const LEAST_CONTACT: f64 = 0.25;
const STEP: f64 = 0.25; // mm zwischen den Proben auf einer Bahn
const JOINED: f64 = 0.8; // mm, so nah gehoeren Proben zu einer Insel
const HELD: f64 = 0.15; // Anteil einer Insel, der mindestens aufliegt
const BED: f64 = 0.03;

#[derive(Clone, Debug)]
pub enum Check {
    /// Von Prusa gebauter Pfeiler.
    Pillar {
        x: f64,
        y: f64,
        surface: f64,
        spacing: f64,
        low: f64,
        high: f64,
        bottom: f64,
        gap: f64,
        bottom_gap: f64,
        layer: f64,
        raft: bool,
        /// Organische Aeste verlaufen absichtlich nicht senkrecht.
        branched: bool,
        /// Echte Unterseite um den gesetzten Punkt.
        underside: Vec<[f64; 3]>,
    },
    /// Spitze einer eigenen Form.
    Tip {
        x: f64,
        y: f64,
        surface: f64,
        z: f64,
        r: f64,
        layer: f64,
        width: f64,
        gap: f64,
        bottom_gap: f64,
        samples: Vec<[f64; 3]>,
        underside: Vec<[f64; 3]>,
    },
    /// Stichprobe an einem Ast.
    Branch { x: f64, y: f64, z: f64, r: f64, layer: f64 },
}

impl Check {
    fn place(&self) -> [f64; 3] {
        match self {
            Check::Pillar { x, y, surface, .. } | Check::Tip { x, y, surface, .. } => [*x, *y, *surface],
            Check::Branch { x, y, z, .. } => [*x, *y, *z],
        }
    }
}

#[derive(Default)]
pub struct Report {
    pub total: usize,
    /// Keine Bahn unter der Flaeche.
    pub missing: Vec<[f64; 3]>,
    /// Luecke im Pfeiler oder Ast.
    pub broken: Vec<[f64; 3]>,
    pub weak: Vec<[f64; 3]>,
    /// Ohne dichte Kontaktlage.
    pub plain: usize,
    /// Stuetzbahnen ohne Material darunter.
    pub floating: Vec<[f64; 3]>,
}

struct Bead {
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    z: f64,
    face: bool,
}

impl Bead {
    fn within(&self, x: f64, y: f64, reach: f64) -> bool {
        segment_distance([self.ax, self.ay], [self.bx, self.by], [x, y]) <= reach
    }

    fn crosses(&self, x: f64, y: f64, half: f64) -> bool {
        let (mut low, mut high) = (0.0f64, 1.0f64);
        for (a, b, min, max) in [(self.ax, self.bx, x - half, x + half), (self.ay, self.by, y - half, y + half)] {
            let delta = b - a;
            if delta.abs() < 1e-12 {
                if a < min || a > max {
                    return false;
                }
                continue;
            }
            let (t1, t2) = ((min - a) / delta, (max - a) / delta);
            low = low.max(t1.min(t2));
            high = high.min(t1.max(t2));
            if low > high {
                return false;
            }
        }
        true
    }
}

struct Beads {
    list: Vec<Bead>,
    cells: FastMap<(i32, i32), Vec<u32>>,
}

fn segment_distance(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let squared = dx * dx + dy * dy;
    let t = if squared > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared).clamp(0.0, 1.0) } else { 0.0 };
    (p[0] - a[0] - dx * t).hypot(p[1] - a[1] - dy * t)
}

fn is_support(role: &str) -> bool {
    role == "Support material" || role == "Support material interface"
}

/// Skirt, Reinigungsturm und Makros tragen nichts.
fn is_model(role: &str) -> bool {
    !is_support(role) && !["Skirt", "Wipe tower", "Custom"].iter().any(|word| role.contains(word))
}

fn cell(v: f64) -> i32 {
    (v / CELL).floor() as i32
}

impl Beads {
    fn each<'a>(&'a self, x: f64, y: f64, half: f64, mut found: impl FnMut(&'a Bead) -> bool) {
        for ix in cell(x - half)..=cell(x + half) {
            for iy in cell(y - half)..=cell(y + half) {
                for &at in self.cells.get(&(ix, iy)).map_or(&[][..], Vec::as_slice) {
                    let bead = &self.list[at as usize];
                    if bead.crosses(x, y, half) && found(bead) {
                        return;
                    }
                }
            }
        }
    }
}

fn beads_of(preview: &Preview) -> (Beads, f64) {
    let kinds: Vec<(bool, bool, bool)> = preview
        .roles
        .iter()
        .map(|role| {
            (is_support(role), role == "Support material interface", is_model(role))
        })
        .collect();
    let mut beads = Beads { list: Vec::new(), cells: FastMap::default() };
    let mut base = f64::INFINITY;
    for i in 0..preview.count() {
        let (support, face, model) = kinds[preview.role[i] as usize];
        let z = f64::from(preview.to[i * 3 + 2]);
        if model {
            base = base.min(z - f64::from(preview.height[i]));
        }
        if !support {
            continue;
        }
        let [ax, ay, bx, by] = [preview.from[i * 3], preview.from[i * 3 + 1], preview.to[i * 3], preview.to[i * 3 + 1]].map(f64::from);
        let at = beads.list.len() as u32;
        for ix in cell(ax.min(bx))..=cell(ax.max(bx)) {
            for iy in cell(ay.min(by))..=cell(ay.max(by)) {
                beads.cells.entry((ix, iy)).or_default().push(at);
            }
        }
        beads.list.push(Bead { ax, ay, bx, by, z, face });
    }
    (beads, base)
}

/// Anteil der Unterseite mit einer Bahn direkt darunter.
fn contact_share(beads: &Beads, underside: &[[f64; 3]], gap: f64, layer: f64, lift: f64) -> f64 {
    if underside.is_empty() {
        return 1.0;
    }
    // Gedruckt wird nur auf Schichtgrenzen, der Abstand rundet sich darauf auf.
    let gap = gap.max((gap / layer - 1e-6).ceil() * layer);
    let touched = underside
        .iter()
        .filter(|&&[x, y, z]| {
            let z = z + lift;
            let mut found = false;
            beads.each(x, y, CONTACT_REACH, |bead| {
                found = bead.z >= z - gap - CONTACT_LAYERS * layer - 0.02 && bead.z <= z + 0.02 && bead.within(x, y, CONTACT_REACH);
                found
            });
            found
        })
        .count();
    touched as f64 / underside.len() as f64
}

/// Zusammenhaengende Stuetzinseln einer Schicht, die fast nirgends aufliegen.
fn floating(preview: &Preview, gap: f64) -> Vec<[f64; 3]> {
    let counts: Vec<bool> = preview.roles.iter().map(|role| is_support(role) || is_model(role)).collect();
    let supports: Vec<bool> = preview.roles.iter().map(|role| is_support(role)).collect();
    let end = |list: &[f32], i: usize| [0, 1, 2].map(|a| f64::from(list[i * 3 + a]));
    let coarse = |v: f64| (v / 2.0).floor() as i32;
    let level = |z: f64| (z * 2.0).floor() as i32; // Faecher von 0,5 mm Hoehe

    let mut below: FastMap<(i32, i32, i32), Vec<u32>> = FastMap::default();
    let mut layers: FastMap<i64, Vec<([f64; 3], u32)>> = FastMap::default();
    for i in 0..preview.count() {
        let role = preview.role[i] as usize;
        if !counts[role] {
            continue;
        }
        let (a, b) = (end(&preview.from, i), end(&preview.to, i));
        for ix in coarse(a[0].min(b[0]))..=coarse(a[0].max(b[0])) {
            for iy in coarse(a[1].min(b[1]))..=coarse(a[1].max(b[1])) {
                below.entry((ix, iy, level(b[2]))).or_default().push(i as u32);
            }
        }
        if supports[role] {
            let steps = ((b[0] - a[0]).hypot(b[1] - a[1]) / STEP).ceil().max(1.0);
            let list = layers.entry((b[2] * 1000.0).round() as i64).or_default();
            for k in 0..=steps as usize {
                let t = k as f64 / steps;
                list.push(([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, b[2]], i as u32));
            }
        }
    }

    let holds = |&([x, y, z], own): &([f64; 3], u32)| -> bool {
        let bottom = z - f64::from(preview.height[own as usize]);
        if bottom <= BED {
            return true;
        }
        let reach = f64::from(preview.width[own as usize]) * 0.9;
        let (low, high) = (bottom - gap - 0.14, bottom + 0.06);
        for iz in level(low)..=level(high) {
            for ix in coarse(x - reach)..=coarse(x + reach) {
                for iy in coarse(y - reach)..=coarse(y + reach) {
                    for &other in below.get(&(ix, iy, iz)).map_or(&[][..], Vec::as_slice) {
                        let (a, b) = (end(&preview.from, other as usize), end(&preview.to, other as usize));
                        if b[2] >= low && b[2] <= high && segment_distance([a[0], a[1]], [b[0], b[1]], [x, y]) <= reach {
                            return true;
                        }
                    }
                }
            }
        }
        false
    };

    let mut heights: Vec<i64> = layers.keys().copied().collect();
    heights.sort_unstable();
    let mut found = Vec::new();
    for height in heights {
        let points = &layers[&height];
        let key = |p: &[f64; 3]| ((p[0] / JOINED).floor() as i32, (p[1] / JOINED).floor() as i32);
        let mut cells: FastMap<(i32, i32), Vec<usize>> = FastMap::default();
        for (i, (p, _)) in points.iter().enumerate() {
            cells.entry(key(p)).or_default().push(i);
        }
        let mut seen = vec![false; points.len()];
        for start in 0..points.len() {
            if seen[start] {
                continue;
            }
            seen[start] = true;
            let mut island = vec![start];
            let mut next = 0;
            while next < island.len() {
                let (p, _) = points[island[next]];
                let (cx, cy) = key(&p);
                for dx in -1..=1 {
                    for dy in -1..=1 {
                        for &other in cells.get(&(cx + dx, cy + dy)).map_or(&[][..], Vec::as_slice) {
                            let (q, _) = points[other];
                            if !seen[other] && (q[0] - p[0]).hypot(q[1] - p[1]) <= JOINED {
                                seen[other] = true;
                                island.push(other);
                            }
                        }
                    }
                }
                next += 1;
            }
            if island.len() < 4 {
                continue;
            }
            // Sobald genug aufliegt, muss der Rest nicht mehr gesucht werden.
            let wanted = island.len() as f64 * HELD;
            let mut held = 0usize;
            for &i in &island {
                if holds(&points[i]) {
                    held += 1;
                    if held as f64 >= wanted {
                        break;
                    }
                }
            }
            if (held as f64) < wanted {
                let n = island.len() as f64;
                let centre = |axis: usize| island.iter().map(|&i| points[i].0[axis]).sum::<f64>() / n;
                found.push([centre(0), centre(1), points[start].0[2]]);
            }
        }
    }
    found
}

/// Return the first geometric overlap of native and Simpliy support extrusion paths.
/// Arc paths have already been subdivided by the G-code parser.
pub fn mixed_support_overlap(preview: &Preview) -> Result<Option<[f64; 3]>, String> {
    if preview.support_origin.len() != preview.count() {
        return Err("Stuetzeigentuemer fehlen in der Vorschau".into());
    }
    let is_path = |i: usize| preview.roles.get(preview.role[i] as usize).is_some_and(|r| is_support(r));
    let point = |v: &[f32], i: usize| [f64::from(v[3*i]), f64::from(v[3*i+1]), f64::from(v[3*i+2])];
    let grid = |v: f64| (v / 2.0).floor() as i32;
    let level = |v: f64| (v / 0.25).floor() as i32;
    let mut cells: FastMap<(i32,i32,i32),Vec<usize>> = FastMap::default();
    let mut own = 0usize;
    for i in 0..preview.count() {
        if !is_path(i) { continue; }
        if preview.support_origin[i] == 1 { own += 1; continue; }
        let (a,b)=(point(&preview.from,i),point(&preview.to,i));
        let radius=f64::from(preview.width[i]).max(0.0)/2.0;
        let low=b[2]-f64::from(preview.height[i]).max(0.0);
        for ix in grid(a[0].min(b[0])-radius)..=grid(a[0].max(b[0])+radius) {
            for iy in grid(a[1].min(b[1])-radius)..=grid(a[1].max(b[1])+radius) {
                for iz in level(low)..=level(b[2]) { cells.entry((ix,iy,iz)).or_default().push(i); }
            }
        }
    }
    if own == 0 { return Err("Eigene Stuetzbahnen konnten nicht eindeutig erkannt werden".into()); }
    let mut seen = vec![0u32; preview.count()]; let mut stamp=0u32;
    for i in 0..preview.count() {
        if !is_path(i) || preview.support_origin[i] != 1 { continue; }
        stamp=stamp.wrapping_add(1); if stamp==0 {seen.fill(0);stamp=1;}
        let (a,b)=(point(&preview.from,i),point(&preview.to,i));
        let width=f64::from(preview.width[i]).max(0.0);
        let low=b[2]-f64::from(preview.height[i]).max(0.0);
        for ix in grid(a[0].min(b[0])-width/2.0)..=grid(a[0].max(b[0])+width/2.0) {
            for iy in grid(a[1].min(b[1])-width/2.0)..=grid(a[1].max(b[1])+width/2.0) {
                for iz in level(low)..=level(b[2]) {
                    for &j in cells.get(&(ix,iy,iz)).map_or(&[][..],Vec::as_slice) {
                        if seen[j]==stamp { continue; } seen[j]=stamp;
                        let (c,d)=(point(&preview.from,j),point(&preview.to,j));
                        let other_low=d[2]-f64::from(preview.height[j]).max(0.0);
                        if b[2].min(d[2])-low.max(other_low)<=0.02 { continue; }
                        let reach=(width+f64::from(preview.width[j]).max(0.0))/2.0-0.03;
                        if reach>0.0 && segment_gap([a[0],a[1]],[b[0],b[1]],[c[0],c[1]],[d[0],d[1]])<reach {
                            return Ok(Some([(a[0]+b[0])/2.0,(a[1]+b[1])/2.0,b[2]]));
                        }
                    }
                }
            }
        }
    }
    Ok(None)
}

fn segment_gap(a:[f64;2],b:[f64;2],c:[f64;2],d:[f64;2])->f64 {
    let cross=|p:[f64;2],q:[f64;2],r:[f64;2]|(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
    let (ab_c,ab_d,cd_a,cd_b)=(cross(a,b,c),cross(a,b,d),cross(c,d,a),cross(c,d,b));
    let boxes_overlap=a[0].min(b[0])<=c[0].max(d[0])+1e-9 && c[0].min(d[0])<=a[0].max(b[0])+1e-9
        && a[1].min(b[1])<=c[1].max(d[1])+1e-9 && c[1].min(d[1])<=a[1].max(b[1])+1e-9;
    if boxes_overlap && ab_c*ab_d<=1e-12 && cd_a*cd_b<=1e-12 { return 0.0; }
    segment_distance(a,b,c).min(segment_distance(a,b,d)).min(segment_distance(c,d,a)).min(segment_distance(c,d,b))
}

pub fn inspect(preview: &Preview, checks: &[Check]) -> Report {
    let (beads, model_base) = beads_of(preview);
    let mut report = Report { total: checks.iter().filter(|c| !matches!(c, Check::Branch { .. })).count(), ..Report::default() };
    let widest_gap = checks
        .iter()
        .filter_map(|check| match check {
            Check::Pillar { gap, bottom_gap, layer, .. } | Check::Tip { gap, bottom_gap, layer, .. } => {
                let gap = gap.max(*bottom_gap);
                Some(gap.max((gap / layer - 1e-6).ceil() * layer))
            }
            Check::Branch { .. } => None,
        })
        .fold(None, |most: Option<f64>, gap| Some(most.map_or(gap, |most| most.max(gap))));
    if let Some(gap) = widest_gap {
        report.floating = floating(preview, gap);
    }
    for check in checks {
        match check {
            Check::Branch { x, y, z, r, layer } => {
                let mut at = false;
                beads.each(*x, *y, r + 0.7, |bead| {
                    at = (bead.z - z).abs() <= 1.6 * layer;
                    at
                });
                if !at {
                    report.broken.push(check.place());
                }
            }
            Check::Tip { x, y, z, r, layer, width, gap, samples, underside, .. } => {
                let mut any = false;
                beads.each(*x, *y, r + 0.7, |bead| {
                    any = (bead.z - z).abs() <= 1.6 * layer;
                    any
                });
                // Dichte Bahn unter den einzelnen Punkten, eine Linie allein reicht nicht.
                let reach = width.max(0.45);
                let mut covered = 0usize;
                for &[sx, sy, sz] in samples {
                    let mut dense = false;
                    beads.each(sx, sy, reach, |bead| {
                        if (bead.z - sz).abs() <= 2.2 * layer {
                            any = true;
                            dense = bead.face;
                        }
                        dense
                    });
                    covered += usize::from(dense);
                }
                if !any {
                    report.missing.push(check.place());
                } else if (!samples.is_empty() && (covered as f64) < samples.len() as f64 * 0.5)
                    || contact_share(&beads, underside, *gap, *layer, 0.0) < LEAST_CONTACT
                {
                    report.weak.push(check.place());
                }
            }
            Check::Pillar { x, y, spacing, low, high, bottom, gap, bottom_gap, layer, raft, branched, underside, .. } => {
                // Ein Raft hebt das Modell im G-Code an.
                let lift = if *raft && model_base.is_finite() { model_base } else { 0.0 };
                let (low, high) = (low + lift, high + lift);
                let from = low - gap - 3.0 * layer - 0.3;
                let to = high - gap + layer + 0.05;
                let half = spacing / 2.0 + 0.4;
                let mut paths: Vec<&Bead> = Vec::new();
                beads.each(*x, *y, half, |bead| {
                    paths.push(bead);
                    false
                });
                let mut top = paths.iter().filter(|bead| bead.z >= from && bead.z <= to).peekable();
                if top.peek().is_none() {
                    report.missing.push(check.place());
                    continue;
                }
                if !top.any(|bead| bead.face) {
                    report.plain += 1;
                }
                if contact_share(&beads, underside, *gap, *layer, lift) < LEAST_CONTACT {
                    report.weak.push(check.place());
                }
                if *branched {
                    continue;
                }
                let reach = (2.0 * layer).max(0.5);
                let mut z = bottom + lift + bottom_gap + 1.0;
                while z < low - gap - 1.0 {
                    if !paths.iter().any(|bead| (bead.z - z).abs() <= reach) {
                        report.broken.push(check.place());
                        break;
                    }
                    z += 0.5;
                }
            }
        }
    }
    report
}

fn places(list: &[[f64; 3]]) -> String {
    let shown: Vec<String> = list.iter().take(4).map(|[x, y, z]| format!("X {x:.1} Y {y:.1} Z {z:.1}")).collect();
    format!("{}{}", shown.join(", "), if list.len() > 4 { " …" } else { "" })
}

impl Report {
    pub fn summary(&self) -> String {
        let good = self.total.saturating_sub(self.missing.len() + self.broken.len());
        let mut text = format!("{good} von {} Stützen erzeugt", self.total);
        if !self.weak.is_empty() {
            text += &format!(", {} mit schwachem Kontakt", self.weak.len());
        }
        if !self.floating.is_empty() {
            text += &format!(", {} schwebende Stellen", self.floating.len());
        }
        if self.plain > 0 {
            text += &format!(", {} davon ohne dichte Kontaktlage", self.plain);
        }
        text
    }

    /// Leer, wenn alles in Ordnung ist.
    pub fn warning(&self) -> String {
        let mut lines = Vec::new();
        if !self.missing.is_empty() {
            lines.push(format!(
                "{} von {} Stützen hat Prusa nicht erzeugt (zu klein, zu niedrig oder kein Überhang): {}",
                self.missing.len(),
                self.total,
                places(&self.missing)
            ));
        }
        if !self.broken.is_empty() {
            lines.push(format!("{} Stützen sind nicht durchgehend: {}", self.broken.len(), places(&self.broken)));
        }
        if !self.weak.is_empty() {
            lines.push(format!("{} von {} Stützen haben zu wenig Kontaktfläche: {}", self.weak.len(), self.total, places(&self.weak)));
            lines.push("Moegliche Ursache: Der XY-Abstand zur Wand laesst zu wenig Platz. Im Stuetzenwerkzeug unter Erzeugung > Aendern > Kontakt versetzen eine besser erreichbare Stelle waehlen und erneut slicen.".into());
        }
        if !self.floating.is_empty() {
            lines.push(format!("{} Stützbahnen hängen in der Luft: {}", self.floating.len(), places(&self.floating)));
        }
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(levels: &[(f32, bool)]) -> Preview {
        let mut p = Preview { roles: vec!["Support material".into(), "Support material interface".into()], ..Preview::default() };
        for &(z, face) in levels {
            p.from.extend([4.0, 5.0, z]);
            p.to.extend([6.0, 5.0, z]);
            p.height.push(0.2);
            p.width.push(0.45);
            p.role.push(u32::from(face));
        }
        p
    }

    fn pillar() -> Check {
        Check::Pillar {
            x: 5.0, y: 5.0, surface: 10.0, spacing: 4.0, low: 10.0, high: 10.0, bottom: 0.0,
            gap: 0.2, bottom_gap: 0.2, layer: 0.2, raft: false, branched: false, underside: Vec::new(),
        }
    }

    #[test]
    fn missing_broken_and_plain_are_told_apart() {
        let full: Vec<(f32, bool)> = (1..50).map(|i| (i as f32 * 0.2, false)).collect();
        let good = inspect(&column(&[full.clone(), vec![(9.8, true)]].concat()), &[pillar()]);
        assert_eq!((good.warning().as_str(), good.plain), ("", 0));
        assert_eq!(inspect(&column(&full), &[pillar()]).plain, 1);
        assert_eq!(inspect(&column(&[(9.8, false)]), &[pillar()]).broken.len(), 1);
        assert!(inspect(&column(&[]), &[pillar()]).warning().contains("nicht erzeugt"));
    }

    #[test]
    fn an_edge_point_without_contact_is_reported_although_the_head_was_printed() {
        let full: Vec<(f32, bool)> = (1..50).map(|i| (i as f32 * 0.2, i == 49)).collect();
        let tip = |underside: Vec<[f64; 3]>| Check::Tip {
            x: 5.0, y: 5.0, surface: 10.0, z: 9.8, r: 0.9, layer: 0.2, width: 0.45, gap: 0.2, bottom_gap: 0.2,
            samples: vec![[5.0, 5.0, 9.8]],
            underside,
        };
        assert_eq!(inspect(&column(&full), &[tip(vec![[5.0, 5.0, 10.0]])]).warning(), "");
        // Die Bahn liegt unter dem Kopf, die Unterseite am Punkt ist 1 mm hoeher.
        assert_eq!(inspect(&column(&full), &[tip(vec![[5.0, 5.0, 11.0]])]).weak.len(), 1);
    }

    #[test]
    fn weak_contact_warning_explains_how_to_reposition_the_support() {
        let report = Report { total: 1, weak: vec![[122.0, 102.0, 29.3]], ..Report::default() };
        let warning = report.warning();
        assert!(warning.contains("X 122.0 Y 102.0 Z 29.3"));
        assert!(warning.contains("XY-Abstand"));
        assert!(warning.contains("Kontakt versetzen"));
    }

    #[test]
    #[ignore = "requires actual engine G-code comparison fixtures"]
    fn real_gcode_detects_overlap_and_protected_paths() {
        let root=std::env::var("SIMPLIY_SUPPORT_GCODE_DIR").unwrap();
        let old=crate::gcode::load(&format!("{root}/auto-experiment.gcode"), |_|{}).unwrap();
        let protected=crate::gcode::load(&format!("{root}/auto-narrow-blocker.gcode"), |_|{}).unwrap();
        assert!(mixed_support_overlap(&old).unwrap().is_some(), "unprotected supports must overlap");
        assert!(mixed_support_overlap(&protected).unwrap().is_none(), "protected case should avoid overlap");
    }

    #[test]
    fn mixed_support_overlap_detects_crossings_but_not_nearby_or_different_layers() {
        let mut p=Preview { roles: vec!["Support material".into()], ..Preview::default() };
        let mut add=|a:[f32;3],b:[f32;3],own:u8|{p.from.extend(a);p.to.extend(b);p.role.push(0);p.width.push(0.4);p.height.push(0.2);p.support_origin.push(own);};
        add([0.0,0.0,1.0],[2.0,0.0,1.0],0);
        add([1.0,-1.0,1.0],[1.0,1.0,1.0],1);
        assert!(mixed_support_overlap(&p).unwrap().is_some());
        p.from[3..6].copy_from_slice(&[1.0,-1.0,1.5]);p.to[3..6].copy_from_slice(&[1.0,1.0,1.5]);
        assert!(mixed_support_overlap(&p).unwrap().is_none());
        p.from[3..6].copy_from_slice(&[0.0,0.5,1.0]);p.to[3..6].copy_from_slice(&[2.0,0.5,1.0]);
        assert!(mixed_support_overlap(&p).unwrap().is_none());
    }

    #[test]
    fn a_skipped_layer_is_reported_as_floating() {
        let gapped: Vec<(f32, bool)> = (1..50).filter(|i| !(20..23).contains(i)).map(|i| (i as f32 * 0.2, false)).collect();
        let report = inspect(&column(&gapped), &[pillar()]);
        assert_eq!(report.floating.len(), 1);
        assert!(report.warning().contains("in der Luft"));
    }

    #[test]
    fn one_bead_is_not_a_contact_area() {
        let tip = Check::Tip {
            x: 5.0, y: 5.0, surface: 10.0, z: 9.8, r: 0.9, layer: 0.2, width: 0.45, gap: 0.2, bottom_gap: 0.2, underside: Vec::new(),
            samples: (0..6).map(|i| [5.0, 3.0 + f64::from(i), 9.8]).collect(),
        };
        assert_eq!(inspect(&column(&[(9.8, true)]), &[tip]).weak.len(), 1);
    }
}
