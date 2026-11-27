import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSupportPanel} from '../frontend/support-panel.js';

const base = tab => ({
  model: {id: 'm'}, ready: true, mode: '', count: 0, automatic: [], manual: [],
  schema: {styles: {pillar: 'Pfeiler', tree: 'Baum'}, limits: {}},
  settings: {contactPattern: 'process', contactLayers: 0, contactDensity: 0, contactAngle: -1, contactLoops: 'process', contactSpeed: 0, contactZ: -1, xyGap: 0,
    bodySpeed: 0, lineWidth: 0, bodyWalls: 1, bodyInfill: 0, bodyPattern: 'rectilinear', style: 'pillar'},
  tabs: {shape: tab},
});

test('Stützen-Panel: Reiter „Kontaktfläche“ zeigt alle Kontakt-Einstellungen mit Prozess-Hinweisen', () => {
  const html = renderSupportPanel(base('contact'));
  for (const key of ['contactPattern', 'contactLayers', 'contactDensity', 'contactAngle', 'contactLoops', 'contactSpeed', 'contactZ', 'xyGap']) {
    assert.ok(html.includes(`data-support-setting="${key}"`), key);
  }
  assert.match(html, /Prozess/);
  assert.match(html, /data-tab="contact"[^>]*>Kontaktfläche/);
});

test('Stützen-Panel: Reiter „Druck“ zeigt Tempo, Bahnbreite, Wände, Füllung und Muster', () => {
  const html = renderSupportPanel(base('print'));
  for (const key of ['bodySpeed', 'lineWidth', 'bodyWalls', 'bodyInfill', 'bodyPattern']) assert.ok(html.includes(`data-support-setting="${key}"`), key);
  assert.match(html, /gyroid/i);
});

test('Stützen-Panel: „aus Prozess“ sperrt die Prusa-gesteuerten Werte und zeigt den Schalter', () => {
  const on = base('body'); on.settings.useProcess = true; Object.assign(on.settings, {overhangAngle: 35, branchAngle: 40, bodyWidth: 3, tipWidth: 1.2, bodyLikePrusa: false});
  on.schema.limits = {bodyWidth: [1.2, 20], branchAngle: [10, 55]};
  const html = renderSupportPanel(on);
  assert.match(html, /data-support-setting="branchAngle"[^>]*disabled/);
  assert.match(html, /aus Prozess/);
  const off = base('body'); Object.assign(off.settings, {useProcess: false, branchAngle: 40, bodyWidth: 3});
  off.schema.limits = on.schema.limits;
  assert.doesNotMatch(renderSupportPanel(off), /data-support-setting="branchAngle"[^>]*disabled/);
  const surfaces = base('body'); surfaces.tabs.place = 'surfaces';
  assert.match(renderSupportPanel(surfaces), /data-support-setting="useProcess"/);
  assert.match(renderSupportPanel(base('print')), /data-support-setting="bodyLikePrusa"/);
});

test('Stützen-Panel: druckbarer Zusatzwinkel, Fasen- und Bohrungsregeln sind einstellbar', () => {
  const place = base('body'); place.tabs.place = 'surfaces'; Object.assign(place.settings, {overhangAngle: 45, printableExtra: 5, printableAuto: true, printableBonus: 8});
  const html = renderSupportPanel(place);
  assert.match(html, /data-support-setting="printableExtra"/);
  assert.match(html, /data-support-setting="printableAuto"/);
  assert.match(html, /ab 32° gestützt/); // 45 − 5 − 8
  const rules = base('body'); rules.tabs.place = 'rules';
  const r = renderSupportPanel(rules);
  for (const k of ['boreMax', 'chamferMax', 'chamferTol']) assert.ok(r.includes(`data-support-setting="${k}"`), k);
});
