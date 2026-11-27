import test from 'node:test';
import assert from 'node:assert/strict';
import * as Z from '../frontend/zone-plan.js';
import * as R from '../frontend/offset-rules.js';

test('zone-plan: Zonen lesen, aktive Zonen je Modell', () => {
  const on = {id: 'z', zone: {fromOn: true, from: '2,5', toOn: false, to: 0}};
  assert.deepEqual(Z.zoneOf(on), {from: 2.5, to: null});
  assert.equal(Z.zoneActive({zone: {fromOn: false, toOn: false}}), false);
  assert.equal(Z.zoneOf({}), null);
  assert.deepEqual(Z.zonesOfModel({zone_processes: ['z', 'weg']}, [on]), [{from: 2.5, to: null}]);
});

test('zone-plan: Schichthöhen-Abgleich mit Prozentwerten und Meldung', () => {
  const main = {layer_height: 0.2, first_layer_height: '100%'};
  assert.equal(Z.heightMismatch(main, {layer_height: [0.2], first_layer_height: 0.2}), null);
  const bad = Z.heightMismatch(main, {layer_height: 0.15, first_layer_height: 0.2});
  assert.ok(bad);
  assert.match(Z.heightMessage('Haupt', 'Fein', bad), /0,20 mm.*0,15 mm/);
});

test('zone-plan: Sperrgründe', () => {
  const ok = {models: 1, tools: 1, hasSupportPlate: false, mainValues: {}, zoneValues: [{}]};
  assert.equal(Z.zoneBlockReason(ok), null);
  assert.match(Z.zoneBlockReason({...ok, models: 2}), /einem Modell/);
  assert.match(Z.zoneBlockReason({...ok, tools: 2}), /Werkzeugen/);
  assert.match(Z.zoneBlockReason({...ok, zoneValues: [{support_material: true}]}), /Stützen/);
  assert.match(Z.zoneBlockReason({...ok, hasSupportPlate: true}), /Stützen/);
});

test('offset-rules: Altformat bleibt erhalten, neue Parameter sind deaktiviert, Alle an/aus behält Werte', () => {
  const rules = [{cat: 'quality', option: 'q', key: 'temperature', delta: 5}];
  const view = {cat: 'quality', option: 'q'};
  const item = R.itemFor(rules, view, 'temperature');
  assert.equal(item.delta, 5);
  assert.equal(rules[0].key, undefined);
  const fresh = R.itemFor(rules, view, 'first_layer_temperature', -2);
  assert.deepEqual(fresh, {key: 'first_layer_temperature', delta: -2, enabled: false});
  R.setAllEnabled(rules, view, true, ['first_layer_temperature']);
  assert.ok(rules[0].items.every(i => i.enabled));
  R.setAllEnabled(rules, view, false);
  assert.ok(rules[0].items.every(i => i.enabled === false));
  assert.equal(rules[0].items[0].delta, 5);
  R.removeItem(rules, view, 'first_layer_temperature');
  assert.equal(rules[0].items.length, 1);
  const other = R.itemFor(rules, {cat: 'quality', option: 'x'}, 'temperature', 1);
  assert.equal(other.delta, 1);
  assert.equal(rules.length, 2);
});
