// Bemalung im Format von PrusaSlicer (TriangleSelector), ohne Abhaengigkeit von three.js.
//
// Je Dreieck ein Baum: Blatt = Zustand (0 leer, 1 Enforcer, 2 Blocker bzw. Werkzeugnummer),
// Knoten = vier Kinder in Prusas Reihenfolge fuer "split_sides = 3".

const HEX = '0123456789ABCDEF';
const MAX_DEPTH = 11;

export function encode(tree) {
  const nibbles = [];
  const walk = node => {
    if (Array.isArray(node)) {
      nibbles.push(3);
      for (let child = 3; child >= 0; child--) walk(node[child]);
    } else if (node < 3) {
      nibbles.push(node << 2);
    } else if (node <= 16) {
      nibbles.push(12, node - 3);
    } else {
      throw Error('Mehr als 16 Werkzeuge werden nicht unterstützt');
    }
  };
  walk(tree);
  return nibbles.reverse().map(n => HEX[n]).join('');
}

export function decode(code) {
  let at = code.length;
  const next = () => {
    const value = at > 0 ? HEX.indexOf(code[--at]) : -1;
    if (value < 0) throw Error('Bemalung ist beschädigt');
    return value;
  };
  const walk = depth => {
    if (depth > 32) throw Error('Bemalung ist beschädigt');
    const n = next();
    if (n & 3) {
      if ((n & 3) !== 3) throw Error('Unbekannte Dreiecksteilung');
      const children = [];
      for (let child = 3; child >= 0; child--) children[child] = walk(depth + 1);
      return children;
    }
    return n >> 2 === 3 ? next() + 3 : n >> 2;
  };
  return walk(0);
}

const middle = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function children([v0, v1, v2]) {
  const m01 = middle(v0, v1);
  const m12 = middle(v1, v2);
  const m20 = middle(v2, v0);
  return [[v0, m01, m20], [m01, v1, m12], [m12, v2, m20], [m01, m12, m20]];
}

/** Quadrat des Abstands Punkt - Dreieck. */
export function distanceSquared(p, [a, b, c]) {
  const toEdge = (u, v) => {
    const edge = sub(v, u);
    const t = Math.max(0, Math.min(1, dot(sub(p, u), edge) / (dot(edge, edge) || 1)));
    const d = sub(p, [u[0] + edge[0] * t, u[1] + edge[1] * t, u[2] + edge[2] * t]);
    return dot(d, d);
  };
  const n = cross(sub(b, a), sub(c, a));
  const nn = dot(n, n);
  if (nn > 1e-20
    && dot(cross(sub(b, a), sub(p, a)), n) >= 0
    && dot(cross(sub(c, b), sub(p, b)), n) >= 0
    && dot(cross(sub(a, c), sub(p, c)), n) >= 0) {
    return dot(sub(p, a), n) ** 2 / nn;
  }
  return Math.min(toEdge(a, b), toEdge(b, c), toEdge(c, a));
}

export function brushTree(node, triangle, centre, radius, value, smallest = Math.max(0.15, radius / 6), depth = 0) {
  const r2 = radius * radius;
  if (distanceSquared(centre, triangle) > r2) return node;
  const inside = p => {
    const d = sub(p, centre);
    return dot(d, d) <= r2;
  };
  if (triangle.every(inside)) return value;
  const split = Array.isArray(node);
  if (!split && node === value) return node;

  const [a, b, c] = triangle;
  const longest = Math.max(dot(sub(b, a), sub(b, a)), dot(sub(c, b), sub(c, b)), dot(sub(a, c), sub(a, c)));
  if (!split && (depth >= MAX_DEPTH || longest <= smallest * smallest)) {
    return inside(middle(middle(a, b), c)) ? value : node;
  }
  const next = children(triangle).map((child, i) =>
    brushTree(split ? node[i] : node, child, centre, radius, value, smallest, depth + 1));
  const uniform = !Array.isArray(next[0]) && next.every(n => n === next[0]);
  return uniform ? next[0] : next;
}

