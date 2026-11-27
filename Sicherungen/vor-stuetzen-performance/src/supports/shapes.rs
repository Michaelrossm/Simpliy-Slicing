//! Formen: Baum, Faecher, Knotenblech, dazu Pfeiler und Mini auf dem Teil als gerade Saeule. Vom Bett baut Prusa sie.
//! Jeder Ast ist eine Kette waagerechter Kreise, damit jede Schicht einen sauberen Kreis schneidet.
use super::{
    contact::{contact_head, Head, HeadInput},
    field::NUDGE,
    context::{Block, Context, Point, TipStart},
    types::{is_column, Shape, Support},
};
use crate::util::{hypot3, round_up, FastMap};
use std::f64::consts::PI;

const BEND_COST: f64 = 5.0; // mm: ein Knick muss mindestens so viel Weg sparen
const LANDING_COST: f64 = 3.0; // mm: Auflage auf dem Teil hinterlaesst Spuren
const MERGE_DISTANCE: f64 = 14.0;
const MERGE_LEVELS: usize = 3; // hoechstens drei Vereinigungen uebereinander
const MERGE_SAVING: f64 = 6.0; // mm, die eine Vereinigung mindestens spart
const BODY_LIMIT: f64 = 2.5; // groesster Stamm = Vielfaches der Astbreite
const GROWTH: f64 = 0.12; // mm Radius je mm Hoehe
const ASIDE: [f64; 4] = [0.6, 1.0, 1.4, 1.8]; // mm, die eine Spitze hoechstens vom Punkt wegrueckt

struct Tip {
    support: usize,
    style: String,
    shape: Shape,
    x: f64,
    y: f64,
    top: f64,
    points: Vec<Point>,
    head: Head,
    /// Neben dem Punkt: bekommt eine eigene gerade Saeule, keinen Strahl und keinen Wandanker.
    aside: bool,
    as_tree: bool,
    done: bool,
    floor: f64,
}

pub struct Route {
    /// Stelle in `contacts`.
    pub support: usize,
    pub ok: bool,
    pub as_tree: bool,
    pub tip: f64,
    #[cfg_attr(not(test), allow(dead_code))]
    pub floor: f64,
    pub samples: Vec<[f64; 3]>,
}

pub struct Routed {
    pub branches: Vec<Vec<Point>>,
    pub routes: Vec<Route>,
    pub dense: Vec<Block>,
    /// Fuesse auf Bett oder Teil: tragen den Ast und sind keine Kontaktflaeche unter dem Bauteil.
    pub feet: Vec<Block>,
    pub strips: Vec<Block>,
    pub solids: Vec<Block>,
}

struct Output {
    branches: Vec<Vec<Point>>,
    feet: Vec<Block>,
}

