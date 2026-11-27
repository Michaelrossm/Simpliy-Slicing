//! Reproduzierbarer, von der Oberflaeche unabhaengiger Leistungslauf.
use super::{generate, input::{Item, ModelInput}, plan, types::{Data, Settings}, Bed};
use crate::mesh::Mesh;
use std::{sync::Arc, time::Instant};
use std::hash::{Hash, Hasher};

fn fingerprint(plans: &[plan::ModelPlan]) -> u64 {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    for plan in plans {
        for blocks in [&plan.solids, &plan.pads, &plan.strips, &plan.lines] {
            let mut canonical: Vec<[u64; 6]> = blocks.iter().map(|b| b.map(f64::to_bits)).collect();
            canonical.sort_unstable();
            canonical.hash(&mut hash);
        }
        let mut branches: Vec<Vec<[u64; 4]>> = plan.branches.iter().map(|branch| branch.iter().map(|p| p.map(f64::to_bits)).collect()).collect();
        branches.sort_unstable();
        branches.hash(&mut hash);
        let mut native: Vec<_> = plan.native.iter().map(|s| (s.x.to_bits(), s.y.to_bits(), s.bottom_z.to_bits(), s.top_z.to_bits(), s.surface_z.to_bits())).collect();
        native.sort_unstable();
        native.hash(&mut hash);
    }
    hash.finish()
}

fn ordered_fingerprint(plans: &[plan::ModelPlan]) -> Vec<u64> {
    let mut result = Vec::new();
    for plan in plans {
        for blocks in [&plan.solids, &plan.pads, &plan.strips, &plan.lines] {
            let mut hash = std::collections::hash_map::DefaultHasher::new();
            for block in blocks { block.map(f64::to_bits).hash(&mut hash); }
            result.push(hash.finish());
        }
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        for branch in &plan.branches { for point in branch { point.map(f64::to_bits).hash(&mut hash); } }
        result.push(hash.finish());
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        for s in &plan.native { (s.x.to_bits(),s.y.to_bits(),s.bottom_z.to_bits(),s.top_z.to_bits(),s.surface_z.to_bits()).hash(&mut hash); }
        result.push(hash.finish());
    }
    result
}

fn enclosing_support_loops(preview: &crate::gcode::Preview, point: &[f64; 3], tolerance: f64) -> Vec<(f64, usize)> {
    let mut result = Vec::new();
    let mut poly = Vec::<[f64; 2]>::new();
    let mut z0 = 0.0;
    let mut finish = |poly: &mut Vec<[f64; 2]>, z: f64| {
        if poly.len() >= 4 && (poly[0][0]-poly[poly.len()-1][0]).hypot(poly[0][1]-poly[poly.len()-1][1]) <= 0.02 {
            let mut inside = false;
            for pair in poly.windows(2) {
                let (a,b)=(pair[0],pair[1]);
                if (a[1]>point[1]) != (b[1]>point[1]) && point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0] { inside=!inside; }
            }
            if inside { result.push((z,poly.len()-1)); }
        }
        poly.clear();
    };
    for i in 0..preview.count() {
        let z=f64::from(preview.to[i*3+2]);
        let role=&preview.roles[preview.role[i] as usize];
        let from=[f64::from(preview.from[i*3]),f64::from(preview.from[i*3+1])];
        let to=[f64::from(preview.to[i*3]),f64::from(preview.to[i*3+1])];
        if !role.starts_with("Support material") || (z-point[2]).abs()>tolerance {
            if !poly.is_empty() { finish(&mut poly,z0); }
            continue;
        }
        if !poly.is_empty() && ((z-z0).abs()>0.001 || (from[0]-poly[poly.len()-1][0]).hypot(from[1]-poly[poly.len()-1][1])>0.02) { finish(&mut poly,z0); }
        if poly.is_empty() { poly.push(from); z0=z; }
        poly.push(to);
        if poly.len() >= 4 && (to[0]-poly[0][0]).hypot(to[1]-poly[0][1])<=0.02 { finish(&mut poly,z0); }
    }
    if !poly.is_empty() { finish(&mut poly,z0); }
    result
}

