// Platten, mehrere Prozesse je Platte und Material je Werkzeug.
import {convert} from './engine-config.js';

/** Aeltere Arbeitsbereiche haben keine Platten: alles landet auf der ersten. */
export function ensurePlates(state) {
  if (!Array.isArray(state.plates) || !state.plates.length) state.plates = [{id: 'plate-1', name: 'Platte 1'}];
  state.ui ??= {};
  if (!state.plates.some(p => p.id === state.ui.active_plate)) state.ui.active_plate = state.plates[0].id;
  for (const model of state.models || []) {
    if (!state.plates.some(p => p.id === model.plate)) model.plate = state.plates[0].id;
  }
}

/** Kleinste freie Nummer. */
export function freePlateName(plates) {
  let number = 1;
  while (plates.some(plate => plate.name === `Platte ${number}`)) number++;
  return `Platte ${number}`;
}

/** Eigene Namen bleiben beim Neustart, Standardnamen nummeriert Rust neu. Leer = zurueck zum Standard. */
export function setPlateName(plates, plate, name) {
  if (name) {
    plate.name = name;
    plate.named = true;
    return;
  }
  delete plate.named;
  plate.name = freePlateName(plates.filter(other => other !== plate));
}

export const plateModels = (state, plate = state.ui.active_plate) => state.models.filter(m => m.plate === plate);

/** Prozesse einer Platte. Der erste ist der Hauptprozess und liefert alles, was fuer die ganze Platte gilt. */
export function plateProcesses(models, processes, active) {
  const used = [];
  for (const model of models) {
    if (model.enabled === false) continue;
    const proc = processes.find(p => p.id === model.process) || active;
    if (!used.includes(proc)) used.push(proc);
  }
  return used.length ? used : [active];
}

function canonical(raw, spec, current) {
  try {
    return JSON.stringify(convert(raw, spec, current));
  } catch {
    return `ungültig:${JSON.stringify(raw)}`;
  }
}

function perSlot(raw, spec, count) {
  let list = [raw];
  if (Array.isArray(raw)) list = raw;
  else if (spec.type !== 'String' && typeof raw === 'string' && raw.includes(';')) list = raw.split(';').map(v => v.trim());
  return Array.from({length: count}, (_, i) => (i < list.length ? list[i] : list[0]));
}

/**
 * @param base     flache Werte des Basisprofils
 * @param layers   [{process, values}], der erste ist der Hauptprozess
 * @param materials {Werkzeug ab 1: Werte einer Auto-Konfiguration}
 * @returns values: Werte der Platte; objects: Werte je Prozess; conflicts: was nicht je Prozess geht
 */
export function planPlate({base, layers, byKey, materials = {}}) {
  const tools = base?.temperature?.length || 1;
  const main = layers[0];
  const values = {...main.values};
  const objects = new Map(layers.map(l => [l.process.id, {}]));
  const conflicts = [];
  const errors = [];
  const slots = new Map();
  const toolOf = process => {
    const tool = Number(process.tool) || 0;
    return tool >= 1 && tool <= tools ? tool : 0;
  };
  const setSlot = (key, spec, tool, raw) => {
    if (!slots.has(key)) slots.set(key, perSlot(values[key] ?? base[key], spec, tools));
    slots.get(key)[tool - 1] = perSlot(raw, spec, tools)[tool - 1];
  };

  if (tools > 1) {
    for (const [tool, assigned] of Object.entries(materials)) {
      if (!(Number(tool) >= 1 && Number(tool) <= tools)) continue;
      for (const [key, raw] of Object.entries(assigned || {})) {
        const spec = byKey.get(key);
        if (spec?.box === 'filament') setSlot(key, spec, Number(tool), raw);
      }
    }
  }

  for (const layer of layers.slice(1)) {
    const {process} = layer;
    const tool = toolOf(process);
    // Ein Werkzeug, das sich zwei Prozesse teilen, kann nur einen Materialsatz haben.
    const ownTool = tool > 0 && layers.every(other => other === layer || (toolOf(other.process) || 1) !== tool);

    for (const key of new Set([...Object.keys(main.values), ...Object.keys(layer.values)])) {
      if (key.startsWith('simpliy.')) continue;
      const spec = byKey.get(key);
      const mine = layer.values[key] ?? base[key];
      const plate = main.values[key] ?? base[key];
      if (!spec) {
        if (key === 'nozzle_diameter' && String(mine) !== String(plate)) conflicts.push({process, key, plate, wanted: mine});
        continue;
      }
      if (spec.box === 'filament' && tools > 1 && ownTool) {
        // Das eigene Werkzeug bekommt das Material dieses Prozesses, auch wenn der Hauptprozess es aendert.
        if (Object.hasOwn(layer.values, key)) setSlot(key, spec, tool, mine);
        else if (!materials[tool] || !Object.hasOwn(materials[tool], key)) setSlot(key, spec, tool, perSlot(base[key], spec, tools));
        continue;
      }
      if (canonical(mine, spec, base[key]) === canonical(plate, spec, base[key])) continue;
      if (spec.perObject) {
        try {
          convert(mine, spec, base[key]);
          objects.get(process.id)[key] = mine;
        } catch (e) {
          errors.push(`${process.name}, ${key}: ${e.message}`);
        }
      } else {
        conflicts.push({process, key, plate, wanted: mine});
      }
    }
  }

  for (const {process} of layers) {
    const tool = toolOf(process);
    if (Number(process.tool) > tools) errors.push(`${process.name}: Werkzeug T${process.tool - 1} gibt es im Basisprofil nicht`);
    if (tool && tools > 1) objects.get(process.id).extruder = tool;
  }
  for (const [key, list] of slots) values[key] = list;
  return {values, objects, conflicts, errors};
}
