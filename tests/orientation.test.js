import test from 'node:test';
import assert from 'node:assert/strict';
import {bestOrientation} from '../frontend/orientation.js';

// Pilz: Platte oben (z 10..12, 30 x 30), Stiel (z 0..10, 6 x 6)
function box([x0, y0, z0], [x1, y1, z1]) {
  const v = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return {v, f};
}
function merge(...parts) {
  const vertices = [], indices = [];
  for (const {v, f} of parts) { const o = vertices.length / 3; vertices.push(...v); indices.push(...f.map(i => i + o)); }
  return {vertices: new Float32Array(vertices), indices: new Uint32Array(indices)};
}

test('Pilz: Platte nach unten ist besser als der Stiel unten', () => {
  const mesh = merge(box([-3, -3, 0], [3, 3, 10]), box([-15, -15, 10], [15, 15, 12]));
  const best = bestOrientation(mesh.vertices, mesh.indices);
  // Außennormale der Fläche, die aufs Bett kommt: die große Plattenoberseite (+Z)
  assert.deepEqual(best.normal.map(v => Math.round(v)), [0, 0, 1]);
  assert.ok(best.overhang <= 36 + 1e-6, "nur die innenliegende Stielkappe zählt");
  assert.ok(best.contact > 800);
});

test('Quader: liegt auf der größten Fläche', () => {
  const mesh = merge(box([0, 0, 0], [40, 40, 5]));
  const best = bestOrientation(mesh.vertices, mesh.indices);
  assert.ok(Math.abs(best.normal[2]) === 1);
});

test('leeres Netz', () => {
  assert.equal(bestOrientation(new Float32Array(), new Uint32Array()), null);
});
