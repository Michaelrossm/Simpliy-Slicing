//! Kontaktbahnen: Die oberste Schicht der Kontaktpolster wird durch einzelne Bahnen ersetzt (wie die oberste Stuetzlage
//! in gaengigen Slicern). Jede Bahn ist ein Block in Bahnbreite und Schichthoehe; die Engine druckt ihn als eine Linie.
//! Die Schichten darunter bleiben dichte Polster und tragen die Bahnen.
use super::context::Block;
use crate::util::{FastMap as HashMap, FastSet as HashSet};
use std::sync::{Arc, Mutex};

const CELL: f64 = 0.05;
thread_local! {
    /// Nur fuer Messungen: (einschichtig ohne Unterbau, oberste Zellen, bahnfaehige Zellen, dicht gebliebene Zellen).
    pub static STATS: std::cell::RefCell<(usize, usize, usize, usize)> = const { std::cell::RefCell::new((0, 0, 0, 0)) };
}
type Cell = (i64, i64);

#[derive(PartialEq, Eq, Hash)]
struct ContactGroup {
    cells: Vec<Cell>,
    points: Vec<[u64; 2]>,
    settings: [u64; 7],
}

type ContactGeometry = (Vec<Block>, Vec<Block>);
#[derive(Default)]
struct ContactGroups {
    geometry: HashMap<ContactGroup, Arc<ContactGeometry>>,
    bytes: usize,
}

static CONTACT_GROUPS: Mutex<Option<ContactGroups>> = Mutex::new(None);
const GROUP_CACHE_BYTES: usize = 32 * 1024 * 1024;

fn remember_contact(key: ContactGroup, geometry: Arc<ContactGeometry>) {
    let bytes = 256 + key.cells.capacity() * std::mem::size_of::<Cell>()
        + key.points.capacity() * std::mem::size_of::<[u64; 2]>()
        + (geometry.0.capacity() + geometry.1.capacity()) * std::mem::size_of::<Block>();
    if bytes > GROUP_CACHE_BYTES || super::plan::cancelled() { return; }
    let mut cache = CONTACT_GROUPS.lock().unwrap();
    let cache = cache.get_or_insert_with(ContactGroups::default);
    if cache.bytes + bytes > GROUP_CACHE_BYTES {
        *cache = ContactGroups::default();
    }
    if let std::collections::hash_map::Entry::Vacant(entry) = cache.geometry.entry(key) {
        entry.insert(geometry);
        cache.bytes += bytes;
    }
}
const fn key(z: f64) -> i64 {
    (z * 10000.0) as i64
}

/// Zerlegt Polsterbloecke in Zellsaeulen. Rueckgabe: Polster ohne oberste Schicht, oberste Schicht je Hoehe (z0, z1, Zellen).
/// `width`: Bahnbreite. Eine Bahn liegt nur dort, wo das Polster darunter rundum mindestens eine halbe Bahnbreite reicht;
/// schmalere Stellen druckt die Engine darunter nicht sicher, sie bleiben dichtes Polster.
/// `points`: Stuetzpunkte; im Umkreis `tip` um einen Punkt traegt die Saeulenspitze auch ein einschichtiges Polster.
/// Übereinanderliegende Blöcke mit gleicher Grundfläche zu einem Block zusammenfassen. Das Ergebnis von `split` bleibt gleich
/// (nur die oberste Schicht jeder Säule zählt), es werden aber viel weniger Rasterzellen angelegt.
fn merge_stacks(blocks: &[Block]) -> Vec<Block> {
    let key = |v: f64| (v * 1e5).round() as i64;
    let mut sorted: Vec<Block> = blocks.to_vec();
    sorted.sort_by(|a, b| (key(a[0]), key(a[1]), key(a[3]), key(a[4])).cmp(&(key(b[0]), key(b[1]), key(b[3]), key(b[4]))).then(a[2].total_cmp(&b[2])));
    let mut out: Vec<Block> = Vec::with_capacity(sorted.len());
    for b in sorted {
        if let Some(last) = out.last_mut() {
            let same = [0, 1, 3, 4].iter().all(|&i| key(last[i]) == key(b[i]));
            if same && b[2] <= last[5] + 1e-4 {
                last[5] = last[5].max(b[5]);
                continue;
            }
        }
        out.push(b);
    }
    out
}

