// Profilverwaltung: Drucker, Materialbibliothek, Qualitaet je Drucker,
// benannte Voreinstellungen und eigenstaendige Prozesse. Reine Logik ohne Oberflaeche.
//
// Werte fuer die Engine (je Slicing neu zusammengesetzt, nichts aus frueheren Auftraegen):
//   Engine-Geruest (nur Struktur) <- Drucker.settings <- Prozess.values
// Prozess.values ist vollstaendig: Material, Qualitaet und Voreinstellungen wurden beim Auswaehlen hineinkopiert.
// Vorrang beim Auswaehlen: Qualitaet setzt nur Druckwerte, Material nur Filamentwerte, damit gibt es keine
// Ueberschneidung. Ergaenzungen und Prozessaenderungen setzen danach ihre Werte, eigene Eingaben zuletzt.

export const SCHEMA = 2;
/**
 * Neutrale Engine-Grundlage von Simpliy (eigenes Engine-Paket ohne Druckermodell und Herstellerwerte).
 * Sie legt nur die Werkzeuganzahl fest; alle Werte kommen beim Slicen aus Simpliy.
 */
export function neutralSkeleton(tools = 1) {
  const n = Math.min(8, Math.max(1, Math.round(Number(tools) || 1)));
  const names = Array(n).fill('Neutral').join(', ');
  return {printer: n === 1 ? `Simpliy ${names}` : `Simpliy ${n}T ${names}`, print: 'Simpliy', tool: 'Simpliy', filament: 'Simpliy', tools: n};
}
/** Werkzeuganzahl einer (auch alten Prusa-)Grundlage, z. B. „Prusa XL 2T 0.4, 0.4“ = 2. */
export function toolsOf(engine) {
  if (Number(engine?.tools) >= 1) return Math.round(engine.tools);
  const m = /\b(\d+)T\b/.exec(engine?.printer || '');
  return m ? Number(m[1]) : 1;
}
export const DEFAULT_SKELETON = neutralSkeleton(1);
export const QUALITY_NAMES = ['Entwurf', 'Schnell', 'Standard', 'Fein', 'Hochpräzision'];
const QUALITY_LAYERS = [0.1, 0.15, 0.2, 0.25, 0.3];
export const PRESET_KINDS = {extras: 'Ergänzungen', change: 'Prozessänderung'};

const clone = value => (value === undefined ? undefined : structuredClone(value));
const newId = (prefix, taken) => {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};

/** Schluessel einer Box aus flachen Werten. `box`: 'printer' | 'print' | 'filament'. */
export function pick(values, byKey, boxes) {
  const out = {};
  for (const [key, value] of Object.entries(values || {})) {
    const box = key === 'nozzle_diameter' ? 'printer' : byKey.get(key)?.box;
    if (boxes.includes(box)) out[key] = clone(value);
  }
  return out;
}

/** Was von den Werten an der Engine vorbei geht (unbekannt in 3.0). */
export function unknownKeys(values, byKey) {
  return Object.keys(values || {}).filter(key => key !== 'nozzle_diameter' && !key.startsWith('simpliy.') && !byKey.get(key)?.box);
}

/** Qualitaeten fuer einen neuen Drucker: aus dem Geruest abgeleitet, je Stufe Schichthoehe und Geschwindigkeit. */
/**
 * Auto-Konfiguration Schichthoehe: eigene Simpliy-Standards je Schichthoehe (nicht aus importierten Profilen).
 * Decklagen aus Mindeststaerken, Geschwindigkeiten aus Grundwerten, begrenzt durch einen Volumenfluss von 12 mm³/s.
 */
