// Uebersetzt Simpliy-Werte in eine vollstaendige PrusaSlicer-3.0-Konfiguration.
// Regel: Jeder zugewiesene Wert kommt an oder wird gemeldet, nichts wird still verworfen.

const BOX = {printer: 'printer_settings', print: 'print_settings', filament: 'filament_settings'};

// Schluessel aus aelteren Arbeitsbereichen und Prusa-2.x-INI-Dateien.
const ALIASES = {
  max_acceleration_extruding: 'machine_max_acceleration_extruding',
  detect_overhang_wall: 'overhangs',
  support_material_auto: null,
  extrusion_axis: null,
  printer_technology: null, // reines FFF
};

// Diese Werte fuehren beim Export Programme aus. Aus einem importierten Profil waere das Codeausfuehrung.
export const LOCKED = {
  post_process: 'Externe Skripte sind gesperrt, weil ein importiertes Profil damit Programme starten könnte.',
};

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

function number(raw, spec, {integer = false} = {}) {
  let text = String(raw).trim();
  if (/^[+-]?\d+,\d+$/.test(text)) text = text.replace(',', '.');
  if (!NUMBER.test(text)) throw Error('keine Zahl');
  const n = Number(text);
  if (integer && !Number.isInteger(n)) throw Error('keine ganze Zahl');
  if (spec.min != null && n < spec.min) throw Error(`kleiner als ${spec.min}`);
  if (spec.max != null && n > spec.max) throw Error(`größer als ${spec.max}`);
  return n;
}

function scalar(raw, spec) {
  switch (spec.type) {
    case 'Bool': {
      if ([true, 1, '1', 'true'].includes(raw)) return true;
      if ([false, 0, '0', 'false'].includes(raw)) return false;
      throw Error('weder an noch aus');
    }
    case 'Int':
      return number(raw, spec, {integer: true});
    case 'OptInt':
      return raw === null || raw === '' || raw === 'nil' ? null : number(raw, spec, {integer: true});
    case 'Float':
      return number(raw, spec);
    case 'Percentage': {
      const v = raw !== null && typeof raw === 'object' ? raw.value : String(raw).trim().replace(/\s*%$/, '');
      return {value: number(v, spec), is_percent: true};
    }
    case 'FloatOrPercentage': {
      const given = raw !== null && typeof raw === 'object';
      const text = given ? String(raw.value) : String(raw).trim();
      const percent = given ? !!raw.is_percent : text.endsWith('%');
      // Grenzen des Schemas gelten fuer den Absolutwert; bei Prozent nur die Untergrenze.
      const limits = percent ? {min: spec.min} : spec;
      return {value: number(text.replace(/\s*%$/, ''), limits), is_percent: percent};
    }
    case 'Enum': {
      let v = String(raw);
      if (spec.key === 'support_material') v = {true: 'everywhere', 1: 'everywhere', false: 'none', 0: 'none'}[v] ?? v;
      if (!spec.options.some(o => o.value === v)) throw Error(`„${v}“ ist keine gültige Auswahl`);
      return v;
    }
    case 'String':
      return String(raw ?? '');
    default:
      throw Error(`Typ ${spec.type} wird nicht unterstützt`);
  }
}

function list(raw, spec, current) {
  if (spec.element === 'Vec2d') {
    const points = Array.isArray(raw) ? raw : String(raw).split(',').map(p => p.trim().split('x'));
    if (spec.key === 'bed_shape' && points.length < 3) throw Error('mindestens drei Punkte nötig');
    return points.map(p => {
      if (p.length !== 2) throw Error('Punkte als 0x0, 250x0, … angeben');
      return p.map(v => number(v, {}));
    });
  }
  if (spec.element === 'Float') {
    const values = (Array.isArray(raw) ? raw : String(raw).split(/[;,]\s*/)).map(v => number(v, spec));
    const size = current?.length || values.length;
    if (values.length === 1) return Array(size).fill(values[0]);
    if (values.length !== size) throw Error(`${size} Werte erwartet`);
    return values;
  }
  return Array.isArray(raw) ? raw.map(String) : String(raw).split(/\r?\n/).filter(Boolean);
}

/** Wandelt einen eingegebenen Wert in die Form der Engine. Wirft bei ungueltigen Werten. */
export function convert(raw, spec, current) {
  if (spec.type === 'Array') return list(raw, spec, current);
  if (spec.box !== 'filament') return scalar(raw, spec);

  const slots = Array.isArray(current) ? current.length : 1;
  let values = raw;
  if (!Array.isArray(values)) {
    // "215; 220" = Wert je Werkzeug. G-Code und Texte enthalten selbst Semikolons.
    const perSlot = spec.type !== 'String' && typeof raw === 'string' && raw.includes(';');
    values = perSlot ? raw.split(';').map(v => v.trim()) : [raw];
  }
  if (values.length === 1) return Array(slots).fill(scalar(values[0], spec));
  if (values.length !== slots) throw Error(`${slots} Werte erwartet`);
  return values.map(v => scalar(v, spec));
}