export class PaintMesh {
  constructor(vertices, indices) {
    this.vertices = vertices;
    this.indices = indices;
    this.count = indices.length / 3;
    this.normals = new Float32Array(this.count * 3);
    this.bounds = new Float32Array(this.count * 4); // Huellkugel je Dreieck
    this.neighbours = null;
    for (let t = 0; t < this.count; t++) {
      const [a, b, c] = this.triangle(t);
      const n = cross(sub(b, a), sub(c, a));
      const length = Math.hypot(...n) || 1;
      this.normals.set(n.map(v => v / length), t * 3);
      const centre = [0, 1, 2].map(i => (a[i] + b[i] + c[i]) / 3);
      const radius = Math.max(...[a, b, c].map(p => Math.hypot(...sub(p, centre))));
      this.bounds.set([...centre, radius + 1e-3], t * 4);
    }
  }

  point(index) {
    const v = this.vertices;
    return [v[index * 3], v[index * 3 + 1], v[index * 3 + 2]];
  }

  triangle(t) {
    return [0, 1, 2].map(k => this.point(this.indices[t * 3 + k]));
  }

  normal(t) {
    return [this.normals[t * 3], this.normals[t * 3 + 1], this.normals[t * 3 + 2]];
  }

  /** Malt in `layer` (Dreieck -> Code). `facing` schuetzt die Rueckseite duenner Waende. */
  brush(layer, centre, radius, value, facing) {
    const b = this.bounds;
    let changed = false;
    for (let t = 0; t < this.count; t++) {
      const i = t * 4;
      const reach = radius + b[i + 3];
      const dx = b[i] - centre[0], dy = b[i + 1] - centre[1], dz = b[i + 2] - centre[2];
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      if (facing && dot(this.normal(t), facing) <= 0) continue;

      const before = layer[t];
      const tree = brushTree(before ? decode(before) : 0, this.triangle(t), centre, radius, value);
      const after = tree === 0 ? undefined : encode(tree);
      if (after === before) continue;
      if (after) layer[t] = after;
      else delete layer[t];
      changed = true;
    }
    return changed;
  }

  adjacency() {
    if (this.neighbours) return this.neighbours;
    const points = this.vertices.length / 3;
    const open = new Map();
    const result = new Int32Array(this.count * 3).fill(-1);
    for (let t = 0; t < this.count; t++) {
      for (let k = 0; k < 3; k++) {
        const a = this.indices[t * 3 + k];
        const b = this.indices[t * 3 + ((k + 1) % 3)];
        const key = Math.min(a, b) * points + Math.max(a, b);
        const other = open.get(key);
        if (other === undefined) {
          open.set(key, t * 3 + k);
        } else {
          result[t * 3 + k] = (other / 3) | 0;
          result[other] = t;
          open.delete(key);
        }
      }
    }
    return (this.neighbours = result);
  }

  /**
   * Zusammenhaengende ebene Flaeche um `start` (fuer „Ablegen“): gleiche Normale wie das Startdreieck
   * (hoechstens `angle` Grad Abweichung) und gleiche Ebene (Abstand <= `tolerance`). Liefert Dreiecksnummern.
   */
  planar(start, angle = 1, tolerance = 0.02) {
    const next = this.adjacency();
    const n0 = this.normal(start);
    const limit = Math.cos(angle * Math.PI / 180);
    const d0 = dot(n0, this.point(this.indices[start * 3]));
    const seen = new Uint8Array(this.count);
    const queue = [start], out = [];
    seen[start] = 1;
    while (queue.length) {
      const t = queue.pop();
      out.push(t);
      for (let k = 0; k < 3; k++) {
        const other = next[t * 3 + k];
        if (other < 0 || seen[other]) continue;
        seen[other] = 1;
        if (dot(n0, this.normal(other)) < limit) continue;
        if (this.triangle(other).some(p => Math.abs(dot(n0, p) - d0) > tolerance)) continue;
        queue.push(other);
      }
    }
    return out;
  }

  /** Zusammenhaengende Flaeche bis zur Kante mit mehr als `angle` Grad zwischen Nachbardreiecken (Dreiecksnummern). */
  edgeRegion(start, angle) {
    const next = this.adjacency();
    const limit = Math.cos(angle * Math.PI / 180) - 1e-6;
    const seen = new Uint8Array(this.count);
    const queue = [start], out = [];
    seen[start] = 1;
    while (queue.length) {
      const t = queue.pop();
      out.push(t);
      for (let k = 0; k < 3; k++) {
        const other = next[t * 3 + k];
        if (other < 0 || seen[other] || dot(this.normal(t), this.normal(other)) < limit) continue;
        seen[other] = 1;
        queue.push(other);
      }
    }
    return out;
  }