/// Aufteilung je Block: Jeder Block prüft nur seine eigenen Zellen gegen die Säulen und gibt seinen Rest direkt als
/// wenige Quader aus (gleiche Regeln wie früher, aber ohne Zelle-für-Zelle-Liste über alle Schichten).
pub fn split(blocks: &[Block], layer: f64, width: f64, points: &[[f64; 2]], tip: f64) -> (Vec<Block>, Vec<(f64, f64, HashSet<Cell>)>) {
    let _ = (width, points, tip);
    let merged = merge_stacks(blocks);
    let blocks = &merged[..];
    let clock = std::time::Instant::now();
    let at = |v: f64| (v / CELL).round() as i64;
    // Rechtecke grob indexieren statt pro Rasterzelle zwei sortierte Hoehenlisten anzulegen.
    // Die eigentliche Nachbarschaftsentscheidung bleibt exakt auf dem bisherigen 0,05-mm-Raster.
    const BIN: i64 = 64;
    let bounds: Vec<_> = blocks.iter().map(|b| (at(b[0]), at(b[1]), at(b[3]), at(b[4]))).collect();
    let mut starts: HashMap<(i64, i64, i64), Vec<usize>> = HashMap::default();
    let mut ends: HashMap<(i64, i64, i64), Vec<usize>> = HashMap::default();
    let zbin = |z: f64| (z / 0.001).floor() as i64;
    for (idx, &(x0, y0, x1, y1)) in bounds.iter().enumerate() {
        if super::plan::cancelled() { return (Vec::new(), Vec::new()); }
        if x0 >= x1 || y0 >= y1 { continue; }
        for i in x0.div_euclid(BIN)..=(x1 - 1).div_euclid(BIN) {
            for j in y0.div_euclid(BIN)..=(y1 - 1).div_euclid(BIN) {
                starts.entry((i, j, zbin(blocks[idx][2]))).or_default().push(idx);
                ends.entry((i, j, zbin(blocks[idx][5]))).or_default().push(idx);
            }
        }
    }
    super::plan::profile(&format!("   split: {} Bloecke, {} Rechteckkacheln, Aufbau {} ms", blocks.len(), starts.len(), clock.elapsed().as_millis()));
    // Rest eines Blocks als Zeilenläufe, untereinander gleiche Läufe zu Quadern verbunden
    let boxes_of = |cells: &[(i64, i64)], z0: f64, z1: f64, out: &mut Vec<Block>| {
        let mut runs: Vec<(i64, i64, i64)> = Vec::new(); // (von, bis, Zeile)
        let mut k = 0;
        while k < cells.len() {
            let (j, start) = cells[k];
            let mut end = start;
            while k + 1 < cells.len() && cells[k + 1].0 == j && cells[k + 1].1 == end + 1 {
                end += 1;
                k += 1;
            }
            runs.push((start, end + 1, j));
            k += 1;
        }
        runs.sort_unstable();
        let mut k = 0;
        while k < runs.len() {
            let (from, to, first) = runs[k];
            let mut last = first;
            while k + 1 < runs.len() && runs[k + 1].0 == from && runs[k + 1].1 == to && runs[k + 1].2 == last + 1 {
                last += 1;
                k += 1;
            }
            out.push([from as f64 * CELL, first as f64 * CELL, z0, to as f64 * CELL, (last + 1) as f64 * CELL, z1]);
            k += 1;
        }
    };
    type Part = (Vec<Block>, Vec<(i64, f64, f64, Cell)>, usize);
    let work = |_: usize, b: &Block| -> Part {
        if super::plan::cancelled() { return (Vec::new(), Vec::new(), 0); }
        let (z0, z1) = (b[2], b[5]);
        let cut = (z1 - layer).max(z0);
        let thick = cut > z0 + 1e-4;
        let mut rest = Vec::new();
        let mut top = Vec::new();
        let mut alone = 0usize;
        let (bx0, by0, bx1, by1) = (at(b[0]), at(b[1]), at(b[3]), at(b[4]));
        let relevant = |table: &HashMap<(i64, i64, i64), Vec<usize>>, z: f64, field: usize| -> Vec<(i64, i64, i64, i64)> {
            let mut ids = HashSet::default();
            if bx0 >= bx1 || by0 >= by1 { return Vec::new(); }
            for x in bx0.div_euclid(BIN)..=(bx1 - 1).div_euclid(BIN) {
                for y in by0.div_euclid(BIN)..=(by1 - 1).div_euclid(BIN) {
                    for bucket in zbin(z)-1..=zbin(z)+1 {
                        if let Some(found) = table.get(&(x, y, bucket)) {
                            for &idx in found {
                                let (x0, y0, x1, y1) = bounds[idx];
                                if blocks[idx][field] >= z - 1e-4 && blocks[idx][field] <= z + 1e-4
                                    && x0 < bx1 && x1 > bx0 && y0 < by1 && y1 > by0 { ids.insert(idx); }
                            }
                        }
                    }
                }
            }
            ids.into_iter().map(|idx| bounds[idx]).collect()
        };
        let above = relevant(&starts, z1, 2);
        let below = if thick { Vec::new() } else { relevant(&ends, z0, 5) };
        // Zellen, deren oberste Schicht Rest bleibt (fortgesetzt oder ohne Unterbau); Reihenfolge Zeile, Spalte
        let mut kept: Vec<(i64, i64)> = Vec::new();
        for j in at(b[1])..at(b[4]) {
            if super::plan::cancelled() { return (Vec::new(), Vec::new(), 0); }
            for i in at(b[0])..at(b[3]) {
                let contains = |&(x0, y0, x1, y1): &(i64, i64, i64, i64)| i >= x0 && i < x1 && j >= y0 && j < y1;
                if above.iter().any(contains) {
                    kept.push((j, i));
                    continue;
                }
                // Eine Bahn braucht Polster darunter. Einschichtige Stellen ohne Unterbau bleiben dicht wie bisher.
                let carried = thick || below.iter().any(contains);
                if !carried {
                    alone += 1;
                    kept.push((j, i));
                    continue;
                }
                top.push((key(z1), cut, z1, (i, j)));
            }
        }
        if thick {
            // Unterer Teil bleibt überall Polster, als ein Quader
            rest.push([b[0], b[1], z0, b[3], b[4], cut]);
            boxes_of(&kept, cut, z1, &mut rest);
        } else {
            boxes_of(&kept, z0, z1, &mut rest);
        }
        (rest, top, alone)
    };
    let parts = super::shapes::par_map(blocks, work);
    let mut rest = Vec::new();
    let mut tops: HashMap<i64, (f64, f64, HashSet<Cell>)> = HashMap::default();
    for (mut part_rest, part_top, alone) in parts {
        if alone > 0 && std::env::var("SIMPLIY_CONTACT_STATS").is_ok() {
            STATS.with(|s| s.borrow_mut().0 += alone);
        }
        rest.append(&mut part_rest);
        for (k, cut, z1, cell) in part_top {
            tops.entry(k).or_insert_with(|| (cut, z1, HashSet::default())).2.insert(cell);
        }
    }
    super::plan::profile(&format!("   split Ende {} ms, {} Restquader", clock.elapsed().as_millis(), rest.len()));
    (rest, tops.into_values().collect())
}