/** Wert der Engine als editierbarer Text. */
export function display(value, spec = {}) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (spec.box === 'filament') {
      const parts = value.map(v => display(v, {...spec, box: ''}));
      return parts.every(p => p === parts[0]) ? parts[0] ?? '' : parts.join('; ');
    }
    if (spec.element === 'Vec2d') return value.map(p => (Array.isArray(p) ? p.join('x') : p)).join(', ');
    if (spec.element === 'Float') return value.every(v => v === value[0]) ? String(value[0] ?? '') : value.join('; ');
    return value.join('\n');
  }
  if (typeof value === 'object') {
    if (!('value' in value)) return JSON.stringify(value);
    return `${value.value}${value.is_percent && spec.type !== 'Percentage' ? '%' : ''}`;
  }
  if (spec.type === 'Percentage') return String(value).replace(/\s*%$/, '');
  return String(value);
}

/** Alle Werte des Basisprofils, flach nach Schluessel. */
export function baseValues(config) {
  if (!config) return {};
  const c = config.configuration;
  const out = {...c.print_settings, ...c.printer_settings, ...c.filament_settings};
  // print-Werte mit Filament-Override stehen in beiden Boxen; wirksam ist der Override.
  const tools = Object.values(config.preset?.hw_config?.tools || {});
  const nozzles = tools.map(t => t.features?.nozzle_diameter).filter(v => v != null);
  if (nozzles.length) out.nozzle_diameter = nozzles.every(v => v === nozzles[0]) ? nozzles[0] : nozzles.join('; ');
  return out;
}

/**
 * @param base     Konfiguration aus `PrusaSlicer --save`
 * @param values   zugewiesene Simpliy-Werte
 * @param byKey    Map Schluessel -> Katalogeintrag
 * @returns {{config: object, errors: object[], ignored: object[], applied: string[]}}
 */
export function compileConfig(base, values, byKey) {
  const config = structuredClone(base);
  const boxes = config.configuration;
  const errors = [];
  const ignored = [];
  const applied = [];

  for (const [given, raw] of Object.entries(values)) {
    if (given.startsWith('simpliy.')) {
      ignored.push({key: given, message: 'Eigener Simpliy-Wert, kein Parameter der Engine'});
      continue;
    }
    const key = given in ALIASES ? ALIASES[given] : given;
    if (key === null) {
      ignored.push({key: given, message: 'Wird in Simpliy nicht verwendet'});
      continue;
    }
    if (key !== given && key in values) {
      ignored.push({key: given, message: `Ersetzt durch ${key}`});
      continue;
    }

    try {
      if (key === 'nozzle_diameter') {
        const tools = Object.values(config.preset?.hw_config?.tools || {});
        const sizes = String(raw).split(';').map(v => number(v.trim(), {min: 0.05, max: 5}));
        if (!tools.length || (sizes.length !== 1 && sizes.length !== tools.length)) {
          throw Error(`${tools.length} Werte erwartet`);
        }
        tools.forEach((tool, i) => {
          (tool.features ??= {}).nozzle_diameter = sizes.length === 1 ? sizes[0] : sizes[i];
        });
        applied.push(key);
        continue;
      }

      const spec = byKey.get(key);
      if (!spec?.box) {
        ignored.push({key: given, message: 'Unbekannt in PrusaSlicer 3.0'});
        continue;
      }
      if (LOCKED[key]) {
        const text = display(raw, spec).trim();
        if (text && text !== display(boxes[BOX[spec.box]]?.[key], spec)) throw Error(LOCKED[key]);
        continue;
      }

      const box = boxes[BOX[spec.box]];
      if (!box || !(key in box)) throw Error('fehlt im gewählten Basisprofil');
      box[key] = convert(raw, spec, box[key]);

      // Ein Override im Filament- oder Werkzeugprofil wuerde den Prozesswert sonst verdecken.
      if (spec.box === 'print') {
        for (const name of ['filament_settings', 'toolprint_settings']) {
          const over = boxes[name];
          if (over && Object.hasOwn(over, key)) over[key] = convert(raw, {...spec, box: 'filament'}, over[key]);
        }
      }
      applied.push(key);
    } catch (e) {
      errors.push({key: given, message: e.message});
    }
  }
  return {config, errors, ignored, applied};
}

function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => same(a[k], b[k]));
}

/** Vergleicht, was gesendet wurde, mit dem, was die Engine zurueckmeldet. */
export function differences(sent, received, keys) {
  return keys.filter(key => {
    if (key === 'nozzle_diameter') return !same(baseValues(sent)[key], baseValues(received)[key]);
    return Object.values(BOX).some(name => {
      const box = sent.configuration[name];
      return box && Object.hasOwn(box, key) && !same(box[key], received.configuration[name]?.[key]);
    });
  });
}
