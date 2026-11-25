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
