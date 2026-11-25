import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pick, makePrinter, makeMaterial, applyMaterial, applyQuality, applyPreset, setValue, effective,
  saveToLibrary, loadFromLibrary, unsaved, translateImport, migrate, materialFromProcess, materialsFor, SCHEMA,
} from '../frontend/profiles.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../frontend/engine-catalog.json', import.meta.url), 'utf8'));
const byKey = new Map(catalog.map(s => [s.key, s]));
const base = Object.fromEntries(catalog.map(s => [s.key, s.default]));
base.nozzle_diameter = 0.4;
const process = () => ({id: 'p', name: 'P', values: pick(base, byKey, ['print', 'filament']), origins: {}});

test('ein neuer Drucker hat vollständige Druckerwerte und Qualitäten', () => {
  const printer = makePrinter({name: 'X', base, byKey});
  assert.equal(Object.keys(printer.settings).length, catalog.filter(s => s.box === 'printer').length + 1);
  assert.deepEqual(printer.qualities.map(q => q.name), ['0,10 mm', '0,15 mm', '0,20 mm', '0,25 mm', '0,30 mm']);
  assert.ok(printer.qualities.every(q => q.values.layer_height > 0));
});

test('Material im Prozess ändern lässt die Bibliothek unverändert und umgekehrt', () => {
  const material = makeMaterial({name: 'Fiberflex 20D', values: {...base, temperature: 230}, byKey});
  const a = process(), b = process();
  applyMaterial(a, material, byKey);
  applyMaterial(b, material, byKey);
  setValue(a, 'temperature', 240);
  assert.equal(material.settings.temperature, 230);
  assert.equal(b.values.temperature, 230);
  material.settings.temperature = 250;
  assert.equal(a.values.temperature, 240);
  assert.equal(b.values.temperature, 230);
  materialFromProcess(material, a, byKey);
  assert.equal(material.settings.temperature, 240);
  assert.equal(b.values.temperature, 230, 'zentrales Speichern ändert andere Prozesse nicht');
});

test('Qualität setzt nur Druckwerte, Material nur Filamentwerte', () => {
  const p = process();
  applyMaterial(p, makeMaterial({name: 'M', values: {...base, temperature: 222}, byKey}), byKey);
  const changed = applyQuality(p, {id: 'q', name: 'Fein', values: {layer_height: 0.1, temperature: 999, perimeters: 3}}, byKey);
  assert.deepEqual(changed.sort(), ['layer_height', 'perimeters']);
  assert.equal(p.values.temperature, 222);
  assert.equal(p.values.layer_height, 0.1);
  assert.equal(p.origins.layer_height, 'Qualität: Fein');
});

test('Ergänzungen behalten auch unbekannte Werte sichtbar', () => {
  const p = process();
  applyPreset(p, {id: 'e', kind: 'extras', name: 'Brim', values: {brim_width: 5, eigener_schluessel: 1}});
  assert.equal(p.values.brim_width, 5);
  assert.equal(p.extras_id, 'e');
  assert.equal(p.origins.eigener_schluessel, 'Ergänzungen: Brim');
});

test('Prozess speichern, neu laden: identische Werte; andere Einträge bleiben unberührt', () => {
  const library = [];
  const a = process();
  setValue(a, 'layer_height', 0.12);
  saveToLibrary(library, a, {name: 'ABS fein', now: 't1'});
  const other = {...process(), id: 'o', name: 'PLA'};
  saveToLibrary(library, other, {now: 't1'});
  assert.equal(unsaved(a, library), false);
  setValue(a, 'layer_height', 0.3);
  assert.equal(unsaved(a, library), true);
  const reloaded = loadFromLibrary({id: 'neu', values: {}}, library[0]);
  assert.equal(reloaded.values.layer_height, 0.12);
  assert.deepEqual(reloaded.values, {...process().values, layer_height: 0.12});
  assert.throws(() => saveToLibrary(library, {...process(), name: 'PLA'}, {asNew: true}), /existiert bereits/);
  assert.equal(library.find(e => e.name === 'PLA').data.values.layer_height, base.layer_height);
  // Geladene Kopie ändern, Bibliothek bleibt.
  setValue(reloaded, 'layer_height', 0.2);
  assert.equal(library[0].data.values.layer_height, 0.12);
});

test('wirksame Werte: Prozess vor Drucker, ohne Reste früherer Aufrufe', () => {
  const printer = makePrinter({name: 'X', base, byKey});
  const p = process();
  const first = effective(p, printer).values;
  setValue(p, 'retract_length', 1.5);
  assert.equal(effective(p, printer).values.retract_length, 1.5);
  delete p.values.retract_length;
  assert.equal(effective(p, printer).values.retract_length, printer.settings.retract_length);
  assert.deepEqual(effective(process(), printer).values, first);
});

test('Druckerfreigabe begrenzt die Materialauswahl', () => {
  const ms = [{id: 'a'}, {id: 'b'}];
  assert.equal(materialsFor({materials: []}, ms).length, 2);
  assert.deepEqual(materialsFor({materials: ['b']}, ms), [{id: 'b'}]);
});