pub fn route_supports(ctx: &Context, contacts: &[Support]) -> Routed {
    let clock = std::time::Instant::now();
    let mut tips: Vec<Tip> = Vec::new();
    let mut failed = Vec::new();
    // Jeder Kopf haengt nur vom Feld ab, nicht von den anderen: auf alle Kerne verteilen.
    let heads = |support: &Support| -> (Shape, Option<Made>, bool) {
        let shape = Shape::of(support.shape.as_ref());
        // Kopf zuerst: Ohne echten Kontakt lohnt sich kein Ast, dann stuetzt Prusa die Stelle.
        let mut made = head_at(ctx, support, &shape, None);
        let mut moved = false;
        // Dicht an einer Wand passt keine Spitze senkrecht unter den Punkt oder kein Weg darunter.
        // Ein Pfeiler auf dem Teil waere dort ein Streifen mit schwebenden Schichten, daneben ist meist Platz.
        // Vom Bett aus druckt Prusa auch schmale Pfeiler sauber.
        if support.slim && support.bottom_z > 1e-6 && !made.as_ref().is_some_and(|made| has_way(ctx, &shape, &made.2)) {
            if let Some(aside) = head_aside(ctx, support, &shape) {
                made = Some(aside);
                moved = true;
            }
        }
        (shape, made, moved)
    };
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).min(contacts.len().div_ceil(8).max(1));
    let computed: Vec<(Shape, Option<Made>, bool)> = if workers <= 1 {
        contacts.iter().map(heads).collect()
    } else {
        let size = contacts.len().div_ceil(workers);
        std::thread::scope(|scope| {
            let jobs: Vec<_> = contacts.chunks(size).map(|part| scope.spawn(|| part.iter().map(&heads).collect::<Vec<_>>())).collect();
            jobs.into_iter().flat_map(|job| job.join().expect("Kopfberechnung")).collect()
        })
    };
    for (index, (support, (shape, made, moved))) in contacts.iter().zip(computed).enumerate() {
        match made {
            Some(([x, y], start, points, head)) => tips.push(Tip {
                support: index,
                style: support.style().unwrap_or_default().to_owned(),
                shape,
                x,
                y,
                top: start.top,
                points,
                head,
                aside: moved || is_column(support),
                as_tree: false,
                done: false,
                floor: 0.0,
            }),
            None => failed.push(index),
        }
    }

    crate::supports::plan::profile(&format!("  koepfe {} von {}: {} ms", tips.len(), contacts.len(), clock.elapsed().as_millis()));
    let mut out = Output { branches: Vec::new(), feet: Vec::new() };
    let of_style = |tips: &[Tip], style: &str| -> Vec<usize> {
        (0..tips.len()).filter(|&i| tips[i].style == style && !tips[i].aside).collect()
    };
    let mut tree_tips: Vec<usize> = (0..tips.len()).filter(|&i| tips[i].style == "tree" || tips[i].aside).collect();
    let fans = of_style(&tips, "fan");
    for group in neighbours(&tips, fans) {
        let left = fan(ctx, &mut tips, group, &mut out);
        tree_tips.extend(left);
    }
    let mut towards = None;
    let gussets = of_style(&tips, "gusset");
    for index in along_rows(&tips, gussets) {
        match gusset(ctx, &mut tips[index], towards, &mut out) {
            Some(direction) => towards = Some(direction),
            None => tree_tips.push(index),
        }
    }
    for &index in &tree_tips {
        tips[index].as_tree = !matches!(tips[index].style.as_str(), "tree" | "pillar" | "mini");
    }
    crate::supports::plan::profile(&format!("  vor Baeumen {} ms", clock.elapsed().as_millis()));
    trees(ctx, &mut tips, &tree_tips, &mut out);
    crate::supports::plan::profile(&format!("  Baeume {} ms", clock.elapsed().as_millis()));

    // Auch der Fuss ist Kontaktlage: Duenne Streifen an Schraegen verschluckt eine Wand.
    let feet = out.feet;
    let mut dense = Vec::new();
    let mut solids = Vec::new();
    let mut strips = Vec::new();
    for tip in tips.iter().filter(|tip| tip.done) {
        dense.extend_from_slice(&tip.head.dense);
        solids.extend_from_slice(&tip.head.stem);
        strips.extend_from_slice(&tip.head.strips);
    }
    let mut routes: Vec<Route> = tips
        .into_iter()
        .map(|tip| Route { support: tip.support, ok: tip.done, as_tree: tip.as_tree, tip: tip.top, floor: tip.floor, samples: tip.head.samples })
        .collect();
    routes.extend(failed.into_iter().map(|support| Route { support, ok: false, as_tree: false, tip: 0.0, floor: 0.0, samples: Vec::new() }));
    Routed { branches: out.branches, routes, dense, feet, strips, solids }
}

type Made = ([f64; 2], TipStart, Vec<Point>, Head);

/// `moved`: Stelle und Unterseite, wenn die Spitze neben dem Punkt steht.
fn head_at(ctx: &Context, support: &Support, shape: &Shape, moved: Option<[f64; 3]>) -> Option<Made> {
    let [x, y, surface] = moved.unwrap_or([support.x, support.y, support.surface_z]);
    let start = ctx.tip(x, y, surface, shape)?;
    let points = ctx.neck(x, y, &start, shape);
    let input = HeadInput {
        x,
        y,
        r: start.r,
        top: start.top,
        neck_low: points[points.len() - 1][2],
        surface,
        shape,
        target: moved.map(|_| [support.x, support.y, support.surface_z]),
    };
    let head = contact_head(ctx, input)?;
    Some(([x, y], start, points, head))
}

