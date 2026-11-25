import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const load = name => import(new URL(`../frontend/${name}`, import.meta.url).href);
const {ensurePlates, plateModels, plateProcesses, planPlate} = await load('plate-plan.js');
const {freePlateName, setPlateName} = await load('plate-plan.js');
const {textVolume} = await load('text-mesh.js');
const {measure} = await load('measure.js');
const {volumeMesh} = await load('geometry.js');
const opentype = await load('vendor/opentype/opentype.module.js');
const catalog = JSON.parse(fs.readFileSync(new URL('../frontend/engine-catalog.json', import.meta.url), 'utf8'));
const byKey = new Map(catalog.map(c => [c.key, c]));

test('old workspaces move to one plate without losing models', () => {
  const state = {models: [{id: 'a'}, {id: 'b'}], ui: {}};
  ensurePlates(state);
  assert.equal(state.plates.length, 1);
  assert.equal(plateModels(state).length, 2);
  const one = {id: '1'}, two = {id: '2'};
  assert.deepEqual(plateProcesses([{process: '2'}, {}, {process: '2'}], [one, two], one), [two, one]);
});

const base = {layer_height: 0.2, perimeters: 2, temperature: [200, 200], bed_temperature: [60, 60]};
const layer = (id, values, tool) => ({process: {id, name: id, tool}, values});

test('object values differ per process', () => {
  const plan = planPlate({base, byKey, layers: [layer('a', {layer_height: 0.1}), layer('b', {perimeters: 5})]});
  assert.deepEqual(plan.objects.get('b'), {layer_height: 0.2, perimeters: 5});
  assert.equal(plan.conflicts.length, 0);
});

test('plate-wide differences are reported, never dropped silently', () => {
  const plan = planPlate({base, byKey, layers: [layer('a', {temperature: 210}), layer('b', {temperature: 250})]});
  assert.deepEqual(plan.conflicts.map(c => c.key), ['temperature']);
});

test('own tool keeps its own material', () => {
  const plan = planPlate({base, byKey, layers: [layer('a', {temperature: 210}, 1), layer('b', {temperature: 250}, 2)]});
  assert.deepEqual(plan.values.temperature, [210, 250]);
  assert.equal(plan.objects.get('b').extruder, 2);
  assert.equal(plan.conflicts.length, 0);
  const inherit = planPlate({base, byKey, layers: [layer('a', {temperature: 210}, 1), layer('b', {}, 2)]});
  assert.deepEqual(inherit.values.temperature, [210, 200]);
});

test('shared or missing tool is not hidden', () => {
  const shared = planPlate({base, byKey, layers: [layer('a', {temperature: 210}), layer('b', {temperature: 250}, 1)]});
  assert.equal(shared.conflicts.length, 1);
  assert.equal(planPlate({base, byKey, layers: [layer('a', {}, 3)]}).errors.length, 1);
});

test('material option fills only its tool', () => {
  const plan = planPlate({base, byKey, layers: [layer('a', {temperature: 210})], materials: {2: {temperature: 260}}});
  assert.deepEqual(plan.values.temperature, [210, 260]);
});

const cube = (size = 20) => {
  const m = volumeMesh({shape: 'box', position: [0, 0, 10], size: [size, size, size]});
  return {vertices: m.vertices.flat(), indices: m.triangles.flat()};
};

test('plate names: lowest free number, own names are marked, empty goes back to default', () => {
  const plates = [{id: 'a', name: 'Platte 2'}, {id: 'b', name: 'Halter'}];
  assert.equal(freePlateName(plates), 'Platte 1');
  setPlateName(plates, plates[0], 'Platte 7');
  assert.equal(plates[0].named, true);
  setPlateName(plates, plates[0], '');
  assert.deepEqual(plates[0], {id: 'a', name: 'Platte 1'});
});

/** Jede Kante genau einmal je Richtung, Volumen positiv. */
function closedBody({vertices, triangles}) {
  const ids = new Map();
  const welded = vertices.map(v => {
    const key = String(v);
    if (!ids.has(key)) ids.set(key, ids.size);
    return ids.get(key);
  });
  const sides = new Set();
  let volume = 0;
  for (const t of triangles) {
    for (let k = 0; k < 3; k++) {
      const side = `${welded[t[k]]}>${welded[t[(k + 1) % 3]]}`;
      if (sides.has(side)) return false;
      sides.add(side);
    }
    const [a, b, c] = t.map(i => vertices[i]);
    volume += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return volume > 0 && [...sides].every(side => sides.has(side.split('>').reverse().join('>')));
}

test('text with holes gives closed bodies', {skip: !fs.existsSync('C:/Windows/Fonts/arial.ttf')}, () => {
  const bytes = fs.readFileSync('C:/Windows/Fonts/arial.ttf');
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const text of ['O8B', 'MK3S Größe 0,5', 'äöü%&@', 'zwei\nZeilen']) {
    for (const engrave of [false, true]) {
      const volume = textVolume(font, {text, height: 8, depth: 1, engrave, position: [10, 0, 5], normal: [1, 0, 0]});
      assert.ok(closedBody(volume.mesh), text);
      const x = volume.mesh.vertices.map(v => v[0]);
      assert.ok(Math.abs(Math.max(...x) - (engrave ? 10.4 : 11)) < 1e-4);
    }
  }
});

test('measurements', () => {
  const p = (...point) => ({point, normal: [0, 0, 1]});
  assert.equal(measure('distance', [p(0, 0, 0), p(3, 4, 0)]).rows[0][1], 5);
  assert.equal(measure('faces', [p(0, 0, 0), p(9, 9, 7)]).rows[0][1], 7);
  assert.ok(Math.abs(measure('circle', [p(5, 0, 1), p(0, 5, 1), p(-5, 0, 1)]).rows[0][1] - 10) < 1e-9);
});