#[test]
#[ignore = "Benötigt SIMPLIY_BENCH_STL und ausreichend Speicher"]
fn support_performance_scene() {
    let path = std::env::var("SIMPLIY_BENCH_STL").expect("SIMPLIY_BENCH_STL");
    let start = Instant::now();
    let mesh = Arc::new(Mesh::from_stl(&std::fs::read(&path).unwrap()).unwrap());
    let vertices = mesh.vertices.iter().flatten().map(|v| f64::from(*v)).collect();
    let indices = mesh.triangles.iter().flatten().copied().collect();
    let world = generate::World::new(vertices, indices);
    println!("Modell laden/analysieren: {:.3} s", start.elapsed().as_secs_f64());
    let settings = Settings { spacing: 1.0, style: "auto".into(), ..Settings::default() };
    let now = Instant::now();
    let generated = generate::automatic(&world, &settings, None);
    println!("Stützpunkte: {}, {:.3} s", generated.supports.len(), now.elapsed().as_secs_f64());
    assert!(!generated.truncated);
    if let Ok(expected) = std::env::var("SIMPLIY_BENCH_COUNT") {
        assert_eq!(generated.supports.len(), expected.parse::<usize>().unwrap(), "Szenenparameter stimmen nicht mit der Referenz überein");
    }
    let data = Data { schema: 1, settings, signature: String::new(), automatic: generated.supports, manual: Vec::new(), incomplete: false, erased: Vec::new() };
    let input = ModelInput { id: "benchmark".into(), path, signature: String::new(), rows: [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]], offset: [0.,0.,0.], cut: false, parts: Vec::new(), stored: serde_json::to_value(data).unwrap(), resolved: Default::default(), range_heights: Vec::new(), range_spans: Vec::new() };
    let bed = Bed { min_x: -10000., max_x: 10000., min_y: -10000., max_y: 10000. };
    let mut item = Item::new(input, mesh, bed).unwrap();
    println!("Von der Planung übernommene Stützpunkte: {}", item.data.count());
    if let Ok(expected) = std::env::var("SIMPLIY_BENCH_COUNT") {
        assert_eq!(item.data.count(), expected.parse::<usize>().unwrap(), "Stützpunkte wurden vor der Planung verworfen");
    }
    let now = Instant::now();
    if std::env::var_os("SIMPLIY_BENCH_CANCEL").is_some() {
        plan::begin_view();
        let trigger = std::thread::spawn(|| { std::thread::sleep(std::time::Duration::from_millis(300)); plan::begin_view(); plan::end_view(); });
        let result = plan::plate(&[item]);
        trigger.join().unwrap();
        plan::end_view();
        assert!(matches!(result, Err(ref error) if error == plan::OUTDATED), "Veraltete Planung darf kein Ergebnis liefern");
        println!("Abbruch bestaetigt nach {:.3} s", now.elapsed().as_secs_f64());
        return;
    }
    let plans = plan::plate(std::slice::from_ref(&item)).expect("Stützenplanung");
    println!("Planung: {:.3} s; Gesamt: {:.3} s; Modelle: {}", now.elapsed().as_secs_f64(), start.elapsed().as_secs_f64(), plans.len());
    println!("Geometrie-Fingerabdruck: {:016x}", fingerprint(&plans));
    for plan in plans.iter() {
        assert_eq!(plan.branches.len(), plan.segment_contacts.len());
        for (id, group) in plan.groups.iter().enumerate() {
            assert!(group.branches.end <= plan.branches.len() && group.feet.end <= plan.group_feet.len());
            for support in &group.contacts {
                assert_eq!(plan.group_index.by_contact(support), Some(id));
            }
            for owners in &plan.segment_contacts[group.branches.clone()] {
                assert!(!owners.is_empty());
                assert!(owners.iter().all(|owner| group.contacts.contains(owner)));
            }
        }
        assert!(plan.routes.iter().all(|route| plan.group_index.by_contact(&route.support.id).is_some()));
        println!("Astgruppen im Plan: {}", plan.groups.len());
    }
    if std::env::var_os("SIMPLIY_BENCH_DELETE").is_some() {
        let index = &plans[0].group_index;
        let native_delete = std::env::var_os("SIMPLIY_BENCH_NATIVE_DELETE").is_some();
        let position = item.data.automatic.iter().position(|p| {
            if native_delete {
                plans[0].native.iter().any(|native| native.id == p.id && native.style() == p.style())
            } else {
                index.by_contact(&p.id).is_some()
            }
        }).unwrap_or(0);
        let removed = item.data.automatic.remove(position);
        let start = Instant::now();
        let own = index.by_contact(&removed.id);
        let nearby = index.at_xy(removed.x, removed.y);
        println!("Graphabfrage: eigene Gruppe {own:?}, {} räumliche Kandidaten, {:.3} ms",
            nearby.len(), start.elapsed().as_secs_f64() * 1000.0);
        item.data.erased.push([removed.x, removed.y, removed.surface_z]);
        let now = Instant::now();
        let edited = plan::plate(std::slice::from_ref(&item)).unwrap();
        let elapsed = now.elapsed();
        let shared = plans[0].shares_geometry(&edited[0]);
        println!("Astgeometrie direkt übernommen: {shared}");
        let retained_paths = edited[0].branches.iter().all(|branch| plans[0].branches.contains(branch));
        println!("Alle verbliebenen Astlinien haben ihre ursprünglichen Koordinaten: {retained_paths}");
        drop(plans);
        println!("Einzelne Löschung: {:.3} s", elapsed.as_secs_f64());
        let expected = ordered_fingerprint(&edited);
        drop(edited);
        super::shapes::clear_shared_routes();
        item.input.id.push_str("-reference"); // Vollständigen Plan-Cache umgehen.
        let now = Instant::now();
        let fresh = plan::plate(&[item]).unwrap();
        println!("Dieselbe Löschung mit leerem Routen-Cache: {:.3} s", now.elapsed().as_secs_f64());
        if !shared && !retained_paths {
            assert_eq!(ordered_fingerprint(&fresh), expected);
        }
    }
}

