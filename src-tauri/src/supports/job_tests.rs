use super::{edit, generate, input::Item, job, test_support::box_mesh, types::Settings};
use crate::{mesh::Mesh, project};
use serde_json::{json, Value};
use std::sync::Arc;

fn table() -> Arc<Mesh> {
    table_width(20.)
}

fn table_width(width: f64) -> Arc<Mesh> {
    let (v, i) = box_mesh(&[[4., 4., 10., 0., 0., 5.], [width, 20., 2., 0., 0., 11.]]);
    Arc::new(Mesh {
        vertices: v.chunks_exact(3).map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect(),
        triangles: i.chunks_exact(3).map(|t| [t[0], t[1], t[2]]).collect(),
    })
}

fn support(x: f64, landing: &str, style: &str) -> Value {
    json!({"id": format!("p{x}"), "x": x, "y": 100.0, "bottomZ": 0.0, "topZ": 9.8, "surfaceZ": 10.0, "landing": landing, "style": style})
}

fn model(id: &str, x: f64, supports: Vec<Value>, settings: Value) -> Value {
    json!({
        "id": id, "path": "x", "signature": id, "rows": [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]], "offset": [x, 100., 0.],
        "stored": {"schema": 1, "signature": id, "settings": settings, "automatic": supports, "manual": []},
        "resolved": {
            "layer_height": 0.15, "support_material": "enforcers_only", "support_material_style": "grid",
            "support_material_contact_distance": 0.1, "support_material_interface_layers": 0,
        },
    })
}

fn expand(plate: Vec<Value>) -> (project::Job, job::Prepared) {
    let models: Vec<Value> = plate
        .iter()
        .map(|m| json!({"id": m["id"], "path": "x", "name": m["id"], "matrix": [1., 0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0.], "signature": null}))
        .collect();
    let mut job: project::Job = serde_json::from_value(json!({
        "config": {"configuration": {"print_settings": {"gcode_label_objects": "disabled", "complete_objects": false}}},
        "models": models,
        "supportPlate": {"bed": {"minX": 0., "maxX": 200., "minY": 0., "maxY": 200.}, "models": plate},
    }))
    .unwrap();
    let mesh = table();
    let made = job::expand(&mut job, &|_: &str| Ok(mesh.clone())).unwrap();
    (job, made)
}

#[test]
fn pruning_one_fan_contact_keeps_the_shared_stem_and_remaining_arm() {
    let mesh = table();
    let bed = super::Bed { min_x: 0., max_x: 220., min_y: 0., max_y: 220. };
    let make = |supports| {
        let input = serde_json::from_value(model("local-fan-delete", 100., supports, json!({}))).unwrap();
        Item::new(input, mesh.clone(), bed).unwrap()
    };
    let a = support(106., "bed", "fan");
    let b = support(108., "bed", "fan");
    let before = super::plan::plate(&[make(vec![a.clone(), b.clone()])]).unwrap();
    assert_eq!(before[0].groups.len(), 1);
    assert_eq!(before[0].groups[0].contacts.len(), 2);
    assert!(before[0].segment_contacts.iter().any(|ids| ids.len() == 2));
    let keep = before[0].branches.iter().zip(&before[0].segment_contacts)
        .filter(|(_, ids)| ids.iter().any(|id| Some(id.as_str()) == b["id"].as_str()))
        .map(|(branch, _)| branch.clone()).collect::<Vec<_>>();
    assert!(keep.len() < before[0].branches.len());
    let edited = super::plan::plate(&[make(vec![b])]).unwrap();
    assert_eq!(edited[0].branches, keep);
    assert_eq!(edited[0].routes.len(), 1);
    assert_eq!(edited[0].groups[0].contacts.len(), 1);
}