#[cfg(test)]
fn split_reference(blocks: &[Block], layer: f64, width: f64, points: &[[f64; 2]], tip: f64) -> (Vec<Block>, Vec<(f64, f64, HashSet<Cell>)>) {
    let merged = merge_stacks(blocks);
    let blocks = &merged[..];
    let clock = std::time::Instant::now();
    let at = |v: f64| (v / CELL).round() as i64;
    let mut columns: HashMap<Cell, Vec<(f64, f64)>> = HashMap::default();
    for b in blocks {
        for i in at(b[0])..at(b[3]) {
            for j in at(b[1])..at(b[4]) {
                columns.entry((i, j)).or_default().push((b[2], b[5]));
            }
        }
    }
    let _ = (&format!("   split: {} Bloecke, {} Spalten, Aufbau {} ms", blocks.len(), columns.len(), clock.elapsed().as_millis()));
    type Rest = Vec<(i64, i64, i64, i64)>; // (z0, z1, Zeile, Spalte), danach sortiert statt gehasht
    type Tops = HashMap<i64, (f64, f64, HashSet<Cell>)>;
    let sort_out = |part: &mut [(Cell, Vec<(f64, f64)>)]| -> (Rest, Tops, usize) {
        let mut rest: Rest = Vec::new();
        let mut tops: Tops = HashMap::default();
        let mut alone = 0usize;
        for ((i, j), list) in part.iter_mut().map(|(c, l)| (*c, l)) {
            list.sort_by(|a, b| a.0.total_cmp(&b.0));
            // Anfaenge sind sortiert, Enden extra: Suche ueber Binaersuche statt ueber die ganze Liste.
            let mut ends: Vec<f64> = list.iter().map(|b| b.1).collect();
            ends.sort_by(|a, b| a.total_cmp(b));
            let has_start = |z: f64| {
                let at = list.partition_point(|b| b.0 < z - 1e-4);
                at < list.len() && list[at].0 <= z + 1e-4
            };
            let has_end = |z: f64| {
                let at = ends.partition_point(|&e| e < z - 1e-4);
                at < ends.len() && ends[at] <= z + 1e-4
            };
            for &(z0, z1) in list.iter() {
                if has_start(z1) {
                    rest.push((key(z0), key(z1), j, i));
                    continue;
                }
                let cut = (z1 - layer).max(z0);
                // Eine Bahn braucht Polster darunter. Einschichtige Stellen ohne Unterbau bleiben dicht wie bisher.
                // (Die Saeulenspitze zaehlt nicht als Unterbau, sie steht nicht immer unter dem Punkt.)
                let carried = cut > z0 + 1e-4 || has_end(z0);
                if !carried {
                    alone += 1;
                    rest.push((key(z0), key(z1), j, i));
                    continue;
                }
                if cut > z0 + 1e-4 {
                    rest.push((key(z0), key(cut), j, i));
                }
                tops.entry(key(z1)).or_insert_with(|| (cut, z1, HashSet::default())).2.insert((i, j));
            }
        }
        (rest, tops, alone)
    };
    let mut columns: Vec<(Cell, Vec<(f64, f64)>)> = columns.into_iter().collect();
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).min(columns.len() / 2000 + 1);
    let size = columns.len().div_ceil(workers).max(1);
    let parts: Vec<(Rest, Tops, usize)> = std::thread::scope(|scope| {
        let jobs: Vec<_> = columns.chunks_mut(size).map(|part| scope.spawn(|| sort_out(part))).collect();
        jobs.into_iter().map(|job| job.join().expect("Kontaktbahnen")).collect()
    });
    let mut rest: Rest = Vec::new();
    let mut tops: Tops = HashMap::default();
    for (mut part_rest, part_tops, alone) in parts {
        if alone > 0 && std::env::var("SIMPLIY_CONTACT_STATS").is_ok() {
            STATS.with(|s| s.borrow_mut().0 += alone);
        }
        rest.append(&mut part_rest);
        for (k, (cut, z1, cells)) in part_tops {
            tops.entry(k).or_insert_with(|| (cut, z1, HashSet::default())).2.extend(cells);
        }
    }
    let _ = (&format!("   split Ende {} ms", clock.elapsed().as_millis()));
    let _ = (width, points, tip);
    // Zeilen gleicher Laenge und Hoehe untereinander zu einem Block verbinden (viel weniger Dreiecke).
    // Sortieren und einmal durchlaufen statt verschachtelter Hash-Tabellen: gleiches Ergebnis, viel schneller.
    rest.sort_unstable();
    let mut runs: Vec<(i64, i64, i64, i64, i64)> = Vec::new(); // (z0, z1, von, bis, Zeile)
    let mut k = 0;
    while k < rest.len() {
        let (z0, z1, j, start) = rest[k];
        let mut end = start;
        while k + 1 < rest.len() && rest[k + 1].0 == z0 && rest[k + 1].1 == z1 && rest[k + 1].2 == j && rest[k + 1].3 <= end + 1 {
            end = end.max(rest[k + 1].3);
            k += 1;
        }
        runs.push((z0, z1, start, end + 1, j));
        k += 1;
    }
    drop(rest);
    runs.sort_unstable();
    let mut out = Vec::new();
    let mut k = 0;
    while k < runs.len() {
        let (z0, z1, from, to, first) = runs[k];
        let mut last = first;
        while k + 1 < runs.len() && runs[k + 1].0 == z0 && runs[k + 1].1 == z1 && runs[k + 1].2 == from && runs[k + 1].3 == to && runs[k + 1].4 <= last + 1 {
            last = last.max(runs[k + 1].4);
            k += 1;
        }
        out.push([from as f64 * CELL, first as f64 * CELL, z0 as f64 / 10000.0, to as f64 * CELL, (last + 1) as f64 * CELL, z1 as f64 / 10000.0]);
        k += 1;
    }
    (out, tops.into_values().collect())
}

/// Untere Kontaktlage der Fuesse: wie `split` + `lines`, nur gespiegelt (unterste Schicht statt oberste).
/// Rueckgabe: dichter Rest, Bahnen der untersten Schicht, dicht gebliebene Stellen der untersten Schicht.
/// Einschichtige Fuesse und zu kleine Stellen bleiben dicht: Die Schicht darueber muss die Bahnen tragen.
pub fn bottom(blocks: &[Block], layer: f64, width: f64, pitch: f64, style: Style) -> (Vec<Block>, Vec<Block>, Vec<Block>) {
    let flip = |b: &Block| [b[0], b[1], -b[5], b[3], b[4], -b[2]];
    let mirrored: Vec<Block> = blocks.iter().map(flip).collect();
    let (rest, tops) = split(&mirrored, layer, width, &[], 0.0);
    let (made, kept) = lines(&tops, width, pitch, &[], style);
    (rest.iter().map(flip).collect(), made.iter().map(flip).collect(), kept.iter().map(flip).collect())
}

