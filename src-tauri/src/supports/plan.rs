//! Eine Platte, ein Plan. Ansicht und Slicing benutzen denselben, damit die Formen uebereinstimmen.
use super::{
    context::{Block, Context, Env, Point},
    field::{PostShape, Solid, SolidField},
    input::{world_of, Item},
    meshes::{boxes_mesh, branch_mesh, Triangles},
    shapes::{route_scene, route_supports, OwnedHead, RouteCache, SupportGroup},
    types::{is_body, is_column, number, Shape, Support, FALLBACK_WIDTH},
};
use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex};

const MAX_ROUNDS: usize = 16;
/// So oft duerfen gescheiterte Stuetzen zu Pfeilern werden und alles neu gesucht werden.
const MAX_GIVE_UP_ROUNDS: usize = 1;
const BRANCH_SIDES: u32 = 22;

pub fn plain(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Object(map) => plain(map.get("value")),
        Value::Array(list) => plain(list.first()),
        Value::String(text) => number(&Value::String(text.trim().trim_end_matches('%').trim().replace(',', "."))),
        other => number(other),
    }
}

pub fn is_percent(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Object(map)) => map.get("is_percent") == Some(&Value::Bool(true)),
        Some(Value::String(text)) => text.trim().ends_with('%'),
        _ => false,
    }
}

/// Prozent bezieht sich auf `whole`.
pub fn absolute(value: Option<&Value>, whole: f64) -> f64 {
    let amount = plain(value).unwrap_or(0.0);
    if is_percent(value) {
        amount * whole / 100.0
    } else {
        amount
    }
}

pub fn env_of(resolved: &Map<String, Value>, range_heights: &[Value]) -> Env {
    let get = |key: &str| resolved.get(key);
    let or = |value: f64, otherwise: f64| if value != 0.0 { value } else { otherwise };
    let layer = range_heights
        .iter()
        .map(|height| plain(Some(height)).unwrap_or(0.0))
        .fold(plain(get("layer_height")).unwrap_or(0.2).max(0.02), f64::max);
    let nozzle = or(plain(get("nozzle_diameter")).unwrap_or(0.4), 0.4);
    let general = or(absolute(get("extrusion_width"), layer), nozzle);
    let line_width = or(absolute(get("support_material_extrusion_width"), layer), general);
    let outer = or(absolute(get("external_perimeter_extrusion_width"), layer), general);
    let gap = plain(get("support_material_contact_distance")).unwrap_or(0.2).max(0.0);
    let layers = plain(get("support_material_interface_layers")).unwrap_or(0.0);
    Env {
        layer,
        first_layer: or(absolute(get("first_layer_height"), layer), layer),
        variable: !range_heights.is_empty(),
        gap,
        bottom_gap: or(plain(get("support_material_bottom_contact_distance")).unwrap_or(0.0), gap),
        xy_gap: absolute(get("support_material_xy_spacing"), outer).max(0.1),
        line_width,
        interfaces: if layers > 0.0 { layers } else { 2.0 },
        spacing: plain(get("support_material_interface_spacing")).unwrap_or(0.0).max(0.0),
        // Mit Kontaktlagen im Prozess deren Abstand, sonst der Stuetzabstand (ohne dichte Stuetzlagen).
        angle: plain(get("support_material_angle")).unwrap_or(0.0),
        grid: get("support_material_interface_pattern").and_then(Value::as_str) == Some("grid"),
        loops: get("support_material_interface_contact_loops").is_some_and(|v| v == &Value::Bool(true) || v == &serde_json::json!(1) || v == &serde_json::json!("1")),
        contact_gap: if layers > 0.0 {
            plain(get("support_material_interface_spacing")).unwrap_or(0.0).max(0.0)
        } else {
            plain(get("support_material_spacing")).unwrap_or(2.5).max(0.0)
        },
        // Wie Prusa: -1 = so viele wie oben. Abstand der unteren Kontaktbahnen = Kontaktlinienabstand.
        bottom_layers: match plain(get("support_material_bottom_interface_layers")).unwrap_or(-1.0) {
            v if v < 0.0 => layers.max(0.0),
            v => v,
        },
        bottom_pitch: line_width + plain(get("support_material_interface_spacing")).unwrap_or(0.0).max(0.0),
        raft: plain(get("raft_layers")).unwrap_or(0.0) > 0.0,
    }
}

#[derive(Clone)]
pub struct PlannedRoute {
    pub support: Support,
    pub as_tree: bool,
    pub tip: f64,
    pub samples: Vec<[f64; 3]>,
}

#[derive(Clone)]
pub struct ModelPlan {
    geometry: Arc<PlanGeometry>,
    pub geometry_revision: u64,
    pub env: Env,
    pub native: Vec<Support>,
    pub skipped: usize,
    pub fallback: usize,
    pub substituted: usize,
    pub reason: Option<&'static str>,
}

fn geometry_revision() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

impl std::ops::Deref for ModelPlan {
    type Target = PlanGeometry;
    fn deref(&self) -> &PlanGeometry { &self.geometry }
}

#[derive(Clone, Default)]
pub struct PlanGeometry {
    pub groups: Vec<SupportGroup>,
    pub segment_contacts: Vec<Arc<[String]>>,
    raw_heads: Option<RawHeads>,
    pub group_feet: Vec<Block>,
    pub group_index: GroupIndex,
    pub routes: Vec<PlannedRoute>,
    pub branches: Vec<Vec<Point>>,
    /// Äste (Netz). Quader werden nur als [x0, y0, z0, x1, y1, z1] gehalten; das Dreiecksnetz entsteht erst beim Slicen
    /// (`*_mesh`), die Anzeige zeichnet sie als Instanzen eines Einheitswürfels.
    pub body: Triangles,
    /// Massive Stammstücke (Quader), gehören zum Körper.
    pub solids: Vec<Block>,
    pub pads: Vec<Block>,
    /// Schmale Teile der Kontaktlage, voll gedruckt.
    pub strips: Vec<Block>,
    /// Kontaktbahnen der obersten Schicht (leer, wenn die oberste Schicht als Polster gedruckt wird).
    pub lines: Vec<Block>,
}

#[derive(Clone)]
struct RawHeads {
    owners: Vec<OwnedHead>,
    pads: Vec<Block>,
    strips: Vec<Block>,
}

/// Index of finished geometry. Candidate search bounds deliberately remain
/// separate from these occupied bounds.
#[derive(Clone, Default)]
pub struct GroupIndex {
    contacts: crate::util::FastMap<String, usize>,
    tiles: crate::util::FastMap<(i32, i32), Vec<usize>>,
}

impl GroupIndex {
    const TILE: f64 = 16.0;

