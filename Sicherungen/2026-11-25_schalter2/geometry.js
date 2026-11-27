// Platzierung von Modellen und Grundkoerper. Vorschau und Export rechnen hiermit identisch.
const RAD = Math.PI / 180;

const multiply = (a, b) => a.map(row => [0, 1, 2].map(c => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
const apply = (m, p) => m.map(row => row[0] * p[0] + row[1] * p[1] + row[2] * p[2]);

/** Drehung X, dann Y, dann Z; davor Skalierung (Prozent, negativ = gespiegelt). Drei Zeilen. */
export function linear(model) {
  const [x, y, z] = (model.rotation || [0, 0, 0]).map(v => v * RAD);
  const rx = [[1, 0, 0], [0, Math.cos(x), -Math.sin(x)], [0, Math.sin(x), Math.cos(x)]];
  const ry = [[Math.cos(y), 0, Math.sin(y)], [0, 1, 0], [-Math.sin(y), 0, Math.cos(y)]];
  const rz = [[Math.cos(z), -Math.sin(z), 0], [Math.sin(z), Math.cos(z), 0], [0, 0, 1]];
  const scale = (model.scale || [100, 100, 100]).map(v => v / 100);
  return multiply(rz, multiply(ry, rx)).map(row => row.map((v, c) => v * scale[c]));
}

export function bedFrom(shape, height) {
  const points = Array.isArray(shape) && shape.length >= 3 ? shape : [[0, 0], [250, 0], [250, 210], [0, 210]];
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return {
    points,
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    height: Number(height) > 0 ? Number(height) : 210,
  };
}

/** Z-Bereich, der nach dem Schneiden stehen bleibt (Modellkoordinaten). */
export function keptRange(model) {
  let from = -Infinity, to = Infinity;
  for (const {cut, position, size} of model.volumes || []) {
    if (!cut) continue;
    if (cut === 'below') from = Math.max(from, position[2] + size[2] / 2);
    if (cut === 'above') to = Math.min(to, position[2] - size[2] / 2);
  }
  return from === -Infinity && to === Infinity ? null : {from, to};
}

/** Punkte, die den Rest eines geschnittenen Netzes begrenzen. */
function keptPoints({vertices: v, indices}, {from, to}) {
  const out = [];
  for (let i = 0; i < v.length; i += 3) {
    if (v[i + 2] >= from && v[i + 2] <= to) out.push(v[i], v[i + 1], v[i + 2]);
  }
  for (let i = 0; i < indices.length; i++) {
    const a = indices[i] * 3;
    const b = indices[i % 3 === 2 ? i - 2 : i + 1] * 3;
    for (const z of [from, to]) {
      if ((v[a + 2] < z) === (v[b + 2] < z) || z < from || z > to) continue;
      const t = (z - v[a + 2]) / (v[b + 2] - v[a + 2]);
      out.push(v[a] + t * (v[b] - v[a]), v[a + 1] + t * (v[b + 1] - v[a + 1]), z);
    }
  }
  return out;
}

/**
 * Lage im Bauraum; was gedruckt wird, steht immer auf dem Bett. Nach einem Schnitt ist das
 * die Schnittflaeche, sonst wuerde der obere Teil in der Luft beginnen.
 */
export function placement(model, mesh, bed) {
  const range = keptRange(model);
  let vertices = range ? keptPoints(mesh, range) : mesh.vertices;
  if (!range) {
    // Erhabener Text gehoert zum Teil und darf nicht unter das Bett ragen.
    const parts = (model.volumes || []).filter(v => v.kind === 'ModelPart');
    if (parts.length) vertices = [...vertices, ...parts.flatMap(v => volumeMesh(v).vertices.flat())];
  }
  const rows = linear(model);
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = rows[a][0] * vertices[i] + rows[a][1] * vertices[i + 1] + rows[a][2] * vertices[i + 2];
      if (v < low[a]) low[a] = v;
      if (v > high[a]) high[a] = v;
    }
  }
  if (low[2] === Infinity) {
    low.fill(0);
    high.fill(0);
  }
  const [x, y] = model.position || [(bed.minX + bed.maxX) / 2, (bed.minY + bed.maxY) / 2];
  // Abgesenkt: Was unter dem Bett liegt, wird nicht gedruckt (wie in anderen Slicern).
  const sink = Math.max(0, Math.min(Number(model.sink) || 0, high[2] - low[2] - 0.05));
  const offset = [x, y, -low[2] - sink];
  return {
    rows,
    offset,
    min: low.map((v, a) => v + offset[a]),
    max: high.map((v, a) => v + offset[a]),
    size: high.map((v, a) => v - low[a]),
  };
}