export function layerHeightValues(layer, nozzle = 0.4) {
  const width = nozzle * 1.125;
  const cap = speed => Math.round(Math.min(speed, 12 / (layer * width)));
  const fine = layer <= 0.12 ? 0.8 : 1;
  const speeds = {perimeter_speed: 45, external_perimeter_speed: 30, infill_speed: 80, solid_infill_speed: 60, top_solid_infill_speed: 40,
    small_perimeter_speed: 25, gap_fill_speed: 30, bridge_speed: 25};
  const values = {
    layer_height: layer,
    first_layer_height: Math.round(Math.min(nozzle * 0.75, Math.max(0.2, layer)) * 100) / 100,
    top_solid_layers: Math.ceil(0.8 / layer - 1e-9),
    bottom_solid_layers: Math.ceil(0.6 / layer - 1e-9),
    top_solid_min_thickness: 0.7,
    bottom_solid_min_thickness: 0.5,
    perimeters: 2,
    first_layer_speed: 20,
    travel_speed: 150,
  };
  for (const [key, v] of Object.entries(speeds)) values[key] = cap(v * fine);
  return values;
}
export const layerName = layer => `${layer.toFixed(2).replace('.', ',')} mm`;
export function defaultQualities(base = {}) {
  const nozzle = Number(String(base.nozzle_diameter ?? 0.4).split(/[;,]/)[0]) || 0.4;
  const layers = QUALITY_LAYERS.filter(l => l <= nozzle * 0.8 + 1e-9);
  return layers.map(layer => ({id: `layer-${Math.round(layer * 100)}`, name: layerName(layer), values: layerHeightValues(layer, nozzle), generated: true}));
}

/** Neuer Drucker mit vollstaendigen Druckerwerten aus dem Geruest und Standard-Qualitaeten. */
export function makePrinter({name, base, byKey, skeleton = DEFAULT_SKELETON, taken = []}) {
  return {
    id: newId('printer', taken), name: name || 'Neuer Drucker', model: '', manufacturer: 'Benutzerdefiniert',
    engine: {...skeleton}, settings: pick(base, byKey, ['printer']),
    qualities: defaultQualities(base), default_quality: 'layer-20', materials: [], default_material: '',
    host_type: 'prusalink', web_url: '',
  };
}

export function makeMaterial({name, values, byKey, taken = [], extra = {}}) {
  const settings = pick(values, byKey, ['filament']);
  return {
    id: newId('material', taken), name: name || 'Neues Material', manufacturer: extra.manufacturer || '',
    type: extra.type || String(settings.filament_type ?? '').replace(/^\[?"?|"?\]?$/g, '') || '', colour: extra.colour || '',
    settings,
  };
}

/** Materialien, die ein Drucker anbietet. Keine Freigabe = alle. */
export function materialsFor(printer, materials) {
  const allowed = printer?.materials || [];
  return allowed.length ? materials.filter(m => allowed.includes(m.id)) : materials;
}

function mark(proc, keys, origin) {
  proc.origins ??= {};
  for (const key of keys) proc.origins[key] = origin;
}

/** Material in den Prozess kopieren. Nur Filamentwerte, der Prozess besitzt danach eine eigene Kopie. */
export function applyMaterial(proc, material, byKey) {
  const own = pick(material.settings, byKey, ['filament']);
  Object.assign(proc.values, clone(own));
  mark(proc, Object.keys(own), `Material: ${material.name}`);
  proc.material_id = material.id;
  return Object.keys(own);
}

/** Qualitaet in den Prozess kopieren. Nur Druckwerte, Materialwerte bleiben unberuehrt. */
export function applyQuality(proc, quality, byKey) {
  const own = pick(quality.values, byKey, ['print']);
  Object.assign(proc.values, clone(own));
  mark(proc, Object.keys(own), `Qualität: ${quality.name}`);
  proc.quality_id = quality.id;
  return Object.keys(own);
}

/** Ergaenzung oder Prozessaenderung: alle ihre Werte, auch unbekannte (bleiben sichtbar). */
export function applyPreset(proc, preset) {
  Object.assign(proc.values, clone(preset.values));
  mark(proc, Object.keys(preset.values), `${PRESET_KINDS[preset.kind] || 'Voreinstellung'}: ${preset.name}`);
  proc[`${preset.kind}_id`] = preset.id;
  return Object.keys(preset.values);
}

export function setValue(proc, key, value) {
  proc.values[key] = value;
  mark(proc, [key], 'Manuell');
}

/** Wirksame Werte eines Prozesses und ihre Herkunft. */
export function effective(proc, printer) {
  const values = {...clone(printer?.settings || {}), ...clone(proc.values || {})};
  const sources = {};
  for (const key of Object.keys(printer?.settings || {})) sources[key] = 'Drucker';
  for (const key of Object.keys(proc.values || {})) sources[key] = proc.origins?.[key] || 'Prozess';
  return {values, sources};
}

