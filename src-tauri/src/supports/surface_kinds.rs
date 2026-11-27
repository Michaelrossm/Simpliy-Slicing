//! Flaechenerkennung fuer Ueberhaenge (kompakte eigene Umsetzung nach dem Prinzip der Flaechenerkennung in SSC Cleaner):
//! Welche Art Flaeche ist ein Ueberhang? Ebene, Zylinder (Bohrung oder Rundung unten) oder Freiform.
//!
//! Verfahren: Die Normalen einer Flaeche liegen bei einer Ebene (fast) auf einer Linie,
//! bei einem Zylinder in einer Ebene senkrecht zur Achse, bei Freiform im Raum. Die Streuung (Eigenwerte der
//! Normalen-Kovarianz) trennt die Typen, anschliessend wird der Radius mit einer Kreisanpassung (Kasa) gemessen.
//! Eine waagerechte, nach innen zeigende Zylinderflaeche ist die Decke einer Bohrung: kleine Bohrungen druckt man
//! ohne Stuetzen (Bruecke/Rundbogen), Stuetzen darin sind kaum entfernbar.
use super::placement::Surface;
use crate::util::FastMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    /// Ebene (auch geneigt, z. B. Fase).
    Plane,
    /// Waagerechte, nach innen zeigende Zylinderflaeche (Decke einer Bohrung) mit Durchmesser in mm.
    Bore(f64),
    /// Zylinder, der nach aussen zeigt (z. B. Unterseite einer Rolle) oder senkrecht steht.
    Cylinder(f64),
    Freeform,
}