fn has_way(ctx: &Context, shape: &Shape, neck: &[Point]) -> bool {
    let tan = (shape.branch_angle * PI / 180.0).tan();
    straight_route(ctx, neck[neck.len() - 1], tan, &[], Search { limit: f64::INFINITY, bend: true }).is_some()
}

/// Naechste Stelle neben dem Punkt, von der aus Kontakt und Weg gehen.
fn head_aside(ctx: &Context, support: &Support, shape: &Shape) -> Option<Made> {
    let mut best: Option<(f64, Made)> = None;
    for away in ASIDE {
        for [ux, uy] in ctx.around16 {
            let (x, y) = (support.x + ux * away, support.y + uy * away);
            // Dieselbe Unterseite, nicht irgendeine darueber.
            let near = |z: &f64| (z - support.surface_z).abs();
            let Some(surface) = ctx
                .field
                .crossings(x + NUDGE[0], y + NUDGE[1])
                .into_iter()
                .filter(|&(z, sign)| sign > 0 && near(&z) <= away * 2.75 + 0.3)
                .map(|(z, _)| z)
                .min_by(|a, b| near(a).total_cmp(&near(b)))
            else {
                continue;
            };
            let Some(made) = head_at(ctx, support, shape, Some([x, y, surface])) else { continue };
            // Mehr Kontakt zaehlt, weiter weg und eine andere Hoehe kosten.
            let score = made.3.reached - 0.05 * away - 0.2 * (surface - support.surface_z).abs();
            if best.as_ref().is_some_and(|(most, _)| score <= *most) || !has_way(ctx, shape, &made.2) {
                continue;
            }
            best = Some((score, made));
        }
    }
    best.map(|(_, made)| made)
}

// Baum: gerade zuerst. Aeste werden als ganze Strecken gesucht, nie Millimeter fuer Millimeter.

fn flat(a: &Point, b: &Point) -> f64 {
    (b[0] - a[0]).hypot(b[1] - a[1])
}