/** Material aus dem Prozess zentral speichern (bewusste Aktion). */
export function materialFromProcess(material, proc, byKey) {
  material.settings = pick(proc.values, byKey, ['filament']);
  return material;
}

// Prozessbibliothek: dauerhaft gespeicherte Prozesse. Laden kopiert, Speichern kopiert zurueck.

const STORED = ['printer_id', 'values', 'origins', 'material_id', 'quality_id', 'extras_id', 'change_id', 'tool'];

export function storedProcess(proc) {
  const data = {};
  for (const key of STORED) if (proc[key] !== undefined) data[key] = clone(proc[key]);
  return data;
}

export function saveToLibrary(library, proc, {asNew = false, name, overwrite = false, now = new Date().toISOString()} = {}) {
  let entry = !asNew && library.find(e => e.id === proc.library_id);
  if (!entry) {
    const same = library.find(e => e.name === (name || proc.name));
    // Gleichnamiger gespeicherter Prozess: nur nach ausdruecklicher Bestaetigung ueberschreiben.
    if (same && !overwrite) {
      const error = new Error(`Ein gespeicherter Prozess „${name || proc.name}“ existiert bereits.`);
      error.existing = same.id;
      throw error;
    }
    if (same) entry = same;
  }
  if (!entry) {
    entry = {id: newId('saved', library.map(e => e.id)), name: name || proc.name};
    library.push(entry);
  }
  entry.data = storedProcess(proc);
  entry.saved_at = now;
  proc.library_id = entry.id;
  if (name) proc.name = name;
  return entry;
}

export function loadFromLibrary(proc, entry) {
  for (const key of STORED) delete proc[key];
  Object.assign(proc, clone(entry.data));
  proc.library_id = entry.id;
  proc.name = entry.name;
  proc.values ??= {};
  return proc;
}

/** Unterscheidet sich der Prozess vom gespeicherten Stand? */
export function unsaved(proc, library) {
  const entry = library.find(e => e.id === proc.library_id);
  return !entry || JSON.stringify(storedProcess(proc)) !== JSON.stringify(entry.data);
}

// Prusa-Import: in den geoeffneten Prozess (nicht gespeichert), Drucker getrennt zur Entscheidung.

/**
 * @param imported Antwort von `prusa_import` ({config} oder {presets})
 * @returns {printer: {name, settings, skeleton}|null, process: values, material: {name, values}|null, unknown: string[], notes}
 */
export function translateImport(imported, byKey, flatten) {
  const notes = [...(imported.notes || [])];
  let printer = null;
  let material = null;
  const process = {};
  const collect = (values, boxes) => Object.assign(process, pick(values, byKey, boxes));
  const unknown = new Set();
  const take = values => {
    for (const key of unknownKeys(values, byKey)) {
      unknown.add(key);
      process[key] = values[key];
    }
  };
  if (imported.config) {
    const flat = flatten(imported.config);
    const name = imported.config.preset?.hw_config?.config_name || 'Importierter Drucker';
    printer = {name, settings: pick(flat, byKey, ['printer']), skeleton: null};
    collect(flat, ['print', 'filament']);
    material = {name: String(flat.filament_settings_id || 'Importiertes Material'), values: pick(flat, byKey, ['filament'])};
    take(flat);
  }
  for (const preset of imported.presets || []) {
    const values = {...(preset.base ? flatten(preset.base) : {}), ...preset.values};
    if (preset.kind === 'printer') {
      printer = {name: preset.name || 'Importierter Drucker', settings: pick(values, byKey, ['printer']), skeleton: preset.skeleton || null};
    } else if (preset.kind === 'filament') {
      material = {name: preset.name || 'Importiertes Material', values: pick(values, byKey, ['filament'])};
      collect(values, ['filament']);
    } else if (preset.kind === 'print') {
      collect(values, ['print']);
    } else {
      // Einzelne Konfiguration ohne Abschnitt: alles, Druckerwerte gehen an den Drucker.
      const own = pick(values, byKey, ['printer']);
      if (Object.keys(own).length) printer = {name: preset.name || 'Importierter Drucker', settings: own, skeleton: null};
      collect(values, ['print', 'filament']);
      if (Object.keys(pick(values, byKey, ['filament'])).length) material = {name: 'Importiertes Material', values: pick(values, byKey, ['filament'])};
    }
    take(preset.values);
  }
  return {printer, process, material, unknown: [...unknown].sort(), notes};
}