test('Import: Druckerwerte getrennt, Prozess bekommt Druck- und Filamentwerte, Unbekanntes wird gemeldet', () => {
  const imported = {presets: [
    {kind: 'printer', name: 'Mein MK3', values: {bed_shape: '0x0,250x0,250x210,0x210', gcode_flavor: 'reprapfirmware'}},
    {kind: 'print', name: 'Fein', values: {layer_height: '0.1', wipe_into_infill: '1', alt_2x_key: '3'}},
    {kind: 'filament', name: 'ABS', values: {temperature: '255'}},
  ]};
  const r = translateImport(imported, byKey, c => c);
  assert.equal(r.printer.settings.gcode_flavor, 'reprapfirmware');
  assert.equal(r.process.layer_height, '0.1');
  assert.equal(r.process.temperature, '255');
  assert.equal(r.process.gcode_flavor, undefined);
  assert.ok(r.unknown.includes('alt_2x_key'));
  assert.equal(r.process.alt_2x_key, '3', 'unbekannte Werte bleiben erhalten');
  assert.equal(r.material.name, 'ABS');
});

test('Migration aus Schema 1: Materialien, Qualitäten, Voreinstellungen, eigene Prozesswerte', () => {
  const state = {
    schema: 1, active_printer_id: 'pr', printers: [{id: 'pr', name: 'MK3S', bed_x: 250, bed_y: 210, bed_z: 210, nozzle: 0.5}],
    filaments: [{id: 'demo', name: 'PLA', temperature: 210, bed_temperature: 60}],
    profiles: [{manifest: {profile_id: 'pr'}, profile: {categories: [
      {id: 'c0', name: 'Material', options: [{id: 'o0', name: 'Easy ABS', assignments: {temperature: 260, retract_length: 0.8}}]},
      {id: 'c1', name: 'Quality', options: [{id: 'o1', name: 'Fast', assignments: {layer_height: 0.3}}]},
      {id: 'c2', name: 'Ergänzung', selected: 'o2', options: [{id: 'o2', name: 'Brim', assignments: {brim_width: 5}}]},
    ]}}],
    processes: [{id: 'x', name: 'Alt', profile_id: 'pr', selections: {c0: 'o0', c1: 'o1'}, overrides: {}}],
  };
  const notes = migrate(state, {byKey, base, resolveOld: () => ({temperature: 260, layer_height: 0.3, brim_width: 5, gcode_flavor: 'reprapfirmware'})});
  assert.equal(state.printers[0].settings.gcode_flavor, 'reprapfirmware');
  assert.equal(state.processes[0].values.gcode_flavor, undefined);
  assert.ok(notes.length >= 2);
  assert.equal(state.profile_schema, SCHEMA);
  assert.equal(state.schema, 1, 'Dateiformat bleibt');
  const [printer] = state.printers;
  assert.equal(printer.settings.nozzle_diameter, 0.5);
  assert.equal(printer.settings.bed_shape, '0x0, 250x0, 250x210, 0x210');
  const abs = state.filaments.find(m => m.name === 'Easy ABS');
  assert.equal(abs.settings.temperature, 260);
  assert.equal(abs.settings.retract_length, 0.8);
  const proc = state.processes[0];
  assert.equal(proc.material_id, abs.id);
  assert.match(proc.quality_id, /^quality-/);
  assert.match(proc.extras_id, /^preset-/);
  assert.equal(proc.values.layer_height, 0.3);
  // Druckerwerte des alten Profils wandern in den Drucker, die wirksamen Werte bleiben gleich.
  const hw = {...state.printers[0]};
  assert.equal(effective(proc, hw).values.temperature, 260);
  assert.equal(proc.overrides !== undefined && proc.profile_id, 'pr', 'alte Felder bleiben erhalten');
  // Zweiter Lauf ändert nichts.
  const before = JSON.stringify(state);
  migrate(state, {byKey, base, resolveOld: () => ({})});
  assert.equal(JSON.stringify(state), before);
});

test('Migration: dasselbe Profil zweimal (Entwurf und Kopie) ergibt keine doppelten Einträge', () => {
  const bundle = id => ({manifest: {profile_id: id}, profile: {categories: [
    {id: 'c0', name: 'Material', options: [{id: 'o0', name: 'Easy ABS', assignments: {temperature: 260}}]},
    {id: 'c1', name: 'Quality', options: [{id: 'o1', name: 'Fast', assignments: {layer_height: 0.3}}]},
    {id: 'c2', name: 'Ergänzung', options: [{id: 'o2', name: 'Brim', assignments: {brim_width: 5}}]},
  ]}});
  const state = {schema: 1, active_printer_id: 'pr', printers: [{id: 'pr', name: 'X'}], filaments: [], profiles: [bundle('a'), bundle('b')],
    processes: [{id: 'x', name: 'A', profile_id: 'a', selections: {c0: 'o0'}}, {id: 'y', name: 'B', profile_id: 'b', selections: {c0: 'o0'}}]};
  migrate(state, {byKey, base, resolveOld: () => ({})});
  assert.equal(state.filaments.filter(m => m.name === 'Easy ABS').length, 1);
  assert.equal(state.printers[0].qualities.filter(q => q.name === 'Fast').length, 1);
  assert.equal(state.presets.filter(p => p.name === 'Brim').length, 1);
  assert.equal(state.processes[0].material_id, state.processes[1].material_id);
});