    fn new(groups: &[SupportGroup], branches: &[Vec<Point>], feet: &[Block]) -> Self {
        let mut index = Self::default();
        for (id, group) in groups.iter().enumerate() {
            for contact in &group.contacts {
                index.contacts.insert(contact.clone(), id);
            }
            let mut tiles = crate::util::FastSet::default();
            let mut add = |min_x: f64, min_y: f64, max_x: f64, max_y: f64| {
                let tile = |v: f64| (v / Self::TILE).floor() as i32;
                for x in tile(min_x)..=tile(max_x) {
                    for y in tile(min_y)..=tile(max_y) {
                        tiles.insert((x, y));
                    }
                }
            };
            for branch in &branches[group.branches.clone()] {
                for segment in branch.windows(2) {
                    let [a, b] = [segment[0], segment[1]];
                    let radius = a[3].max(b[3]);
                    add(a[0].min(b[0]) - radius, a[1].min(b[1]) - radius,
                        a[0].max(b[0]) + radius, a[1].max(b[1]) + radius);
                }
            }
            for &[x0, y0, _, x1, y1, _] in &feet[group.feet.clone()] {
                add(x0, y0, x1, y1);
            }
            for tile in tiles {
                index.tiles.entry(tile).or_default().push(id);
            }
        }
        index
    }

    pub fn by_contact(&self, id: &str) -> Option<usize> {
        self.contacts.get(id).copied()
    }

    pub fn at_xy(&self, x: f64, y: f64) -> &[usize] {
        let tile = ((x / Self::TILE).floor() as i32, (y / Self::TILE).floor() as i32);
        self.tiles.get(&tile).map_or(&[], Vec::as_slice)
    }
}

impl ModelPlan {
    #[cfg(test)]
    pub fn shares_geometry(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.geometry, &other.geometry)
    }
    /// Vollständiger Stützkörper als Netz: Äste und massive Stammstücke.
    pub fn body_mesh(&self) -> Triangles {
        let mut mesh = self.body.clone();
        mesh.append(&boxes_mesh(&self.solids));
        mesh
    }
}

struct Cached {
    key: Vec<u8>,
    meshes: Vec<Arc<crate::mesh::Mesh>>,
    plans: Arc<Vec<ModelPlan>>,
    bytes: usize,
}

/// A native contact can be edited without rerouting owned branches if its
/// conservative column envelope misses their geometry on the entire plate.
fn edit_one_contact(items: &[Item], previous: &[ModelPlan], before: &[Value], after: &[Value]) -> Option<Vec<ModelPlan>> {
    if items.len() != previous.len() || before.len() != after.len() || before.len() != items.len() { return None; }
    let mut addition = None;
    let mut deletion = None;
    for (model, (old, new)) in before.iter().zip(after).enumerate() {
        let (old, new) = (old.as_array()?, new.as_array()?);
        if old.len() != 9 || new.len() != 9 || old[..7] != new[..7] || old[8] != new[8] { return None; }
        if old[7] == new[7] { continue; }
        let old = old[7].as_array()?;
        let new = new[7].as_array()?;
        let old_ids: crate::util::FastMap<_, _> = old.iter().map(|p| Some((p.get("id")?.as_str()?, p))).collect::<Option<_>>()?;
        let new_ids: crate::util::FastMap<_, _> = new.iter().map(|p| Some((p.get("id")?.as_str()?, p))).collect::<Option<_>>()?;
        if old_ids.len() != old.len() || new_ids.len() != new.len() { return None; }
        let removed: Vec<_> = old.iter().filter(|p| new_ids.get(p["id"].as_str().unwrap()) != Some(p)).collect();
        let added: Vec<_> = new.iter().filter(|p| old_ids.get(p["id"].as_str().unwrap()) != Some(p)).collect();
        if removed.len() > 1 || added.len() != 1 || addition.is_some() { return None; }
        let support: Support = serde_json::from_value(added[0].clone()).ok()?;
        if let Some(old) = removed.first() {
            deletion = Some(old["id"].as_str()?);
        }
        addition = Some((model, support));
    }
    let (model, support) = addition?;
    if is_body(support.style()) || is_column(&support) {
        let mut retained = match deletion {
            Some(id) => {
                let mut reduced = before.to_vec();
                reduced[model][7].as_array_mut()?.retain(|p| p["id"].as_str() != Some(id));
                without_removed_groups(items, previous, before, &reduced)?
            }
            None => previous.to_vec(),
        };
        return append_isolated_branch(items, &mut retained, model, support).then_some(retained);
    }
    if let Some(id) = deletion {
        let native = previous[model].native.iter().find(|p| p.id == id)?;
        let saved = serde_json::to_value(native).ok()?;
        if !before[model][7].as_array()?.contains(&saved) { return None; }
    }
    let env = previous[model].env;
    let half = support.width(items[model].data.settings.spacing) / 2.0 + env.line_width;
    if !half.is_finite() || half > 100.0 { return None; }
    let limits = [support.x - half, support.y - half, support.bottom_z,
        support.x + half, support.y + half, support.surface_z + env.layer];
    for plan in previous {
        let gap = plan.env.xy_gap + plan.env.line_width + 0.5;
        let overlaps = |b: Block| (0..3).all(|i| {
            let margin = if i == 2 { plan.env.gap.max(plan.env.bottom_gap) + plan.env.layer } else { gap };
            b[i] <= limits[i + 3] + margin && limits[i] <= b[i + 3] + margin
        });
        // Query occupied cells first, then check the actual segment bounds.
        let tile = |v: f64| (v / GroupIndex::TILE).floor() as i32;
        let mut groups = crate::util::FastSet::default();
        for x in tile(limits[0] - gap)..=tile(limits[3] + gap) {
            for y in tile(limits[1] - gap)..=tile(limits[4] + gap) {
                if let Some(ids) = plan.group_index.tiles.get(&(x, y)) { groups.extend(ids.iter().copied()); }
            }
        }
        if groups.into_iter().any(|id: usize| plan.branches[plan.groups[id].branches.clone()].iter().any(|branch|
            branch.windows(2).any(|p| {
                let r = p[0][3].max(p[1][3]);
                overlaps([p[0][0].min(p[1][0])-r, p[0][1].min(p[1][1])-r, p[0][2].min(p[1][2]),
                    p[0][0].max(p[1][0])+r, p[0][1].max(p[1][1])+r, p[0][2].max(p[1][2])])
            })
        )) || plan.pads.iter().chain(&plan.strips).chain(&plan.lines).chain(&plan.solids).copied().any(overlaps) {
            return None;
        }
    }
    let mut result = previous.to_vec();
    if let Some(id) = deletion { result[model].native.retain(|p| p.id != id); }
    result[model].native.push(support);
    Some(result)
}