// Migration aus Schema 1 (gemeinsame Profile mit Auto-Konfigurationen). Nichts wird geloescht.

/**
 * @param resolveOld (process) => flache Werte des alten Systems (Profil + Auswahl + Ueberschreibungen)
 * @param base flache Werte des Engine-Geruests (vollstaendig)
 */
export function migrate(state, {byKey, base, resolveOld, skeleton}) {
  if (state.profile_schema >= SCHEMA) return [];
  const done = [];
  state.presets ??= [];
  state.process_library ??= [];
  state.filaments ??= [];
  state.printers ??= [];
  const takenMaterials = () => state.filaments.map(m => m.id);

  for (const printer of state.printers) {
    if (printer.settings) continue;
    printer.engine ??= neutralSkeleton(toolsOf(skeleton));
    printer.settings = pick(base, byKey, ['printer']);
    const x = Number(printer.bed_x), y = Number(printer.bed_y);
    if (x > 0 && y > 0) printer.settings.bed_shape = `0x0, ${x}x0, ${x}x${y}, 0x${y}`;
    if (Number(printer.bed_z) > 0) printer.settings.max_print_height = Number(printer.bed_z);
    if (Number(printer.nozzle) > 0) printer.settings.nozzle_diameter = Number(printer.nozzle);
    printer.qualities ??= defaultQualities({...base, ...printer.settings});
    printer.default_quality ??= 'quality-3';
    printer.materials ??= [];
    done.push(`Drucker „${printer.name}“: vollständige Druckerwerte angelegt`);
  }
  for (const material of state.filaments) {
    if (material.settings) continue;
    material.settings = pick(base, byKey, ['filament']);
    if (Number(material.temperature) > 0) Object.assign(material.settings, {temperature: material.temperature, first_layer_temperature: material.temperature});
    if (material.bed_temperature != null && material.bed_temperature !== '') Object.assign(material.settings, {bed_temperature: material.bed_temperature, first_layer_bed_temperature: material.bed_temperature});
    if (Number(material.diameter) > 0) material.settings.filament_diameter = material.diameter;
  }

  // Auto-Konfigurationen der alten Profile: Material -> Bibliothek, Qualitaet -> Drucker, Rest -> Voreinstellungen.
  const converted = new Map();
  // Gepruefte Profile zuerst. Ein gesperrter Entwurf legt nichts Neues an, er wird ueber die Namen zugeordnet.
  const draft = bundle => bundle.manifest.source?.kind === 's3d-fff-partial-port';
  const bundles = [...(state.profiles || [])].sort((a, b) => draft(a) - draft(b));
  for (const bundle of bundles) {
    const printer = state.printers.find(p => p.id === bundle.manifest.profile_id)
      || state.printers.find(p => p.id === state.active_printer_id);
    for (const cat of bundle.profile.categories || []) {
      const kind = /material/i.test(cat.name) ? 'material' : /qualit/i.test(cat.name) ? 'quality' : /erg[aä]nz/i.test(cat.name) ? 'extras' : 'change';
      for (const option of cat.options || []) {
        const key = `${bundle.manifest.profile_id}|${cat.id}|${option.id}`;
        if (kind === 'material') {
          const made = makeMaterial({name: option.name, values: {...pick(base, byKey, ['filament']), ...option.assignments}, byKey, taken: takenMaterials()});
          // Materialwerte, die Prusa beim Drucker fuehrt (z. B. Einzug), bleiben im Material erhalten.
          Object.assign(made.settings, pick(option.assignments, byKey, ['print', 'printer']));
          // Dasselbe Material aus einem zweiten Profil (z. B. Entwurf und Kopie) nur einmal.
          let material = state.filaments.find(m => m.name === option.name && (draft(bundle) || JSON.stringify(m.settings) === JSON.stringify(made.settings)));
          if (!material) {
            material = made;
            material.migrated_from = key;
            state.filaments.push(material);
          }
          converted.set(key, {kind, id: material.id});
        } else if (kind === 'quality' && printer) {
          const same = printer.qualities.find(q => q.name === option.name && (draft(bundle) || JSON.stringify(q.values) === JSON.stringify(option.assignments)));
          const id = same?.id || `quality-${bundle.manifest.profile_id}-${option.id}`;
          if (!same) printer.qualities.push({id, name: option.name, values: clone(option.assignments)});
          converted.set(key, {kind, id});
        } else {
          const presetKind = kind === 'quality' ? 'change' : kind;
          const same = state.presets.find(p => p.kind === presetKind && p.name === option.name && (draft(bundle) || JSON.stringify(p.values) === JSON.stringify(option.assignments)));
          const id = same?.id || `preset-${bundle.manifest.profile_id}-${option.id}`;
          if (!same) state.presets.push({id, kind: presetKind, name: option.name, values: clone(option.assignments)});
          converted.set(key, {kind: presetKind, id});
        }
      }
    }
  }

  // Druckerwerte gehoeren zum Drucker: Der Prozess, dessen Profil zum Drucker gehoert, gibt sie zuerst ab.
  // Andere Prozesse behalten nur Abweichungen davon. Die wirksamen Werte bleiben gleich.
  const own = proc => state.printers.some(p => p.id === proc.profile_id);
  const ordered = [...(state.processes || [])].sort((a, b) => own(b) - own(a));
  const claimed = new Set();
  for (const proc of ordered) {
    if (proc.values) continue;
    const old = resolveOld(proc);
    proc.printer_id ??= own(proc) ? proc.profile_id : state.active_printer_id;
    const printer = state.printers.find(p => p.id === proc.printer_id);
    const hardware = pick(old, byKey, ['printer']);
    if (printer && !claimed.has(printer.id)) {
      Object.assign(printer.settings, clone(hardware));
      claimed.add(printer.id);
    }
    const kept = {...clone(old)};
    for (const [key, value] of Object.entries(hardware)) {
      if (printer && JSON.stringify(printer.settings[key]) === JSON.stringify(value)) delete kept[key];
    }
    proc.values = {...pick(base, byKey, ['print', 'filament']), ...kept};
    proc.origins = {};
    for (const key of Object.keys(kept)) proc.origins[key] = 'Übernommen';
    // Ohne eigene Auswahl galt im alten System die Vorauswahl der Kategorie.
    const bundle = (state.profiles || []).find(b => b.manifest.profile_id === proc.profile_id);
    const chosen = Object.fromEntries((bundle?.profile.categories || []).map(cat => [cat.id, proc.selections?.[cat.id] || cat.selected]).filter(([, opt]) => opt));
    for (const [catId, optId] of Object.entries(chosen)) {
      const hit = converted.get(`${proc.profile_id}|${catId}|${optId}`);
      if (!hit) continue;
      if (hit.kind === 'material') proc.material_id = hit.id;
      else if (hit.kind === 'quality') proc.quality_id = hit.id;
      else proc[`${hit.kind}_id`] = hit.id;
    }
    done.push(`Prozess „${proc.name}“: eigene vollständige Werte`);
  }
  state.profile_schema = SCHEMA;
  return done;
}

