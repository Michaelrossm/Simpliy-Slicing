use super::{
    context::{Bed, Context, Env, Point},
    field::{Solid, SolidField},
    generate,
    input::{aligned, Item, ModelInput},
    shapes::{route_supports, Routed},
    test_support::{box_mesh, boxes},
    types::{Settings, Support},
};
use serde_json::json;

const BED: Bed = Bed { min_x: 0.0, max_x: 100.0, min_y: 0.0, max_y: 100.0 };

fn env() -> Env {
    Env { layer: 0.2, first_layer: 0.2, variable: false, gap: 0.2, bottom_gap: 0.2, xy_gap: 0.3, line_width: 0.45, interfaces: 2.0, spacing: 0.2, contact_gap: 2.5, angle: 0.0, grid: false, loops: false, bottom_layers: 0.0, bottom_pitch: 0.65, raft: false }
}

fn contact(style: &str, z: f64) -> Support {
    serde_json::from_value(json!({"id": "a", "x": 50.0, "y": 50.0, "bottomZ": 0.0, "topZ": z - 0.2, "surfaceZ": z, "style": style})).unwrap()
}

fn route(solid: &[[f64; 6]], contacts: &[Support], bed_only: bool) -> Routed {
    let (vertices, indices) = box_mesh(solid);
    let field = SolidField::new(&[Solid { vertices: &vertices, indices: &indices }]);
    route_supports(&Context::new(&field, env(), BED, bed_only), contacts)
}

fn straight(routed: &Routed) {
    for p in routed.branches.iter().flatten() {
        assert!((p[0] - 50.0).hypot(p[1] - 50.0) < 1e-6, "{p:?}");
    }
}

fn bends(branch: &[Point]) -> usize {
    let mut before: Option<[f64; 3]> = None;
    let mut count = 0;
    for pair in branch.windows(2) {
        let d = [0, 1, 2].map(|k| pair[1][k] - pair[0][k]);
        let length = crate::util::hypot3(d[0], d[1], d[2]);
        if length < 0.05 {
            continue;
        }
        let d = d.map(|v| v / length);
        if before.is_some_and(|b| b[0] * d[0] + b[1] * d[1] + b[2] * d[2] < 0.985) {
            count += 1;
        }
        before = Some(d);
    }
    count
}

#[test]
fn the_field_sees_walls_floors_and_free_bands() {
    let (vertices, indices) = box_mesh(&[[10.0, 10.0, 10.0, 50.0, 50.0, 15.0]]);
    let field = SolidField::new(&[Solid { vertices: &vertices, indices: &indices }]);
    assert!(field.free(50.0, 50.0, 1.0, 1.0, 9.9));
    assert!(!field.free(50.0, 50.0, 1.0, 1.0, 10.1));
    assert!(!field.free(50.0, 50.0, 1.0, 14.0, 16.0));
    assert!(field.free(56.0, 50.0, 0.9, 12.0, 14.0));
    assert!(!field.free(56.0, 50.0, 1.1, 12.0, 14.0));
    assert_eq!(field.floor_below(50.0, 50.0, 30.0), 20.0);
}

#[test]
fn every_shape_reaches_its_contacts_below_the_gap() {
    let table = [[24.0, 20.0, 3.0, 50.0, 50.0, 21.5], [4.0, 20.0, 20.0, 40.0, 50.0, 10.0]];
    for style in ["tree", "fan", "gusset"] {
        let settings = Settings { style: style.into(), ..Settings::default() };
        let contacts: Vec<Support> =
            generate::automatic(&boxes(&table), &settings, None).supports.into_iter().filter(|p| p.x > 45.0).collect();
        assert!(contacts.len() > 5);
        let routed = route(&table, &contacts, false);
        assert!(routed.routes.iter().all(|r| r.ok), "{style}");
        for p in routed.branches.iter().flatten() {
            assert!(p[2] <= 19.8 + 1e-6 && p[2] >= -1e-6, "{style} {p:?}");
            assert!(style == "gusset" || p[0] - p[3] >= 42.0 - 1e-3, "{style} {p:?}");
        }
    }
}

#[test]
fn a_free_overhang_gets_a_straight_column_also_instead_of_a_gusset() {
    let routed = route(&[[30.0, 30.0, 3.0, 50.0, 50.0, 41.5]], &[contact("gusset", 40.0)], false);
    assert!(routed.routes[0].ok && routed.routes[0].as_tree);
    straight(&routed);
}

#[test]
fn above_a_ledge_the_column_lands_straight_on_it() {
    let solid = [[30.0, 30.0, 10.0, 50.0, 50.0, 5.0], [10.0, 10.0, 3.0, 50.0, 50.0, 31.5]];
    let routed = route(&solid, &[contact("tree", 30.0)], false);
    assert!(routed.routes[0].ok && routed.routes[0].floor > 9.9);
    straight(&routed);
}

#[test]
fn around_an_obstacle_there_is_one_bend_at_most() {
    let solid = [[8.0, 8.0, 10.0, 50.0, 50.0, 15.0], [10.0, 10.0, 3.0, 50.0, 50.0, 51.5]];
    let routed = route(&solid, &[contact("tree", 50.0)], true);
    assert!(routed.routes[0].ok);
    assert!(routed.branches.iter().flatten().any(|p| p[2] < 1e-6));
    assert!(routed.branches.iter().all(|branch| bends(branch) <= 1));
}