fn length(a: &Point, b: &Point) -> f64 {
    hypot3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

/// Waagerechte Richtung, None bei senkrecht.
fn heading(a: &Point, b: &Point) -> Option<[f64; 2]> {
    let d = flat(a, b);
    (d > 0.05).then(|| [(b[0] - a[0]) / d, (b[1] - a[1]) / d])
}

fn turns_back(before: [f64; 2], after: Option<[f64; 2]>) -> bool {
    after.is_some_and(|after| before[0] * after[0] + before[1] * after[1] < -0.02)
}

#[derive(Clone)]
struct Path {
    points: Vec<Point>,
    cost: f64,
    floor: f64,
    pad: Option<Vec<Block>>,
}

impl Path {
    fn to_bed(points: Vec<Point>, cost: f64) -> Path {
        Path { points, cost, floor: 0.0, pad: None }
    }
}

struct Search {
    limit: f64,
    bend: bool,
}

/// Reihenfolge: senkrecht (Bett oder Teil), eine Gerade zum Bett, hoechstens ein Knick.
/// `incoming`: Richtungen der ankommenden Aeste. Zurueck geht es nie.
fn straight_route(ctx: &Context, at: Point, tan: f64, incoming: &[[f64; 2]], search: Search) -> Option<Path> {
    let [x, y, z, r] = at;
    if z <= 1e-6 {
        return Some(Path::to_bed(vec![at], 0.0));
    }
    let down = [x, y, 0.0, r];
    if ctx.on_bed(x, y, r) && ctx.clear(at, down) {
        return Some(Path::to_bed(vec![at, down], z));
    }
    if let Some(below) = ctx.landing(at) {
        let cost = z - below.foot[2] + LANDING_COST;
        return Some(Path { points: vec![at, below.foot], cost, floor: below.floor, pad: Some(below.pad) });
    }

    let mut best: Option<Path> = None;
    let most = 40f64.min(z * tan);
    for [ux, uy] in ctx.around24 {
        if incoming.iter().any(|&before| turns_back(before, Some([ux, uy]))) {
            continue;
        }
        let mut d = 0.5;
        while d <= most {
            let here = d;
            d += if d < 6.0 { 0.5 } else if d < 16.0 { 1.0 } else { 2.0 };
            let steep = here / tan;
            let arrive = (z - steep).max(0.0);
            let bed_cost = z.hypot(here);
            let bent_cost = steep.hypot(here) + BEND_COST;
            let best_cost = best.as_ref().map_or(f64::INFINITY, |b| b.cost);
            // Billiger als so wird es in dieser Richtung nicht mehr.
            if bed_cost.min(if search.bend { bent_cost } else { f64::INFINITY }) >= search.limit.min(best_cost) {
                break;
            }
            let (tx, ty) = (x + ux * here, y + uy * here);
            if !ctx.on_bed(tx, ty, r) {
                break;
            }
            let ground = [tx, ty, 0.0, r];
            if bed_cost < best_cost && ctx.clear(at, ground) {
                best = Some(Path::to_bed(vec![at, ground], bed_cost));
                break;
            }
            if !search.bend || arrive < 0.5 || bent_cost >= best_cost {
                continue;
            }
            let turn = [tx, ty, arrive, r];
            if !ctx.clear(at, turn) {
                continue;
            }
            let to_bed = bent_cost + arrive;
            if to_bed < best_cost && ctx.clear(turn, ground) {
                best = Some(Path::to_bed(vec![at, turn, ground], to_bed));
                break;
            }
            let Some(rest) = ctx.landing(turn) else { continue };
            let to_part = bent_cost + arrive - rest.foot[2] + LANDING_COST;
            if to_part < best_cost {
                best = Some(Path { points: vec![at, turn, rest.foot], cost: to_part, floor: rest.floor, pad: Some(rest.pad) });
            }
        }
    }
    best
}

/// Stamm unterhalb einer Vereinigung allmaehlich dicker, soweit Platz ist.
fn thickened(ctx: &Context, points: &[Point], wanted: f64, landed: bool) -> Vec<Point> {
    let mut r = points[0][3];
    if wanted <= r + 0.01 {
        return points.to_vec();
    }
    let mut out = vec![points[0]];
    let mut a = points[0];
    let last = points.len().saturating_sub(if landed { 2 } else { 1 }); // Das Stueck bis zur Auflage bleibt, wie es geprueft ist.
    for (i, &b) in points.iter().enumerate().skip(1) {
        let drop = a[2] - b[2];
        let grown = if i <= last { wanted.min(r + GROWTH * drop) } else { r };
        if grown > r + 0.01 {
            let share = ((grown - r) / GROWTH / drop).min(1.0);
            let full = [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share, grown];
            let end = [b[0], b[1], b[2], grown];
            let fits = if share > 0.999 { ctx.clear(a, end) } else { ctx.clear(a, full) && ctx.clear(full, end) };
            if fits {
                if share <= 0.999 {
                    out.push(full);
                }
                out.push(end);
                a = end;
                r = grown;
                continue;
            }
        }
        a = [b[0], b[1], b[2], r.min(if i <= last { r } else { b[3] })];
        out.push(a);
    }
    out
}

#[derive(Clone)]
struct Node {
    at: Point,
    tan: f64,
    shape: Shape,
    tips: Vec<usize>,
    parts: Vec<Vec<Point>>,
    incoming: Vec<[f64; 2]>,
    route: Option<Path>,
}

/// `work` auf alle Kerne verteilen, Reihenfolge bleibt erhalten.
fn par_map<T: Sync, R: Send>(items: &[T], work: impl Fn(usize, &T) -> R + Sync) -> Vec<R> {
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).min(items.len().div_ceil(8).max(1));
    if workers <= 1 {
        return items.iter().enumerate().map(|(i, item)| work(i, item)).collect();
    }
    let size = items.len().div_ceil(workers);
    std::thread::scope(|scope| {
        let jobs: Vec<_> = items
            .chunks(size)
            .enumerate()
            .map(|(c, part)| {
                let work = &work;
                scope.spawn(move || part.iter().enumerate().map(|(i, item)| work(c * size + i, item)).collect::<Vec<_>>())
            })
            .collect();
        jobs.into_iter().flat_map(|job| job.join().expect("Berechnung")).collect()
    })
}