#[test]
#[ignore = "requires local Prusa engine and support job settings"]
fn pruned_shared_fan_real_engine() {
    let engine = std::env::var("SIMPLIY_TEST_ENGINE").unwrap();
    let template = std::env::var("SIMPLIY_TEST_SUPPORT_JOB").unwrap();
    let mut job: project::Job = serde_json::from_slice(&std::fs::read(template).unwrap()).unwrap();
    let source = table_width(80.);
    let stl = super::meshes::Triangles {
        vertices: source.vertices.iter().flatten().copied().collect(),
        indices: source.triangles.iter().flatten().copied().collect(),
    };
    let path = std::env::temp_dir().join(format!("simpliy-pruned-fan-{}.stl", std::process::id()));
    std::fs::write(&path, stl.to_stl()).unwrap();
    let path = path.to_string_lossy().into_owned();
    let mesh = crate::engine::Engine::open(&engine).unwrap().cached_mesh(&path).unwrap();
    let bed = super::Bed { min_x: 0., max_x: 250., min_y: 0., max_y: 210. };
    let mut input: super::ModelInput = serde_json::from_value(model("pruned-fan-engine", 100.,
        vec![support(104., "bed", "fan"), support(108., "bed", "fan"),
            support(126., "bed", "fan"), support(130., "bed", "fan")], json!({}))).unwrap();
    input.path = path.clone();
    input.resolved.insert("layer_height".into(), json!(0.2));
    input.resolved.insert("first_layer_height".into(), job.config["configuration"]["print_settings"]["first_layer_height"].clone());
    input.resolved.insert("support_material_contact_distance".into(), json!(0.2));
    job.config["configuration"]["print_settings"]["layer_height"] = json!(0.2);
    let before = super::plan::plate(&[Item::new(input.clone(), mesh.clone(), bed).unwrap()]).unwrap();
    assert_eq!(before[0].groups.len(), 2);
    assert_eq!(before[0].groups[0].contacts.len(), 2);
    let start = std::time::Instant::now();
    input.stored["automatic"].as_array_mut().unwrap().remove(0);
    let after = super::plan::plate(&[Item::new(input.clone(), mesh.clone(), bed).unwrap()]).unwrap();
    assert_eq!(after[0].routes.len(), 3);
    assert_eq!(after[0].groups.len(), 2);
    let old_far = before[0].group_index.by_contact("p130").unwrap();
    let new_far = after[0].group_index.by_contact("p130").unwrap();
    assert_eq!(before[0].branches[before[0].groups[old_far].branches.clone()],
        after[0].branches[after[0].groups[new_far].branches.clone()]);
    assert!(!after[0].branches.is_empty() && after[0].branches.len() < before[0].branches.len());
    assert!(after[0].branches.iter().all(|branch| before[0].branches.contains(branch)));
    println!("Lokaler Astschnitt: {:.3} ms", start.elapsed().as_secs_f64() * 1000.0);
    if let Some(style) = std::env::var_os("SIMPLIY_PRUNED_FAN_EDIT_STYLE") {
        let style = style.to_str().unwrap();
        let start = std::time::Instant::now();
        input.stored["manual"].as_array_mut().unwrap().push(support(70., "bed", style));
        let added = super::plan::plate(&[Item::new(input.clone(), mesh.clone(), bed).unwrap()]).unwrap();
        assert!(added[0].branches.starts_with(&after[0].branches));
        assert_eq!(added[0].routes.len() + added[0].native.len(), 4);
        println!("Lokales Hinzufügen: {:.3} ms", start.elapsed().as_secs_f64() * 1000.0);
        let start = std::time::Instant::now();
        input.stored["manual"][0] = support(76., "bed", style);
        let moved = super::plan::plate(&[Item::new(input.clone(), mesh, bed).unwrap()]).unwrap();
        assert!(moved[0].branches.starts_with(&after[0].branches));
        assert_eq!(moved[0].routes.len() + moved[0].native.len(), 4);
        println!("Lokales Verschieben: {:.3} ms", start.elapsed().as_secs_f64() * 1000.0);
    }
    job.models.truncate(1);
    let target = &mut job.models[0];
    target.id = Some(input.id.clone());
    target.path = path.clone();
    target.inline = None;
    target.signature = None;
    target.volumes.clear();
    target.matrix = [1., 0., 0., 0., 1., 0., 0., 0., 1., 100., 100., 0.];
    job.support_plate = Some(super::Plate { bed, models: vec![input], tools: 1, marks: None });
    let result = tauri::async_runtime::block_on(crate::slice_preview(engine, job)).unwrap();
    println!("Lokal geschnittener Fächer: {}", result["supportInfo"]);
    assert!(std::fs::read_to_string(result["output"].as_str().unwrap()).unwrap().contains(";TYPE:Support material"));
    assert_eq!(result["supportInfo"]["warning"].as_str().unwrap_or(""), "");
}

