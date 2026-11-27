import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelActions} from '../frontend/model-actions.js';

test('Rückgängig und Wiederholen, neue Änderung leert Wiederholen', () => {
  const state = {models: [{id: 'a', n: 1}], plates: [], ui: {active_plate: 'p'}};
  const actions = createModelActions({state: () => state, selected: () => state.models[0], mesh: () => null, meshes: () => new Map(), bed: () => ({}), id: () => 'x', notify: () => {}});
  actions.remember();
  state.models[0].n = 2;
  assert.equal(actions.undo(), true);
  assert.equal(state.models[0].n, 1);
  assert.equal(actions.redo(), true);
  assert.equal(state.models[0].n, 2);
  assert.equal(actions.undo(), true);
  actions.remember();
  assert.equal(actions.redo(), false, 'neue Änderung beendet die Kette');
});
