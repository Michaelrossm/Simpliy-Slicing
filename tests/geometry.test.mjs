import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../frontend/geometry.js', import.meta.url));
const {placement, volumeMesh, bedFrom} = await import('data:text/javascript;base64,' + source.toString('base64'));
const cube = volumeMesh({shape: 'box', position: [0, 0, 10], size: [20, 20, 20]});
const mesh = {vertices: cube.vertices.flat(), indices: cube.triangles.flat()};
const slab = (cut, z) => ({cut, position: [0, 0, z], size: [50, 50, 20]});

test('upper half of a cut starts on the bed', () => {
  const box = placement({volumes: [slab('below', -3)]}, mesh, bedFrom());
  assert.ok(Math.abs(box.offset[2] + 7) < 1e-9);
  assert.ok(Math.abs(box.size[2] - 13) < 1e-9);
});

test('rotated cut halves start on the bed', () => {
  for (const rotation of [[90, 0, 0], [180, 0, 0], [30, 20, 5]]) {
    for (const volume of [slab('below', -3), slab('above', 17)]) {
      assert.ok(Math.abs(placement({rotation, volumes: [volume]}, mesh, bedFrom()).min[2]) < 1e-9);
    }
  }
  const flipped = placement({rotation: [180, 0, 0], volumes: [slab('above', 17)]}, mesh, bedFrom());
  assert.ok(Math.abs(flipped.size[2] - 7) < 1e-9);
});

test('transform Z is an absolute build-plate coordinate', () => {
  const atBed = placement({bedZ: 0}, mesh, bedFrom());
  const raised = placement({bedZ: 12.5}, mesh, bedFrom());
  assert.ok(Math.abs(atBed.min[2]) < 1e-9);
  assert.ok(Math.abs(raised.min[2] - 12.5) < 1e-9);
  assert.ok(Math.abs(raised.offset[2] - (12.5 - atBed.min[2])) < 1e-9);
});