/// Bahnen ueber den obersten Zellen. `pitch`: Abstand der Bahnmitten, `width`: Bahnbreite.
/// `points`: Stuetzpunkte (x, y). Durch jeden Punkt einer Kontaktstelle laeuft eine Bahn: Dort muss getragen werden.
/// Kontaktschicht wie Prusa: `angle` = support_material_angle (Kontaktbahnen quer dazu), `grid` = Muster "grid",
/// `loops` = support_material_interface_contact_loops.
#[derive(Clone, Copy, Default)]
pub struct Style {
    pub angle: f64,
    pub grid: bool,
    pub loops: bool,
}

// Grobe XY-Kacheln beschleunigen die Kandidatensuche; die exakte Zellpruefung bleibt in rows_of.
struct PointIndex<'a> {
    points: &'a [[f64; 2]],
    bins: HashMap<Cell, Vec<usize>>,
}
impl<'a> PointIndex<'a> {
    const BIN: i64 = 64;
    fn new(points: &'a [[f64; 2]]) -> Self {
        let mut bins: HashMap<Cell, Vec<usize>> = HashMap::default();
        for (index, point) in points.iter().enumerate() {
            let x = (point[0] / CELL).floor() as i64;
            let y = (point[1] / CELL).floor() as i64;
            bins.entry((x.div_euclid(Self::BIN), y.div_euclid(Self::BIN))).or_default().push(index);
        }
        Self { points, bins }
    }
    fn candidates(&self, (min_i, max_i, min_j, max_j): (i64, i64, i64, i64)) -> Vec<[f64; 2]> {
        let (x0, x1) = ((min_i - 4).div_euclid(Self::BIN), (max_i + 4).div_euclid(Self::BIN));
        let (y0, y1) = ((min_j - 4).div_euclid(Self::BIN), (max_j + 4).div_euclid(Self::BIN));
        // Bei sehr grossen Bereichen ist ein linearer Scan guenstiger als leere Kacheln abzulaufen.
        let count = (x1 - x0 + 1).saturating_mul(y1 - y0 + 1);
        if count as usize > self.bins.len().saturating_mul(4).max(64) {
            return self.points.to_vec();
        }
        let mut indices = Vec::new();
        for x in x0..=x1 {
            for y in y0..=y1 {
                if let Some(found) = self.bins.get(&(x, y)) { indices.extend_from_slice(found); }
            }
        }
        // Die urspruengliche Reihenfolge bestimmt bei Gleichstand die Wahl der Rasterlage.
        indices.sort_unstable();
        indices.into_iter().map(|i| self.points[i]).collect()
    }
}

/// Rueckgabe: Bahnen und Stellen, die keine gueltige Bahn bekommen und deshalb dicht bleiben.
pub fn lines(tops: &[(f64, f64, HashSet<Cell>)], width: f64, pitch: f64, points: &[[f64; 2]], style: Style) -> (Vec<Block>, Vec<Block>) {
    lines_impl(tops, width, pitch, points, style, true)
}

