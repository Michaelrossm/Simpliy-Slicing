import test from 'node:test';
import assert from 'node:assert/strict';
import {createOffsetActions} from '../frontend/actions/offsets.js';
import {createColorActions} from '../frontend/actions/colors.js';
import {createZoneActions} from '../frontend/actions/zones.js';
import {createFavoriteActions} from '../frontend/actions/favorites.js';
import {createProcessResetActions} from '../frontend/actions/process-reset.js';
import * as P from '../frontend/profiles.js';

const el = (dataset, extra = {}) => ({dataset, ...extra});

function world() {
  const calls = {update: 0, render: 0, notes: [], modal: ''};
  const material = {id: 'm1', name: 'PLA', settings: {}, colors: [{id: 'c1', name: 'Rot', colour: '#ff0000', offsets: {temperature: -5}}]};
  const qualities = [{id: 'q10', name: '0,10', values: {layer_height: 0.1}}, {id: 'q20', name: '0,20', values: {layer_height: 0.2}}];
  const state = {auto_offsets: [{cat: 'quality', option: 'q10', key: 'temperature', delta: -3}], filaments: [material], presets: [], printers: [{id: 'p', qualities}], favorites: []};
  const proc = {id: 'proc', material_id: 'm1', quality_id: 'q20', values: {}};
  const env = {
    state, catalogByKey: new Map([['temperature', {type: 'Int'}]]), autoField: new Proxy({}, {get: (_, c) => `${String(c)}_id`}),
    autoList: cat => (cat === 'material' ? state.filaments : cat === 'quality' ? qualities : []),
    printerOf: () => state.printers[0],
    notify: m => calls.notes.push(m), confirmRemove: async () => true,
    render: () => { calls.render++; }, update: () => { calls.update++; },
    openModal: n => { calls.modal = n; }, closeModal: () => { calls.modal = ''; }, getModal: () => calls.modal,
    byId: () => null, invalidateBase: () => {},
  };
  return {env, state, proc, calls, material};
}

test('Offsets: Änderungen landen im Entwurf, nicht in den globalen Regeln; Altformat bleibt erhalten', () => {
  const {env, state, proc} = world();
  const offsets = createOffsetActions(env);
  assert.deepEqual(offsets.viewOf(proc), {cat: 'material', option: 'm1'}); // erste Kategorie
  offsets.actions['offset-cat']({el: el({cat: 'quality'})});
  assert.deepEqual(offsets.viewOf(proc), {cat: 'quality', option: 'q20'}); // aktive Option vorausgewählt
  offsets.change(el({field: 'offset-option'}, {value: 'q10'}), proc);
  assert.equal(offsets.viewOf(proc).option, 'q10'); // betrachtete Option getrennt von der aktiven
  assert.equal(proc.quality_id, 'q20');
  offsets.change(el({offsetDelta: 'temperature'}, {value: '+4'}), proc);
  assert.equal(state.auto_offsets[0].delta, -3, 'globale Regel unverändert');
  const rule = proc.pending.offsetRules[0];
  assert.equal(rule.items[0].delta, 4);
  assert.equal(rule.key, undefined);
});

test('Offsets: Standardparameter, Alle an/aus, Master, Entfernen', () => {
  const {env, proc} = world();
  const offsets = createOffsetActions(env);
  offsets.actions['offset-cat']({el: el({cat: 'quality'})});
  offsets.change(el({offsetAllCat: ''}, {checked: true}), proc);
  const rules = proc.pending.offsetRules;
  const q10 = rules.find(r => r.option === 'q10');
  const q20 = rules.find(r => r.option === 'q20');
  assert.ok(q20.items.every(i => i.enabled), 'auch Optionen ohne Regel bekommen ihre Standardparameter');
  assert.deepEqual(q20.items.map(i => i.key).sort(), ['first_layer_temperature', 'temperature']);
  assert.equal(q10.items.find(i => i.key === 'temperature').delta, -3, 'vorhandener Wert bleibt');
  offsets.change(el({offsetAllCat: ''}, {checked: false}), proc);
  assert.ok(rules.every(r => r.items.every(i => i.enabled === false)));
  offsets.change(el({offsetMaster: ''}, {checked: false}), proc);
  assert.ok(rules.filter(r => r.option === 'q20').every(r => r.enabled === false));
  offsets.change(el({offsetOn: 'temperature'}, {checked: true}), proc);
  assert.equal(rules.find(r => r.option === 'q20').items.find(i => i.key === 'temperature').enabled, true);
  offsets.actions['offset-item-remove']({proc, el: el({key: 'temperature'})});
  assert.ok(!rules.find(r => r.option === 'q20').items.some(i => i.key === 'temperature'));
});