fn append_isolated_branch(items: &[Item], retained: &mut [ModelPlan], model: usize, support: Support) -> bool {
    let mut trial = items.to_vec();
    for item in &mut trial {
        item.data.automatic.clear();
        item.data.manual.clear();
    }
    trial[model].data.manual.push(support.clone());
    let envs: Vec<_> = retained.iter().map(|plan| plan.env).collect();
    let Ok(mut plans) = build(&trial, &envs) else { return false; };
    let fresh = plans.swap_remove(model);
    if fresh.routes.len() != 1 || fresh.groups.len() != 1 || !fresh.native.is_empty() || fresh.branches.is_empty() {
        return false;
    }

    // Include the complete footprint and a margin for raster adjacency,
    // contact-point row alignment, and the collision clearance.
    let mut limits = [support.x, support.y, support.x, support.y];
    let mut include = |b: [f64; 4]| {
        limits[0] = limits[0].min(b[0]); limits[1] = limits[1].min(b[1]);
        limits[2] = limits[2].max(b[2]); limits[3] = limits[3].max(b[3]);
    };
    for &[x,y,_,r] in fresh.branches.iter().flatten() { include([x-r,y-r,x+r,y+r]); }
    let Some(head) = &fresh.raw_heads else { return false; };
    for b in head.pads.iter().chain(&head.strips).chain(&fresh.pads).chain(&fresh.strips)
        .chain(&fresh.lines).chain(&fresh.solids).chain(&fresh.group_feet) {
        include([b[0],b[1],b[3],b[4]]);
    }
    let tile = |v: f64| (v / GroupIndex::TILE).floor() as i32;
    for (item, plan) in items.iter().zip(retained.iter()) {
        let margin = 1.0 + plan.env.xy_gap.max(fresh.env.xy_gap) + plan.env.line_width.max(fresh.env.line_width);
        let overlaps = |b: [f64; 4]| b[0] <= limits[2]+margin && b[2] >= limits[0]-margin
            && b[1] <= limits[3]+margin && b[3] >= limits[1]-margin;
        let mut candidates = crate::util::FastSet::default();
        for x in tile(limits[0]-margin)..=tile(limits[2]+margin) {
            for y in tile(limits[1]-margin)..=tile(limits[3]+margin) {
                if let Some(ids) = plan.group_index.tiles.get(&(x,y)) { candidates.extend(ids.iter().copied()); }
            }
        }
        if candidates.into_iter().any(|id: usize| plan.branches[plan.groups[id].branches.clone()].iter().any(|branch|
            branch.windows(2).any(|p| {
                let r = p[0][3].max(p[1][3]);
                overlaps([p[0][0].min(p[1][0])-r,p[0][1].min(p[1][1])-r,
                    p[0][0].max(p[1][0])+r,p[0][1].max(p[1][1])+r])
            })
        )) || plan.pads.iter().chain(&plan.strips).chain(&plan.lines).chain(&plan.solids).any(|b| overlaps([b[0],b[1],b[3],b[4]]))
            || plan.raw_heads.as_ref().is_some_and(|raw| raw.pads.iter().chain(&raw.strips).any(|b| overlaps([b[0],b[1],b[3],b[4]])))
            || plan.native.iter().any(|p| {
                let r = p.width(item.data.settings.spacing)/2.0 + plan.env.line_width;
                overlaps([p.x-r,p.y-r,p.x+r,p.y+r])
            }) || plan.routes.iter().any(|r| overlaps([r.support.x,r.support.y,r.support.x,r.support.y])) {
            return false;
        }
    }

    let plan = &mut retained[model];
    let geometry = Arc::make_mut(&mut plan.geometry);
    let (branches, feet, solids) = (geometry.branches.len(), geometry.group_feet.len(), geometry.solids.len());
    let raw = geometry.raw_heads.get_or_insert_with(|| RawHeads { owners: Vec::new(), pads: Vec::new(), strips: Vec::new() });
    let (pads, strips) = (raw.pads.len(), raw.strips.len());
    let shift = |r: &std::ops::Range<usize>, base| r.start + base..r.end + base;
    raw.owners.extend(head.owners.iter().map(|h| OwnedHead { id: h.id.clone(), pads: shift(&h.pads, pads),
        strips: shift(&h.strips, strips), solids: shift(&h.solids, solids) }));
    raw.pads.extend_from_slice(&head.pads);
    raw.strips.extend_from_slice(&head.strips);
    geometry.groups.extend(fresh.groups.iter().map(|g| SupportGroup { contacts: g.contacts.clone(),
        branches: shift(&g.branches, branches), feet: shift(&g.feet, feet) }));
    geometry.branches.extend_from_slice(&fresh.branches);
    geometry.group_feet.extend_from_slice(&fresh.group_feet);
    geometry.segment_contacts.extend_from_slice(&fresh.segment_contacts);
    geometry.routes.extend_from_slice(&fresh.routes);
    geometry.pads.extend_from_slice(&fresh.pads);
    geometry.strips.extend_from_slice(&fresh.strips);
    geometry.lines.extend_from_slice(&fresh.lines);
    geometry.solids.extend_from_slice(&fresh.solids);
    geometry.body.append(&fresh.body);
    geometry.group_index = GroupIndex::new(&geometry.groups, &geometry.branches, &geometry.group_feet);
    plan.geometry_revision = geometry_revision();
    plan.substituted += fresh.substituted;
    profile("Lokal einen unabhängigen Ast geplant");
    true
}

/// Removing a native enforcer removes an obstacle. Owned bodies land on
/// model triangles or the bed, never on native posts in SolidField.
fn without_removed_groups(items: &[Item], previous: &[ModelPlan], before: &[Value], after: &[Value]) -> Option<Vec<ModelPlan>> {
    if before.len() != after.len() || before.len() != previous.len() { return None; }
    let mut changes = Vec::with_capacity(after.len());
    for ((old, new), plan) in before.iter().zip(after).zip(previous) {
        let (old, new) = (old.as_array()?, new.as_array()?);
        if old.len() != 9 || new.len() != 9 || old[..7] != new[..7] || old[8] != new[8] {
            return None;
        }
        let (old, new) = (old[7].as_array()?, new[7].as_array()?);
        let mut rest = new.iter().peekable();
        let mut removed = crate::util::FastSet::default();
        for support in old {
            if rest.peek() == Some(&support) {
                rest.next();
            } else {
                let id = support.get("id")?.as_str()?;
                if !removed.insert(id) { return None; }
            }
        }
        if rest.next().is_some() {
            return None;
        }
        let mut remove_body = false;
        let mut prune = false;
        if !removed.is_empty() {
            for support in plan.native.iter().filter(|p| removed.contains(p.id.as_str())) {
                if !old.contains(&serde_json::to_value(support).ok()?) { return None; }
            }
            let native = plan.native.iter().filter(|p| removed.contains(p.id.as_str())).count();
            if new.iter().any(|p| p.get("id").and_then(Value::as_str).is_some_and(|id| removed.contains(id))) {
                return None;
            }
            if native != removed.len() {
                let deleted = removed.iter().filter(|id| plan.group_index.by_contact(id).is_some()).count();
                if plan.reason.is_some() || native + deleted != removed.len() {
                    return None;
                }
                remove_body = deleted == plan.routes.len();
                prune = !remove_body;
            } else if removed.iter().any(|id| plan.group_index.by_contact(id).is_some()) {
                return None;
            }
        }
        changes.push((removed, remove_body, prune));
    }
    if changes.iter().all(|(ids, _, _)| ids.is_empty()) { return None; }
    let mut plans = previous.to_vec();
    for ((plan, (removed, remove_body, prune)), item) in plans.iter_mut().zip(changes).zip(items) {
        plan.native.retain(|p| !removed.contains(p.id.as_str()));
        if remove_body {
            plan.geometry = Arc::default();
            plan.geometry_revision = geometry_revision();
            plan.substituted = 0;
        } else if prune {
            *plan = prune_group(item, plan, &removed)?;
        }
    }
    Some(plans)
}