  /** Setzt ganze Dreiecke auf `value`; liefert, ob sich etwas geaendert hat. */
  setWhole(layer, triangles, value) {
    const code = value ? encode(value) : undefined;
    let changed = false;
    for (const t of triangles) {
      if (layer[t] === code) continue;
      if (code) layer[t] = code;
      else delete layer[t];
      changed = true;
    }
    return changed;
  }

  /** Fuellt die zusammenhaengende Flaeche bis zur Kante mit mehr als `angle` Grad. */
  fill(layer, start, value, angle) {
    return this.setWhole(layer, this.edgeRegion(start, angle), value);
  }

  /** Ein einzelnes Dreieck komplett. */
  paintTriangle(layer, triangle, value) {
    return this.setWhole(layer, [triangle], value);
  }

  /**
   * Erkannte Flaeche um `start`: Eine Ebene (gleiche Normale und Ebene, auch bei feinem Netzrauschen) ganz,
   * sonst die glatt zusammenhaengende gekruemmte Flaeche bis zur naechsten scharfen Kante.
   * Liefert {kind: 'plane' | 'curved' | 'single', triangles}.
   */
  face(start, {planeAngle = 2, planeTolerance = 0.05, smoothAngle = 25, maxTurn = 180} = {}) {
    const plane = this.planar(start, planeAngle, planeTolerance);
    const next = this.adjacency();
    const smooth = Math.cos(smoothAngle * Math.PI / 180) - 1e-6;
    const turn = Math.cos(maxTurn * Math.PI / 180);
    const n0 = this.normal(start);
    const seen = new Uint8Array(this.count);
    const queue = [start], out = [];
    seen[start] = 1;
    while (queue.length) {
      const t = queue.pop();
      out.push(t);
      for (let k = 0; k < 3; k++) {
        const other = next[t * 3 + k];
        if (other < 0 || seen[other]) continue;
        const n = this.normal(other);
        if (dot(this.normal(t), n) < smooth || dot(n0, n) < turn) continue;
        seen[other] = 1;
        queue.push(other);
      }
    }
    // Ebene, wenn sie (fast) die ganze glatte Flaeche ausmacht; sonst ist die Flaeche gekruemmt.
    if (plane.length > 1 && plane.length * 1.1 >= out.length) return {kind: 'plane', triangles: plane};
    return {kind: out.length > 1 ? 'curved' : 'single', triangles: out};
  }

  paintFace(layer, start, value, options) {
    return this.setWhole(layer, this.face(start, options).triangles, value);
  }

  /** Zusammenhaengende Dreiecke mit demselben Zustand wie `start` (Eimer). */
  sameState(layer, start) {
    const next = this.adjacency();
    const target = layer[start];
    const seen = new Uint8Array(this.count);
    const queue = [start], out = [];
    seen[start] = 1;
    while (queue.length) {
      const t = queue.pop();
      out.push(t);
      for (let k = 0; k < 3; k++) {
        const other = next[t * 3 + k];
        if (other < 0 || seen[other] || layer[other] !== target) continue;
        seen[other] = 1;
        queue.push(other);
      }
    }
    return out;
  }

  /** Eimer: alle zusammenhaengenden Dreiecke im selben Zustand bekommen `value`. */
  bucket(layer, start, value) {
    return this.setWhole(layer, this.sameState(layer, start), value);
  }

  /** Hoehe jedes Eckpunkts ueber dem tiefsten Punkt (mm) in Richtung `rows[2]`. */
  heights(rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const up = rows[2];
    const length = Math.hypot(...up) || 1;
    const count = this.vertices.length / 3;
    const h = new Float64Array(count);
    let floor = Infinity;
    for (let i = 0; i < count; i++) {
      h[i] = dot(this.point(i), up) / length;
      floor = Math.min(floor, h[i]);
    }
    for (let i = 0; i < count; i++) h[i] -= floor;
    return h;
  }

