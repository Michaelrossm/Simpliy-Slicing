import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../frontend/paint-core.js', import.meta.url));
const {encode, decode, PaintMesh, paintedTriangles} = await import('data:text/javascript;base64,' + source.toString('base64'));

const cube = () => new PaintMesh(
  new Float32Array([-10, -10, 0, 10, -10, 0, 10, 10, 0, -10, 10, 0, -10, -10, 20, 10, -10, 20, 10, 10, 20, -10, 10, 20]),
  new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
);

function area(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i += 9) {
    const u = [0, 1, 2].map(k => list[i + 3 + k] - list[i + k]);
    const v = [0, 1, 2].map(k => list[i + 6 + k] - list[i + k]);
    sum += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return sum;
}

test('codes match the engine format', () => {
  assert.equal(encode(1), '4');
  assert.equal(encode(2), '8');
  assert.equal(encode(3), '0C');
  assert.equal(encode([1, 0, 0, 0]), '40003');
  for (const tree of [1, 16, [1, [0, 2, 5, 0], 0, 1]]) assert.deepEqual(decode(encode(tree)), tree);
});

test('brush paints a circle on two huge triangles, not the triangles', () => {
  const mesh = cube();
  const layer = {};
  assert.ok(mesh.brush(layer, [0, 0, 20], 4, 1));
  const painted = area(paintedTriangles(mesh, layer).get(1));
  assert.ok(Math.abs(painted - Math.PI * 16) < 3, `area ${painted}`);
});

test('eraser removes what the brush painted', () => {
  const mesh = cube();
  const layer = {};
  mesh.brush(layer, [0, 0, 20], 4, 1);
  mesh.brush(layer, [0, 0, 20], 6, 0);
  assert.deepEqual(layer, {});
});

test('back of a thin wall stays clean', () => {
  const mesh = cube();
  const layer = {};
  mesh.brush(layer, [0, 0, 20], 21, 1, [0, 0, 1]);
  assert.deepEqual(Object.keys(layer), ['2', '3']);
});

test('fill stops at sharp edges', () => {
  const mesh = cube();
  const layer = {};
  mesh.fill(layer, 2, 2, 30);
  assert.deepEqual(layer, {2: '8', 3: '8'});
});

test('overhang marking skips the face lying on the bed', () => {
  const mesh = cube();
  const layer = {};
  assert.equal(mesh.markOverhangs(layer, 45), false);
});

// ---- Prusa-Werkzeuge: Dreieck, erkannte Fläche, Eimer, Höhenbereich, Lücken ----------------------------------------
/** Ebenes Raster n×n (Seitenlänge n mm), Höhe z je Gitterpunkt aus `height(i, j)`. */
function grid(n, height = () => 0) {
  const vertices = [], indices = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vertices.push(i, j, height(i, j));
  const at = (i, j) => j * (n + 1) + i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) indices.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
  return new PaintMesh(new Float32Array(vertices), new Uint32Array(indices));
}

test('Dreieck: genau ein Dreieck wird ganz bemalt, Radieren nimmt es zurück', () => {
  const mesh = grid(4);
  const layer = {};
  assert.ok(mesh.paintTriangle(layer, 5, 1));
  assert.deepEqual(Object.keys(layer), ['5']);
  assert.equal(layer[5], encode(1));
  assert.ok(!mesh.paintTriangle(layer, 5, 1), 'zweites Mal ändert nichts');
  assert.ok(mesh.paintTriangle(layer, 5, 0));
  assert.deepEqual(layer, {});
});

test('Fläche: eine Ebene wird ganz erkannt (auch mit Netzrauschen), eine Stufe begrenzt sie', () => {
  const noisy = grid(10, (i, j) => (i + j) % 2 ? 0.001 : 0);
  const found = noisy.face(0);
  assert.equal(found.kind, 'plane');
  assert.equal(found.triangles.length, 200);
  const step = grid(10, (i, j) => (i >= 5 ? 1 : 0));
  const side = step.face(0).triangles;
  assert.ok(side.length < 200 && side.length >= 40, String(side.length));
  const layer = {};
  assert.ok(noisy.paintFace(layer, 0, 1));
  assert.equal(Object.keys(layer).length, 200);
});

