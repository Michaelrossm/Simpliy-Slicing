import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pick, makePrinter, makeMaterial, applyMaterial, applyQuality, applyPreset, setValue, effective,
  saveToLibrary, loadFromLibrary, unsaved, translateImport, migrate, materialFromProcess, materialsFor, SCHEMA,
} from '../frontend/profiles.js';
import * as P from '../frontend/profiles.js';

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

test('Konfiguration: Export-Paket und Rueckholen aus Simpliy-G-Code', () => {
  const proc = {name: 'Test', values: {start_gcode: 'G28\nM104 S200 ; ä€', temperature: [215, 220]}, printer_id: 'printer-1', origins: {a: 'x'}};
  const bundle = P.configBundle({proc, printer: {id: 'p', name: 'Drucker', settings: {x: 1}}, material: {id: 'm', name: 'PLA'}, offsets: [{cat: 'a', option: 'b', items: []}], app: '0.0.0-alpha.2', withOrigins: false});
  assert.equal(bundle.process.data.origins, undefined);
  const lines = P.gcodeConfigLines(bundle);
  assert.ok(lines.every(l => l.startsWith(';') && l.length < 200));
  const gcode = ['; G-Code generated by Simpliy Slicing Version 0.0.0-alpha.2', '; 2026-11-25 10:00:00 UTC', '; Settings Summary', ';   processName,Test', ...lines, 'G1 X1'].join('\n');
  const back = P.readGcodeConfig(gcode);
  assert.equal(back.kind, 'exact');
  assert.equal(back.info.app, '0.0.0-alpha.2');
  assert.deepEqual(back.bundle.process.data.values, proc.values);
  assert.equal(back.bundle.printer.name, 'Drucker');
  assert.deepEqual(back.bundle.auto_offsets, bundle.auto_offsets);
});

test('Konfiguration: fremder G-Code wird abgelehnt, aeltere Dateien nutzen die Zusammenfassung', () => {
  assert.equal(P.readGcodeConfig('; generated by PrusaSlicer 3.0.0\nG1 X1\n'), null);
  const old = P.readGcodeConfig('; G-Code generated by Simpliy Slicing Version 0.0.0-alpha.1\n; x\n; Settings Summary\n;   processName,P\n;   start_gcode,G28\\nG1\nG1 X1\n');
  assert.equal(old.kind, 'summary');
  assert.deepEqual(old.entries, [['processName', 'P'], ['start_gcode', 'G28\nG1']]);
  assert.throws(() => P.readGcodeConfig('; G-Code generated by Simpliy Slicing Version 1\n; x\n; simpliy_config_begin 1\n; simpliy_config = ####\n; simpliy_config_end\n'), /beschädigt/);
  assert.throws(() => P.readConfig({format: 'Anderes'}), /keine Simpliy-Konfiguration/);
});

test('Auto-Konfiguration uebernehmen: Vorhandenes bleibt unveraendert', () => {
  const values = o => o.values || {};
  const list = [{id: 'layer-10', name: '0,10 mm', values: {layer_height: 0.1, perimeter_speed: 24}}, {id: 'layer-20', name: '0,20 mm', values: {layer_height: 0.2, perimeter_speed: 30}}];
  const before = structuredClone(list);
  // identisch: vorhandene Option wird gewaehlt
  const same = P.adoptOption(list, {id: 'x', name: '0,10 mm', values: {perimeter_speed: 24, layer_height: 0.1}}, values);
  assert.equal(same.status, 'same'); assert.equal(same.option.id, 'layer-10'); assert.equal(same.added, null);
  // gleicher Name, andere Werte: Kopie, Original bleibt
  const copy = P.adoptOption(list, {id: 'x', name: '0,10 mm', values: {layer_height: 0.1, perimeter_speed: 40}, generated: true}, values);
  assert.equal(copy.status, 'copy'); assert.equal(copy.added.name, '0,10 mm (Import)'); assert.equal(copy.added.generated, undefined);
  assert.ok(!list.some(o => o.id === copy.added.id));
  // unbekannt: neu
  const fresh = P.adoptOption(list, {id: 'y', name: '0,05 mm', values: {layer_height: 0.05}}, values);
  assert.equal(fresh.status, 'new'); assert.equal(fresh.added.name, '0,05 mm');
  // wiederholter Import derselben Kopie legt nichts doppelt an
  const again = P.adoptOption([...list, copy.added], {id: 'x', name: '0,10 mm', values: {layer_height: 0.1, perimeter_speed: 40}}, values);
  assert.equal(again.status, 'same'); assert.equal(again.option.id, copy.added.id);
  assert.deepEqual(list, before);
});

