import test from 'node:test';
import assert from 'node:assert/strict';
import {padsJob, boxJob, newFlow, DEFAULTS} from '../frontend/flow-calibration.js';

const codes = {startCode: DEFAULTS.startCode, endCode: DEFAULTS.endCode};

test('Flow-Plättchen: M221-Stufen, Start- und Endcode, Beschriftung', () => {
  const g = padsJob({}, {}, codes);
  for (const flow of [86, 90, 94]) assert.ok(g.includes(`M221 S${flow}`), `M221 S${flow}`);
  assert.ok(g.includes('M98 P"0:/sys/print/start.g" S55 H210'));
  assert.ok(g.trimEnd().endsWith('; Ende Flow-Plättchen'));
  assert.ok(g.includes('M221 S100'));
  assert.ok(!g.includes('NaN'));
});

test('Flow-Plättchen: Plättchen außerhalb des Druckbetts werden abgelehnt', () => {
  assert.throws(() => padsJob({bedW: 40, bedD: 40}, {}, codes), /Druckbett/);
  assert.throws(() => padsJob({}, {P: 5}, codes), /zu klein/);
});

test('Einzelwand-Box: Schichten, Lüfter ab Schicht 3 und Linienbreite', () => {
  const g = boxJob({}, {Z: 5, S: 30}, codes);
  assert.equal(g.split('\n').filter(l => l.startsWith('G1 Z') && l.endsWith('F900')).length, 5);
  assert.equal(g.split('\n').filter(l => l.startsWith('M106 S0.4')).length, 1);
  assert.ok(g.includes('Soll-Wand=0.48mm'));
  assert.throws(() => boxJob({nozzleDia: 0.35}, {}, codes), /Düse nicht unterstützt/);
  assert.equal(boxJob({nozzleDia: 0.35}, {W: 0.4}, codes).includes('Soll-Wand=0.4mm'), true);
});

test('Auswertung: neuer Flow = aktuell × Soll / gemessen', () => {
  assert.ok(Math.abs(newFlow({measured: 0.48, target: 0.45, currentFlow: 100}) - 93.75) < 1e-9);
  assert.throws(() => newFlow({measured: 0, target: 0.45, currentFlow: 100}), /Gemessene/);
});