/** Zwoelf Werte in der Reihenfolge von 3MF. */
export function matrix3mf({rows, offset}) {
  return [0, 1, 2].flatMap(c => [rows[0][c], rows[1][c], rows[2][c]]).concat(offset);
}

/** Winkel, die die Normale einer Flaeche senkrecht nach unten drehen. */
export function rotationToBed(normal, scale = [100, 100, 100]) {
  const n = normal.map((v, i) => v * 100 / scale[i]);
  const length = Math.hypot(...n);
  const [a, b, c] = n.map(v => v / length);
  // Erst um X in die XZ-Ebene, dann um Y auf -Z.
  const x = Math.atan2(b, c);
  const z1 = Math.hypot(b, c);
  const y = Math.atan2(a, -z1);
  return [x / RAD, y / RAD, 0].map(v => Math.round(v * 1e6) / 1e6);
}

export function insideBed(box, bed) {
  const e = 0.01;
  return box.min[0] >= bed.minX - e && box.max[0] <= bed.maxX + e
    && box.min[1] >= bed.minY - e && box.max[1] <= bed.maxY + e
    && box.max[2] <= bed.height + e;
}

export function overlapping(boxes) {
  const hit = new Set();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const clash = [0, 1].every(k => a.min[k] < b.max[k] - 0.01 && b.min[k] < a.max[k] - 0.01);
      if (clash) {
        hit.add(i);
        hit.add(j);
      }
    }
  }
  return hit;
}

/** Reihenweise anordnen, grosse Teile zuerst. Liefert Mittelpunkte oder null, wenn es nicht passt. */
export function arrange(boxes, bed, gap = 6) {
  const width = bed.maxX - bed.minX;
  const depth = bed.maxY - bed.minY;
  const order = boxes.map((box, i) => i).sort((a, b) => boxes[b].size[1] - boxes[a].size[1]);
  const centres = [];
  const rows = [];
  let x = 0, y = 0, rowDepth = 0, row = [];
  const close = () => {
    if (row.length) rows.push({items: row, width: x - gap});
  };
  for (const i of order) {
    const [w, d] = boxes[i].size;
    if (w > width || d > depth) return null;
    if (x + w > width) {
      close();
      y += rowDepth + gap;
      x = rowDepth = 0;
      row = [];
    }
    if (y + d > depth) return null;
    row.push({i, x, y});
    x += w + gap;
    rowDepth = Math.max(rowDepth, d);
  }
  close();
  const shiftY = bed.minY + (depth - (y + rowDepth)) / 2;
  for (const {items, width: used} of rows) {
    const shiftX = bed.minX + (width - used) / 2;
    for (const item of items) {
      const box = boxes[item.i];
      // Der Ursprung eines gedrehten Teils liegt nicht in der Mitte seines Huellquaders.
      centres[item.i] = [0, 1].map(a =>
        (a ? shiftY + item.y : shiftX + item.x) + (box.offset[a] - box.min[a]));
    }
  }
  return centres;
}

function unitBox() {
  return {
    points: [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    triangles: [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]],
  };
}

function unitRound(rings, segments) {
  const points = [[0, 0, -1]];
  for (const [radius, z] of rings) {
    for (let s = 0; s < segments; s++) {
      points.push([radius * Math.cos(2 * Math.PI * s / segments), radius * Math.sin(2 * Math.PI * s / segments), z]);
    }
  }
  const top = points.push([0, 0, 1]) - 1;
  const at = (ring, s) => 1 + ring * segments + (s % segments);
  const triangles = [];
  for (let s = 0; s < segments; s++) {
    triangles.push([0, at(0, s + 1), at(0, s)]);
    for (let r = 0; r < rings.length - 1; r++) {
      triangles.push([at(r, s), at(r, s + 1), at(r + 1, s + 1)], [at(r, s), at(r + 1, s + 1), at(r + 1, s)]);
    }
    triangles.push([top, at(rings.length - 1, s), at(rings.length - 1, s + 1)]);
  }
  return {points, triangles};
}

/** Zusatzkoerper in Modellkoordinaten. position = Mitte, size = Kantenlaengen. */
export function volumeMesh({shape, position, size, mesh}) {
  if (shape === 'text') return mesh;
  let unit;
  if (shape === 'cylinder') {
    unit = unitRound([[1, -1], [1, 1]], 48);
  } else if (shape === 'sphere') {
    const rings = [];
    for (let i = 1; i < 16; i++) rings.push([Math.sin(Math.PI * i / 16), -Math.cos(Math.PI * i / 16)]);
    unit = unitRound(rings, 32);
  } else {
    unit = unitBox();
  }
  return {
    vertices: unit.points.map(p => p.map((v, a) => v * size[a] / 2 + position[a])),
    triangles: unit.triangles,
  };
}

export {apply};