fn trees(ctx: &Context, tips: &mut [Tip], members: &[usize], out: &mut Output) {
    let mut nodes: Vec<Node> = par_map(members, |_, &index| {
            let tip = &tips[index];
            let at = tip.points[tip.points.len() - 1];
            let tan = (tip.shape.branch_angle * PI / 180.0).tan();
            let route = straight_route(ctx, at, tan, &[], Search { limit: f64::INFINITY, bend: true });
            Node { at, tan, shape: tip.shape, tips: vec![index], parts: vec![tip.points.clone()], incoming: Vec::new(), route }
        });

    for _ in 0..MERGE_LEVELS {
        let merges = join_candidates(ctx, &nodes, tips);
        if merges.is_empty() {
            break;
        }
        let mut taken = vec![false; nodes.len()];
        let mut joined = Vec::new();
        for merge in merges {
            if taken[merge.a] || taken[merge.b] {
                continue;
            }
            taken[merge.a] = true;
            taken[merge.b] = true;
            joined.push(merge.node);
        }
        let mut next: Vec<Node> = nodes.into_iter().zip(taken).filter(|(_, taken)| !taken).map(|(node, _)| node).collect();
        next.extend(joined);
        nodes = next;
    }

    let standing: Vec<(usize, Point)> = nodes
        .iter()
        .enumerate()
        .filter_map(|(i, node)| node.route.as_ref().filter(|route| route.pad.is_none()).map(|route| (i, route.points[route.points.len() - 1])))
        .collect();
    for (i, node) in nodes.iter().enumerate() {
        // Ohne vernuenftigen Weg druckt Prusa dort einen geraden Pfeiler.
        let Some(route) = &node.route else { continue };
        let body = node.shape.body_width / 2.0;
        let wanted = (body * BODY_LIMIT).min(body * (1.0 + node.shape.thicken / 100.0 * (node.tips.len() - 1) as f64).sqrt());
        let points = thickened(ctx, &route.points, wanted, route.pad.is_some());
        out.branches.extend(node.parts.iter().filter(|part| part.len() > 1).cloned());
        if points.len() > 1 {
            out.branches.push(points.clone());
        }
        match &route.pad {
            Some(pad) => out.feet.extend_from_slice(pad),
            None => {
                // Kurze Stuetzen brauchen keinen breiten Fuss, benachbarte wuerden zu einem hohlen Klotz verschmelzen.
                let highest = node.tips.iter().map(|&t| tips[t].top).fold(f64::NEG_INFINITY, f64::max);
                if highest >= 2.0 * node.shape.base_height {
                    // Fuesse duerfen sich nicht beruehren, sonst entstehen hohle Zwickel mit schwebenden Waenden.
                    let own = route.points[route.points.len() - 1];
                    let room = standing
                        .iter()
                        .filter(|(other, _)| *other != i)
                        .fold(f64::INFINITY, |room, (_, other)| room.min((flat(&own, other) - 0.2) / 2.0));
                    if let Some(base) = ctx.flare(&points, &node.shape, room) {
                        out.branches.push(base);
                    }
                }
            }
        }
        for &tip in &node.tips {
            tips[tip].done = true;
            tips[tip].floor = route.floor;
        }
    }
}

struct Merge {
    a: usize,
    b: usize,
    saving: f64,
    node: Node,
}