// Zuweisung: Jede Einstellung gehoert hoechstens einer Auto-Konfiguration.
// Auswaehlen setzt genau diese Einstellungen, Speichern (💾) uebernimmt genau diese aus dem Prozess.

export const AUTO = {material: 'Material', quality: 'Schichthöhe', extras: 'Ergänzungen', change: 'Prozessänderung'};

/** Sichtbare Auto-Konfigurationen in ihrer Reihenfolge: [{id, name}]. Eigene Kategorien haben Optionen in state.presets. */
export function autoCategories(state) {
  const list = state.auto_categories || Object.keys(AUTO).map(id => ({id}));
  return list.map(c => ({id: c.id, name: c.name || state.auto_labels?.[c.id] || AUTO[c.id] || c.id}));
}
export const QUALITY_KEYS = ['layer_height', 'first_layer_height', 'perimeters', 'top_solid_layers', 'bottom_solid_layers',
  'top_solid_min_thickness', 'bottom_solid_min_thickness', 'perimeter_speed', 'external_perimeter_speed', 'infill_speed', 'solid_infill_speed',
  'top_solid_infill_speed', 'travel_speed', 'first_layer_speed', 'small_perimeter_speed', 'gap_fill_speed', 'bridge_speed'];
/** Materialabhaengige Prozesswerte (Einzug), zusaetzlich zu allen Filamentwerten. */
export const MATERIAL_KEYS = ['retract_length', 'retract_speed', 'deretract_speed', 'retract_restart_extra'];
/** Ergaenzungen: Skirt/Brim und Raft. */
const EXTRAS_KEY = /^(brim_|skirt|min_skirt_length|raft_)/;