fn prune_group(item: &Item, plan: &ModelPlan, removed: &crate::util::FastSet<&str>) -> Option<ModelPlan> {
    let raw = plan.raw_heads.as_ref()?;
    let mut entry = Entry {
        item,
        env: plan.env,
        groups: Vec::new(),
        segment_contacts: Vec::new(),
        heads: Vec::new(),
        native: plan.native.clone(),
        pending: Vec::new(),
        skipped: plan.skipped,
        fallback: plan.fallback,
        routes: plan.routes.iter().filter(|r| !removed.contains(r.support.id.as_str())).cloned().collect(),
        branches: Vec::new(),
        dense: Vec::new(),
        feet: Vec::new(),
        strips: Vec::new(),
        solids: Vec::new(),
        reason: plan.reason,
    };
    if plan.branches.len() != plan.segment_contacts.len() { return None; }
    let affected: crate::util::FastSet<_> = removed.iter().filter_map(|id| plan.group_index.by_contact(id)).collect();
    for (index, group) in plan.groups.iter().enumerate() {
        let changed = affected.contains(&index);
        let contacts: Box<[_]> = group.contacts.iter()
            .filter(|id| !changed || !removed.contains(id.as_str())).cloned().collect();
        if contacts.is_empty() { continue; }
        let branch_start = entry.branches.len();
        let foot_start = entry.feet.len();
        for branch in group.branches.clone() {
            let owners = &plan.segment_contacts[branch];
            let owners = if changed && owners.iter().any(|id| removed.contains(id.as_str())) {
                let kept: Vec<_> = owners.iter().filter(|id| !removed.contains(id.as_str())).cloned().collect();
                if kept.is_empty() { continue; }
                kept.into()
            } else {
                Arc::clone(owners)
            };
            entry.branches.push(plan.branches[branch].clone());
            entry.segment_contacts.push(owners);
        }
        entry.feet.extend_from_slice(&plan.group_feet[group.feet.clone()]);
        entry.groups.push(SupportGroup {
            contacts,
            branches: branch_start..entry.branches.len(),
            feet: foot_start..entry.feet.len(),
        });
    }
    for head in raw.owners.iter().filter(|h| !removed.contains(h.id.as_str())) {
        let (pads, strips, solids) = (entry.dense.len(), entry.strips.len(), entry.solids.len());
        entry.dense.extend_from_slice(&raw.pads[head.pads.clone()]);
        entry.strips.extend_from_slice(&raw.strips[head.strips.clone()]);
        entry.solids.extend_from_slice(&plan.solids[head.solids.clone()]);
        entry.heads.push(OwnedHead {
            id: head.id.clone(),
            pads: pads..entry.dense.len(),
            strips: strips..entry.strips.len(),
            solids: solids..entry.solids.len(),
        });
    }
    if entry.heads.len() != entry.routes.len() || entry.heads.is_empty() { return None; }
    let contact_lines = std::env::var("SIMPLIY_CONTACT").as_deref() != Ok("dense");
    profile(&format!("Astlöschung: {} von {} Gruppen zugeschnitten", affected.len(), plan.groups.len()));
    let prepared = if contact_lines { local_contacts(plan, &entry, removed) } else { None };
    #[cfg(test)]
    if let Some((pads, strips, lines)) = prepared.as_ref().filter(|_| std::env::var_os("SIMPLIY_VERIFY_LOCAL_CONTACTS").is_some()) {
        let (full_pads, full_strips, full_lines) = prepare_contacts(&entry, &entry.dense, &entry.strips, &entry.feet)?;
        for (local, full) in [(pads, full_pads), (strips, full_strips), (lines, full_lines)] {
            let canonical = |blocks: &[Block]| {
                let mut out: Vec<_> = blocks.iter().map(|block| block.map(|v| (v * 1e7).round() as i64)).collect();
                out.sort_unstable();
                out
            };
            assert!(canonical(local) == canonical(&full), "Lokale Kontaktgeometrie weicht vom vollständigen Kontaktaufbau ab ({} / {} Quader)", local.len(), full.len());
        }
    }
    finish_entry_with_contacts(entry, contact_lines, prepared)
}

type ContactLayers = (Vec<Block>, Vec<Block>, Vec<Block>);

/// Take the closure of changed raw and finished rectangles before replacing
/// any output. With a gap between components, the existing splitter and
/// line builder cannot assign material across the boundary.
fn local_contacts(plan: &ModelPlan, entry: &Entry<'_>, removed: &crate::util::FastSet<&str>) -> Option<ContactLayers> {
    let raw = plan.raw_heads.as_ref()?;
    let mut dirty: Vec<Block> = raw.owners.iter().filter(|head| removed.contains(head.id.as_str()))
        .flat_map(|head| raw.pads[head.pads.clone()].iter().chain(&raw.strips[head.strips.clone()])).copied().collect();
    for group in &plan.groups {
        if group.contacts.iter().all(|id| removed.contains(id.as_str())) {
            dirty.extend_from_slice(&plan.group_feet[group.feet.clone()]);
        }
    }
    // A removed sample can change row alignment in any island close enough
    // to that XY position, independent of its height.
    let removed_points: Vec<_> = plan.routes.iter().filter(|route| removed.contains(route.support.id.as_str()))
        .map(|route| [route.support.x, route.support.y]).collect();
    let sources: [&[Block]; 6] = [&raw.pads, &raw.strips, &plan.group_feet, &plan.pads, &plan.strips, &plan.lines];
    let mut spatial = crate::util::FastMap::<(i32, i32), Vec<(usize, usize)>>::default();
    let mut used: Vec<Vec<bool>> = sources.iter().map(|blocks| vec![false; blocks.len()]).collect();
    let tile = |v: f64| (v / 3.2).floor() as i32;
    let tiles = |b: &Block, extra: f64| {
        let ys = tile(b[1] - extra)..=tile(b[4] + extra);
        (tile(b[0] - extra)..=tile(b[3] + extra)).flat_map(move |x| ys.clone().map(move |y| (x, y)))
    };
    for (source, blocks) in sources.iter().enumerate() {
        for (i, block) in blocks.iter().enumerate() {
            for cell in tiles(block, 0.0) { spatial.entry(cell).or_default().push((source, i)); }
        }
    }
    let halo = 0.1 + entry.env.line_width;
    for [x, y] in removed_points {
        dirty.push([x - 0.25, y - 0.25, f64::NEG_INFINITY, x + 0.25, y + 0.25, f64::INFINITY]);
    }
    let mut cursor = 0;
    while cursor < dirty.len() {
        if cancelled() || dirty.len() > 32_768 { return None; }
        let b = dirty[cursor];
        cursor += 1;
        for tile in tiles(&b, halo) {
            let Some(candidates) = spatial.get(&tile) else { continue; };
            for &(source, index) in candidates {
                if used[source][index] { continue; }
                let a = sources[source][index];
                if a[2] > b[5] + 0.001 || b[2] > a[5] + 0.001
                    || a[0] > b[3] + halo || b[0] > a[3] + halo
                    || a[1] > b[4] + halo || b[1] > a[4] + halo { continue; }
                used[source][index] = true;
                dirty.push(a);
            }
        }
    }
    let selected = |source: usize| {
        // New raw rectangles are a subset of the previous plan after a pure deletion.
        let marks: crate::util::FastSet<_> = sources[source].iter().zip(&used[source])
            .filter(|(_, selected)| **selected).map(|(block, _)| block.map(f64::to_bits)).collect();
        let blocks = match source { 0 => &entry.dense, 1 => &entry.strips, _ => &entry.feet };
        blocks.iter().filter(|block| marks.contains(&block.map(f64::to_bits))).copied().collect::<Vec<_>>()
    };
    let (pads, strips, feet) = (selected(0), selected(1), selected(2));
    let (mut pads, mut strips, mut lines) = prepare_contacts(entry, &pads, &strips, &feet)?;
    for (target, source) in [(&mut pads, 3), (&mut strips, 4), (&mut lines, 5)] {
        target.extend(sources[source].iter().zip(&used[source]).filter(|(_, selected)| !**selected).map(|(block, _)| *block));
    }
    profile(&format!("Lokale Kontaktaufbereitung: {} von {} Rohquadern", used[..3].iter().flatten().filter(|&&used| used).count(), sources[..3].iter().map(|s| s.len()).sum::<usize>()));
    Some((pads, strips, lines))
}