/// Nachbarn, die mit zwei geraden Aesten und einem Stamm deutlich kuerzer werden, beste zuerst.
fn join_candidates(ctx: &Context, nodes: &[Node], tips: &[Tip]) -> Vec<Merge> {
    // Nur echte Baeume wachsen zusammen. Ersatz fuer Faecher und Knotenblech bleibt einzeln und gerade.
    let open: Vec<usize> = (0..nodes.len())
        .filter(|&i| nodes[i].route.is_some() && !nodes[i].tips.iter().any(|&t| tips[t].as_tree || tips[t].aside))
        .collect();
    let cell = |x: f64, y: f64| ((x / MERGE_DISTANCE).floor() as i32, (y / MERGE_DISTANCE).floor() as i32);
    let mut cells: FastMap<(i32, i32), Vec<usize>> = FastMap::default();
    for (i, &node) in open.iter().enumerate() {
        cells.entry(cell(nodes[node].at[0], nodes[node].at[1])).or_default().push(i);
    }
    let per_node = par_map(&open, |i, &a| {
        let mut found = Vec::new();
        let at = nodes[a].at;
        let mut near = Vec::new();
        for dx in -1..=1 {
            for dy in -1..=1 {
                let key = cell(at[0] + f64::from(dx) * MERGE_DISTANCE, at[1] + f64::from(dy) * MERGE_DISTANCE);
                for &j in cells.get(&key).map_or(&[][..], Vec::as_slice) {
                    let d = flat(&at, &nodes[open[j]].at);
                    if j > i && d <= MERGE_DISTANCE {
                        near.push((d, open[j]));
                    }
                }
            }
        }
        near.sort_by(|p, q| p.0.total_cmp(&q.0));
        for &(_, b) in near.iter().take(5) {
            if let Some((saving, node)) = junction(ctx, &nodes[a], &nodes[b]) {
                found.push(Merge { a, b, saving, node });
            }
        }
        found
    });
    let mut found: Vec<Merge> = per_node.into_iter().flatten().collect();
    found.sort_by(|p, q| q.saving.total_cmp(&p.saving));
    found
}

fn junction(ctx: &Context, a: &Node, b: &Node) -> Option<(f64, Node)> {
    let (route_a, route_b) = (a.route.as_ref()?, b.route.as_ref()?);
    let tan = a.tan.min(b.tan);
    let (wa, wb) = (a.tips.len() as f64, b.tips.len() as f64);
    let (end_of_a, end_of_b) = (route_a.points[route_a.points.len() - 1], route_b.points[route_b.points.len() - 1]);
    let spots = [
        [(a.at[0] * wa + b.at[0] * wb) / (wa + wb), (a.at[1] * wa + b.at[1] * wb) / (wa + wb)],
        [end_of_a[0], end_of_a[1]], // auf den geraden Weg des einen, der andere stoesst dazu
        [end_of_b[0], end_of_b[1]],
    ];
    let apart = route_a.cost + route_b.cost;
    let mut best: Option<(f64, Node)> = None;
    for [x, y] in spots {
        let (da, db) = ((x - a.at[0]).hypot(y - a.at[1]), (x - b.at[0]).hypot(y - b.at[1]));
        let z = (a.at[2] - da / tan).min(b.at[2] - db / tan);
        if z < 1.0 {
            continue;
        }
        let at = [x, y, z, a.at[3].max(b.at[3])];
        let arms = length(&a.at, &at) + length(&b.at, &at);
        if apart - arms < MERGE_SAVING {
            continue;
        }
        let (end_a, end_b) = ([x, y, z, a.at[3]], [x, y, z, b.at[3]]);
        let (ha, hb) = (heading(&a.at, &at), heading(&b.at, &at));
        if a.incoming.iter().any(|&h| turns_back(h, ha)) || b.incoming.iter().any(|&h| turns_back(h, hb)) {
            continue;
        }
        if !ctx.clear(a.at, end_a) || !ctx.clear(b.at, end_b) {
            continue;
        }
        let incoming: Vec<[f64; 2]> = [ha, hb].into_iter().flatten().collect();
        // Unter einer Vereinigung laeuft der Stamm gerade, sonst bleiben die Aeste lieber einzeln.
        let worth = (apart - arms - MERGE_SAVING).min(0.8 * apart - arms);
        if worth <= 0.0 {
            continue;
        }
        let Some(route) = straight_route(ctx, at, tan, &incoming, Search { limit: worth, bend: false }) else { continue };
        let saving = apart - arms - route.cost;
        if saving < MERGE_SAVING || saving < 0.2 * apart || best.as_ref().is_some_and(|(s, _)| saving <= *s) {
            continue;
        }
        let mut parts: Vec<Vec<Point>> = a.parts.iter().chain(&b.parts).cloned().collect();
        for (from, to) in [(a.at, end_a), (b.at, end_b)] {
            if length(&from, &to) > 1e-3 {
                parts.push(vec![from, to]);
            }
        }
        let node = Node {
            at,
            tan,
            shape: if wa >= wb { a.shape } else { b.shape },
            tips: a.tips.iter().chain(&b.tips).copied().collect(),
            parts,
            incoming,
            route: Some(route),
        };
        best = Some((saving, node));
    }
    best
}