test('Zuweisung wie S3D: Auswählen und Speichern wirken nur auf zugewiesene Einstellungen', async () => {
  const {categoryOf, controlled, applyControlled, valuesFrom, defaultCategory} = await import('../frontend/profiles.js');
  const state = {presets: [{id: 'b', kind: 'extras', name: 'Brim', values: {brim_width: 5}}], filaments: [],
    printers: [{qualities: [{id: 'f', name: 'Fine', values: {temperature: 215, layer_height: 0.1}}]}]};
  assert.equal(defaultCategory('temperature', byKey, state), 'material');
  assert.equal(defaultCategory('layer_height', byKey, state), 'quality');
  assert.equal(defaultCategory('brim_width', byKey, state), 'extras');
  assert.equal(defaultCategory('retract_length', byKey, state), 'material');
  assert.equal(defaultCategory('fill_density', byKey, state), '', 'Inhalt importierter Profile bestimmt die Zuordnung nicht');
  // Einzug dem Material zuweisen, Temperatur keiner Kategorie (wie im S3D-Dialog).
  state.auto_keys = {retract_length: 'material', temperature: ''};
  assert.equal(categoryOf('retract_length', byKey, state), 'material');
  const keys = ['temperature', 'retract_length', 'bed_temperature', 'layer_height'];
  const mat = controlled('material', keys, byKey, state);
  assert.deepEqual([...mat].sort(), ['bed_temperature', 'retract_length']);
  const p = process();
  const changed = applyControlled(p, {temperature: 999, retract_length: 0.8, bed_temperature: 100, layer_height: 0.3}, mat, 'Material: X');
  assert.deepEqual(changed.sort(), ['bed_temperature', 'retract_length']);
  assert.notEqual(p.values.temperature, 999);
  assert.deepEqual(valuesFrom(p, mat), {retract_length: 0.8, bed_temperature: 100});
});

test('Schichthöhe: eigene Standardwerte, Volumenfluss begrenzt', async () => {
  const {layerHeightValues} = await import('../frontend/profiles.js');
  const fine = layerHeightValues(0.1, 0.4), coarse = layerHeightValues(0.3, 0.5);
  assert.equal(fine.top_solid_layers, 8);
  assert.equal(fine.bottom_solid_layers, 6);
  assert.equal(coarse.top_solid_layers, 3);
  assert.equal(coarse.first_layer_height, 0.3);
  assert.ok(fine.perimeter_speed < 45, 'fein etwas langsamer');
  assert.ok(coarse.infill_speed <= Math.round(12 / (0.3 * 0.5625)), 'Volumenfluss 12 mm³/s');
});

test('Auto-Konfig-Offset: nur bei aktiver Option, auch je Werkzeug und Prozentwerte', async () => {
  const {withOffsets} = await import('../frontend/profiles.js');
  const proc = {quality_id: 'layer-10', material_id: 'abs'};
  const offsets = [{cat: 'quality', option: 'layer-10', key: 'temperature', delta: 5},
    {cat: 'quality', option: 'layer-30', key: 'temperature', delta: -5},
    {cat: 'material', option: 'abs', key: 'external_perimeter_speed', delta: -2}];
  const out = withOffsets({temperature: [250, 240], external_perimeter_speed: {value: 30, is_percent: false}, layer_height: 0.1}, proc, offsets);
  assert.deepEqual(out.temperature, [255, 245]);
  assert.deepEqual(out.external_perimeter_speed, {value: 28, is_percent: false});
  assert.equal(out.layer_height, 0.1);
  assert.deepEqual(withOffsets({temperature: 250}, {quality_id: 'layer-20'}, offsets), {temperature: 250});
});

test('gespeicherten Prozess gleichen Namens nur nach Bestätigung überschreiben', async () => {
  const {saveToLibrary} = await import('../frontend/profiles.js');
  const library = [{id: 'saved-1', name: 'PETG', data: {values: {temperature: 240}}}];
  const proc = {name: 'Neu', values: {temperature: 250}, origins: {}};
  assert.throws(() => saveToLibrary(library, proc, {asNew: true, name: 'PETG'}), e => e.existing === 'saved-1');
  const entry = saveToLibrary(library, proc, {asNew: true, name: 'PETG', overwrite: true});
  assert.equal(library.length, 1);
  assert.equal(entry.id, 'saved-1');
  assert.equal(entry.data.values.temperature, 250);
  assert.equal(proc.library_id, 'saved-1');
});