test('Farben: Entwurf, Auswahl, Löschen; Material-Liste bleibt bis zum Speichern unverändert', async () => {
  const {env, proc, material, calls} = world();
  const colors = createColorActions(env);
  assert.equal(colors.activeColorOf(proc), null);
  colors.actions['color-pick']({proc, el: el({id: 'c1'})});
  assert.equal(colors.activeColorOf(proc).name, 'Rot');
  colors.change(el({colorOffset: 'min_fan_speed'}, {value: '7'}), proc);
  assert.equal(colors.activeColorOf(proc).offsets.min_fan_speed, 7);
  assert.equal(material.colors[0].offsets.min_fan_speed, undefined, 'Material unverändert');
  colors.actions['color-add']({proc});
  assert.equal(colors.colorsOf(proc).length, 2);
  assert.equal(calls.modal, 'colors');
  await colors.actions['color-remove']({proc});
  assert.equal(proc.color_id, '');
  assert.equal(colors.colorsOf(proc).length, 1);
  assert.equal(material.colors.length, 1);
  assert.equal(colors.colorOptions(proc).list.length, 1);
});

test('Zonen: Fenster prüft Eingaben und schreibt erst mit Speichern in den Prozess', () => {
  const {env, proc, calls} = world();
  const zones = createZoneActions(env);
  zones.actions['open-zones']({proc});
  assert.equal(calls.modal, 'zones');
  zones.change(el({zone: 'fromOn'}, {checked: true}));
  zones.change(el({zone: 'from'}, {value: '6'}));
  zones.change(el({zone: 'toOn'}, {checked: true}));
  zones.change(el({zone: 'to'}, {value: '4'}));
  zones.actions['zone-save']({proc});
  assert.equal(proc.zone, undefined, 'Ende unter Start wird abgelehnt');
  assert.match(zones.renderDialog(), /Das Ende muss über dem Start liegen/);
  zones.input(el({zone: 'to'}, {value: '12,5'}));
  zones.actions['zone-save']({proc});
  assert.deepEqual(proc.zone, {fromOn: true, from: 6, toOn: true, to: 12.5});
  assert.equal(calls.modal, '');
  assert.equal(zones.renderDialog(), '');
});

test('Zonen: withProcess setzt den Hauptprozess der Platte und stellt die Zuordnung wieder her', async () => {
  const {env} = world();
  const zones = createZoneActions(env);
  const model = {process: 'main', zone_processes: ['z1']};
  const other = {process: 'main'};
  const seen = await zones.withProcess([model, other], {id: 'z1'}, async () => [model.process, other.process, zones.mainId()]);
  assert.deepEqual(seen, ['z1', 'main', 'z1']);
  assert.equal(model.process, 'main');
  assert.equal(zones.mainId(), null);
});

test('Favoriten: hinzufügen ohne Doppelte, entfernen, Suche', () => {
  const {env, state} = world();
  const favorites = createFavoriteActions(env);
  favorites.actions['fav-add']({el: el({key: 'fill_density'})});
  favorites.actions['fav-add']({el: el({key: 'fill_density'})});
  assert.deepEqual(state.favorites, ['fill_density']);
  favorites.actions['fav-remove']({el: el({key: 'fill_density'})});
  assert.deepEqual(state.favorites, []);
  assert.equal(favorites.live({target: {dataset: {live: 'search'}, value: 'x'}}), false);
  assert.equal(favorites.live({target: {dataset: {live: 'fav-search'}, value: 'füll'}}), true);
  assert.equal(favorites.search(), 'füll');
});

test('Prozess zurücksetzen: nur der Entwurf wird auf den gespeicherten Stand gesetzt', async () => {
  const {env, state, calls} = world();
  const library = [];
  const proc = {id: 'p', name: 'P', values: {fill_density: '20%'}, origins: {}};
  P.saveToLibrary(library, proc, {});
  state.process_library = library;
  const reset = createProcessResetActions(env);
  await reset.actions['reset-process']({proc});
  assert.match(calls.notes.at(-1), /entspricht bereits/);
  proc.values.fill_density = '60%';
  await reset.actions['reset-process']({proc});
  assert.equal(proc.values.fill_density, '20%');
  assert.equal(library[0].data.values.fill_density, '20%');
  const fresh = {id: 'n', name: 'N', values: {}};
  await reset.actions['reset-process']({proc: fresh});
  assert.match(calls.notes.at(-1), /noch nicht gespeichert/);
});