#[test]
fn a_new_fan_contact_near_an_existing_arm_uses_the_group_planner() {
    let mesh = table_width(80.);
    let bed = super::Bed { min_x: 0., max_x: 220., min_y: 0., max_y: 220. };
    let make = |supports| {
        let input = serde_json::from_value(model("local-fan-neighbour", 100., supports, json!({}))).unwrap();
        Item::new(input, mesh.clone(), bed).unwrap()
    };
    let first = support(108., "bed", "fan");
    let start = super::plan::plate(&[make(vec![first.clone()])]).unwrap();
    assert_eq!(start[0].groups.len(), 1);
    let joined = super::plan::plate(&[make(vec![first, support(106., "bed", "fan")])]).unwrap();
    assert_eq!(joined[0].groups.len(), 1);
    assert_eq!(joined[0].groups[0].contacts.len(), 2);
    assert!(joined[0].segment_contacts.iter().any(|ids| ids.len() == 2));
}

#[test]
fn adding_and_moving_a_distant_native_contact_keeps_owned_geometry() {
    let mesh = table_width(80.);
    let bed = super::Bed { min_x: 0., max_x: 220., min_y: 0., max_y: 220. };
    let make = |supports| {
        let input = serde_json::from_value(model("local-native-move", 100., supports, json!({}))).unwrap();
        Item::new(input, mesh.clone(), bed).unwrap()
    };
    let tree = support(108., "bed", "tree");
    let baseline = super::plan::plate(&[make(vec![tree.clone()])]).unwrap();
    assert!(!baseline[0].branches.is_empty());
    let added = super::plan::plate(&[make(vec![tree.clone(), support(130., "bed", "pillar")])]).unwrap();
    assert!(baseline[0].shares_geometry(&added[0]));
    let moved = super::plan::plate(&[make(vec![tree.clone(), support(126., "bed", "pillar")])]).unwrap();
    assert!(added[0].shares_geometry(&moved[0]));
    assert_eq!(moved[0].native.len(), 1);
    assert_eq!(moved[0].native[0].x, 126.);
    let conflict = super::plan::plate(&[make(vec![tree, support(108., "bed", "pillar")])]).unwrap();
    assert!(!moved[0].shares_geometry(&conflict[0]));
}

#[test]
fn removing_native_enforcer_keeps_owned_branches_by_reference() {
    let mesh = table();
    let bed = super::Bed { min_x: 0., max_x: 220., min_y: 0., max_y: 220. };
    let tree = support(108., "bed", "tree");
    let pillar = support(180., "bed", "pillar");
    let make = |supports| {
        let input = serde_json::from_value(model("local-native-delete", 100., supports, json!({}))).unwrap();
        Item::new(input, mesh.clone(), bed).unwrap()
    };
    let before = super::plan::plate(&[make(vec![tree.clone(), pillar])]).unwrap();
    assert!(!before[0].branches.is_empty());
    assert_eq!(before[0].native.len(), 1);
    let edited = super::plan::plate(&[make(vec![tree])]).unwrap();
    assert!(before[0].shares_geometry(&edited[0]));
    assert_eq!(before[0].geometry_revision, edited[0].geometry_revision);
    assert!(edited[0].native.is_empty());
    let optimized = super::plan::plate_with_strategy(&[make(vec![support(108., "bed", "tree")])], true).unwrap();
    assert!(!edited[0].shares_geometry(&optimized[0]));
    let cached = super::plan::plate(&[make(vec![support(108., "bed", "tree")])]).unwrap();
    assert!(cached[0].shares_geometry(&optimized[0]));
    let empty = super::plan::plate(&[make(vec![])]).unwrap();
    assert!(!edited[0].shares_geometry(&empty[0]));
    assert!(empty[0].branches.is_empty());
}