const KEPT_PLANS: usize = 4;
const MAX_PLAN_CACHE_BYTES: usize = 256 * 1024 * 1024;
static CACHE: Mutex<Vec<Cached>> = Mutex::new(Vec::new());

fn plan_bytes(plans: &[ModelPlan]) -> usize {
    plans.iter().map(|p| {
        let blocks = p.solids.capacity() + p.pads.capacity() + p.strips.capacity() + p.lines.capacity() + p.group_feet.capacity();
        let groups = p.groups.capacity() * std::mem::size_of::<SupportGroup>()
            + p.groups.iter().flat_map(|g| g.contacts.iter()).map(|id| id.capacity() + std::mem::size_of::<String>()).sum::<usize>()
            + p.segment_contacts.iter().map(|ids| 32 + ids.iter().map(|id| id.capacity() + std::mem::size_of::<String>()).sum::<usize>()).sum::<usize>()
            + p.group_index.contacts.iter().map(|(id, _)| id.capacity() + 64).sum::<usize>()
            + p.group_index.tiles.values().map(|ids| 64 + ids.capacity() * std::mem::size_of::<usize>()).sum::<usize>();
        let raw = p.raw_heads.as_ref().map_or(0, |heads| {
            (heads.pads.capacity() + heads.strips.capacity()) * std::mem::size_of::<Block>()
                + heads.owners.capacity() * std::mem::size_of::<OwnedHead>()
                + heads.owners.iter().map(|head| head.id.capacity()).sum::<usize>()
        });
        blocks.saturating_mul(std::mem::size_of::<Block>())
            .saturating_add(groups)
            .saturating_add(raw)
            .saturating_add(p.body.vertices.capacity() * std::mem::size_of::<f32>())
            .saturating_add(p.body.indices.capacity() * std::mem::size_of::<u32>())
            .saturating_add(p.branches.iter().map(|b| b.capacity() * std::mem::size_of::<Point>()).sum::<usize>())
            .saturating_add(p.routes.iter().map(|r| r.samples.capacity() * std::mem::size_of::<[f64; 3]>() + std::mem::size_of::<PlannedRoute>()).sum::<usize>())
            .saturating_add(p.native.capacity() * std::mem::size_of::<Support>())
    }).sum()
}

/// Slicen und Ansicht fragen oft dasselbe, und das Werkzeug fragt bei jeder Mausbewegung.
/// Schichthöhe an den Kontakten, wenn alle in der Mitte desselben ausgerichteten Höhenbereichs liegen (mehr als vier Schichten vom Rand).
fn local_layer(item: &Item) -> Option<f64> {
    let spans = &item.input.range_spans;
    let base = plain(item.input.resolved.get("layer_height"))?.max(0.02);
    let contacts: Vec<f64> = item.data.all().iter().map(|s| s.surface_z).collect();
    if spans.is_empty() || contacts.is_empty() {
        return None;
    }
    let on = |value: f64, step: f64| ((value / step) - (value / step).round()).abs() < 1e-3;
    spans.iter().find_map(|&[from, to, height]| {
        let margin = 4.0 * height.max(base);
        let inside = contacts.iter().all(|z| *z >= from + margin && *z <= to - margin);
        // Die Bereiche davor und dahinter müssen das Raster erhalten, sonst bleibt es bei der Reserve
        let others_fine = spans.iter().all(|&[f, t, h]| (f == from && t == to) || (on(f, base) && on(t, base) && on(t - f, h)));
        (inside && others_fine && on(from, base) && on(to, base)).then_some(height)
    })
}

/// Ist die Schichtlage an den Kontakten unsicher? Nur dann braucht der Kontakt eine ganze Schicht Reserve.
/// Ohne bekannte Bereiche gilt das immer. Mit Bereichen: nur wenn ein Bereich mit anderer Schichthöhe nahe an einem Kontakt liegt
/// oder seine Grenzen nicht auf dem Raster der Grundschicht liegen (dann verschiebt sich das Raster darüber).
fn grid_uncertain(item: &Item, env: &Env) -> bool {
    let spans = &item.input.range_spans;
    if spans.is_empty() {
        return true;
    }
    let base = super::plan::plain(item.input.resolved.get("layer_height")).unwrap_or(env.layer).max(0.02);
    let on = |value: f64, step: f64| ((value / step) - (value / step).round()).abs() < 1e-3;
    let contacts: Vec<f64> = item.data.all().iter().map(|s| s.surface_z).collect();
    spans.iter().filter(|[_, _, height]| (height - base).abs() > 1e-6).any(|&[from, to, height]| {
        let margin = 4.0 * base.max(height);
        let misaligned = !(on(from, base) && on(to, base) && on(to - from, height));
        misaligned || contacts.iter().any(|z| *z >= from - margin && *z <= to + margin)
    })
}

/// Abbruch veralteter Anzeige-Berechnungen: Jede neue Anfrage der Anzeige erhöht die Nummer. Eine Berechnung, die mit einer
/// älteren Nummer läuft, bricht an den nächsten Stufengrenzen ab. Slicing und Bearbeitung laufen ohne Nummer und nie abgebrochen.
static VIEW_EPOCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
thread_local! {
    static TOKEN: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}