fn lines_impl(tops: &[(f64, f64, HashSet<Cell>)], width: f64, pitch: f64, points: &[[f64; 2]], style: Style, indexed: bool) -> (Vec<Block>, Vec<Block>) {
    let mut out = Vec::new();
    let mut kept = Vec::new();
    let point_index = PointIndex::new(points);
    let collect_stats = std::env::var_os("SIMPLIY_CONTACT_STATS").is_some();
    let mut reused = 0;
    let mut computed = 0;
    for (z0, z1, cells) in tops {
        if super::plan::cancelled() { return (Vec::new(), Vec::new()); }
        let mut left = cells.clone();
        while let Some(&start) = left.iter().next() {
            if super::plan::cancelled() { return (Vec::new(), Vec::new()); }
            left.remove(&start);
            let mut part = vec![start];
            let mut k = 0;
            while k < part.len() {
                if k % 4096 == 0 && super::plan::cancelled() { return (Vec::new(), Vec::new()); }
                let (i, j) = part[k];
                for (di, dj) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    if left.remove(&(i + di, j + dj)) {
                        part.push((i + di, j + dj));
                    }
                }
                k += 1;
            }
            let (min_i, max_i) = (part.iter().map(|c| c.0).min().unwrap(), part.iter().map(|c| c.0).max().unwrap());
            let (min_j, max_j) = (part.iter().map(|c| c.1).min().unwrap(), part.iter().map(|c| c.1).max().unwrap());
            let local_points = if indexed { point_index.candidates((min_i, max_i, min_j, max_j)) } else { points.to_vec() };
            // The flood fill identifies exact 4-connected islands. Keep its order because
            // equal-cost decisions and the dense fallback must retain their original order.
            let cache_key = (indexed && !collect_stats && (16..=8192).contains(&part.len())).then(|| ContactGroup {
                cells: part.clone(),
                points: local_points.iter().map(|point| point.map(f64::to_bits)).collect(),
                settings: [z0.to_bits(), z1.to_bits(), width.to_bits(), pitch.to_bits(), style.angle.to_bits(),
                    u64::from(style.grid), u64::from(style.loops)],
            });
            let cached = cache_key.as_ref().and_then(|key| {
                CONTACT_GROUPS.lock().unwrap().as_ref()?.geometry.get(key).cloned()
            });
            if let Some(geometry) = cached {
                out.extend_from_slice(&geometry.0);
                kept.extend_from_slice(&geometry.1);
                reused += 1;
                continue;
            }
            computed += 1;
            let (out_start, kept_start) = (out.len(), kept.len());
            let all: HashSet<Cell> = part.iter().copied().collect();
            // Bahnen nur ueber Zellen, die rundum eine halbe Bahnbreite getragen sind: Schmaleres Polster
            // darunter druckt die Engine nicht sicher. Der Rest der obersten Schicht bleibt frei wie zwischen Stuetzlinien.
            let reach = ((width / 2.0) / CELL).round() as i64;
            let set: HashSet<Cell> = part
                .iter()
                .copied()
                .filter(|&(i, j)| (-reach..=reach).all(|a| (-reach..=reach).all(|b| a * a + b * b > reach * reach || all.contains(&(i + a, j + b)))))
                .collect();
            // Schmale Stellen: Bahnen entlang der laengeren Seite, sonst bekaemen sie keine durchgehende Bahn.
            // Breite Stellen: wie Prusa quer zum Stuetzwinkel (auf die naechste Achse gerundet).
            let short = ((max_i - min_i).min(max_j - min_j) + 1) as f64 * CELL;
            let along_x = if short < 3.0 * pitch {
                (max_i - min_i) >= (max_j - min_j)
            } else {
                let dir = (style.angle + 90.0).rem_euclid(180.0);
                !(45.0..135.0).contains(&dir)
            };
            let mut made = 0;
            for (k, along_x) in [along_x, !along_x].into_iter().enumerate() {
                if k == 1 && !(style.grid && short >= 3.0 * pitch) {
                    break;
                }
                made += rows_of(&set, along_x, (min_i, max_i, min_j, max_j), width, pitch, &local_points, (*z0, *z1), &mut out);
            }
            let (lo, hi, from, to) = if along_x { (min_j, max_j, min_i, max_i) } else { (min_i, max_i, min_j, max_j) };
            if made > 0 {
                // Keine Stelle darf weiter als 1,5 Bahnabstaende von einer Bahn liegen; sonst bleibt sie dicht wie bisher.
                let mine = &out[out.len() - made..];
                let limit = 1.5 * pitch;
                let mut far: Vec<Cell> = part
                    .iter()
                    .copied()
                    .filter(|&(i, j)| {
                        let (x, y) = ((i as f64 + 0.5) * CELL, (j as f64 + 0.5) * CELL);
                        mine.iter().all(|b| (b[0] - x).max(x - b[3]).max(0.0).hypot((b[1] - y).max(y - b[4]).max(0.0)) > limit)
                    })
                    .collect();
                far.sort_unstable_by_key(|&(i, j)| (j, i));
                push_runs(&far, (*z0, *z1), &mut kept);
            }
            if style.loops && made > 0 {
                // Schleife um die Kontaktstelle: Randzellen in Bahnbreite (die Engine druckt sie als eine Wand).
                let ring = (width / CELL).round() as i64;
                let mut edge: Vec<Cell> = all
                    .iter()
                    .copied()
                    .filter(|&(i, j)| (-ring..=ring).any(|a| (-ring..=ring).any(|b| a * a + b * b <= ring * ring && !all.contains(&(i + a, j + b)))))
                    .collect();
                edge.sort_unstable_by_key(|&(i, j)| (j, i));
                push_runs(&edge, (*z0, *z1), &mut out);
            }
            if made == 0 {
                // Schmaler als ein Bahnabstand: eine Bahn mittig.
                made = runs(&set, along_x, (lo + hi + 1) as f64 * CELL / 2.0, (from, to), width, (*z0, *z1), &mut out);
            }
            if collect_stats {
                STATS.with(|s| {
                    let mut s = s.borrow_mut();
                    s.1 += part.len();
                    s.2 += set.len();
                    if made == 0 {
                        s.3 += part.len();
                    }
                });
            }
            if made == 0 {
                // Keine durchgehende Bahn moeglich (z. B. Treppenring unter runder Decke): bleibt dichter Kontakt.
                let mut rows: HashMap<i64, Vec<i64>> = HashMap::default();
                for &(i, j) in &part {
                    rows.entry(j).or_default().push(i);
                }
                for (j, mut list) in rows {
                    list.sort_unstable();
                    let mut k = 0;
                    while k < list.len() {
                        let start = list[k];
                        while k + 1 < list.len() && list[k + 1] == list[k] + 1 {
                            k += 1;
                        }
                        kept.push([start as f64 * CELL, j as f64 * CELL, *z0, (list[k] + 1) as f64 * CELL, (j + 1) as f64 * CELL, *z1]);
                        k += 1;
                    }
                }
            }
            if let Some(key) = cache_key {
                remember_contact(key, Arc::new((out[out_start..].to_vec(), kept[kept_start..].to_vec())));
            }
        }
    }
    super::plan::profile(&format!("Kontaktgruppen: {} untersucht, {computed} berechnet, {reused} übernommen", computed + reused));
    (out, kept)
}

/// Bahnen einer Richtung: Raster nach den Stuetzpunkten, Zusatzbahnen fuer nicht getroffene Punkte, Randreihen.
#[allow(clippy::too_many_arguments)]
fn rows_of(set: &HashSet<Cell>, along_x: bool, (min_i, max_i, min_j, max_j): (i64, i64, i64, i64), width: f64, pitch: f64, points: &[[f64; 2]], (z0, z1): (f64, f64), out: &mut Vec<Block>) -> usize {
    let reach = ((width / 2.0) / CELL).round() as i64;
            let (lo, hi, from, to) = if along_x { (min_j, max_j, min_i, max_i) } else { (min_i, max_i, min_j, max_j) };
            let span = (hi - lo + 1) as f64 * CELL;
            let rows = (span / pitch).floor() as i64;
            // Stuetzpunkte dieser Kontaktstelle (Zelle des Punktes oder direkte Nachbarn liegen in der Stelle).
            let near: Vec<f64> = points
                .iter()
                .filter(|p| {
                    let (i, j) = ((p[0] / CELL).floor() as i64, (p[1] / CELL).floor() as i64);
                    (-4..=4).any(|a| (-4..=4).any(|b| set.contains(&(i + a, j + b))))
                })
                .map(|p| if along_x { p[1] } else { p[0] })
                .collect();
            // Ein Punkt gilt als getroffen, wenn die Bahn klar innerhalb des Pruefradius liegt.
            let hit = width / 2.0 + 0.4;
            let rows_from = |first: f64| -> Vec<f64> {
                (-1..=rows + 1).map(|r| first + r as f64 * pitch).filter(|&a| a >= lo as f64 * CELL - 1e-9 && a <= (hi + 1) as f64 * CELL).collect()
            };
            // Rasterlage, die die meisten Stuetzpunkte schon trifft; ohne Punkte mittig.
            let first = near
                .iter()
                .map(|&at| at - ((at - lo as f64 * CELL) / pitch).floor() * pitch)
                .max_by_key(|&first| {
                    let rows = rows_from(first);
                    near.iter().filter(|&&p| rows.iter().any(|&a| (a - p).abs() <= hit)).count()
                })
                .unwrap_or(lo as f64 * CELL + (span - rows as f64 * pitch) / 2.0);
            let mut across = rows_from(first);
            // Nur Punkte, die keine Bahn trifft, bekommen eine eigene.
            for &at in &near {
                if across.iter().all(|&a| (a - at).abs() > hit) {
                    across.push(at);
                }
            }
            // Raender nicht weiter als einen Dreiviertel-Bahnabstand von der naechsten Bahn (Raster nach den Punkten
            // ausgerichtet kann sonst einen breiten Randstreifen ohne Bahn lassen).
            let (edge_lo, edge_hi) = (lo as f64 * CELL + width / 2.0 + reach as f64 * CELL, (hi + 1) as f64 * CELL - width / 2.0 - reach as f64 * CELL);
            if edge_lo <= edge_hi {
                let nearest = |at: f64, list: &[f64]| list.iter().map(|&a| (a - at).abs()).fold(f64::INFINITY, f64::min);
                for edge in [edge_lo, edge_hi] {
                    if nearest(edge, &across) > 0.75 * pitch {
                        across.push(edge);
                    }
                }
            }
    let mut made = 0;
            for a in across {
                made += runs(&set, along_x, a, (from, to), width, (z0, z1), out);
            }
    made
}