#[test]
#[ignore = "Benötigt STL, Prusa-Engine und eine lokale Auftragsvorlage"]
fn slice_performance_scene() {
    let path = std::env::var("SIMPLIY_BENCH_STL").expect("SIMPLIY_BENCH_STL");
    let engine = std::env::var("SIMPLIY_TEST_ENGINE").expect("SIMPLIY_TEST_ENGINE");
    let template = std::env::var("SIMPLIY_TEST_SUPPORT_JOB").expect("SIMPLIY_TEST_SUPPORT_JOB");
    let mesh = Mesh::from_stl(&std::fs::read(&path).unwrap()).unwrap();
    let vertices = mesh.vertices.iter().flat_map(|p| [f64::from(p[0]) + 125.0, f64::from(p[1]) + 105.0, f64::from(p[2])]).collect();
    let indices = mesh.triangles.iter().flatten().copied().collect();
    let world = generate::World::new(vertices, indices);
    let settings = Settings { spacing: 1.0, style: "auto".into(), ..Settings::default() };
    let generated = generate::automatic(&world, &settings, None);
    assert!(!generated.truncated);
    assert_eq!(generated.supports.len(), 6181, "Testszene stimmt nicht mit der Referenz überein");
    let data = Data { schema: 1, settings, signature: String::new(), automatic: generated.supports, manual: Vec::new(), incomplete: false, erased: Vec::new() };
    let mut input = ModelInput { id: "benchmark".into(), path: path.clone(), signature: String::new(), rows: [[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]], offset: [125.,105.,0.], cut: false, parts: Vec::new(), stored: serde_json::to_value(data).unwrap(), resolved: Default::default(), range_heights: Vec::new(), range_spans: Vec::new() };
    let mut job: crate::project::Job = serde_json::from_slice(&std::fs::read(template).unwrap()).unwrap();
    input.resolved = job.support_plate.as_ref().and_then(|p| p.models.first()).expect("Prozesswerte in Auftragsvorlage fehlen").resolved.clone();
    if std::env::var_os("SIMPLIY_BENCH_FINGERPRINT_ONLY").is_some() {
        let bed = Bed { min_x: 0., max_x: 250., min_y: 0., max_y: 210. };
        let item = Item::new(input, Arc::new(mesh), bed).unwrap();
        let plans = plan::plate(&[item]).expect("Planung für Geometrievergleich");
        println!("Slice-Geometrie-Fingerabdruck: {:016x}", fingerprint(&plans));
        println!("Geometrie-Reihenfolge (solids,pads,strips,lines,branches,native): {:x?}", ordered_fingerprint(&plans));
        return;
    }
    job.models.truncate(1);
    let model = &mut job.models[0];
    model.id = Some("benchmark".into());
    model.path = path;
    model.inline = None;
    model.name = "Benchmark-Modell".into();
    model.matrix = [1.,0.,0.,0.,1.,0.,0.,0.,1.,125.,105.,0.];
    model.signature = None;
    model.volumes.clear();
    job.support_plate = Some(super::Plate { bed: Bed { min_x: 0., max_x: 250., min_y: 0., max_y: 210. }, models: vec![input], tools: 1, marks: None });
    if std::env::var_os("SIMPLIY_SLICE_NATIVE_DELETE").is_some() {
        let plate = job.support_plate.as_mut().unwrap();
        let input = &mut plate.models[0];
        let mesh = crate::engine::Engine::open(&engine).unwrap().cached_mesh(&input.path).unwrap();
        let baseline = Item::new(input.clone(), mesh.clone(), plate.bed).unwrap();
        let before = plan::plate(&[baseline]).unwrap();
        let supports = input.stored["automatic"].as_array_mut().unwrap();
        let position = supports.iter().position(|s| before[0].native.iter().any(|p|
            serde_json::to_value(p).ok().as_ref() == Some(s)
        )).expect("Native Stütze fehlt");
        let removed = supports.remove(position);
        let edited = Item::new(input.clone(), mesh, plate.bed).unwrap();
        let after = plan::plate(&[edited]).unwrap();
        assert!(before[0].shares_geometry(&after[0]));
        assert_eq!(before[0].native.len(), after[0].native.len() + 1);
        println!("Lokal gelöschter Prusa-Pfeiler: {}", removed["id"]);
    }
    if let Ok(output) = std::env::var("SIMPLIY_BENCH_PROJECT_ONLY") {
        let mesh = Arc::new(mesh);
        let prepared = super::job::expand(&mut job, &|_| Ok(Arc::clone(&mesh))).unwrap();
        assert!(prepared.problems.is_empty(), "{:?}", prepared.problems);
        let meshes: Vec<_> = job.models.iter().map(|model| match &model.inline {
            Some(inline) => inline.mesh().unwrap(),
            None => (*mesh).clone(),
        }).collect();
        std::fs::write(format!("{output}.config.json"), serde_json::to_vec(&job.config).unwrap()).unwrap();
        crate::project::write(std::fs::File::create(output).unwrap(), &job, &meshes).unwrap();
        println!("3MF-Vergleichsdatei erzeugt");
        return;
    }
    if let Ok(gcode) = std::env::var("SIMPLIY_DIAG_GCODE") {
        let mesh = Arc::new(mesh);
        let support_input = job.support_plate.as_ref().and_then(|p| p.models.first()).cloned();
        let prepared = super::job::expand(&mut job, &|_| Ok(Arc::clone(&mesh))).expect("Prüfpunkte vorbereiten");
        let read_preview = |path: &str| {
            if std::env::var_os("SIMPLIY_DIAG_RAW").is_some() {
                let text = std::fs::read_to_string(path).unwrap();
                let labelled = crate::engine::label_support_bodies(&text);
                let temporary = std::env::temp_dir().join(format!("simpliy-diag-{}-{}.gcode", std::process::id(), if path.contains("direct-1") { 1 } else { 2 }));
                std::fs::write(&temporary, labelled).unwrap();
                crate::gcode::load(&temporary.to_string_lossy(), |_| {}).expect("G-Code lesen")
            } else { crate::gcode::load(path, |_| {}).expect("G-Code lesen") }
        };
        let preview = read_preview(&gcode);
        let inspect_start = Instant::now();
        let report = super::inspect::inspect(&preview, &prepared.checks);
        println!("G-Code-Prüfung: {:.3} s", inspect_start.elapsed().as_secs_f64());
        println!("Warnung einschließlich Modellevidenz: {}", report.warning());
        let mut types = [0usize; 3];
        for check in &prepared.checks {
            let (place, kind) = match check {
                super::inspect::Check::Pillar {x,y,surface,..} => ([*x,*y,*surface], 0),
                super::inspect::Check::Tip {x,y,surface,..} => ([*x,*y,*surface], 1),
                super::inspect::Check::Branch {x,y,z,..} => ([*x,*y,*z], 2),
            };
            if report.broken.iter().any(|p| (0..3).all(|i| (place[i]-p[i]).abs()<1e-6)) { types[kind]+=1; }
        }
        println!("Nicht durchgehend, Prüfpunktarten Pfeiler/Spitze/Ast: {types:?}");
        for point in report.branch_gaps.iter().take(5) {
            let mut nearest_support = (f64::INFINITY, String::new(), 0.0f64, 0u8);
            let mut nearest_model = (f64::INFINITY, String::new(), 0.0f64, 0u8);
            let mut radius = 0.0;
            let mut tolerance = 0.0;
            for check in &prepared.checks {
                if let super::inspect::Check::Branch{x,y,z,r,layer} = check {
                    if (x-point[0]).abs()<1e-6 && (y-point[1]).abs()<1e-6 && (z-point[2]).abs()<1e-6 { radius=*r; tolerance=1.6*layer; break; }
                }
            }
            for i in 0..preview.count() {
                let z = f64::from(preview.to[i*3+2]);
                if (z-point[2]).abs()>tolerance { continue; }
                let a = [f64::from(preview.from[i*3]), f64::from(preview.from[i*3+1])];
                let b = [f64::from(preview.to[i*3]), f64::from(preview.to[i*3+1])];
                let dx=b[0]-a[0]; let dy=b[1]-a[1]; let squared=dx*dx+dy*dy;
                let t=if squared>0.0 { (((point[0]-a[0])*dx+(point[1]-a[1])*dy)/squared).clamp(0.0,1.0) } else { 0.0 };
                let distance=(point[0]-a[0]-dx*t).hypot(point[1]-a[1]-dy*t);
                let role=&preview.roles[preview.role[i] as usize];
                let slot=if role.starts_with("Support material") { &mut nearest_support } else { &mut nearest_model };
                if distance<slot.0 { *slot=(distance,role.clone(),z,preview.support_origin[i]); }
            }
            println!("ASTPROBE {point:?}, radius={radius:.3}, z_toleranz={tolerance:.3}, nearest_support={nearest_support:?}, nearest_other={nearest_model:?}, closed_support_loops={:?}", enclosing_support_loops(&preview, point, tolerance));
        }
        if let Ok(other_path) = std::env::var("SIMPLIY_DIAG_COMPARE") {
            let other = read_preview(&other_path);
            let other_report = super::inspect::inspect(&other, &prepared.checks);
            println!("Vergleichs-G-Code: {} Gesamt-Prüfstellen, {} Pfeiler, {} Ast-Prüfstellen, {} schwebende Inseln", other_report.broken.len(), other_report.pillar_breaks.len(), other_report.branch_gaps.len(), other_report.floating.len());
            let key = |p: &[f64; 3]| p.map(|v| (v * 1000.0).round() as i64);
            let a: std::collections::BTreeSet<_> = report.broken.iter().map(key).collect();
            let b: std::collections::BTreeSet<_> = other_report.broken.iter().map(key).collect();
            println!("Nur erster G-Code: {:?}; nur Vergleichs-G-Code: {:?}", a.difference(&b).collect::<Vec<_>>(), b.difference(&a).collect::<Vec<_>>());
            for target in a.difference(&b).take(2) {
                if let Some(check) = prepared.checks.iter().find(|c| match c {
                    super::inspect::Check::Pillar{x,y,surface,..} => key(&[*x,*y,*surface]) == *target,
                    _ => false,
                }) {
                    println!("Abweichender Punkt {target:?}, erster G-Code:");
                    super::inspect::diagnose_pillar(&preview, check);
                    println!("Abweichender Punkt {target:?}, Vergleichs-G-Code:");
                    super::inspect::diagnose_pillar(&other, check);
                }
            }
        }
        if let Ok(output) = std::env::var("SIMPLIY_DIAG_REPORT") {
            std::fs::write(output, serde_json::to_vec(&serde_json::json!({"broken": report.broken, "missing": report.missing, "weak": report.weak, "floating": report.floating})).unwrap()).unwrap();
        }
        println!("Diagnose: {}", report.summary());
        println!("Erste gebrochene Punkte: {:?}; schwebend: {:?}", &report.broken[..report.broken.len().min(8)], report.floating);
        if let Some(input) = support_input {
            let bed = Bed { min_x: 0., max_x: 250., min_y: 0., max_y: 210. };
            let item = Item::new(input, Arc::clone(&mesh), bed).unwrap();
            let plans = plan::plate(&[item]).unwrap();
            for point in report.floating.iter().chain(report.branch_gaps.iter().take(3)) {
                for plan in plans.iter() {
                    for (kind, boxes) in [("solids", &plan.solids), ("pads", &plan.pads), ("strips", &plan.strips), ("lines", &plan.lines)] {
                        let hits: Vec<_> = boxes.iter().filter(|b| point[0]>=b[0]-0.8 && point[0]<=b[3]+0.8 && point[1]>=b[1]-0.8 && point[1]<=b[4]+0.8 && point[2]>=b[2]-0.5 && point[2]<=b[5]+0.5).take(12).collect();
                        if !hits.is_empty() { println!("Geometrie {kind} um {point:?}: {hits:?}"); }
                    }
                    let mut hits = Vec::new();
                    for branch in &plan.branches { for segment in branch.windows(2) {
                        let (a,b) = (segment[0],segment[1]);
                        if point[2]>=a[2].min(b[2])-0.5 && point[2]<=a[2].max(b[2])+0.5 && point[0]>=a[0].min(b[0])-a[3].max(b[3])-0.8 && point[0]<=a[0].max(b[0])+a[3].max(b[3])+0.8 && point[1]>=a[1].min(b[1])-a[3].max(b[3])-0.8 && point[1]<=a[1].max(b[1])+a[3].max(b[3])+0.8 { hits.push((a,b)); }
                    }}
                    println!("Geometrie Aeste um {point:?}: {} Treffer, Beispiele {:?}", hits.len(), &hits[..hits.len().min(5)]);
                }
            }
        }
        for point in report.broken.iter().take(3) {
            for check in &prepared.checks {
                let place = match check {
                    super::inspect::Check::Pillar {x,y,surface,..} | super::inspect::Check::Tip {x,y,surface,..} => [*x,*y,*surface],
                    super::inspect::Check::Branch {x,y,z,..} => [*x,*y,*z],
                };
                if (0..3).all(|i| (place[i] - point[i]).abs() < 0.001) {
                    match check {
                        super::inspect::Check::Pillar {x,y,low,high,bottom,gap,bottom_gap,spacing,layer,branched,..} => println!("Pfeiler x={x:.2} y={y:.2} low={low:.3} high={high:.3} bottom={bottom:.3} gap={gap} bottom_gap={bottom_gap} width={spacing} layer={layer} branched={branched}"),
                        super::inspect::Check::Branch {x,y,z,r,layer} => println!("Ast x={x:.2} y={y:.2} z={z:.3} radius={r:.3} layer={layer}"),
                        super::inspect::Check::Tip {x,y,z,r,layer,..} => println!("Spitze x={x:.2} y={y:.2} z={z:.3} radius={r:.3} layer={layer}"),
                    }
                    super::inspect::diagnose_pillar(&preview, check);
                }
            }
            let mut samples = Vec::new();
            for i in 0..preview.count() {
                let x = f64::from(preview.to[i*3]); let y = f64::from(preview.to[i*3+1]); let z = f64::from(preview.to[i*3+2]);
                if (x-point[0]).abs() <= 1.5 && (y-point[1]).abs() <= 1.5 && z <= point[2] + 1.0 {
                    let role = &preview.roles[preview.role[i] as usize];
                    if role.contains("Support") || role.contains("infill") || role.contains("perimeter") {
                        samples.push(((z*10.0).round() as i64, role.clone(), preview.support_origin[i]));
                    }
                }
            }
            samples.sort(); samples.dedup();
            println!("Nahe G-Code-Endpunkte um {:?}: {} Schicht/Rollen-Kombinationen", point, samples.len());
        }
        for point in &report.floating {
            let mut nearby = Vec::new();
            for i in 0..preview.count() {
                let x = f64::from(preview.to[i*3]); let y = f64::from(preview.to[i*3+1]); let z = f64::from(preview.to[i*3+2]);
                if (x-point[0]).abs() <= 2.0 && (y-point[1]).abs() <= 2.0 && (z-point[2]).abs() <= 0.8 {
                    let role = &preview.roles[preview.role[i] as usize];
                    nearby.push(((z*100.0).round() as i64, role.clone(), preview.support_origin[i]));
                }
            }
            nearby.sort(); nearby.dedup();
            println!("Schwebend {:?}: nahe G-Code-Hoehen, Rollen, Ursprung {:?}", point, nearby);
        }
        return;
    }
    let now = Instant::now();
    let result = tauri::async_runtime::block_on(crate::slice_preview(engine, job)).expect("Echter Engine-Slice der Leistungsszene");
    println!("Engine-Slice {:.3} s, Stützenbericht: {}", now.elapsed().as_secs_f64(), result["supportInfo"]);
    let output = result["output"].as_str().expect("G-Code fehlt");
    let text = std::fs::read_to_string(output).unwrap();
    assert!(text.contains(";TYPE:Support material"), "Keine Stützbahnen im G-Code");
    if let Ok(target) = std::env::var("SIMPLIY_BENCH_GCODE") { std::fs::copy(output, target).unwrap(); }
    let warning = result["supportInfo"]["warning"].as_str().unwrap_or("");
    assert!(warning.is_empty(), "Stützenprüfung meldet Probleme: {warning}");
}