pub const OUTDATED: &str = "Stützenplanung veraltet (neue Änderung)";

/// Neue Anzeige-Anfrage: Nummer vergeben und für diesen Thread setzen. Ältere laufende Anfragen gelten ab jetzt als veraltet.
pub fn begin_view() -> u64 {
    let epoch = VIEW_EPOCH.fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1;
    TOKEN.with(|t| t.set(epoch));
    epoch
}

pub fn end_view() {
    TOKEN.with(|t| t.set(0));
}

pub(crate) fn view_token() -> u64 { TOKEN.with(|t| t.get()) }
pub(crate) fn set_view_token(token: u64) { TOKEN.with(|t| t.set(token)); }

pub fn cancelled() -> bool {
    let token = TOKEN.with(|t| t.get());
    token != 0 && VIEW_EPOCH.load(std::sync::atomic::Ordering::Acquire) != token
}

/// Zuletzt fertig geplante Platte mit denselben Modellen (Schlüssel egal): für die Auswahl beim Klicken genügt sie,
/// so muss ein Löschen nicht auf eine komplette Neuplanung warten.
pub fn recent(items: &[Item]) -> Option<Arc<Vec<ModelPlan>>> {
    let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    cache.iter().rev().find(|c| c.meshes.len() == items.len() && c.meshes.iter().zip(items).all(|(m, i)| Arc::ptr_eq(m, &i.mesh))).map(|c| Arc::clone(&c.plans))
}

pub fn plate(items: &[Item]) -> Result<Arc<Vec<ModelPlan>>, String> {
    plate_with_strategy(items, false)
}

pub fn plate_with_strategy(items: &[Item], optimize: bool) -> Result<Arc<Vec<ModelPlan>>, String> {
    if cancelled() { return Err(OUTDATED.into()); }
    let envs: Vec<Env> = items
        .iter()
        .map(|item| {
            let mut env = env_of(&item.input.resolved, &item.input.range_heights);
            match local_layer(item) {
                // Alle Kontakte liegen mitten in einem Bereich mit gleichmäßiger Schichthöhe: Dort gilt genau diese Höhe.
                Some(height) if env.variable => { env.layer = height; env.variable = false; }
                _ => env.variable = env.variable && grid_uncertain(item, &env),
            }
            env
        })
        .collect();
    let parts: Vec<Value> = items
        .iter()
        .zip(&envs)
        .map(|(item, env)| {
            let supports = if item.stale { Vec::new() } else { item.data.all() };
            let i = &item.input;
            json!([i.id, i.rows, i.offset, i.parts, item.bed, item.data.settings.placement, item.data.settings.spacing, supports, env])
        })
        .collect();
    let key = serde_json::to_vec(&parts).map_err(|e| e.to_string())?;
    let local = if optimize { None } else {
        let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let same = |cached: &Cached| {
            cached.key == key
                && cached.meshes.len() == items.len()
                && cached.meshes.iter().zip(items).all(|(mesh, item)| Arc::ptr_eq(mesh, &item.mesh))
        };
        if let Some(found) = cache.iter().find(|cached| same(cached)) {
            if cancelled() { return Err(OUTDATED.into()); }
            return Ok(Arc::clone(&found.plans));
        }
        cache.iter().rev().find(|cached| cached.meshes.len() == items.len()
            && cached.meshes.iter().zip(items).all(|(mesh, item)| Arc::ptr_eq(mesh, &item.mesh)))
            .map(|cached| (cached.key.clone(), Arc::clone(&cached.plans)))
    }.and_then(|(before, previous)| {
        let before: Vec<Value> = serde_json::from_slice(&before).ok()?;
        without_removed_groups(items, &previous, &before, &parts)
            .or_else(|| edit_one_contact(items, &previous, &before, &parts))
    });
    let plans = Arc::new(match local {
        Some(plans) => {
            profile("Lokale Stützenbearbeitung ohne erneute Wegsuche");
            plans
        }
        None => build(items, &envs)?,
    });
    if cancelled() { return Err(OUTDATED.into()); }
    let bytes = plan_bytes(&plans).saturating_add(key.capacity());
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if optimize {
        cache.retain(|p| p.key != key || p.meshes.len() != items.len()
            || !p.meshes.iter().zip(items).all(|(mesh, item)| Arc::ptr_eq(mesh, &item.mesh)));
    }
    while !cache.is_empty() && (cache.len() >= KEPT_PLANS || cache.iter().map(|item| item.bytes).sum::<usize>().saturating_add(bytes) > MAX_PLAN_CACHE_BYTES) {
        cache.remove(0);
    }
    if bytes <= MAX_PLAN_CACHE_BYTES {
        cache.push(Cached { key, meshes: items.iter().map(|item| Arc::clone(&item.mesh)).collect(), plans: Arc::clone(&plans), bytes });
    }
    Ok(plans)
}

struct Entry<'a> {
    groups: Vec<SupportGroup>,
    segment_contacts: Vec<Arc<[String]>>,
    heads: Vec<OwnedHead>,
    item: &'a Item,
    env: Env,
    native: Vec<Support>,
    pending: Vec<Support>,
    skipped: usize,
    fallback: usize,
    routes: Vec<PlannedRoute>,
    branches: Vec<Vec<Point>>,
    dense: Vec<Block>,
    feet: Vec<Block>,
    strips: Vec<Block>,
    solids: Vec<Block>,
    reason: Option<&'static str>,
}