/// Zellen als Bloecke (zusammenhaengende Stuecke je Zeile).
fn push_runs(cells: &[Cell], (z0, z1): (f64, f64), out: &mut Vec<Block>) {
    let mut k = 0;
    while k < cells.len() {
        let (start, j) = cells[k];
        while k + 1 < cells.len() && cells[k + 1].1 == j && cells[k + 1].0 == cells[k].0 + 1 {
            k += 1;
        }
        out.push([start as f64 * CELL, j as f64 * CELL, z0, (cells[k].0 + 1) as f64 * CELL, (j + 1) as f64 * CELL, z1]);
        k += 1;
    }
}

/// Durchgehende Stuecke einer Bahn innerhalb der Kontaktstelle (mindestens 0,8 mm lang).
fn runs(set: &HashSet<Cell>, along_x: bool, across: f64, (from, to): (i64, i64), width: f64, (z0, z1): (f64, f64), out: &mut Vec<Block>) -> usize {
    let row = (across / CELL).floor() as i64;
    let inside = |k: i64| if along_x { set.contains(&(k, row)) } else { set.contains(&(row, k)) };
    let mut made = 0;
    let mut k = from;
    while k <= to {
        if !inside(k) {
            k += 1;
            continue;
        }
        let start = k;
        while k <= to && inside(k) {
            k += 1;
        }
        let (a, b) = (start as f64 * CELL, k as f64 * CELL);
        if b - a >= 0.8 {
            let half = width / 2.0;
            out.push(if along_x { [a, across - half, z0, b, across + half, z1] } else { [across - half, a, z0, across + half, b, z1] });
            made += 1;
        }
    }
    made
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexed_points_match_linear_selection_including_negative_coordinates_and_order() {
        let points: Vec<[f64; 2]> = (-75..=75).flat_map(|x| (-25..=25).map(move |y| [x as f64 * 0.13, y as f64 * 0.17])).collect();
        let index = PointIndex::new(&points);
        for (x, y) in [(-120, -30), (-64, 64), (0, 0), (62, -65), (115, 10)] {
            let bounds = (x, x + 21, y, y + 23);
            let set: HashSet<Cell> = (bounds.0..=bounds.1).flat_map(|i| (bounds.2..=bounds.3).map(move |j| (i, j))).collect();
            let select = |list: &[[f64; 2]]| -> Vec<[f64; 2]> { list.iter().copied().filter(|p| {
                let (i, j) = ((p[0] / CELL).floor() as i64, (p[1] / CELL).floor() as i64);
                (-4..=4).any(|a| (-4..=4).any(|b| set.contains(&(i + a, j + b))) )
            }).collect() };
            assert_eq!(select(&index.candidates(bounds)), select(&points));
        }
    }

    #[test]
    fn indexed_contact_lines_match_full_scan() {
        let mut cells = HashSet::default();
        for x in -80..80 { for y in -45..45 {
            if (x * x + y * y < 70 * 70) && !(x > 15 && y > 10) { cells.insert((x, y)); }
        }}
        let tops = vec![(1.0, 1.2, cells)];
        let points: Vec<[f64; 2]> = (-100..100).map(|i| [i as f64 * 0.15, (i % 13) as f64 * 0.25]).collect();
        let normalize = |(mut a, mut b): (Vec<Block>, Vec<Block>)| {
            let sort = |items: &mut Vec<Block>| items.sort_by(|a, b| a.iter().zip(b).map(|(x, y)| x.total_cmp(y)).find(|v| !v.is_eq()).unwrap_or(std::cmp::Ordering::Equal));
            sort(&mut a); sort(&mut b); (a, b)
        };
        for style in [Style::default(), Style { angle: 45.0, grid: true, loops: true }] {
            assert_eq!(normalize(lines_impl(&tops, 0.45, 1.1, &points, style, true)), normalize(lines_impl(&tops, 0.45, 1.1, &points, style, false)));
        }
    }

    #[test]
    fn rectangle_index_preserves_exact_top_cells_across_tile_boundaries() {
        let mut blocks = Vec::new();
        for i in 0..100 {
            let x = ((i * 37 % 170) as f64 - 85.0) * CELL;
            let y = ((i * 53 % 170) as f64 - 85.0) * CELL;
            let z = (i % 7) as f64 * 0.2;
            blocks.push([x, y, z, x + (4 + i % 18) as f64 * CELL, y + (4 + i % 21) as f64 * CELL, z + 0.2]);
        }
        let (a_rest, a_tops) = split(&blocks, 0.2, 0.45, &[], 0.9);
        let (b_rest, b_tops) = split_reference(&blocks, 0.2, 0.45, &[], 0.9);
        let tops = |list: Vec<(f64, f64, HashSet<Cell>)>| {
            let mut result = std::collections::BTreeMap::<i64, std::collections::BTreeSet<Cell>>::new();
            for (_, z, cells) in list { result.entry(key(z)).or_default().extend(cells); }
            result
        };
        assert_eq!(tops(a_tops), tops(b_tops));
        let occupancy = |list: Vec<Block>| {
            let mut result = std::collections::BTreeMap::<Cell, Vec<(i64, i64)>>::new();
            for b in list { for x in (b[0] / CELL).round() as i64..(b[3] / CELL).round() as i64 { for y in (b[1] / CELL).round() as i64..(b[4] / CELL).round() as i64 {
                result.entry((x, y)).or_default().push((key(b[2]), key(b[5])));
            }}}
            for spans in result.values_mut() {
                spans.sort_unstable();
                let mut merged: Vec<(i64, i64)> = Vec::new();
                for &(lo, hi) in spans.iter() { if let Some(last) = merged.last_mut() { if lo <= last.1 { last.1 = last.1.max(hi); continue; } } merged.push((lo, hi)); }
                *spans = merged;
            }
            result
        };
        assert_eq!(occupancy(a_rest), occupancy(b_rest));
    }

    #[test]
    fn block_wise_split_matches_the_cell_wise_reference() {
        // Kontaktpolster wie im Planer: Pyramiden aus Einzelschichten, teils nebeneinander, teils ohne Unterbau
        let mut blocks = Vec::new();
        for (cx, cy, layers) in [(5.0, 5.0, 6), (12.0, 6.0, 4), (20.0, 20.0, 1), (5.4, 9.0, 3)] {
            for k in 0..layers {
                let r = 3.0 - 0.35 * k as f64;
                let z = 2.0 + 0.1 * k as f64;
                blocks.push([cx - r, cy - r, z, cx + r, cy + r, z + 0.1]);
            }
        }
        blocks.push([0.0, 0.0, 1.0, 30.0, 2.0, 1.5]); // dicker Block
        let (rest_a, tops_a) = split(&blocks, 0.1, 0.6, &[], 0.9);
        let (rest_b, tops_b) = split_reference(&blocks, 0.1, 0.6, &[], 0.9);
        // Belegte Zellen je Schicht vergleichen (Quader können sich anders aufteilen, die Belegung muss gleich sein)
        let occupancy = |list: &[Block]| {
            let mut cells = std::collections::BTreeMap::new();
            for b in list {
                for i in ((b[0] / CELL).round() as i64)..((b[3] / CELL).round() as i64) {
                    for j in ((b[1] / CELL).round() as i64)..((b[4] / CELL).round() as i64) {
                        cells.entry((i, j)).or_insert_with(Vec::new).push(((b[2] * 1e4f64).round() as i64, (b[5] * 1e4f64).round() as i64));
                    }
                }
            }
            // Vereinigung der Höhenintervalle je Zelle (Überlappungen zählen einmal)
            cells.into_iter().map(|(c, mut list)| {
                list.sort();
                let mut merged: Vec<(i64, i64)> = Vec::new();
                for (a, b) in list { match merged.last_mut() { Some(last) if a <= last.1 => last.1 = last.1.max(b), _ => merged.push((a, b)) } }
                (c, merged)
            }).collect::<Vec<_>>()
        };
        assert_eq!(occupancy(&rest_a), occupancy(&rest_b), "Restpolster unterscheiden sich");
        let norm = |t: Vec<(f64, f64, HashSet<Cell>)>| { let mut v: Vec<(i64, Vec<Cell>)> = t.into_iter().map(|(a, b, c)| { let mut c: Vec<Cell> = c.into_iter().collect(); c.sort(); (((a + b) * 1e4) as i64, c) }).collect(); v.sort(); v };
        assert_eq!(norm(tops_a), norm(tops_b), "oberste Zellen unterscheiden sich");
    }

    #[test]
    fn stacked_layers_give_the_same_result_as_one_block() {
        let stacked = [[0.0, 0.0, 1.0, 10.0, 10.0, 1.1], [0.0, 0.0, 1.1, 10.0, 10.0, 1.2], [0.0, 0.0, 1.2, 10.0, 10.0, 1.3], [12.0, 0.0, 1.0, 14.0, 3.0, 1.1]];
        let single = [[0.0, 0.0, 1.0, 10.0, 10.0, 1.3], [12.0, 0.0, 1.0, 14.0, 3.0, 1.1]];
        let (rest_a, tops_a) = split(&stacked, 0.1, 0.6, &[], 0.9);
        let (rest_b, tops_b) = split(&single, 0.1, 0.6, &[], 0.9);
        let volume = |l: &[Block]| l.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])).sum::<f64>();
        assert!((volume(&rest_a) - volume(&rest_b)).abs() < 1e-6);
        let norm = |t: Vec<(f64, f64, HashSet<Cell>)>| { let mut v: Vec<(i64, usize)> = t.iter().map(|(a, b, c)| (((a + b) * 1e4) as i64, c.len())).collect(); v.sort(); v };
        assert_eq!(norm(tops_a), norm(tops_b));
    }

    #[test]
    fn a_square_pad_keeps_its_body_and_gets_lines_on_top() {
        // Polster 10 x 10 mm, drei Schichten (0,1 mm), als ein Block.
        let (rest, tops) = split(&[[0.0, 0.0, 1.0, 10.0, 10.0, 1.3]], 0.1, 0.6, &[], 0.9);
        let below: f64 = rest.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])).sum();
        assert!((below - 20.0).abs() < 0.01, "zwei Schichten bleiben Polster: {below}");
        assert!(rest.iter().all(|b| b[5] <= 1.2 + 1e-6));
        // Stuetzwinkel 0 Grad: Kontaktbahnen wie bei Prusa quer dazu, also entlang Y.
        let made = lines(&tops, 0.6, 2.0, &[], Style::default()).0;
        assert!((4..=5).contains(&made.len()), "{made:?}");
        assert!(made.iter().all(|b| (b[2] - 1.2).abs() < 1e-6 && (b[5] - 1.3).abs() < 1e-6 && (b[3] - b[0] - 0.6).abs() < 1e-6), "{made:?}");
        let mut centres: Vec<f64> = made.iter().map(|b| (b[0] + b[3]) / 2.0).collect();
        centres.sort_by(f64::total_cmp);
        assert!((centres[1] - centres[0] - 2.0).abs() < 1e-6, "{centres:?}");
        let area: f64 = made.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1])).sum();
        assert!((0.2..=0.3).contains(&(area / 100.0)), "Deckung {area}");
    }

    #[test]
    fn angle_grid_and_loops_follow_the_process() {
        let (_, tops) = split(&[[0.0, 0.0, 1.0, 10.0, 10.0, 1.2]], 0.1, 0.6, &[], 0.9);
        let along_x = |l: &[Block]| l.iter().all(|b| (b[4] - b[1] - 0.6).abs() < 1e-6);
        let turned = lines(&tops, 0.6, 2.0, &[], Style { angle: 90.0, ..Style::default() }).0;
        assert!(along_x(&turned), "90 Grad: Bahnen entlang X");
        let plain = lines(&tops, 0.6, 2.0, &[], Style::default()).0;
        let grid = lines(&tops, 0.6, 2.0, &[], Style { grid: true, ..Style::default() }).0;
        assert!(grid.len() >= 2 * plain.len() - 1 && !along_x(&grid), "grid legt beide Richtungen");
        let looped = lines(&tops, 0.6, 2.0, &[], Style { loops: true, ..Style::default() }).0;
        let area = |l: &[Block]| l.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1])).sum::<f64>();
        assert!(area(&looped) > area(&plain) + 15.0, "Schleife um den Kontakt: {} gegen {}", area(&looped), area(&plain));
    }

    #[test]
    fn a_narrow_strip_gets_one_line_along_it() {
        let (_, tops) = split(&[[0.0, 0.0, 1.0, 0.7, 6.0, 1.2]], 0.1, 0.6, &[], 0.9);
        let made = lines(&tops, 0.6, 2.0, &[], Style::default()).0;
        assert_eq!(made.len(), 1, "{made:?}");
        // Die Bahn endet eine halbe Bahnbreite vor dem Polsterrand.
        assert!(made[0][4] - made[0][1] >= 5.3 && (made[0][3] - made[0][0] - 0.6).abs() < 1e-6, "{made:?}");
    }

    #[test]
    fn every_support_point_gets_a_line_through_it() {
        let (_, tops) = split(&[[0.0, 0.0, 1.0, 10.0, 10.0, 1.2]], 0.1, 0.6, &[], 0.9);
        let points = [[5.0, 4.0], [5.0, 7.0]];
        let made = lines(&tops, 0.6, 2.0, &points, Style::default()).0;
        for p in points {
            assert!(made.iter().any(|b| b[1] <= p[1] && p[1] <= b[4] && b[0] <= p[0] && p[0] <= b[3]), "kein Bahn durch {p:?}: {made:?}");
        }
    }

    #[test]
    fn a_single_layer_without_anything_below_stays_dense() {
        let (rest, tops) = split(&[[0.0, 0.0, 1.0, 10.0, 10.0, 1.1]], 0.1, 0.6, &[], 0.9);
        assert!(tops.is_empty() && rest.len() > 0, "keine Bahn ohne Unterbau");
    }

    #[test]
    fn a_contact_without_a_valid_line_stays_dense() {
        // 0,5 x 0,5 mm: zu kurz fuer eine Bahn.
        let (_, tops) = split(&[[0.0, 0.0, 1.0, 0.5, 0.5, 1.2]], 0.1, 0.6, &[], 0.9);
        let (made, kept) = lines(&tops, 0.6, 2.0, &[], Style::default());
        assert!(made.is_empty());
        let area: f64 = kept.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1])).sum();
        assert!((area - 0.25).abs() < 1e-6, "{area}");
    }

    #[test]
    fn a_step_keeps_its_lower_free_top_as_contact() {
        // Linke Haelfte hoeher: Die freie Oberseite rechts unten ist auch Kontakt.
        let (rest, tops) = split(&[[0.0, 0.0, 0.8, 4.0, 2.0, 1.0], [0.0, 0.0, 1.0, 2.0, 2.0, 1.1]], 0.1, 0.6, &[], 0.9);
        assert_eq!(tops.len(), 2);
        let low = tops.iter().find(|t| (t.1 - 1.0).abs() < 1e-6).unwrap();
        assert_eq!(low.2.len(), 40 * 40, "rechte Haelfte 2 x 2 mm");
        assert!(rest.iter().all(|b| b[0] < 2.0 - 1e-6 || b[5] <= 0.9 + 1e-6), "rechts bleibt nur das Polster unter der Bahnschicht: {rest:?}");
    }
}

