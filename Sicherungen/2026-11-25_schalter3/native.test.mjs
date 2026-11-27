import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPacket, readMesh, latest} from '../frontend/native.js';
import {PaintMesh} from '../frontend/paint-core.js';
import {meshGeometry} from '../frontend/surface-shading.js';
import {supportSignature} from '../frontend/support-plate.js';
import {createSupportClient} from '../frontend/support-client.js';

test('packets from Rust are read without a detour through text', () => {
  const head = new TextEncoder().encode(JSON.stringify({
    meta: {name: 'Fächer'},
    arrays: [{name: 'a', type: 'f32', offset: 0, length: 2}, {name: 'b', type: 'u32', offset: 8, length: 1}],
  }));
  const size = Math.ceil(head.length / 4) * 4;
  const bytes = new Uint8Array(4 + size + 12).fill(32, 4, 4 + size);
  bytes.set(head, 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size, true);
  view.setFloat32(4 + size, 1.5, true);
  view.setFloat32(8 + size, 2.5, true);
  view.setUint32(12 + size, 7, true);
  const {meta, arrays} = readPacket(bytes.buffer);
  assert.equal(meta.name, 'Fächer');
  assert.deepEqual([...arrays.a, ...arrays.b], [1.5, 2.5, 7]);
});

test('drawing normals never replace the face normals used by text, flat and paint', () => {
  const buffer = new ArrayBuffer(12 + 4 * 12 + 2 * 12 + 2 * 36);
  new Uint32Array(buffer, 0, 3).set([4, 2, 7]);
  new Float32Array(buffer, 12, 12).set([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]);
  new Uint32Array(buffer, 60, 6).set([0, 1, 2, 0, 3, 1]);
  new Float32Array(buffer, 84, 18).fill(0.5);
  const mesh = readMesh(buffer, PaintMesh);
  assert.deepEqual([...mesh.normal(0), ...mesh.normal(1)], [0, 0, 1, 0, 1, 0]);
  assert.equal(meshGeometry(mesh).getAttribute('normal').array[0], 0.5);
});

test('only the newest question gets an answer', async () => {
  const queue = latest();
  const slow = value => () => new Promise(resolve => setTimeout(() => resolve(value), 5));
  assert.deepEqual(await Promise.all([queue.run(slow(1)), queue.run(slow(2)), queue.run(slow(3))]), [undefined, undefined, 3]);
});

test('the saved signature format does not change', () => {
  const text = supportSignature({path: 'x'}, {signature: 5}, {rows: [[1, 0, 0]], offset: [1, 2, 0]});
  assert.equal(text, '["x",5,[[1,0,0]],[1,2,0],[]]');
});

test('edits follow each other, a changed model rejects the answer', async () => {
  const model = {id: 'm', path: 'x', position: [100, 100]};
  const mesh = {vertices: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 5]), indices: new Uint32Array([0, 1, 2]), signature: 1};
  let during = () => {};
  const seen = [];
  const invoke = async (name, {request}) => {
    seen.push(request.plate.models[0].stored?.n ?? 0);
    during();
    return {data: {n: seen.length}};
  };
  const client = createSupportClient({invoke, meshes: () => new Map([['x', mesh]]), resolve: () => () => ({}), changed() {}, failed() {}});
  const scope = {model, plate: 'p', models: () => [model], bed: () => ({minX: 0, maxX: 200, minY: 0, maxY: 200, height: 200})};
  const apply = answer => { model.straightSupports = answer.data; };
  await Promise.all([client.edit(scope, {op: 'a'}, apply), client.edit(scope, {op: 'b'}, apply)]);
  assert.deepEqual(seen, [0, 1]);
  during = () => { model.straightSupports = {n: 99}; };
  await assert.rejects(client.edit(scope, {op: 'c'}, apply), /währenddessen/);
  assert.equal(model.straightSupports.n, 99);
});
