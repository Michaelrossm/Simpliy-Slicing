// Aus Arbeitsbereich und Profilwerten wird ein vollstaendiger Auftrag fuer die Engine.
import {compileConfig, convert, baseValues} from './engine-config.js';
import {bedFrom, placement, matrix3mf, volumeMesh, insideBed, overlapping} from './geometry.js';
import {supportPlate, supportCount} from './support-plate.js';

const FLAVOURS = {'Marlin 2': 'marlin2', 'Marlin': 'marlin', 'Klipper': 'klipper', 'RepRapFirmware': 'reprapfirmware'};

/** Werte aus eigener Drucker- und Filamentliste, nur wenn dort freigeschaltet. */
export function libraryValues(printer, filament) {
  const values = {};
  const sources = {};
  const put = (key, value, source) => {
    if (value === undefined || value === null || value === '') return;
    values[key] = value;
    sources[key] = source;
  };
  if (printer?.use_values) {
    const x = Number(printer.bed_x);
    const y = Number(printer.bed_y);
    if (x > 0 && y > 0) put('bed_shape', `0x0, ${x}x0, ${x}x${y}, 0x${y}`, 'Drucker');
    if (Number(printer.bed_z) > 0) put('max_print_height', Number(printer.bed_z), 'Drucker');
    if (Number(printer.nozzle) > 0) put('nozzle_diameter', Number(printer.nozzle), 'Drucker');
    put('gcode_flavor', FLAVOURS[printer.gcode_flavor] || printer.gcode_flavor, 'Drucker');
  }
  if (filament?.use_values) {
    if (Number(filament.temperature) > 0) {
      put('temperature', filament.temperature, 'Filament');
      put('first_layer_temperature', filament.temperature, 'Filament');
    }
    if (filament.bed_temperature !== '' && filament.bed_temperature != null) {
      put('bed_temperature', filament.bed_temperature, 'Filament');
      put('first_layer_bed_temperature', filament.bed_temperature, 'Filament');
    }
    if (Number(filament.diameter) > 0) put('filament_diameter', filament.diameter, 'Filament');
    if (/^#[0-9a-f]{6}$/i.test(filament.colour || '')) put('filament_colour', filament.colour, 'Filament');
  }
  return {values, sources};
}

export function effectiveBed(base, values, byKey) {
  const pick = key => {
    if (Object.hasOwn(values, key)) {
      try {
        return convert(values[key], byKey.get(key), base?.[key]);
      } catch {
        // Der ungueltige Wert wird im Dialog markiert; die Ansicht nimmt das Basisprofil.
      }
    }
    return base?.[key];
  };
  return bedFrom(pick('bed_shape'), pick('max_print_height'));
}

function convertExtras(settings, byKey, where, problems) {
  const out = {};
  for (const [key, raw] of Object.entries(settings || {})) {
    try {
      const spec = key === 'extruder' ? {key, type: 'Int', min: 0, max: 16} : byKey.get(key);
      if (!spec) throw Error('unbekannter Parameter');
      out[key] = convert(raw, spec);
    } catch (e) {
      problems.push(`${where}, ${key}: ${e.message}`);
    }
  }
  return out;
}

/** @returns {{job: object|null, problems: string[], ignored: object[]}} */
export function buildJob({base, values, byKey, models, meshes, supportKeys = []}) {
  const {config, errors, ignored, applied} = compileConfig(base, values, byKey);
  const problems = errors.map(e => `${e.key}: ${e.message}`);
  const effective = baseValues(config);
  const bed = bedFrom(effective.bed_shape, effective.max_print_height);
  const tools = effective.temperature?.length || 1;

  const boxes = [];
  const jobModels = [];
  const ownSettings = new Map();
  for (const model of models.filter(m => m.enabled !== false)) {
    const mesh = model.path && meshes.get(model.path);
    if (!mesh) {
      problems.push(`${model.name}: Modell ist nicht geladen`);
      continue;
    }
    const box = placement(model, mesh, bed);
    if (!insideBed(box, bed)) problems.push(`${model.name}: liegt außerhalb des Bauraums`);
    boxes.push(box);

    const paint = {};
    for (const [kind, layer] of Object.entries(model.paint || {})) {
      if (Object.keys(layer).length) paint[kind] = layer;
    }
    if (paint.color && tools < 2) problems.push(`${model.name}: Mehrfarben-Bemalung braucht ein Profil mit mehreren Werkzeugen`);

    for (const volume of model.volumes || []) {
      if (volume.shape !== 'text' && volume.size.some(v => !(v > 0))) problems.push(`${model.name}: Zusatzkörper mit Größe 0`);
    }
    const objectSettings=convertExtras(model.settings,byKey,model.name,problems);
    ownSettings.set(model.id, objectSettings);
    jobModels.push({
      id: model.id,
      path: model.path,
      name: model.name,
      matrix: matrix3mf(box),
      signature: model.signature ?? null,
      paint,
      volumes: [...(model.volumes || []).map(volume => ({
        kind: volume.kind,
        ...volumeMesh(volume),
        settings: convertExtras(volume.settings, byKey, `${model.name}, Modifikator`, problems),
      }))],
      ranges: model.ranges || [],
      settings: objectSettings,
    });
  }
  if (!jobModels.length) problems.push('Kein Modell zum Drucken ausgewählt');
  if (overlapping(boxes).size) problems.push('Modelle überlappen sich. „Zentrieren und anordnen“ benutzen.');

  if (problems.length) return {problems, ignored, job: null};
  const job = {config, applied, models: jobModels};
  if (models.some(model => model.enabled !== false && supportCount(model))) {
    job.supportPlate = supportPlate({models, meshes, bed, tools, keys: supportKeys,
      resolve: model => ({...effective, ...ownSettings.get(model.id)})});
  }
  return {problems, ignored, job};
}