#[cfg(test)]
mod bottom_tests {
    use super::*;

    #[test]
    fn a_foot_gets_lines_only_in_its_lowest_layer() {
        // Fuss 6 x 6 mm, drei Schichten 0,1 mm ab z = 2,0.
        let (rest, under, kept) = bottom(&[[0.0, 0.0, 2.0, 6.0, 6.0, 2.3]], 0.1, 0.5, 1.5, Style::default());
        assert!(!under.is_empty());
        assert!(under.iter().all(|b| (b[2] - 2.0).abs() < 1e-6 && (b[5] - 2.1).abs() < 1e-6), "{under:?}");
        let vol: f64 = rest.iter().chain(&kept).map(|b| (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])).sum();
        let above: f64 = rest.iter().filter(|b| b[2] >= 2.1 - 1e-6).map(|b| (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])).sum();
        assert!((above - 7.2).abs() < 0.01, "zwei Schichten darueber bleiben dicht: {above}");
        let area: f64 = under.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1])).sum();
        assert!(area < 0.6 * 36.0 && vol >= 7.19, "Bahnen statt voller Flaeche: {area}");
    }

    #[test]
    fn a_single_layer_foot_stays_dense() {
        let (rest, under, _) = bottom(&[[0.0, 0.0, 2.0, 6.0, 6.0, 2.1]], 0.1, 0.5, 1.5, Style::default());
        assert!(under.is_empty());
        let area: f64 = rest.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1])).sum();
        assert!((area - 36.0).abs() < 0.01);
    }
}