test('Fläche: eine glatte Rundung wird bis zur scharfen Kante erkannt', () => {
  // Halbzylinder (Achse X, 12 Segmente) mit einer waagerechten Fläche im 90°-Knick
  const vertices = [], indices = [];
  const segments = 12;
  for (let s = 0; s <= segments; s++) {
    const a = Math.PI * s / segments;
    vertices.push(0, 5 * Math.cos(a), 5 * Math.sin(a), 10, 5 * Math.cos(a), 5 * Math.sin(a));
  }
  for (let s = 0; s < segments; s++) {
    const a = s * 2, b = (s + 1) * 2;
    indices.push(a, b, b + 1, a, b + 1, a + 1);
  }
  const last = segments * 2;
  const k = vertices.length / 3;
  vertices.push(0, -15, 0, 10, -15, 0);
  indices.push(last, k, k + 1, last, k + 1, last + 1);
  const mesh = new PaintMesh(new Float32Array(vertices), new Uint32Array(indices));
  const found = mesh.face(0);
  assert.equal(found.kind, 'curved');
  assert.equal(found.triangles.length, segments * 2);
  assert.ok(!found.triangles.includes(segments * 2), 'die Wand gehört nicht dazu');
});

test('Eimer: füllt nur den zusammenhängenden Bereich mit gleichem Zustand', () => {
  const mesh = grid(6);
  const layer = {};
  // Mittelband (y 2..4) rot, Rest leer
  for (let t = 0; t < mesh.count; t++) {
    const c = mesh.triangle(t).reduce((a, p) => a + p[1], 0) / 3;
    if (c > 2 && c < 4) layer[t] = encode(1);
  }
  const before = Object.keys(layer).length;
  assert.ok(mesh.bucket(layer, 0, 2)); // unteres leeres Feld
  const blue = Object.values(layer).filter(c => c === encode(2)).length;
  assert.equal(blue, 24); // y 0..2: 2 Reihen × 6 × 2 Dreiecke
  assert.equal(Object.keys(layer).length, before + 24, 'oberes leeres Feld bleibt leer');
  assert.ok(mesh.bucket(layer, 0, 0), 'Radieren mit dem Eimer');
  assert.equal(Object.keys(layer).length, before);
});

test('Höhenbereich: bemalt genau das Band, Grenzdreiecke werden geteilt', () => {
  const mesh = cube();
  const layer = {};
  assert.ok(mesh.heightRange(layer, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 5, 10, 1));
  const painted = area(paintedTriangles(mesh, layer).get(1));
  assert.ok(Math.abs(painted - 4 * 20 * 5) < 25, `Fläche ${painted}`); // vier Seiten, 20 breit, 5 hoch
  assert.ok(!mesh.heightRange({}, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 10, 5, 1), 'von >= bis ändert nichts');
  const none = {};
  assert.ok(!mesh.heightRange(none, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 50, 60, 1));
});

test('Lücken: kleine umschlossene Inseln werden gefüllt, große und offene nicht', () => {
  const mesh = grid(8);
  const layer = {};
  for (let t = 0; t < mesh.count; t++) layer[t] = encode(1);
  // Insel: zwei Dreiecke in der Mitte frei
  const island = [mesh.count / 2 + 6, mesh.count / 2 + 7];
  island.forEach(t => delete layer[t]);
  assert.ok(mesh.gapFill(layer, 2, 1), 'Fläche 1 mm² ≤ 2');
  assert.equal(Object.keys(layer).length, mesh.count);
  // zu groß
  island.forEach(t => delete layer[t]);
  assert.ok(!mesh.gapFill(layer, 0.4, 1));
  assert.equal(Object.keys(layer).length, mesh.count - 2);
  // am Rand offen (grenzt an die freie Kante des Netzes): wird nicht gefüllt
  const edge = {};
  for (let t = 1; t < mesh.count; t++) edge[t] = encode(1);
  assert.ok(!mesh.gapFill(edge, 5, 1));
});