// ---- Auto-Konfig Farbe -----------------------------------------------------------------------------------------------
import {offsetNote} from '../frontend/process-dialog.js';
const redMaterial = () => {
  const m = makeMaterial({name: 'PLA', values: {...base, temperature: 253}, byKey});
  m.colors = [{id: 'rot', name: 'Rot', colour: '#e53935', offsets: {temperature: -5}}];
  return m;
};
const colorCtx = (list, p) => ({list, byKey});

test('Farbe: neues und dupliziertes Material starten ohne Farben', () => {
  const m = makeMaterial({name: 'Neu', values: base, byKey});
  assert.equal(m.colors, undefined);
  assert.deepEqual(P.makeColor({taken: []}).offsets, {});
  const proc = process();
  applyMaterial(proc, redMaterial(), byKey);
  assert.equal(proc.color_id, '');
});

test('Farbe: 253 + 2 - 5 ergibt 250, ohne Farbe bleibt es bei 255, kein doppeltes Rechnen', () => {
  const m = redMaterial(), proc = process();
  applyMaterial(proc, m, byKey);
  proc.values.temperature = 253;
  const offsets = [{cat: 'quality', option: 'q', items: [{key: 'temperature', delta: 2}]}];
  proc.quality_id = 'q';
  assert.equal(P.withOffsets(proc.values, proc, offsets, colorCtx(m.colors)).temperature, 255);
  proc.color_id = 'rot';
  const once = P.withOffsets(proc.values, proc, offsets, colorCtx(m.colors));
  assert.equal(once.temperature, 250);
  assert.equal(once.filament_colour, '#e53935');
  assert.equal(P.withOffsets(proc.values, proc, offsets, colorCtx(m.colors)).temperature, 250); // wiederholt: gleiches Ergebnis
  assert.equal(proc.values.temperature, 253); // Grundwert bleibt unveraendert
  proc.color_id = '';
  assert.equal(P.withOffsets(proc.values, proc, offsets, colorCtx(m.colors)).temperature, 255);
});

test('Farbe: Endwerte werden auf den Prusa-Wertebereich begrenzt', () => {
  const spec = byKey.get('max_fan_speed');
  assert.equal(P.shiftClamped(95, 20, spec), spec.max ?? 100);
  assert.equal(P.shiftClamped(5, -20, spec), spec.min ?? 0);
});