#[test]
fn contact_follows_a_slope() {
    let (mut vertices, indices) = box_mesh(&[[24.0, 20.0, 4.0, 0.0, 0.0, 0.0]]);
    for p in vertices.chunks_exact_mut(3) {
        let (x, y, z) = (p[0], p[1], p[2]);
        p.copy_from_slice(&[x + 50.0, y + 50.0, 0.7 * x + z + 30.0]);
    }
    let field = SolidField::new(&[Solid { vertices: &vertices, indices: &indices }]);
    let routed = route_supports(&Context::new(&field, env(), BED, false), &[contact("tree", 28.0)]);
    assert!(routed.routes[0].ok && routed.routes[0].samples.len() > 2);
    for [x, _, z] in &routed.routes[0].samples {
        let gap = 28.0 + (x - 50.0) * 0.7 - z;
        assert!((0.15..1.25).contains(&gap), "{x} {z} {gap}");
    }
    let highest = routed.dense.iter().chain(&routed.strips).fold(0.0, |top: f64, block| top.max(block[5]));
    assert!(highest > 28.2, "uphill must rise above the tip");
}

#[test]
fn next_to_a_wall_a_slim_tip_steps_aside() {
    let solid = [[10.0, 30.0, 28.5, 45.0, 50.0, 14.25], [30.0, 30.0, 3.0, 55.0, 50.0, 30.0], [20.0, 30.0, 4.0, 60.0, 50.0, 2.0]];
    let mut point = contact("tree", 28.5);
    point.bottom_z = 4.0;
    point.x = 50.4;
    point.slim = true;
    let routed = route(&solid, &[point], false);
    assert!(routed.routes[0].ok);
    let top = routed.branches.iter().flatten().fold([0.0; 4], |top: Point, p| if p[2] > top[2] { *p } else { top });
    assert!(top[0] > 50.9 && top[0] < 52.3, "{top:?}");
}

#[test]
fn a_branch_over_empty_space_does_not_rest() {
    let (vertices, indices) = box_mesh(&[[20.0, 20.0, 10.0, 50.0, 50.0, 5.0]]);
    let field = SolidField::new(&[Solid { vertices: &vertices, indices: &indices }]);
    let ctx = Context::new(&field, env(), BED, false);
    let foot = |x: f64, z: f64| super::contact::resting_foot(&ctx, [x, 50.0, z, 1.5]);
    assert!(foot(50.0, 10.2).is_some());
    assert!(foot(60.8, 10.2).is_none());
    assert!(foot(50.0, 16.0).is_none());
}

#[test]
fn moving_keeps_supports_and_rotating_marks_them_stale() {
    let signature = |x: f64, row: f64| json!(["x", 42, [[row, 0, 0], [0, 1, 0], [0, 0, 1]], [x, 80, 0], []]).to_string();
    let stored = json!({"schema": 1, "signature": signature(100.0, 1.0), "automatic": [], "manual": [contact("tree", 10.0)]});
    let input = |x: f64, row: f64| ModelInput {
        id: "m".into(),
        path: "x".into(),
        signature: signature(x, row),
        rows: [[row, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        offset: [x, 80.0, 0.0],
        cut: false,
        parts: Vec::new(),
        stored: stored.clone(),
        resolved: Default::default(),
        range_heights: Vec::new(),
    };
    let moved = aligned(&input(110.0, 1.0));
    assert_eq!(moved.manual[0].x, 60.0);
    assert_eq!(moved.signature, signature(110.0, 1.0));
    let mesh = std::sync::Arc::new(crate::mesh::Mesh { vertices: Vec::new(), triangles: Vec::new() });
    assert!(!Item::new(input(110.0, 1.0), mesh.clone(), BED).unwrap().stale);
    assert!(Item::new(input(100.0, 2.0), mesh, BED).unwrap().stale);
}

#[test]
fn a_pillar_on_the_part_becomes_a_straight_column() {
    // Prusa legte die unterste Lage solcher Pfeiler auf Schraegen, eine Bahn hing dann in der Luft.
    let solid = [[30.0, 30.0, 2.0, 50.0, 50.0, 28.0], [30.0, 30.0, 2.0, 50.0, 50.0, 4.0]];
    let mut point = contact("pillar", 27.0);
    point.bottom_z = 5.0;
    point.size = Some(4.0);
    assert!(super::types::is_column(&point));
    let routed = route(&solid, &[point], false);
    assert!(routed.routes[0].ok);
    assert!(!routed.routes[0].as_tree, "zaehlt nicht als Ersatzform");
    straight(&routed);
}


#[test]
fn foot_does_not_count_cells_blocked_by_xy_clearance() {
    use super::field::PostShape;
    let (vertices, indices) = box_mesh(&[[20.0, 20.0, 10.0, 50.0, 50.0, 5.0]]);
    let mut field = SolidField::new(&[Solid { vertices: &vertices, indices: &indices }]);
    let foot = [50.0, 50.0, 11.0, 1.5];
    let mut settings = env(); settings.xy_gap = 0.5;
    assert!(super::contact::resting_foot(&Context::new(&field, settings, BED, false), foot).is_some());
    field.add_post(PostShape { x: 50.0, y: 50.0, half: 2.0, low: 10.3, high: 11.2, round: false });
    assert!(super::contact::resting_foot(&Context::new(&field, settings, BED, false), foot).is_none());
}