// Faecher: gerade Strahlen auf einen Stamm

fn neighbours(tips: &[Tip], mut left: Vec<usize>) -> Vec<Vec<usize>> {
    let mut groups = Vec::new();
    while !left.is_empty() {
        let mut first = 0;
        for i in 1..left.len() {
            let (p, q) = (&tips[left[i]], &tips[left[first]]);
            if p.x < q.x || (p.x == q.x && p.y < q.y) {
                first = i;
            }
        }
        let start = left.remove(first);
        let mut group = vec![start];
        while (group.len() as f64) < round_up(tips[start].shape.fan_count) {
            let mut best = None;
            let mut nearest = 14.0;
            for (i, &candidate) in left.iter().enumerate() {
                for &member in &group {
                    let (p, q) = (&tips[candidate], &tips[member]);
                    let d = hypot3(p.x - q.x, p.y - q.y, p.top - q.top);
                    if d < nearest {
                        nearest = d;
                        best = Some(i);
                    }
                }
            }
            let Some(best) = best else { break };
            group.push(left.remove(best));
        }
        groups.push(group);
    }
    groups
}

/// Gibt die Spitzen zurueck, die der Baum uebernehmen soll.
fn fan(ctx: &Context, tips: &mut [Tip], group: Vec<usize>, out: &mut Output) -> Vec<usize> {
    if group.len() < 2 {
        return group;
    }
    let shape = tips[group[0]].shape;
    let tan = (shape.branch_angle * PI / 180.0).tan();
    let count = group.len() as f64;
    let cx = group.iter().fold(0.0, |sum, &t| sum + tips[t].x) / count;
    let cy = group.iter().fold(0.0, |sum, &t| sum + tips[t].y) / count;
    let body = shape.body_width / 2.0;
    let trunk = (body * BODY_LIMIT).min(body * (1.0 + shape.thicken / 100.0 * (count - 1.0)).sqrt());
    let mut spots = vec![[0.0, 0.0]];
    for d in [2.0, 4.0, 7.0, 10.0] {
        spots.extend(ctx.around16.iter().map(|[ux, uy]| [ux * d, uy * d]));
    }
    let ends: Vec<Point> = group.iter().map(|&t| tips[t].points[tips[t].points.len() - 1]).collect();

    for [dx, dy] in spots {
        let (hx, hy) = (cx + dx, cy + dy);
        let hz = ends.iter().fold(f64::INFINITY, |low, [x, y, z, _]| low.min(z - (x - hx).hypot(y - hy) / tan));
        if hz < shape.base_height + 1.0 {
            continue;
        }
        if !ctx.clear([hx, hy, hz, trunk], [hx, hy, 0.0, trunk]) {
            continue;
        }
        let hub = [hx, hy, hz, body];
        if !ends.iter().all(|&end| ctx.clear(end, hub)) {
            continue;
        }
        // Oben so schmal wie die Strahlen, sonst beginnt deren Wand ueber dem hohlen Stamm.
        let taper = shape.base_height.max(hz - 3.0 * (trunk - body));
        let stem = if taper < hz - 1e-3 {
            vec![hub, [hx, hy, taper, trunk], [hx, hy, 0.0, trunk]]
        } else {
            vec![hub, [hx, hy, 0.0, body]]
        };
        let base = ctx.flare(&stem, &shape, f64::INFINITY);
        for &t in &group {
            out.branches.push(tips[t].points.iter().copied().chain([hub]).collect());
            tips[t].done = true;
        }
        out.branches.push(stem);
        out.branches.extend(base);
        return Vec::new();
    }
    if group.len() < 4 {
        return group;
    }
    let span = |value: &dyn Fn(&Tip) -> f64| {
        let values = group.iter().map(|&t| value(&tips[t]));
        values.clone().fold(f64::NEG_INFINITY, f64::max) - values.fold(f64::INFINITY, f64::min)
    };
    let by_x = span(&|t| t.x) >= span(&|t| t.y);
    let mut sorted = group.clone();
    sorted.sort_by(|&a, &b| if by_x { tips[a].x.total_cmp(&tips[b].x) } else { tips[a].y.total_cmp(&tips[b].y) });
    let second = sorted.split_off(sorted.len() / 2);
    let mut left = fan(ctx, tips, sorted, out);
    left.extend(fan(ctx, tips, second, out));
    left
}