test('Farbe: nur der Farb-Offset wird in Filamentfarbe dargestellt', () => {
  const spec = byKey.get('temperature');
  const ctx = {offsetOf: new Map([['temperature', 2]]), colorOf: new Map([['temperature', -5]]), colorHex: '#e53935',
    shift: P.shift, shiftClamped: P.shiftClamped, colorStyle: P.colorTextStyle};
  const html = offsetNote('temperature', spec, 253, ctx);
  assert.match(html, /253/);
  assert.match(html, /\+2/);
  assert.match(html, /<b class="color-offset" style="color:#e53935;">−5<\/b>/);
  assert.match(html, /= 250/);
  assert.equal((html.match(/#e53935/g) || []).length, 1); // +2 und Endwert bleiben normal
  assert.equal(offsetNote('temperature', spec, 253, {...ctx, colorOf: new Map()}).includes('color-offset'), false);
  assert.match(P.colorTextStyle('#ffffff'), /text-shadow/); // helle Farbe: Kontur
  assert.match(P.colorTextStyle('#000000'), /text-shadow/);
});

test('Farbe: nur Farben des gewaehlten Materials, Speichern behaelt Farben, Zuruecksetzen stellt den Stand her', () => {
  const m = redMaterial(), other = makeMaterial({name: 'PETG', values: base, byKey});
  assert.equal(P.activeColor({color_id: 'rot'}, other.colors || []), null);
  assert.equal(P.activeColor({color_id: 'rot'}, m.colors).name, 'Rot');
  const proc = process(), library = [];
  applyMaterial(proc, m, byKey);
  proc.color_id = 'rot';
  saveToLibrary(library, proc, {});
  setValue(proc, 'temperature', 199); proc.color_id = '';
  assert.equal(unsaved(proc, library), true);
  loadFromLibrary(proc, library[0]);
  assert.equal(proc.color_id, 'rot');
  assert.equal(unsaved(proc, library), false);
  assert.equal(m.colors.length, 1);
});

test('Farbe: Farb-Offset steht lesbar im G-Code-Kopf und ist auslesbar', () => {
  const color = {materialName: 'PLA', id: 'rot', name: 'Rot', colour: '#e53935', offsets: {temperature: -5, min_fan_speed: 10}};
  const bundle = P.configBundle({proc: {name: 'X', values: {}}, color, app: 'test'});
  const lines = P.gcodeConfigLines(bundle);
  assert.ok(lines.some(l => /^; simpliy_color = Rot #e53935 temperature=-5 min_fan_speed=\+10/.test(l)));
  const text = ['; G-Code generated by Simpliy Slicing Version 0', '; datum', ...lines, 'G28'].join('\n');
  const read = P.readGcodeConfig(text);
  assert.equal(read.kind, 'exact');
  assert.deepEqual(read.bundle.color.offsets, {temperature: -5, min_fan_speed: 10});
  assert.equal(read.bundle.color.colour, '#e53935');
  assert.ok(P.COLOR_KEYS.flatMap(g => g[1]).every(k => byKey.has(k) && byKey.get(k).box === 'filament'));
});

// ---- Auto-Konfig-Offset: Aktivierung, Addition, Altformat --------------------------------------------------------------
test('Offsets: deaktivierte Regeln/Parameter zaehlen 0, Werte bleiben, Wiederaktivieren stellt sie her', () => {
  const proc = {quality_id: 'q'};
  const rule = {cat: 'quality', option: 'q', items: [{key: 'first_layer_temperature', delta: -5}, {key: 'temperature', delta: -3, enabled: false}]};
  const v = {first_layer_temperature: 215, temperature: 210};
  const run = () => P.withOffsets(v, proc, [rule], {list: [], byKey});
  assert.deepEqual([run().first_layer_temperature, run().temperature], [210, 210]); // nur erster aktiv
  rule.items[1].enabled = true;
  assert.equal(run().temperature, 207);
  rule.enabled = false;
  assert.deepEqual([run().first_layer_temperature, run().temperature], [215, 210]);
  assert.equal(rule.items[0].delta, -5); // nichts geloescht
  rule.enabled = true;
  assert.equal(run().first_layer_temperature, 210);
});

test('Offsets: Altformat ohne enabled bleibt aktiv, Regeln addieren sich, Farbe zusaetzlich einmal, Grenzen greifen', () => {
  const legacy = {cat: 'quality', option: 'q', key: 'temperature', delta: 5};
  const second = {cat: 'material', option: 'm', items: [{key: 'temperature', delta: 3}]};
  const proc = {quality_id: 'q', material_id: 'm', color_id: 'c'};
  const colors = {list: [{id: 'c', name: 'C', colour: '#ff0000', offsets: {temperature: -4}}], byKey};
  const out = P.withOffsets({temperature: 200}, proc, [legacy, second], colors);
  assert.equal(out.temperature, 204); // 200 + 5 + 3 - 4
  const hot = {cat: 'quality', option: 'q', key: 'bed_temperature', delta: 10};
  assert.equal(P.withOffsets({bed_temperature: 295}, proc, [hot], {list: [], byKey}).bed_temperature, byKey.get('bed_temperature').max);
  assert.equal(P.withOffsets({temperature: 200}, proc, [], null).temperature, 200);
  assert.deepEqual(P.DEFAULT_QUALITY_ITEMS.map(d => d.key), ['first_layer_temperature', 'temperature']);
});

test('Offsets: Standard-Temperaturwerte beginnen bei -2 und steigen je Schichthöhe um 2', () => {
  const opts = [0.3, 0.1, 0.2, 0.15].map(h => ({id: `q${h}`, values: {layer_height: h}})).concat([{id: 'ohne', values: {}}]);
  const d = id => P.defaultOffset('quality', opts, id, 'temperature');
  assert.deepEqual([d('q0.1'), d('q0.15'), d('q0.2'), d('q0.3')], [-2, 0, 2, 4]);
  assert.equal(d('ohne'), 0);
  assert.equal(P.defaultOffset('quality', opts, 'q0.1', 'bed_temperature'), 0);
  assert.equal(P.defaultOffset('material', opts, 'q0.1', 'temperature'), 0);
});
