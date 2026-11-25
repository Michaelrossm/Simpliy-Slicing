// Inhalt einer Projektdatei und das Zurueckspielen in den Arbeitsbereich.
import {ensurePlates} from './plate-plan.js';

const withoutReview = bundle => {
  const copy = structuredClone(bundle);
  if (copy.manifest.source) delete copy.manifest.source.reviewed;
  return copy;
};

export function projectDocument(state, name) {
  const usedProfiles = new Set(state.processes.map(p => p.profile_id).concat(state.active_profile_id));
  const printer = state.printers.find(p => p.id === state.active_printer_id && p.use_values);
  const filament = state.filaments.find(f => f.id === state.active_filament_id && f.use_values);
  let sharedPrinter = null;
  if (printer) {
    // Adresse und Anschluss des Druckers gehoeren nicht in eine weitergebbare Datei.
    const {web_url: address, host_type: host, ...rest} = printer;
    sharedPrinter = rest;
  }
  return structuredClone({
    format: 'SimpliyProject',
    version: 1,
    name,
    plates: state.plates,
    active_plate: state.ui.active_plate,
    models: state.models.map(({original_path: original, ...model}) => model),
    processes: state.processes,
    active_process_id: state.active_process_id,
    profiles: state.profiles.filter(b => usedProfiles.has(b.manifest.profile_id)).map(withoutReview),
    prusa_preset: state.ui.prusa_preset || null,
    tool_materials: state.tool_materials || {},
    printer: sharedPrinter,
    filament: filament || null,
  });
}

/**
 * Aendert `state`. Vorhandene Profile, Drucker und Filamente werden nie ueberschrieben,
 * abweichende kommen als Kopie dazu.
 */
export function applyProject(state, incoming, id) {
  const doc = structuredClone(incoming);
  for (const process of doc.processes) {
    if (typeof process?.id !== 'string' || typeof process.name !== 'string') throw Error('Prozesse im Projekt sind beschädigt');
    process.overrides ??= {};
    process.selections ??= {};
  }
  for (const bundle of doc.profiles) {
    if (!Array.isArray(bundle.profile.category_order) || typeof bundle.profile.name !== 'string') throw Error('Profil im Projekt ist beschädigt');
  }

  const renamed = new Map();
  for (const bundle of doc.profiles) {
    if (bundle.manifest.source) delete bundle.manifest.source.reviewed;
    const key = bundle.manifest.profile_id;
    const existing = state.profiles.find(b => b.manifest.profile_id === key);
    if (existing && JSON.stringify(withoutReview(existing)) === JSON.stringify(bundle)) continue;
    if (existing) {
      bundle.manifest.profile_id = id('profile');
      bundle.profile.name += ' (Projekt)';
      renamed.set(key, bundle.manifest.profile_id);
    }
    state.profiles.push(bundle);
  }
  for (const process of doc.processes) process.profile_id = renamed.get(process.profile_id) || process.profile_id;

  const adopt = (entry, list, kind) => {
    if (!entry) return '';
    const same = list.find(x => {
      const {web_url: address, host_type: host, ...rest} = x;
      return JSON.stringify(rest) === JSON.stringify(entry);
    });
    if (same) return same.id;
    const copy = {...entry, id: id(kind), name: `${entry.name} (Projekt)`};
    list.push(copy);
    return copy.id;
  };
  state.active_printer_id = adopt(doc.printer, state.printers, 'printer');
  state.active_filament_id = adopt(doc.filament, state.filaments, 'filament');

  state.plates = doc.plates;
  state.models = doc.models;
  state.processes = doc.processes;
  state.tool_materials = doc.tool_materials || {};
  state.ui.prusa_preset = doc.prusa_preset || null;
  state.ui.active_plate = doc.active_plate;
  state.ui.selected_model_id = '';
  state.active_process_id = doc.active_process_id;
  ensurePlates(state);
  const active = state.processes.find(p => p.id === state.active_process_id) || state.processes[0];
  state.active_process_id = active.id;
  if (state.profiles.some(b => b.manifest.profile_id === active.profile_id)) state.active_profile_id = active.profile_id;
}