// Knotenblech: schraeg von der naechsten Wand, ohne Material bis zum Bett

fn along_rows(tips: &[Tip], mut members: Vec<usize>) -> Vec<usize> {
    members.sort_by(|&a, &b| {
        let (p, q) = (&tips[a], &tips[b]);
        round_up(p.top)
            .total_cmp(&round_up(q.top))
            .then(round_up(p.y).total_cmp(&round_up(q.y)))
            .then(p.x.total_cmp(&q.x))
    });
    members
}

struct Anchor {
    score: f64,
    points: Vec<Point>,
    direction: [f64; 2],
    floor: f64,
}

fn gusset(ctx: &Context, tip: &mut Tip, towards: Option<[f64; 2]>, out: &mut Output) -> Option<[f64; 2]> {
    let tan = (tip.shape.branch_angle.min(45.0) * PI / 180.0).tan();
    let end = tip.points[tip.points.len() - 1];
    let [x, y, z, r] = end;
    let mut best: Option<Anchor> = None;
    for [ux, uy] in ctx.around24 {
        // Nachbarn sollen parallel laufen.
        let penalty = towards.map_or(0.0, |t| 3.0 * (1.0 - ux * t[0] - uy * t[1]));
        let mut d = 0.4;
        while d <= 40.0 {
            let here = d;
            d += 0.4;
            if best.as_ref().is_some_and(|b| here + penalty >= b.score) {
                break;
            }
            let (px, py, pz) = (x + ux * here, y + uy * here, z - here / tan);
            if pz < 1.0 || !ctx.on_bed(px, py, r) {
                break;
            }
            if !ctx.field.inside(px, py, pz) {
                continue;
            }
            // Genauer Wandpunkt
            let (mut outside, mut within) = (here - 0.4, here);
            for _ in 0..12 {
                let mid = (outside + within) / 2.0;
                if ctx.field.inside(x + ux * mid, y + uy * mid, z - mid / tan) {
                    within = mid;
                } else {
                    outside = mid;
                }
            }
            let wall = outside;
            // Nur an Waenden ankern. Auf einer Oberseite wuerde der Ast festschmelzen und Narben lassen.
            let over = pz + r.max(1.0);
            let (beyond, before) = (wall + 0.5, (wall - 0.5).max(0.0));
            if !ctx.field.inside(x + ux * beyond, y + uy * beyond, z - wall / tan + r.max(1.0))
                || ctx.field.inside(x + ux * before, y + uy * before, z - wall / tan - 0.5f64.max(r / 2.0))
                || over >= tip.top
            {
                break;
            }
            let along = |dist: f64, radius: f64| [x + ux * dist, y + uy * dist, z - dist / tan, radius];
            let foot = r.min(1.2 * ctx.env.line_width);
            // Ab hier beruehrt der Ast die Wand absichtlich, sonst hinge er in der Luft.
            let near = (wall - r - ctx.env.xy_gap - 0.6).max(0.0);
            if near > 0.05 && !ctx.clear_by(end, along(near, r), 0.0) {
                break;
            }
            let mut points = tip.points.clone();
            if near > 0.05 {
                points.push(along(near, r));
            }
            points.push(along(wall, foot));
            best = Some(Anchor { score: wall + penalty, points, direction: [ux, uy], floor: z - wall / tan });
            break;
        }
    }
    let best = best?;
    out.branches.push(best.points);
    tip.done = true;
    tip.floor = best.floor;
    Some(best.direction)
}