/// Eigenwerte und -vektoren einer symmetrischen 3x3-Matrix (Jacobi), absteigend sortiert.
fn eigen(mut a: [[f64; 3]; 3]) -> ([f64; 3], [[f64; 3]; 3]) {
    let mut v = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    for _ in 0..40 {
        let (mut p, mut q, mut big) = (0, 1, 0.0);
        for (i, j) in [(0, 1), (0, 2), (1, 2)] {
            if a[i][j].abs() > big {
                big = a[i][j].abs();
                (p, q) = (i, j);
            }
        }
        if big < 1e-14 {
            break;
        }
        let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
        let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
        let t = if theta == 0.0 { 1.0 } else { t };
        let (c, s) = (1.0 / (t * t + 1.0).sqrt(), t / (t * t + 1.0).sqrt());
        for k in 0..3 {
            let (akp, akq) = (a[k][p], a[k][q]);
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
        }
        for k in 0..3 {
            let (apk, aqk) = (a[p][k], a[q][k]);
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
        }
        for row in v.iter_mut() {
            let (vp, vq) = (row[p], row[q]);
            row[p] = c * vp - s * vq;
            row[q] = s * vp + c * vq;
        }
    }
    let mut order = [0usize, 1, 2];
    order.sort_by(|&x, &y| a[y][y].partial_cmp(&a[x][x]).unwrap_or(std::cmp::Ordering::Equal));
    let values = order.map(|i| a[i][i]);
    let vectors = order.map(|i| [v[0][i], v[1][i], v[2][i]]);
    (values, vectors)
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn unit(a: [f64; 3]) -> [f64; 3] {
    let l = dot(a, a).sqrt().max(1e-300);
    [a[0] / l, a[1] / l, a[2] / l]
}

/// Dreiecksdaten einer Flaeche: Schwerpunkt, Einheitsnormale (nach aussen), Flaeche.
pub struct Facet {
    pub centre: [f64; 3],
    pub normal: [f64; 3],
    pub area: f64,
}

/// Art einer Flaeche aus ihren Dreiecken.
pub fn classify(facets: &[Facet]) -> Kind {
    let total: f64 = facets.iter().map(|f| f.area).sum();
    if facets.is_empty() || total <= 0.0 {
        return Kind::Freeform;
    }
    // Kovarianz der Normalen (ohne Mittelwert: die Richtung zaehlt)
    let mut m = [[0.0; 3]; 3];
    for f in facets {
        for i in 0..3 {
            for j in 0..3 {
                m[i][j] += f.area / total * f.normal[i] * f.normal[j];
            }
        }
    }
    let (values, _) = eigen(m);
    let sum = values.iter().sum::<f64>().max(1e-300);
    let (l2, l3) = (values[1] / sum, values[2] / sum);
    if l2 < 0.002 {
        return Kind::Plane;
    }
    // Ein Zylinder braucht genug Dreiecke fuer eine Kreisanpassung.
    if l3 > 0.003 || facets.len() < 6 {
        return Kind::Freeform;
    }
    match fit_cylinder(facets) {
        Some(fit) if fit.concave && fit.axis[2].abs() < 0.35 => Kind::Bore(2.0 * fit.radius),
        Some(fit) => Kind::Cylinder(2.0 * fit.radius),
        None => Kind::Freeform,
    }
}

/// Angepasster Zylinder einer Flaeche.
#[derive(Clone, Copy, Debug)]
pub struct CylFit {
    pub axis: [f64; 3],
    /// Ein Punkt auf der Achse (Mitte der Flaeche, auf die Achse projiziert).
    pub centre: [f64; 3],
    pub radius: f64,
    /// Normalen zeigen zur Achse (Loch) statt von ihr weg (Rolle).
    pub concave: bool,
    /// Groesste Luecke im Umfang in Grad (0 = voller Kreis, 360 = ein Punkt).
    pub gap: f64,
}

/// Zylinder in eine Flaeche einpassen (Normalen-Streuung fuer die Achse, Kreisanpassung nach Kasa fuer den Radius).
pub fn fit_cylinder(facets: &[Facet]) -> Option<CylFit> {
    let total: f64 = facets.iter().map(|f| f.area).sum();
    if facets.len() < 6 || total <= 0.0 {
        return None;
    }
    let mut m = [[0.0; 3]; 3];
    for f in facets {
        for i in 0..3 {
            for j in 0..3 {
                m[i][j] += f.area / total * f.normal[i] * f.normal[j];
            }
        }
    }
    let (values, vectors) = eigen(m);
    let sum = values.iter().sum::<f64>().max(1e-300);
    if values[2] / sum > 0.003 || values[1] / sum < 0.002 {
        return None;
    }
    let axis = unit(vectors[2]);
    let helper = if axis[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    let e1 = unit(cross(axis, helper));
    let e2 = cross(axis, e1);
    let mean: [f64; 3] = [0, 1, 2].map(|k| facets.iter().map(|f| f.centre[k] * f.area).sum::<f64>() / total);
    let pts: Vec<(f64, f64, f64)> = facets
        .iter()
        .map(|f| {
            let d = [f.centre[0] - mean[0], f.centre[1] - mean[1], f.centre[2] - mean[2]];
            (dot(d, e1), dot(d, e2), f.area)
        })
        .collect();
    // Kreisanpassung nach Kasa: u^2 + v^2 + A u + B v + C = 0 (gewichtet), Normalgleichungen 3x3
    let mut n = [[0.0f64; 3]; 3];
    let mut r = [0.0f64; 3];
    for &(u, v, w) in &pts {
        let row = [u, v, 1.0];
        let rhs = -(u * u + v * v);
        for i in 0..3 {
            for j in 0..3 {
                n[i][j] += w * row[i] * row[j];
            }
            r[i] += w * row[i] * rhs;
        }
    }
    let sol = solve3(n, r)?;
    let (cu, cv) = (-sol[0] / 2.0, -sol[1] / 2.0);
    let radius_sq = cu * cu + cv * cv - sol[2];
    if !(radius_sq > 0.0) {
        return None;
    }
    let radius = radius_sq.sqrt();
    let rms = (pts.iter().map(|&(u, v, w)| w * (((u - cu).hypot(v - cv)) - radius).powi(2)).sum::<f64>() / total).sqrt();
    if rms > 0.08 * radius || !(0.2..=500.0).contains(&radius) {
        return None;
    }
    let centre = [0, 1, 2].map(|k| mean[k] + e1[k] * cu + e2[k] * cv);
    let inward: f64 = facets
        .iter()
        .map(|f| f.area * dot(f.normal, unit([centre[0] - f.centre[0], centre[1] - f.centre[1], centre[2] - f.centre[2]])))
        .sum::<f64>()
        / total;
    // Umfangsabdeckung: groesste Winkelluecke zwischen den Flaechenschwerpunkten um die Achse
    let mut angles: Vec<f64> = pts.iter().map(|&(u, v, _)| (v - cv).atan2(u - cu).to_degrees()).collect();
    angles.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut gap = 360.0 - (angles[angles.len() - 1] - angles[0]);
    for w in angles.windows(2) {
        gap = gap.max(w[1] - w[0]);
    }
    Some(CylFit { axis, centre, radius, concave: inward > 0.0, gap })
}

/// Neigung (Grad aus der Waagerechten) und Breite (mm) einer ebenen Flaeche; `None`, wenn sie nicht eben ist.
/// Die Breite ist Flaeche geteilt durch Laenge entlang der Hauptrichtung (schmaler Streifen = Fase).
pub fn plane_slope_and_width(facets: &[Facet]) -> Option<(f64, f64)> {
    plane_details(facets).map(|(slope, width, _)| (slope, width))
}

/// Wie `plane_slope_and_width`, zusaetzlich die mittlere Normale.
pub fn plane_details(facets: &[Facet]) -> Option<(f64, f64, [f64; 3])> {
    if classify(facets) != Kind::Plane {
        return None;
    }
    let total: f64 = facets.iter().map(|f| f.area).sum();
    let mut n = [0.0; 3];
    for f in facets {
        for k in 0..3 {
            n[k] += f.normal[k] * f.area / total;
        }
    }
    let n = unit(n);
    let slope = (-n[2]).clamp(-1.0, 1.0).acos().to_degrees();
    // Hauptrichtung in der Ebene: waagerechte Richtung (Hoehenlinie) der Flaeche
    let h = unit(cross(n, [0.0, 0.0, 1.0]));
    let h = if h.iter().all(|v| v.is_finite()) && dot(h, h) > 0.5 { h } else { [1.0, 0.0, 0.0] };
    let w = unit(cross(n, h));
    let spread = |axis: [f64; 3]| {
        let (lo, hi) = facets.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), f| {
            let v = dot(f.centre, axis);
            (lo.min(v), hi.max(v))
        });
        hi - lo
    };
    let margin = (total / facets.len() as f64).sqrt();
    // Laenge = groessere der beiden Ausdehnungen, Breite = Flaeche / Laenge
    let length = (spread(h).max(spread(w)) + margin).max(1e-9);
    Some((slope, total / length, n))
}