#[test]
fn deleting_a_pillar_sends_only_its_changed_viewport_group() {
    let mesh = table();
    let bed = json!({"minX": 0., "maxX": 200., "minY": 0., "maxY": 200.});
    let make = |supports, known| {
        let plate = serde_json::from_value(json!({"bed": bed, "models": [
            model("pillar-delta-test", 100., supports, json!({}))
        ]})).unwrap();
        let bytes = super::view_inner(plate, &known, &Default::default(), false, &|_: &str| Ok(mesh.clone())).unwrap();
        let size = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
        let head: Value = serde_json::from_slice(&bytes[4..4 + size]).unwrap();
        (head, bytes.len())
    };
    let a = support(101., "bed", "pillar");
    let b = support(102., "bed", "pillar");
    let far = support(180., "bed", "pillar");
    let (first, first_size) = make(vec![a, b.clone(), far.clone()], Default::default());
    let groups = first["meta"]["models"][0]["pillarGroups"].as_array().unwrap();
    let known = groups.iter().map(|group| (
        group["id"].as_str().unwrap().to_owned(), group["revision"].as_u64().unwrap(),
    )).collect();
    let (edited, edited_size) = make(vec![b, far], known);
    assert_eq!(first["meta"]["transferredPillars"], 3);
    assert_eq!(edited["meta"]["transferredPillars"], 1);
    let updated = edited["meta"]["models"][0]["pillarGroups"].as_array().unwrap();
    assert_eq!(groups[1], updated[1], "entfernte Gruppe behält ihre Revision");
    assert_ne!(groups[0]["revision"], updated[0]["revision"]);
    assert!(edited_size < first_size);
}

#[test]
fn pillars_reach_prusa_as_enforcers_never_as_bodies() {
    for landing in ["bed", "model"] {
        let (job, made) = expand(vec![model("a", 100., vec![support(108., landing, "pillar")], json!({}))]);
        assert!(made.problems.is_empty());
        assert_eq!((job.models.len(), made.checks.len()), (1, 1));
        assert!(matches!(job.models[0].volumes[0].kind, project::VolumeKind::SupportEnforcer));
        let settings = &job.models[0].settings;
        assert_eq!(settings["support_material"], "enforcers_only");
        assert_eq!(settings["support_material_style"], "snug");
        assert_eq!(settings["support_material_threshold"], 89);
        assert_eq!(settings["support_material_interface_layers"], 2);
    }
}

#[test]
fn automatic_process_supports_and_process_style_are_kept() {
    let mut own = model("a", 100., vec![support(108., "bed", "pillar")], json!({"build": "process"}));
    own["resolved"]["support_material"] = json!("everywhere");
    let (job, made) = expand(vec![own]);
    let settings = &job.models[0].settings;
    assert_eq!(settings["support_material"], "everywhere");
    assert_eq!(settings["support_material_style"], "grid");
    assert!(!settings.contains_key("support_material_threshold"));
    assert_eq!(made.notes.len(), 1);
}

#[test]
fn several_models_share_a_plate_and_styles_mix() {
    let first = model("a", 100., vec![support(108., "bed", "pillar"), support(92., "bed", "tree")], json!({}));
    let second = model("b", 40., vec![support(48., "bed", "pillar")], json!({}));
    let (job, made) = expand(vec![first, second]);
    assert!(made.problems.is_empty());
    assert_eq!(job.models.len(), 3);
    assert!(job.models[2].name.starts_with("Simpliy-Stuetze a"));
    assert_eq!(job.models[2].settings["perimeters"], 1);
    assert_eq!(job.config["configuration"]["print_settings"]["gcode_label_objects"], "octoprint");
}