impl Entry<'_> {
    fn to_pillars(&mut self, failed: &[Support]) {
        let settings = &self.item.data.settings;
        for support in failed {
            if is_column(support) {
                // Ohne Weg fuer die Saeule bleibt es beim eingestellten Prusa-Pfeiler.
                let mut pillar = support.clone();
                pillar.shape = None;
                self.native.push(pillar);
                continue;
            }
            if settings.placement == "buildplate" && support.landing.as_deref() == Some("model") {
                self.skipped += 1;
                continue;
            }
            let mut pillar = support.clone();
            pillar.style = Some("pillar".into());
            pillar.size = Some(FALLBACK_WIDTH.min(settings.spacing));
            self.native.push(pillar);
            self.fallback += 1;
        }
    }

    fn add_pillars(&self, field: &mut SolidField, from: usize) {
        for support in &self.native[from..] {
            field.add_post(PostShape {
                x: support.x,
                y: support.y,
                half: support.width(self.item.data.settings.spacing) / 2.0 + self.env.line_width,
                low: support.bottom_z,
                high: support.surface_z + self.env.layer,
                round: false,
            });
        }
    }

    fn route(&mut self, field: &mut SolidField, scene: Option<u64>) {
        let bed_only = self.item.data.settings.placement == "buildplate";
        let route_cache = RouteCache::for_scene(scene, self.env, self.item.bed, bed_only);
        let mut contacts = self.pending.clone();
        let mut round = 0;
        let mut give_rounds = 0;
        while !contacts.is_empty() {
            if cancelled() {
                return;
            }
            let routed = route_supports(&Context::new(field, self.env, self.item.bed, bed_only), &contacts, &route_cache);
            let failed: Vec<usize> = routed.routes.iter().filter(|route| !route.ok).map(|route| route.support).collect();
            // Jede Runde sucht alle Wege neu. Nach einigen Runden bleiben die gefundenen Wege, der Rest wird Pfeiler.
            let settle = give_rounds >= MAX_GIVE_UP_ROUNDS && failed.iter().all(|&i| contacts[i].slim);
            if failed.is_empty() || settle {
                self.groups = routed.groups;
                self.segment_contacts = routed.segment_contacts;
                self.heads = routed.heads;
                self.branches = routed.branches;
                self.dense = routed.dense;
                self.feet = routed.feet;
                self.strips = routed.strips;
                self.solids = routed.solids;
                self.routes = routed
                    .routes
                    .into_iter()
                    .filter(|route| route.ok)
                    .map(|route| PlannedRoute {
                        support: contacts[route.support].clone(),
                        as_tree: route.as_tree,
                        tip: route.tip,
                        samples: route.samples,
                    })
                    .collect();
                if !failed.is_empty() {
                    let left: Vec<Support> = failed.iter().map(|&i| contacts[i].clone()).collect();
                    self.to_pillars(&left);
                }
                break;
            }
            // Erst ein schlanker Ast: Ein Pfeiler wuerde auch den Nachbarn den Weg nehmen.
            let thick: Vec<usize> = failed.iter().copied().filter(|&i| !contacts[i].slim).collect();
            if !thick.is_empty() && round < MAX_ROUNDS {
                for i in thick {
                    let mut shape = Shape::of(contacts[i].shape.as_ref());
                    shape.body_width = 1.4;
                    shape.tip_width = 1.4;
                    shape.thicken = 0.0;
                    contacts[i].shape = Some(shape.to_map());
                    contacts[i].slim = true;
                }
                round += 1;
                continue;
            }
            // Neue Pfeiler sind neue Hindernisse, deshalb noch einmal suchen.
            let give_up: Vec<usize> = if round >= MAX_ROUNDS { (0..contacts.len()).collect() } else { failed };
            give_rounds += 1;
            let before = self.native.len();
            let given: Vec<Support> = give_up.iter().map(|&i| contacts[i].clone()).collect();
            self.to_pillars(&given);
            self.add_pillars(field, before);
            route_cache.clear();
            let mut keep = vec![true; contacts.len()];
            for i in give_up {
                keep[i] = false;
            }
            contacts = contacts.into_iter().zip(keep).filter(|(_, keep)| *keep).map(|(support, _)| support).collect();
            round += 1;
        }
    }

    /// Die Aeste des naechsten Modells muessen diesen ausweichen.
    fn block_space(&self, field: &mut SolidField) {
        for &[a, b, c, d, e, f] in self.dense.iter().chain(&self.feet).chain(&self.strips).chain(&self.solids) {
            field.add_post(PostShape {
                x: (a + d) / 2.0,
                y: (b + e) / 2.0,
                half: (d - a).max(e - b) / 2.0 + 0.5,
                low: c,
                high: f,
                round: false,
            });
        }
        for branch in &self.branches {
            for pair in branch.windows(2) {
                let (a, b) = (pair[0], pair[1]);
                let parts = (b[0] - a[0]).hypot(b[1] - a[1]).ceil().max(1.0);
                for j in 0..parts as usize {
                    let j = j as f64;
                    let f = (j + 0.5) / parts;
                    let za = a[2] + (b[2] - a[2]) * j / parts;
                    let zb = a[2] + (b[2] - a[2]) * (j + 1.0) / parts;
                    field.add_post(PostShape {
                        x: a[0] + (b[0] - a[0]) * f,
                        y: a[1] + (b[1] - a[1]) * f,
                        half: a[3].max(b[3]) + 0.5,
                        low: za.min(zb),
                        high: za.max(zb),
                        round: true,
                    });
                }
            }
        }
    }
}

/// Gerade Saeule, Kontakt so breit wie der Pfeiler bei Prusa.
fn as_column(mut support: Support, spacing: f64) -> Support {
    let width = support.width(spacing);
    let mut shape = Shape::of(None);
    // Breiter als der Baumschaft stuende der Fuss auf Schraegen mit Luecken.
    shape.body_width = width.min(shape.body_width).max(1.2);
    shape.tip_width = width.min(shape.tip_width).max(0.8);
    shape.contact_width = width.clamp(1.2, 12.0);
    shape.thicken = 0.0;
    support.shape = Some(shape.to_map());
    // Nicht erst duenner versuchen, sonst waere es kein Pfeiler mehr.
    support.slim = true;
    support
}

fn build(items: &[Item], envs: &[Env]) -> Result<Vec<ModelPlan>, String> {
    let mut state: Vec<Entry> = items
        .iter()
        .zip(envs)
        .map(|(item, &env)| {
            let supports = if item.stale { Vec::new() } else { item.data.all() };
            let spacing = item.data.settings.spacing;
            let (pending, native): (Vec<Support>, Vec<Support>) = supports
                .into_iter()
                .map(|p| if is_column(&p) { as_column(p, spacing) } else { p })
                .partition(|p| is_body(p.style()) || is_column(p));
            let mut entry = Entry {
                groups: Vec::new(),
                segment_contacts: Vec::new(),
                heads: Vec::new(),
                item,
                env,
                native,
                pending,
                skipped: 0,
                fallback: 0,
                routes: Vec::new(),
                branches: Vec::new(),
                dense: Vec::new(),
                feet: Vec::new(),
                strips: Vec::new(),
                solids: Vec::new(),
                reason: None,
            };
            if env.raft && !entry.pending.is_empty() {
                entry.reason = Some("Mit Raft werden Baum, Fächer und Knotenblech als Pfeiler gedruckt");
                let all = std::mem::take(&mut entry.pending);
                entry.to_pillars(&all);
            }
            entry
        })
        .collect();

    if state.iter().any(|entry| !entry.pending.is_empty()) {
        // Alle Modelle der Platte sind Hindernisse, dazu erhabener Text und angefuegte Koerper.
        let worlds: Vec<_> = items.iter().map(world_of).collect();
        let mut parts_by_model: Vec<Vec<(Vec<f64>, Vec<u32>)>> = Vec::with_capacity(items.len());
        for item in items {
            let mut parts = Vec::new();
            let place = item.input.placed();
            for part in &item.input.parts {
                parts.push((
                    part.vertices.iter().flat_map(|&v| place.apply(v)).collect(),
                    part.triangles.iter().flatten().copied().collect(),
                ));
            }
            parts_by_model.push(parts);
        }
        let mut solids: Vec<Solid> = Vec::new();
        for (world, parts) in worlds.iter().zip(&parts_by_model) {
            solids.push(Solid { vertices: &world.vertices, indices: &world.indices });
            solids.extend(parts.iter().map(|(vertices, indices)| Solid { vertices, indices }));
        }
        let clock = std::time::Instant::now();
        let mut field = SolidField::new(&solids);
        let scene = route_scene(&field);
        profile(&format!("feld {} ms", clock.elapsed().as_millis()));
        for entry in &state {
            entry.add_pillars(&mut field, 0);
        }
        for entry in state.iter_mut() {
            if entry.pending.is_empty() {
                continue;
            }
            let n = entry.pending.len();
            entry.route(&mut field, scene);
            if cancelled() {
                return Err(OUTDATED.into());
            }
            profile(&format!("route {} Kontakte {} ms", n, clock.elapsed().as_millis()));
            entry.block_space(&mut field);
            profile(&format!("block {} ms", clock.elapsed().as_millis()));
        }
    }

    // Kontaktbahnen sind Standard. Der fruehere dichte Kontakt nur noch fuer Vergleichsmessungen.
    let contact_lines = std::env::var("SIMPLIY_CONTACT").as_deref() != Ok("dense");
    if cancelled() {
        return Err(OUTDATED.into());
    }
    state
        .into_iter()
        .map(|entry| finish_entry(entry, contact_lines))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| OUTDATED.to_owned())
}

