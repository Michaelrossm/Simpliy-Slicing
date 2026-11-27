//! Kontaktbahnen: Die oberste Schicht der Kontaktpolster wird durch einzelne Bahnen ersetzt (wie die oberste Stuetzlage
//! in gaengigen Slicern). Jede Bahn ist ein Block in Bahnbreite und Schichthoehe; die Engine druckt ihn als eine Linie.
//! Die Schichten darunter bleiben dichte Polster und tragen die Bahnen.
use super::context::Block;
use crate::util::{FastMap as HashMap, FastSet as HashSet};

const CELL: f64 = 0.05;
thread_local! {
    /// Nur fuer Messungen: (einschichtig ohne Unterbau, oberste Zellen, bahnfaehige Zellen, dicht gebliebene Zellen).
    pub static STATS: std::cell::RefCell<(usize, usize, usize, usize)> = const { std::cell::RefCell::new((0, 0, 0, 0)) };
}
type Cell = (i64, i64);
const fn key(z: f64) -> i64 {
    (z * 10000.0) as i64
}

/// Zerlegt Polsterbloecke in Zellsaeulen. Rueckgabe: Polster ohne oberste Schicht, oberste Schicht je Hoehe (z0, z1, Zellen).
/// `width`: Bahnbreite. Eine Bahn liegt nur dort, wo das Polster darunter rundum mindestens eine halbe Bahnbreite reicht;
/// schmalere Stellen druckt die Engine darunter nicht sicher, sie bleiben dichtes Polster.
/// `points`: Stuetzpunkte; im Umkreis `tip` um einen Punkt traegt die Saeulenspitze auch ein einschichtiges Polster.
pub fn split(blocks: &[Block], layer: f64, width: f64, points: &[[f64; 2]], tip: f64) -> (Vec<Block>, Vec<(f64, f64, HashSet<Cell>)>) {
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
    super::plan::profile(&format!("   split: {} Bloecke, {} Spalten, Aufbau {} ms", blocks.len(), columns.len(), clock.elapsed().as_millis()));
    type Rest = HashMap<(i64, i64, i64), Vec<i64>>; // (z0, z1, Zeile) -> Spalten
    type Tops = HashMap<i64, (f64, f64, HashSet<Cell>)>;
    let sort_out = |part: &mut [(Cell, Vec<(f64, f64)>)]| -> (Rest, Tops, usize) {
        let mut rest: Rest = HashMap::default();
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
                    rest.entry((key(z0), key(z1), j)).or_default().push(i);
                    continue;
                }
                let cut = (z1 - layer).max(z0);
                // Eine Bahn braucht Polster darunter. Einschichtige Stellen ohne Unterbau bleiben dicht wie bisher.
                // (Die Saeulenspitze zaehlt nicht als Unterbau, sie steht nicht immer unter dem Punkt.)
                let carried = cut > z0 + 1e-4 || has_end(z0);
                if !carried {
                    alone += 1;
                    rest.entry((key(z0), key(z1), j)).or_default().push(i);
                    continue;
                }
                if cut > z0 + 1e-4 {
                    rest.entry((key(z0), key(cut), j)).or_default().push(i);
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
    let mut rest: Rest = HashMap::default();
    let mut tops: Tops = HashMap::default();
    for (part_rest, part_tops, alone) in parts {
        if alone > 0 && std::env::var("SIMPLIY_CONTACT_STATS").is_ok() {
            STATS.with(|s| s.borrow_mut().0 += alone);
        }
        for (k, mut v) in part_rest {
            rest.entry(k).or_default().append(&mut v);
        }
        for (k, (cut, z1, cells)) in part_tops {
            tops.entry(k).or_insert_with(|| (cut, z1, HashSet::default())).2.extend(cells);
        }
    }
    super::plan::profile(&format!("   split Ende {} ms", clock.elapsed().as_millis()));
    let _ = (width, points, tip);
    // Zeilen gleicher Laenge und Hoehe untereinander zu einem Block verbinden (viel weniger Dreiecke).
    let mut spans: HashMap<(i64, i64, i64, i64), Vec<i64>> = HashMap::default(); // (z0, z1, von, bis) -> Zeilen
    for ((z0, z1, j), mut list) in rest {
        list.sort_unstable();
        let mut k = 0;
        while k < list.len() {
            let start = list[k];
            while k + 1 < list.len() && list[k + 1] == list[k] + 1 {
                k += 1;
            }
            spans.entry((z0, z1, start, list[k] + 1)).or_default().push(j);
            k += 1;
        }
    }
    let mut out = Vec::new();
    for ((z0, z1, from, to), mut rows) in spans {
        rows.sort_unstable();
        let mut k = 0;
        while k < rows.len() {
            let first = rows[k];
            while k + 1 < rows.len() && rows[k + 1] == rows[k] + 1 {
                k += 1;
            }
            out.push([from as f64 * CELL, first as f64 * CELL, z0 as f64 / 10000.0, to as f64 * CELL, (rows[k] + 1) as f64 * CELL, z1 as f64 / 10000.0]);
            k += 1;
        }
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

/// Rueckgabe: Bahnen und Stellen, die keine gueltige Bahn bekommen und deshalb dicht bleiben.
pub fn lines(tops: &[(f64, f64, HashSet<Cell>)], width: f64, pitch: f64, points: &[[f64; 2]], style: Style) -> (Vec<Block>, Vec<Block>) {
    let mut out = Vec::new();
    let mut kept = Vec::new();
    for (z0, z1, cells) in tops {
        let mut left = cells.clone();
        while let Some(&start) = left.iter().next() {
            left.remove(&start);
            let mut part = vec![start];
            let mut k = 0;
            while k < part.len() {
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
                made += rows_of(&set, along_x, (min_i, max_i, min_j, max_j), width, pitch, points, (*z0, *z1), &mut out);
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
            if std::env::var("SIMPLIY_CONTACT_STATS").is_ok() {
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
        }
    }
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