/** Ohne eigene Zuweisung: wie bisher (Voreinstellungen, Qualitaeten, Filamentwerte, uebernommene Materialwerte). */
export function defaultCategory(key, byKey, state) {
  // Feste, sinnvolle Standard-Zuordnung. Was ein importiertes Profil zufaellig enthaelt, bestimmt sie nicht.
  void state;
  if (byKey.get(key)?.box === 'filament' || MATERIAL_KEYS.includes(key)) return 'material';
  if (QUALITY_KEYS.includes(key)) return 'quality';
  if (EXTRAS_KEY.test(key)) return 'extras';
  return '';
}

export function categoryOf(key, byKey, state) {
  const own = state.auto_keys?.[key];
  const found = own !== undefined ? own : defaultCategory(key, byKey, state);
  // Eine geloeschte oder ausgeblendete Kategorie steuert nichts mehr.
  return found && !autoCategories(state).some(c => c.id === found) ? '' : found;
}

/** Alle Einstellungen einer Auto-Konfiguration. */
export function controlled(category, keys, byKey, state) {
  return new Set(keys.filter(key => categoryOf(key, byKey, state) === category));
}

/** Werte einer Option aus dem Prozess (nur die zugewiesenen Einstellungen). */
export function valuesFrom(proc, controls) {
  return Object.fromEntries([...controls].filter(k => Object.hasOwn(proc.values, k)).map(k => [k, clone(proc.values[k])]));
}

/** Option anwenden: nur zugewiesene Einstellungen, die die Option kennt. */
export function applyControlled(proc, values, controls, origin) {
  const keys = Object.keys(values || {}).filter(k => controls.has(k));
  for (const key of keys) proc.values[key] = clone(values[key]);
  mark(proc, keys, origin);
  return keys;
}

/**
 * Auto-Konfig-Offset: Ist in einer Auto-Konfiguration eine bestimmte Option gewaehlt, wird ein Zahlenwert verschoben
 * (z. B. Schichthoehe 0,10 mm aktiv: Duesentemperatur +5). Gilt beim Slicen, der eingestellte Wert bleibt unveraendert.
 */
export function shift(value, delta) {
  if (Array.isArray(value)) return value.map(v => shift(v, delta));
  if (value && typeof value === 'object' && 'value' in value) return {...value, value: shift(value.value, delta)};
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^[-+]?\d+([.,]\d+)?$/.test(value.trim()) ? Number(value.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? Math.round((n + delta) * 10000) / 10000 : value;
}
/** Eine Regel hat mehrere Parameter (`items`); aeltere Regeln mit einem Parameter (`key`, `delta`) gelten weiter. */
export const offsetItems = o => (o.items || [{key: o.key, delta: o.delta}]).filter(it => it.key && Number(it.delta));
export function activeOffsets(proc, offsets = []) {
  return offsets.filter(o => o.cat && o.option && proc?.[`${o.cat}_id`] === o.option);
}
export function withOffsets(values, proc, offsets = []) {
  const out = {...values};
  for (const o of activeOffsets(proc, offsets)) for (const it of offsetItems(o)) if (it.key in out) out[it.key] = shift(out[it.key], Number(it.delta));
  return out;
}

/** Reihenfolge einer Liste aendern (Option nach oben oder unten). */
export function move(list, id, step) {
  const i = list.findIndex(x => x.id === id), j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}