  /**
   * Hoehenbereich (wie Prusas „Hoehenbereich“): alles zwischen `from` und `to` (mm ueber dem tiefsten Punkt des Modells)
   * bekommt `value`; Dreiecke an den Grenzen werden unterteilt, damit die Kante genau liegt.
   */
  heightRange(layer, rows, from, to, value, maxDepth = 7) {
    if (!(to > from)) return false;
    const up = rows[2];
    const length = Math.hypot(...up) || 1;
    let floorOffset = Infinity;
    for (let i = 0; i < this.vertices.length / 3; i++) floorOffset = Math.min(floorOffset, dot(this.point(i), up) / length);
    const heightOf = p => dot(p, up) / length - floorOffset;
    const within = x => x >= from && x <= to;
    const tree = (node, triangle, depth) => {
      const hs = triangle.map(heightOf);
      if (Math.max(...hs) < from || Math.min(...hs) > to) return node;
      if (hs.every(within)) return value;
      if (depth >= maxDepth) {
        const centre = heightOf(triangle[0].map((_, i) => (triangle[0][i] + triangle[1][i] + triangle[2][i]) / 3));
        return within(centre) ? value : node;
      }
      const split = Array.isArray(node);
      const next = children(triangle).map((child, i) => tree(split ? node[i] : node, child, depth + 1));
      const uniform = !Array.isArray(next[0]) && next.every(n => n === next[0]);
      return uniform ? next[0] : next;
    };
    let changed = false;
    for (let t = 0; t < this.count; t++) {
      const tri = this.triangle(t);
      const hs = tri.map(heightOf);
      if (Math.max(...hs) < from || Math.min(...hs) > to) continue;
      const before = layer[t];
      const result = tree(before ? decode(before) : 0, tri, 0);
      const after = result === 0 ? undefined : encode(result);
      if (after === before) continue;
      if (after) layer[t] = after;
      else delete layer[t];
      changed = true;
    }
    return changed;
  }

  /** Flaeche eines Dreiecks in mm². */
  area(t) {
    const [a, b, c] = this.triangle(t);
    return Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
  }

  /**
   * Luecken fuellen (wie Prusas „Luecken“): zusammenhaengende Dreiecke, die nicht `value` haben, deren Gesamtflaeche
   * hoechstens `maxArea` mm² betraegt und die ringsum von `value` umgeben sind (keine offene Kante, keine Nachbarn mit
   * anderem Zustand), werden ebenfalls auf `value` gesetzt.
   */
  gapFill(layer, maxArea, value) {
    const next = this.adjacency();
    const code = value ? encode(value) : undefined;
    const seen = new Uint8Array(this.count);
    let changed = false;
    for (let s = 0; s < this.count; s++) {
      if (seen[s] || layer[s] === code) continue;
      const queue = [s], island = [];
      let area = 0, closed = true;
      seen[s] = 1;
      while (queue.length) {
        const t = queue.pop();
        island.push(t);
        area += this.area(t);
        for (let k = 0; k < 3; k++) {
          const other = next[t * 3 + k];
          if (other < 0) { closed = false; continue; }
          if (layer[other] === code) continue;
          if (layer[other] !== layer[t]) { closed = false; continue; }
          if (seen[other]) continue;
          seen[other] = 1;
          queue.push(other);
        }
      }
      if (closed && area <= maxArea) changed = this.setWhole(layer, island, value) || changed;
    }
    return changed;
  }

  /**
   * Markiert Ueberhaenge flacher als `angle` (Grad ab Horizontale). `rows` ist die Drehung
   * des Modells als drei Zeilen; die Auflageflaeche auf dem Bett bleibt frei.
   */
  markOverhangs(layer, angle, rows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const up = rows[2];
    const length = Math.hypot(...up);
    const limit = -Math.cos(angle * Math.PI / 180);
    let floor = Infinity;
    for (let i = 0; i < this.vertices.length / 3; i++) floor = Math.min(floor, dot(this.point(i), up));
    let changed = false;
    for (let t = 0; t < this.count; t++) {
      if (dot(this.normal(t), up) / length > limit) continue;
      if (this.triangle(t).every(p => dot(p, up) - floor < 0.05)) continue;
      if (layer[t] === '4') continue;
      layer[t] = '4';
      changed = true;
    }
    return changed;
  }
}

/** Farbige Teildreiecke fuer die Anzeige. */
export function paintedTriangles(mesh, layer) {
  const byState = new Map();
  const walk = (node, triangle) => {
    if (Array.isArray(node)) {
      children(triangle).forEach((child, i) => walk(node[i], child));
    } else if (node) {
      if (!byState.has(node)) byState.set(node, []);
      const out = byState.get(node);
      for (const p of triangle) out.push(p[0], p[1], p[2]);
    }
  };
  for (const [t, code] of Object.entries(layer || {})) {
    if (Number(t) < mesh.count) walk(decode(code), mesh.triangle(Number(t)));
  }
  return byState;
}
