import test from 'node:test';
import assert from 'node:assert/strict';
import {holeAdvice, DEFAULT_UNDERSIZE, TINY} from '../frontend/hole-advice.js';
import {renderRepairPanel} from '../frontend/feature-panels.js';

const holes = [{diameter: 5, orientation: 'senkrecht', depth: 6, axis: [0, 0, 1]}, {diameter: 2, orientation: 'waagerecht', depth: 4, axis: [1, 0, 0]}];

test('Bohrungen: erwartetes Druckmaß und Aufmaß ohne Ausgleich im Prozess', () => {
  const a = holeAdvice(holes, {});
  assert.equal(a.undersize, DEFAULT_UNDERSIZE);
  assert.equal(a.delta, 0.2);
  assert.ok(Math.abs(a.rows[0].expected - 4.8) < 1e-9);
  assert.ok(a.rows[1].warnings.some(w => /sehr klein/.test(w)) && a.rows[1].warnings.some(w => /waagerecht/.test(w)));
  assert.ok(a.rows[1].diameter < TINY);
  assert.match(a.alternative, /−0,10 mm|-0,10 mm/);
});

test('Bohrungen: Prusa-Ausgleich (Maßausgleich XY, Schrumpf) senkt das nötige Aufmaß', () => {
  const comp = holeAdvice(holes, {xy_size_compensation: -0.1});
  assert.equal(comp.delta, 0);          // 0,2 − 2·0,1: nichts mehr nötig
  assert.equal(comp.alternative, '');
  assert.ok(Math.abs(comp.rows[0].expected - 5.0) < 1e-9);
  const shrink = holeAdvice([holes[0]], {filament_shrinkage_compensation_xy: 2});
  assert.ok(Math.abs(shrink.delta - 0.1) < 1e-9, String(shrink.delta)); // 0,2 − 5·0,02
  const over = holeAdvice(holes, {xy_size_compensation: -0.5});
  assert.equal(over.delta, 0, 'nie ein negatives Aufmaß');
  assert.equal(holeAdvice(holes, {xy_size_compensation: [{value: -0.1}]}).delta, 0, 'Wert als Liste/Objekt');
});

test('Bohrungen: Panel zeigt Liste, Warnung, Empfehlung und den Knopf', () => {
  const advice = holeAdvice(holes, {});
  const html = renderRepairPanel({model: {id: 'm'}, report: null, tolerance: 0.001, holes: {advice, undersize: 0.2}});
  assert.match(html, /data-action="hole-scan"/);
  assert.match(html, /data-repair="undersize"/);
  assert.match(html, /Bohrungen um 0,2 mm vergrößern/);
  assert.match(html, /sehr klein/);
  const none = renderRepairPanel({model: {id: 'm'}, report: null, tolerance: 0.001, holes: {undersize: 0.2}});
  assert.doesNotMatch(none, /hole-adjust/);
});