#[test]
fn touching_pillars_get_separate_volumes() {
    let supports = vec![support(104., "bed", "pillar"), support(108., "bed", "pillar")];
    assert_eq!(expand(vec![model("a", 100., supports, json!({}))]).0.models[0].volumes.len(), 2);
}

#[test]
fn enforcers_follow_a_mirrored_model() {
    let mut own = model("a", 100., vec![support(108., "bed", "pillar")], json!({}));
    own["rows"][0][0] = json!(-1.);
    let (job, _) = expand(vec![own]);
    let volume = &job.models[0].volumes[0];
    assert!(volume.vertices.iter().all(|v| v[0] < -5.0 && v[0] > -11.0));
    let signed: f32 = volume
        .triangles
        .iter()
        .map(|t| {
            let [a, b, c] = t.map(|i| volume.vertices[i as usize]);
            a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
        })
        .sum();
    assert!(signed > 0.0);
}

#[test]
fn stale_supports_are_refused() {
    let mut own = model("a", 100., vec![support(108., "bed", "pillar")], json!({}));
    own["signature"] = json!("anders");
    assert!(expand(vec![own]).1.problems[0].contains("veraltet"));
}

#[test]
fn an_enforcer_covers_the_whole_sloped_footprint() {
    let (mut v, i) = box_mesh(&[[24., 20., 4., 0., 0., 0.]]);
    for p in v.chunks_exact_mut(3) {
        p[2] += 0.7 * p[0] + 30.0;
    }
    let world = generate::World::new(v, i);
    let settings = Settings::default();
    let made = generate::at_xy(&world, 0., 0., &settings, "m").unwrap();
    let (low, high) = generate::ceilings(&world, &[made], &settings)[0];
    assert!((low - 26.6).abs() < 1e-4 && (high - 29.4).abs() < 1e-4, "{low} {high}");
}

#[test]
fn removing_respects_the_clicked_height() {
    let mut high = support(108., "bed", "pillar");
    for (key, value) in [("id", json!("oben")), ("bottomZ", json!(20.)), ("topZ", json!(29.8)), ("surfaceZ", json!(30.))] {
        high[key] = value;
    }
    let own = model("a", 100., vec![support(108., "bed", "pillar"), high], json!({}));
    let bed = serde_json::from_value(json!({"minX": 0., "maxX": 200., "minY": 0., "maxY": 200.})).unwrap();
    let items = [Item::new(serde_json::from_value(own).unwrap(), table(), bed).unwrap()];
    let point = edit::Pick { kind: "surface".into(), xyz: [108., 100., 29.] };
    let left = edit::apply(&items, 0, edit::Op::Remove { point, area: false }).unwrap().data.unwrap().automatic;
    assert_eq!((left.len(), left[0].id.as_str()), (1, "p108"));
}

#[test]
fn automatic_with_own_branches_uses_protection_and_restores_safe_settings() {
    let mut own = model("a", 100., vec![support(108., "bed", "tree")], json!({}));
    own["resolved"]["support_material"] = json!("everywhere");
    let (mut job, made) = expand(vec![own]);
    assert!(made.problems.is_empty(), "{:?}", made.problems);
    assert!(made.has_automatic_trial());
    assert_eq!(job.models[0].settings["support_material"], "everywhere");
    assert!(job.models[0].volumes.iter().any(|v| matches!(v.kind, project::VolumeKind::SupportBlocker)));
    made.use_safe_fallback(&mut job);
    assert_eq!(job.models[0].settings["support_material"], "enforcers_only");
    assert!(!job.models[0].volumes.iter().any(|v| matches!(v.kind, project::VolumeKind::SupportBlocker)));
}