fn solve3(mut a: [[f64; 3]; 3], mut b: [f64; 3]) -> Option<[f64; 3]> {
    for i in 0..3 {
        let pivot = (i..3).max_by(|&x, &y| a[x][i].abs().partial_cmp(&a[y][i].abs()).unwrap_or(std::cmp::Ordering::Equal))?;
        if a[pivot][i].abs() < 1e-12 {
            return None;
        }
        a.swap(i, pivot);
        b.swap(i, pivot);
        for k in i + 1..3 {
            let f = a[k][i] / a[i][i];
            for j in i..3 {
                a[k][j] -= f * a[i][j];
            }
            b[k] -= f * b[i];
        }
    }
    let mut x = [0.0; 3];
    for i in (0..3).rev() {
        let s: f64 = (i + 1..3).map(|j| a[i][j] * x[j]).sum();
        x[i] = (b[i] - s) / a[i][i];
    }
    Some(x)
}

/// Art jeder Ueberhangflaeche (Schluessel = Flaechen-Kennung aus `Surface::region`).
pub fn kinds(surface: &Surface) -> FastMap<i64, Kind> {
    surface.facets_by_region().into_iter().map(|(region, facets)| (region, classify(&facets))).collect()
}

/// Fasen: schmale ebene Streifen knapp unter der Ueberhangschwelle (z. B. 45°-Fasen bei Schwelle 45°). Sie druckt der
/// Drucker selbsttragend, eine Stuetze lohnt nicht. `angle` = Schwelle (Grad aus der Waagerechten), `tol` = wie viel
/// steiler als die Schwelle noch als Fase gilt, `max_width` = hoechste Streifenbreite in mm.
pub fn chamfers(surface: &Surface, angle: f64, tol: f64, max_width: f64) -> Vec<i64> {
    if max_width <= 0.0 {
        return Vec::new();
    }
    surface
        .facets_by_region()
        .into_iter()
        .filter_map(|(region, facets)| {
            let (slope, _, normal) = plane_details(&facets)?;
            if !(slope <= angle + 1e-6 && slope >= angle - tol) {
                return None;
            }
            // Breite aus den echten Eckpunkten (wenige grosse Dreiecke verfaelschen die Schwerpunkt-Schaetzung)
            let (_, width) = surface.region_extents(region, normal);
            (width <= max_width).then_some(region)
        })
        .collect()
}

