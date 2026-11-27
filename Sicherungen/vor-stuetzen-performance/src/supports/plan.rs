//! Eine Platte, ein Plan. Ansicht und Slicing benutzen denselben, damit die Formen uebereinstimmen.
use super::{
    context::{Block, Context, Env, Point},
    field::{PostShape, Solid, SolidField},
    input::{world_of, Item},
    meshes::{boxes_mesh, branch_mesh, Triangles},
    shapes::route_supports,
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

pub struct PlannedRoute {
    pub support: Support,
    pub as_tree: bool,
    pub tip: f64,
    pub samples: Vec<[f64; 3]>,
}

pub struct ModelPlan {
    pub env: Env,
    pub native: Vec<Support>,
    pub skipped: usize,
    pub fallback: usize,
    pub substituted: usize,
    pub routes: Vec<PlannedRoute>,
    pub branches: Vec<Vec<Point>>,
    pub reason: Option<&'static str>,
    pub body: Triangles,
    pub pads: Triangles,
    /// Schmale Teile der Kontaktlage, voll gedruckt.
    pub strips: Triangles,
    /// Kontaktbahnen der obersten Schicht (leer, wenn die oberste Schicht als Polster gedruckt wird).
    pub lines: Triangles,
}

struct Cached {
    key: Vec<u8>,
    meshes: Vec<Arc<crate::mesh::Mesh>>,
    plans: Arc<Vec<ModelPlan>>,
}

const KEPT_PLANS: usize = 4;
static CACHE: Mutex<Vec<Cached>> = Mutex::new(Vec::new());

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

pub fn plate(items: &[Item]) -> Result<Arc<Vec<ModelPlan>>, String> {
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
    {
        let cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        let same = |cached: &Cached| {
            cached.key == key
                && cached.meshes.len() == items.len()
                && cached.meshes.iter().zip(items).all(|(mesh, item)| Arc::ptr_eq(mesh, &item.mesh))
        };
        if let Some(found) = cache.iter().find(|cached| same(cached)) {
            return Ok(Arc::clone(&found.plans));
        }
    }
    let plans = Arc::new(build(items, &envs));
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if cache.len() >= KEPT_PLANS {
        cache.remove(0);
    }
    cache.push(Cached { key, meshes: items.iter().map(|item| Arc::clone(&item.mesh)).collect(), plans: Arc::clone(&plans) });
    Ok(plans)
}

struct Entry<'a> {
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

    fn route(&mut self, field: &mut SolidField) {
        let bed_only = self.item.data.settings.placement == "buildplate";
        let mut contacts = self.pending.clone();
        let mut round = 0;
        let mut give_rounds = 0;
        while !contacts.is_empty() {
            let routed = route_supports(&Context::new(field, self.env, self.item.bed, bed_only), &contacts);
            let failed: Vec<usize> = routed.routes.iter().filter(|route| !route.ok).map(|route| route.support).collect();
            // Jede Runde sucht alle Wege neu. Nach einigen Runden bleiben die gefundenen Wege, der Rest wird Pfeiler.
            let settle = give_rounds >= MAX_GIVE_UP_ROUNDS && failed.iter().all(|&i| contacts[i].slim);
            if failed.is_empty() || settle {
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

fn build(items: &[Item], envs: &[Env]) -> Vec<ModelPlan> {
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
        let mut owned: Vec<(Vec<f64>, Vec<u32>)> = Vec::new();
        for item in items {
            let world = world_of(item);
            owned.push((world.vertices.clone(), world.indices.clone()));
            let place = item.input.placed();
            for part in &item.input.parts {
                owned.push((
                    part.vertices.iter().flat_map(|&v| place.apply(v)).collect(),
                    part.triangles.iter().flatten().copied().collect(),
                ));
            }
        }
        let solids: Vec<Solid> = owned.iter().map(|(vertices, indices)| Solid { vertices, indices }).collect();
        let clock = std::time::Instant::now();
        let mut field = SolidField::new(&solids);
        profile(&format!("feld {} ms", clock.elapsed().as_millis()));
        for entry in &state {
            entry.add_pillars(&mut field, 0);
        }
        for entry in state.iter_mut() {
            if entry.pending.is_empty() {
                continue;
            }
            let n = entry.pending.len();
            entry.route(&mut field);
            profile(&format!("route {} Kontakte {} ms", n, clock.elapsed().as_millis()));
            entry.block_space(&mut field);
            profile(&format!("block {} ms", clock.elapsed().as_millis()));
        }
    }

    // Kontaktbahnen sind Standard. Der fruehere dichte Kontakt nur noch fuer Vergleichsmessungen.
    let contact_lines = std::env::var("SIMPLIY_CONTACT").as_deref() != Ok("dense");
    state
        .into_iter()
        .map(|entry| {
            // Oberste Schicht der Polster und Streifen als einzelne Bahnen, darunter bleibt alles tragend.
            let (dense, strips, lines) = if contact_lines {
                let points: Vec<[f64; 2]> = entry.routes.iter().map(|r| [r.support.x, r.support.y]).collect();
                let tip = crate::supports::contact::CONTACT_RADIUS;
                let clock = std::time::Instant::now();
                let (dense, mut tops) = crate::supports::contact_lines::split(&entry.dense, entry.env.layer, entry.env.line_width, &points, tip);
                let (strips, more) = crate::supports::contact_lines::split(&entry.strips, entry.env.layer, entry.env.line_width, &points, tip);
                tops.extend(more);
                let pitch = entry.env.line_width + entry.env.contact_gap;
                let style = crate::supports::contact_lines::Style { angle: entry.env.angle, grid: entry.env.grid, loops: entry.env.loops };
                profile(&format!("bahnen split {} ms", clock.elapsed().as_millis()));
                let (lines, kept) = crate::supports::contact_lines::lines(&tops, entry.env.line_width, pitch, &points, style);
                let mut dense = dense;
                dense.extend(kept);
                profile(&format!("bahnen lines {} ms", clock.elapsed().as_millis()));
                // Fuesse auf dem Teil: mit unteren Kontaktlagen wird nur ihre unterste Schicht zu Bahnen,
                // darueber bleiben sie dicht und tragen. Ohne untere Kontaktlagen bleiben sie ganz dicht.
                let mut lines = lines;
                if entry.env.bottom_layers >= 1.0 {
                    let (rest, under, kept_under) = crate::supports::contact_lines::bottom(&entry.feet, entry.env.layer, entry.env.line_width, entry.env.bottom_pitch, style);
                    dense.extend(rest);
                    dense.extend(kept_under);
                    lines.extend(under);
                } else {
                    dense.extend_from_slice(&entry.feet);
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
                (dense, strips, lines)
            } else {
                (entry.dense.iter().chain(&entry.feet).copied().collect(), entry.strips.clone(), Vec::new())
            };
            let mut body = branch_mesh(&simplified(&entry.branches), BRANCH_SIDES);
            body.append(&boxes_mesh(&entry.solids));
            ModelPlan {
                env: entry.env,
                substituted: entry.routes.iter().filter(|route| route.as_tree).count(),
                pads: boxes_mesh(&dense),
                strips: boxes_mesh(&strips),
                lines: boxes_mesh(&lines),
                body,
                native: entry.native,
                skipped: entry.skipped,
                fallback: entry.fallback,
                routes: entry.routes,
                branches: entry.branches,
                reason: entry.reason,
            }
        })
        .collect()
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
            let _ = writeln!(f, "{text}");
        }
    }
}
