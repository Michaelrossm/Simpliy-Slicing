import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelActions} from '../frontend/model-actions.js';
import {volumeMesh} from '../frontend/geometry.js';

const mesh = {vertices: new Float32Array([0, 0, 0, 40, 0, 0, 40, 20, 0, 0, 20, 0, 0, 0, 30, 40, 0, 30, 40, 20, 30, 0, 20, 30]), indices: new Uint32Array([0, 1, 2])};

function cut(position, keep, axis, tilt) {
  const state = {models: [{id: 'a', name: 'Teil', path: 'p', plate: 'p1'}], plates: [], ui: {active_plate: 'p1', selected_model_id: 'a'}};
  const actions = createModelActions({state: () => state, selected: () => state.models[0], mesh: () => mesh, meshes: () => new Map(), bed: () => ({}), id: p => `${p}-x`, notify: () => {}});
  actions.cut(position, keep, axis, tilt);
  return state.models[0].volumes[0];
}

test('Schnitt entlang X: entfernt alles oberhalb von x = 10', () => {
  const volume = cut(10, 'below', 0, 0);
  const xs = volumeMesh(volume).vertices.map(v => v[0]);
  assert.ok(Math.abs(Math.min(...xs) - 10) < 1e-6, `min x ${Math.min(...xs)}`);
  assert.equal(volume.cut, 'above');
});

test('Gerader Z-Schnitt wie bisher (Höhe absolut)', () => {
  const volume = cut(12, 'above', 2, 0);
  const zs = volumeMesh(volume).vertices.map(v => v[2]);
  assert.ok(Math.abs(Math.max(...zs) - 12) < 1e-6, `max z ${Math.max(...zs)}`);
});

test('Geneigter Schnitt: Ebene dreht um den eingestellten Winkel', () => {
  const volume = cut(15, 'below', 2, 45);
  const [, , n] = volume.orientation;
  assert.ok(Math.abs(n[2] - Math.SQRT1_2) < 1e-9 && Math.abs(n[0] - Math.SQRT1_2) < 1e-9);
  // Die Schnittfläche des Körpers geht durch den Mittelpunkt der Ebene
  const points = volumeMesh(volume).vertices;
  const centre = [20, 10, 15];
  const distances = points.map(p => (p[0] - centre[0]) * n[0] + (p[1] - centre[1]) * n[1] + (p[2] - centre[2]) * n[2]);
  assert.ok(Math.min(...distances.map(Math.abs)) < 1e-6);
});

import {placement, keptPlanes} from '../frontend/geometry.js';

test('Lage nach einem X-Schnitt: nur der behaltene Teil zählt', () => {
  const state = {models: [{id: 'a', name: 'Teil', path: 'p', plate: 'p1'}], plates: [], ui: {active_plate: 'p1', selected_model_id: 'a'}};
  const actions = createModelActions({state: () => state, selected: () => state.models[0], mesh: () => mesh, meshes: () => new Map(), bed: () => ({}), id: p => `${p}-x`, notify: () => {}});
  actions.cut(10, 'below', 0, 0); // behält x 0..10
  const box = placement(state.models[0], mesh, {minX: 0, maxX: 250, minY: 0, maxY: 210});
  assert.ok(Math.abs(box.size[0] - 10) < 1e-6, `Breite ${box.size[0]}`);
  assert.equal(box.size[1], 20);
  assert.equal(keptPlanes(state.models[0]).length, 1);
});