/// Flaechen, die kleine Bohrungen sind (Durchmesser <= `max_diameter`).
pub fn small_bores(surface: &Surface, max_diameter: f64) -> Vec<i64> {
    if max_diameter <= 0.0 {
        return Vec::new();
    }
    kinds(surface).into_iter().filter(|(_, kind)| matches!(kind, Kind::Bore(d) if *d <= max_diameter)).map(|(region, _)| region).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    /// Decke einer waagerechten Bohrung (Achse X) als Facettenring: Normalen zeigen zur Achse.
    fn bore(radius: f64, from: f64, to: f64, steps: usize) -> Vec<Facet> {
        (0..steps)
            .map(|i| {
                let a = from + (to - from) * (i as f64 + 0.5) / steps as f64;
                Facet {
                    centre: [i as f64 * 0.1, radius * a.cos(), 10.0 + radius * a.sin()],
                    normal: [0.0, -a.cos(), -a.sin()],
                    area: 1.0,
                }
            })
            .collect()
    }

    #[test]
    fn horizontal_bore_ceiling_is_recognised_with_diameter() {
        let facets = bore(3.0, PI * 0.15, PI * 0.85, 40);
        match classify(&facets) {
            Kind::Bore(d) => assert!((d - 6.0).abs() < 0.2, "{d}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn plane_convex_cylinder_and_freeform_are_told_apart() {
        let plane: Vec<Facet> = (0..10).map(|i| Facet {centre: [i as f64, 0.0, 5.0], normal: [0.0, 0.0, -1.0], area: 1.0}).collect();
        assert_eq!(classify(&plane), Kind::Plane);
        // Unterseite einer Rolle: Normalen zeigen von der Achse weg
        let roll: Vec<Facet> = bore(4.0, PI * 1.2, PI * 1.8, 30).into_iter().map(|f| Facet {normal: [-f.normal[0], -f.normal[1], -f.normal[2]], ..f}).collect();
        assert!(matches!(classify(&roll), Kind::Cylinder(_)), "{:?}", classify(&roll));
        // Kugel-Kuppel von unten: Normalen im Raum verteilt
        let dome: Vec<Facet> = (0..60).map(|i| {
            let (u, v) = (i as f64 * 0.37, (i % 6) as f64 * 0.2 + 0.2);
            let n = unit([v.sin() * u.cos(), v.sin() * u.sin(), -v.cos()]);
            Facet {centre: [n[0] * 5.0, n[1] * 5.0, 10.0 + n[2] * 5.0], normal: n, area: 1.0}
        }).collect();
        assert_eq!(classify(&dome), Kind::Freeform);
    }

    #[test]
    fn vertical_cylinder_is_not_a_bore() {
        // Achse senkrecht: Normalen waagerecht, nach innen
        let facets: Vec<Facet> = (0..36).map(|i| {
            let a = i as f64 * PI / 18.0;
            Facet {centre: [3.0 * a.cos(), 3.0 * a.sin(), 0.5 * (i % 3) as f64], normal: [-a.cos(), -a.sin(), 0.0], area: 1.0}
        }).collect();
        assert!(matches!(classify(&facets), Kind::Cylinder(_)));
    }

    /// Geneigter ebener Streifen: `len` Dreiecke entlang X, `rows` Reihen in Hangrichtung (je 1 mm breit).
    fn strip(slope: f64, len: usize, rows: usize) -> Vec<Facet> {
        let a = slope.to_radians();
        let normal = [0.0, a.sin(), -a.cos()];
        let mut out = Vec::new();
        for r in 0..rows {
            for i in 0..len {
                let along = r as f64 + 0.5;
                out.push(Facet {centre: [i as f64 + 0.5, along * a.cos(), 10.0 + along * a.sin()], normal, area: 1.0});
            }
        }
        out
    }

    #[test]
    fn narrow_strip_is_a_chamfer_wide_plane_is_not() {
        let (slope, width) = plane_slope_and_width(&strip(44.0, 30, 1)).unwrap();
        assert!((slope - 44.0).abs() < 0.1, "{slope}");
        assert!(width < 1.2, "{width}");
        let (_, wide) = plane_slope_and_width(&strip(44.0, 30, 20)).unwrap();
        assert!(wide > 10.0, "{wide}");
        assert!(plane_slope_and_width(&bore(3.0, 0.5, 2.6, 30)).is_none(), "ein Zylinder ist keine Ebene");
    }

    /// Block mit schmaler Fase unten (Querschnitt in YZ, Laenge `L` in X) als Netz.
    fn chamfer_block(cy: f64, cz: f64) -> (Vec<f64>, Vec<u32>) {
        let prof = [(cy, 0.0), (30.0, 0.0), (30.0, 20.0), (0.0, 20.0), (0.0, cz)];
        let (mut vertices, mut indices) = (Vec::new(), Vec::new());
        for x in [0.0, 30.0] {
            for p in prof {
                vertices.extend([x, p.0, p.1]);
            }
        }
        let n = prof.len() as u32;
        for i in 0..n {
            let j = (i + 1) % n;
            indices.extend([i, j, n + j, i, n + j, n + i]);
        }
        for k in 1..n - 1 {
            indices.extend([0, k + 1, k]);
            indices.extend([n, n + k, n + k + 1]);
        }
        (vertices, indices)
    }

    #[test]
    fn chamfer_strip_is_found_only_when_narrow_enough() {
        let (v, i) = chamfer_block(1.5, 1.4); // 43°, Breite ≈ 2,05 mm
        let surface = Surface::analyse(&v, &i, 45.0);
        assert_eq!(chamfers(&surface, 45.0, 5.0, 3.0).len(), 1);
        assert!(chamfers(&surface, 45.0, 5.0, 1.0).is_empty(), "zu breit fuer die Grenze");
        assert!(chamfers(&surface, 45.0, 1.0, 3.0).is_empty(), "43° liegt ausserhalb der Toleranz 1°");
        assert!(chamfers(&surface, 45.0, 5.0, 0.0).is_empty(), "0 = aus");
        // flache Flaeche (20°) ist keine Fase
        let (v, i) = chamfer_block(6.0, 2.2);
        assert!(chamfers(&Surface::analyse(&v, &i, 45.0), 45.0, 5.0, 10.0).is_empty());
    }

    /// Mit echtem Netz: `SIMPLIY_TEST_STL=pfad.stl cargo test --lib real_mesh_kinds -- --ignored --nocapture`
    #[test]
    #[ignore = "braucht eine STL-Datei"]
    fn real_mesh_kinds() {
        let bytes = std::fs::read(std::env::var("SIMPLIY_TEST_STL").unwrap()).unwrap();
        let mesh = crate::mesh::Mesh::from_stl(&bytes).unwrap();
        let vertices: Vec<f64> = mesh.vertices.iter().flatten().map(|v| f64::from(*v)).collect();
        let indices: Vec<u32> = mesh.triangles.iter().flatten().copied().collect();
        let surface = Surface::analyse(&vertices, &indices, 45.0);
        let found = kinds(&surface);
        for (region, kind) in &found {
            println!("Flaeche {region}: {kind:?}, Flaeche {:.1} mm2", surface.region_area[region]);
        }
        assert!(!found.is_empty());
    }
}
