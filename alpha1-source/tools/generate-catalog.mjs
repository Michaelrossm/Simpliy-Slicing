// Erzeugt den Parameterkatalog aus Schema + Quellcode von PrusaSlicer.
// Simpliy liefert KEINE Prusa-Texte aus: Beschriftungen, Beschreibungen und Auswahltexte stehen nur als Pruefsumme
// (FNV-1a, 32 Bit, des englischen Originaltexts) im Katalog. Die Texte liest Simpliy zur Laufzeit aus der
// Uebersetzungsdatei der vom Nutzer installierten Engine (Rust: engine_texts).
// node tools/generate-catalog.mjs "<Prusa-Quellordner>"
import fs from 'node:fs';

const src = process.argv[2];
if (!src) throw Error('Prusa-Quellordner fehlt');
const read = p => fs.readFileSync(p, 'utf8');
const root = new URL('..', import.meta.url);
const schema = JSON.parse(read(new URL('schema-prusa-3.0-alpha14.json', root)));
const dom = `${src}/src/slic3r-domain/src/Slic3r/Domain/`;
const lit = s => [...s.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
  .map(m => JSON.parse(`"${m[1].replace(/\\'/g, "'").replace(/\t/g, '\\t')}"`)).join('');

const de = new Map();
for (const block of read(`${src}/resources/localization/de/PrusaSlicer_de.po`).split(/\r?\n\r?\n/)) {
  if (block.includes('#, fuzzy') || block.includes('msgid_plural')) continue;
  const m = block.match(/msgid ((?:"[^\n]*"\s*)+)msgstr ((?:"[^\n]*"\s*)+)/);
  if (m && lit(m[2])) de.set(lit(m[1]), lit(m[2]));
}
const t = s => de.get(s) ?? s;
const fnv = s => { let h = 0x811c9dc5; for (const b of Buffer.from(s, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
const hash = s => (s ? fnv(s) : '');

const groups = new Map();
for (const m of read(`${dom}ConfigDef.cpp`).matchAll(/case ConfigItemDef::OptionGroup::(\w+):\s*return (?:_?L\()?("(?:[^"\\]|\\.)*")/g)) {
  groups.set(m[1], lit(m[2]));
}

const defs = new Map();
for (const file of ['ConfigDefsFDM.cpp', 'ConfigDefUtils.cpp', 'ConfigCommon.cpp']) {
  if (!fs.existsSync(dom + file)) continue;
  for (const body of read(dom + file).replace(/^\s*\/\/.*$/gm, '').split(/defs\.add\(\s*/).slice(1)) {
    const name = body.match(/^"([^"]+)"/)?.[1];
    if (!name || defs.has(name)) continue;
    const get = f => body.match(new RegExp(`def->${f}\\s*=([\\s\\S]*?);\\s*\\n`))?.[1];
    defs.set(name, {
      label: lit(get('full_label') || get('label') || ''),
      short: lit(get('label') || ''),
      tip: lit(get('tooltip') || ''),
      cat: get('category')?.match(/Category::(\w+)/)?.[1] || '',
      group: get('option_group')?.match(/OptionGroup::(\w+)/)?.[1] || '',
      order: Number(get('order')) || 0,
      unit: [...(get("units") || "").matchAll(/"([^"]*)"/g)].map(m => m[1]).join(" / "),
      multi: /def->multiline\s*=\s*true/.test(body),
      choices: Object.fromEntries([...body.matchAll(/\{\s*(?:int|static_cast<int>)\([^)]*\)\s*,\s*"([^"]*)"\s*,\s*L\("([^"]*)"\)/g)].map(m => [m[1], m[2]])),
    });
  }
}

function tabOf(key, d) {
  const c = d.cat;
  if (/temperature|idle_temp/.test(key)) return 'Temperatur';
  if (c === 'Filament_Cooling' || /(^|_)fan(_|$)/.test(key)) return 'Kühlung';
  if (/(^|_)(gcode|post_process)$/.test(key) || key === 'gcode_substitutions') return 'Skripte';
  if (/^(skirt|brim|draft_shield|wipe_tower|raft_|ooze_prevention|min_skirt_length)/.test(key)) return 'Ergänzungen';
  return {
    Print_LayersSurfaces: 'Schicht', Print_WallsPerimeters: 'Schicht', Print_Infill: 'Füllung',
    Print_BedAdhesion: 'Ergänzungen', Print_Supports: 'Stützen', Print_Speed: 'Geschwindigkeiten',
    Print_MotionDynamics: 'Geschwindigkeiten', Print_ExtrusionRetraction: 'Extruder', Print_MultiMaterial: 'Extruder',
    Print_PrecisionSlicing: 'Fortgeschritten', Print_CustomGCode: 'Skripte', Print_OutputOptions: 'Ausgabe',
    Filament_MaterialTemperatures: 'Temperatur', Filament_ExtrusionCalibration: 'Extruder',
    Filament_MultiMaterial: 'Extruder', Filament_Overrides: 'Extruder', Filament_CustomGCode: 'Skripte',
    Printer_General: 'Ausgabe', Printer_Bed: 'Ausgabe', Printer_CustomGCode: 'Skripte',
    Printer_MachineLimits: 'Geschwindigkeiten', Printer_MultipleExtruders: 'Extruder',
    Printer_SingleExtruderMMSetup: 'Extruder',
  }[c] || 'Andere';
}

const out = [];
for (const box of ['printer', 'print', 'filament']) {
  for (const i of schema[box].items) {
    if (i.name === 'printer_technology') continue; // Simpliy ist reines FFF, SLA wird nicht benoetigt
    const d = defs.get(i.name) || { label: i.name, short: i.name, tip: '', cat: '', group: '', order: 0, unit: '', choices: {} };
    out.push({
      key: i.name, box, perObject: box === 'print' && i.overrides_in.includes('Object'),
      perVolume: box === 'print' && i.overrides_in.includes('Volume'),
      label: i.name, labelHash: hash(d.label || d.short), tipHash: hash(d.tip), tab: tabOf(i.name, d),
      group: '', groupHash: hash(groups.get(d.group) || ''),
      category: d.cat, order: d.order, unit: d.unit, type: i.type, element: i.element_type,
      min: i.min, max: i.max, default: i.value,
      multiline: !!d.multi || /gcode$|notes$|^post_process$/.test(i.name),
      options: i.enum_values?.map(v => ({ value: v, label: v, labelHash: hash(d.choices[v] || '') })),
    });
  }
}

fs.writeFileSync(new URL('frontend/engine-catalog.json', root), JSON.stringify(out));

const tally = {};
for (const i of out) ((tally[i.tab] ??= {})[i.group] = (tally[i.tab][i.group] || 0) + 1);
console.log(out.length, 'Parameter;', de.size, 'Uebersetzungen');
console.log(tally);
console.log('ohne Quelle', out.filter(i => !defs.has(i.key)).map(i => i.key).join(' '));
console.log('ohne Uebersetzung', out.filter(i => {
  const d = defs.get(i.key);
  return d && !de.has(d.label || d.short);
}).map(i => `${i.key}=${i.label}`).join(' | '));