#[test]
fn weak_native_retry_only_modifies_the_temporary_job_copy() {
    let mut pillar=support(108., "model", "pillar");pillar["bottomZ"]=json!(2.0);
    let own=model("a",100.,vec![pillar],json!({}));
    let mut job: project::Job=serde_json::from_value(json!({
        "config":{},"models":[],"supportPlate":{"bed":{"minX":0.,"maxX":200.,"minY":0.,"maxY":200.},"models":[own]}
    })).unwrap();
    let original=job.clone();
    assert_eq!(job::retry_weak_as_native(&mut job,&[[108.,100.,10.]]),1);
    assert_eq!(job.support_plate.as_ref().unwrap().models[0].stored["automatic"][0]["__internal_retry_native"],true);
    assert!(original.support_plate.as_ref().unwrap().models[0].stored["automatic"][0].get("__internal_retry_native").is_none());
}

#[test]
fn deleted_automatic_supports_stay_deleted_after_recalculation() {
    let own = model("a", 100., vec![support(108., "bed", "pillar")], json!({}));
    let bed = serde_json::from_value(json!({"minX": 0., "maxX": 200., "minY": 0., "maxY": 200.})).unwrap();
    let items = [Item::new(serde_json::from_value(own).unwrap(), table(), bed).unwrap()];
    let point = edit::Pick { kind: "surface".into(), xyz: [108., 100., 9.] };
    let data = edit::apply(&items, 0, edit::Op::Remove { point, area: false }).unwrap().data.unwrap();
    assert_eq!((data.automatic.len(), data.erased.len()), (0, 1));
    // Gespeichert und wieder gelesen
    let stored = serde_json::to_value(&data).unwrap();
    assert_eq!(super::types::Data::read(&stored).erased.len(), 1);
}

