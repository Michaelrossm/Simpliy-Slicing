use super::{edit, generate, input::Item, job, test_support::box_mesh, types::Settings};
use crate::{mesh::Mesh, project};
use serde_json::{json, Value};
use std::sync::Arc;

fn table() -> Arc<Mesh> {
    let (v, i) = box_mesh(&[[4., 4., 10., 0., 0., 5.], [20., 20., 2., 0., 0., 11.]]);
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