fn prepare_contacts(entry: &Entry<'_>, pads: &[Block], strips: &[Block], feet: &[Block]) -> Option<ContactLayers> {
                let points: Vec<[f64; 2]> = entry.routes.iter().map(|r| [r.support.x, r.support.y]).collect();
                let tip = crate::supports::contact::CONTACT_RADIUS;
                let clock = std::time::Instant::now();
                let (dense, mut tops) = crate::supports::contact_lines::split(pads, entry.env.layer, entry.env.line_width, &points, tip);
                if cancelled() { return None; }
                let (strips, more) = crate::supports::contact_lines::split(strips, entry.env.layer, entry.env.line_width, &points, tip);
                if cancelled() { return None; }
                tops.extend(more);
                let pitch = entry.env.line_width + entry.env.contact_gap;
                let style = crate::supports::contact_lines::Style { angle: entry.env.angle, grid: entry.env.grid, loops: entry.env.loops };
                profile(&format!("bahnen split {} ms", clock.elapsed().as_millis()));
                let (lines, kept) = crate::supports::contact_lines::lines(&tops, entry.env.line_width, pitch, &points, style);
                if cancelled() { return None; }
                let mut dense = dense;
                dense.extend(kept);
                profile(&format!("bahnen lines {} ms", clock.elapsed().as_millis()));
                // Fuesse auf dem Teil: mit unteren Kontaktlagen wird nur ihre unterste Schicht zu Bahnen,
                // darueber bleiben sie dicht und tragen. Ohne untere Kontaktlagen bleiben sie ganz dicht.
                let mut lines = lines;
                if entry.env.bottom_layers >= 1.0 {
                    let (rest, under, kept_under) = crate::supports::contact_lines::bottom(feet, entry.env.layer, entry.env.line_width, entry.env.bottom_pitch, style);
                    dense.extend(rest);
                    dense.extend(kept_under);
                    lines.extend(under);
                } else {
                    dense.extend_from_slice(feet);
                }
                if std::env::var("SIMPLIY_CONTACT_STATS").is_ok() {
                    let cell = 0.05f64 * 0.05;
                    let area = |l: &[Block]| l.iter().map(|b| (b[3] - b[0]) * (b[4] - b[1])).sum::<f64>();
                    crate::supports::contact_lines::STATS.with(|s| {
                        let s = s.borrow();
                        eprintln!("KONTAKTSTATS ohne_Unterbau={:.1} oberste={:.1} bahnfaehig={:.1} dicht_geblieben={:.1} Bahnen={:.1} mm2",
                            s.0 as f64 * cell, s.1 as f64 * cell, s.2 as f64 * cell, s.3 as f64 * cell, area(&lines));
                    });
                }
                profile(&format!("bahnen fertig {} ms", clock.elapsed().as_millis()));
                Some((dense, strips, lines))
}

fn finish_entry(entry: Entry<'_>, contact_lines: bool) -> Option<ModelPlan> {
    finish_entry_with_contacts(entry, contact_lines, None)
}

fn finish_entry_with_contacts(entry: Entry<'_>, contact_lines: bool, prepared: Option<ContactLayers>) -> Option<ModelPlan> {
            if cancelled() { return None; }
            let (dense, strips, lines) = if let Some(prepared) = prepared {
                prepared
            } else if contact_lines {
                prepare_contacts(&entry, &entry.dense, &entry.strips, &entry.feet)?
            } else {
                (entry.dense.iter().chain(&entry.feet).copied().collect(), entry.strips.clone(), Vec::new())
            };
            let raw_heads = (!entry.groups.is_empty()).then(|| RawHeads {
                owners: entry.heads,
                pads: entry.dense.clone(),
                strips: entry.strips.clone(),
            });
            let mut body = branch_mesh(&simplified(&entry.branches), BRANCH_SIDES);
            let group_index = GroupIndex::new(&entry.groups, &entry.branches, &entry.feet);
            let substituted = entry.routes.iter().filter(|route| route.as_tree).count();
            Some(ModelPlan {
                geometry_revision: geometry_revision(),
                geometry: Arc::new(PlanGeometry {
                    raw_heads,
                    groups: entry.groups,
                    segment_contacts: entry.segment_contacts,
                    group_feet: entry.feet,
                    group_index,
                    pads: dense,
                    strips,
                    lines,
                    solids: entry.solids,
                    body,
                    routes: entry.routes,
                    branches: entry.branches,
                }),
                env: entry.env,
                substituted,
                native: entry.native,
                skipped: entry.skipped,
                fallback: entry.fallback,
                reason: entry.reason,
            })
}

/// Zwischenkreise weglassen, die auf der Geraden liegen.
fn simplified(branches: &[Vec<Point>]) -> Vec<Vec<Point>> {
    branches
        .iter()
        .map(|branch| {
            if branch.len() < 3 {
                return branch.clone();
            }
            let mut out = vec![branch[0]];
            let mut a = branch[0];
            for i in 1..branch.len() - 1 {
                let (b, c) = (branch[i], branch[i + 1]);
                let span = c[2] - a[2];
                let keep = span.abs() < 1e-6 || {
                    let t = (b[2] - a[2]) / span;
                    [0, 1, 3].iter().any(|&k| (a[k] + (c[k] - a[k]) * t - b[k]).abs() > 1e-4)
                };
                if keep {
                    out.push(b);
                    a = b;
                }
            }
            out.push(branch[branch.len() - 1]);
            out
        })
        .collect()
}

/// Zeitmessung fuer die Fehlersuche: nur mit SIMPLIY_PROFILE=Dateipfad.
pub(crate) fn profile(text: &str) {
    if let Ok(path) = std::env::var("SIMPLIY_PROFILE") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
            let _ = writeln!(f, "{now} {text}");
        }
    }
}