/// Eigene Stützformen mit Prozesszonen (variable Schichthöhe) gegen die echte Engine.
/// Aufruf: SIMPLIY_TEST_ENGINE=<PrusaSlicer.exe> cargo test own_supports_with_zones_real_engine -- --ignored --nocapture
#[test]
#[ignore]
fn own_supports_with_zones_real_engine() {
    use crate::engine::{neutral_printer, Engine};
    let engine = Engine::open(&std::env::var("SIMPLIY_TEST_ENGINE").expect("Pfad zur PrusaSlicer-3.x-EXE fehlt")).unwrap();
    let mesh = table();
    let inline = json!({
        "vertices": mesh.vertices.iter().map(|v| json!([v[0], v[1], v[2]])).collect::<Vec<_>>(),
        "triangles": mesh.triangles.iter().map(|t| json!([t[0], t[1], t[2]])).collect::<Vec<_>>(),
    });
    let mut report = Vec::new();
    for (near, (from, to)) in [(false, (3.0f64, 7.0f64)), (true, (8.0, 12.0))] {
    for style in ["pillar", "mini", "tree", "fan", "gusset"] {
        let mut gaps = Vec::new();
        for zone in [false, true] {
            let preset = json!({"printer": neutral_printer(1), "print": "Simpliy", "tool": "Simpliy", "filament": "Simpliy"});
            let mut config = engine.base_config(&preset).unwrap();
            config["configuration"]["printer_settings"]["binary_gcode"] = json!(false);
            for (key, value) in [("layer_height", json!(0.2)), ("support_material", json!("none"))] {
                config["configuration"]["print_settings"][key] = value;
            }
            let ranges = if zone { json!([{"from": from, "to": to, "height": 0.1, "settings": {"perimeters": 3}}]) } else { json!([]) };
            let mut own = model("a", 100., vec![support(108., "bed", style)], json!({}));
            own["resolved"]["layer_height"] = json!(0.2);
            if zone {
                own["rangeHeights"] = json!([0.1]);
                own["rangeSpans"] = json!([[from, to, 0.1]]);
            }
            let mut job: project::Job = serde_json::from_value(json!({
                "config": config,
                "models": [{"id": "a", "path": "x", "inline": inline, "name": "a", "matrix": [1., 0., 0., 0., 1., 0., 0., 0., 1., 100., 100., 0.], "signature": null, "ranges": ranges}],
                "supportPlate": {"bed": {"minX": 0., "maxX": 200., "minY": 0., "maxY": 200.}, "models": [own]},
            }))
            .unwrap();
            let shared = mesh.clone();
            let made = job::expand(&mut job, &|_: &str| Ok(shared.clone())).unwrap_or_else(|e| panic!("{style}: {e}"));
            assert!(made.problems.is_empty(), "{style}: {:?}", made.problems);
            made.use_safe_fallback(&mut job);
            let dir = std::env::temp_dir().join(crate::uid("own-support-test"));
            std::fs::create_dir_all(&dir).unwrap();
            let output = dir.join("own-support.gcode");
            engine.slice(&job, &output).unwrap_or_else(|e| panic!("{style} (Zone {zone}): {e}"));
            let text = std::fs::read_to_string(&output).unwrap();
            let _ = std::fs::remove_dir_all(&dir);
            // Extrusionen im Stützfuß (x 105,5..110,5, y 97,5..102,5) je Schicht
            let (mut z, mut x, mut y, mut last_e) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
            let relative = text.lines().any(|l| l.trim() == "M83");
            let mut layers = std::collections::BTreeSet::new();
            let mut fine = false;
            for line in text.lines() {
                if let Some(v) = line.strip_prefix(";Z:") { z = v.trim().parse().unwrap_or(z); }
                if let Some(v) = line.strip_prefix(";HEIGHT:") { if (v.trim().parse::<f64>().unwrap_or(0.2) - 0.1).abs() < 0.006 { fine = true; } }
                if !line.starts_with("G1") { continue; }
                let mut e = None;
                for w in line.split_whitespace() {
                    if let Some(v) = w.strip_prefix('X') { x = v.parse().unwrap_or(x); }
                    if let Some(v) = w.strip_prefix('Y') { y = v.parse().unwrap_or(y); }
                    if let Some(v) = w.strip_prefix('E') { e = v.parse::<f64>().ok(); }
                }
                let Some(e) = e else { continue };
                let extruded = if relative { e > 0.0 } else { let d = e - last_e; last_e = e; d > 0.0 };
                if extruded && (105.5..110.5).contains(&x) && (97.5..102.5).contains(&y) && z <= 9.9 {
                    layers.insert((z * 1000.0).round() as i64);
                }
            }
            let list: Vec<f64> = layers.iter().map(|l| *l as f64 / 1000.0).collect();
            let covered_to = list.last().copied().unwrap_or(0.0);
            let max_gap = list.windows(2).map(|w| w[1] - w[0]).fold(0.0f64, f64::max);
            assert!(!list.is_empty(), "{style} (Zone {zone}): keine Stützbahnen am Fuß gefunden");
            if zone { assert!(fine, "{style}: keine feinen Zonenschichten"); }
            let _ = near;
            gaps.push((zone, list.len(), covered_to, max_gap));
        }
        report.push(format!("{style} (Zone {from}-{to} mm, {}): ohne Zone {:?}, mit Zone {:?}", if near { "nahe am Kontakt" } else { "fern vom Kontakt" }, gaps[0], gaps[1]));
        // Die Zone darf Stützen weder unterbrechen noch verkürzen
        assert!(gaps[1].3 <= gaps[0].3 + 0.31, "{style}: Lücke mit Zone {:.3} mm gegen {:.3} mm ohne Zone", gaps[1].3, gaps[0].3);
        // Weit weg vom Kontakt muss der Kontaktabstand unverändert bleiben (lokale Schichthöhe statt pauschaler Reserve)
        let tolerance = if near { 0.31 } else { 0.05 };
        assert!(gaps[1].2 >= gaps[0].2 - tolerance, "{style} ({from}-{to}): Stütze endet mit Zone bei {:.3} statt {:.3}", gaps[1].2, gaps[0].2);
    }
    }
    println!("EIGENE STÜTZEN (Schichten, höchste Schicht, größte Lücke):\n{}", report.join("\n"));
}
