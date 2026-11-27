// Prozesse: anlegen, duplizieren, loeschen, speichern, Overrides.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.
import {visibleProcesses} from '../process-utils.js';
import * as P from '../profiles.js';

/** Eine Funktion fuer mehrere Aktionsnamen. */
const share = (names, fn) => Object.fromEntries(names.map((n) => [n, fn]));

/** env: siehe actionEnv in app.js. */
export function createProcessOpsActions(env) {
  async function updateProfileAction({proc}) {
    const b = env.processProfile(proc);
    if (b.manifest.profile_id === env.DRAFT_ID) return env.notify('Der Entwurf bleibt unverändert. Bitte „Als neu speichern“ verwenden.', true);
    env.absorbOverrides(b, proc);
    env.update();
    env.notify('Profil aktualisiert.');
  }

  async function saveAsProfileAction({proc}) {
    const b = env.duplicateProfile(env.processProfile(proc));
    env.absorbOverrides(b, proc);
    env.state.profiles.push(b);
    env.state.active_profile_id = b.manifest.profile_id;
    proc.profile_id = b.manifest.profile_id;
    for (const c of b.profile.categories) {
      if (proc.selections[c.id]) c.selected = proc.selections[c.id];
    }
    env.update();
    env.notify(`Gespeichert als „${b.profile.name}“. Den Namen änderst du über … neben dem Profil.`);
  }

  async function duplicateProcessAction({proc}) {
    const cp = {...env.clone(proc), id: env.id('proc'), name: `${proc.name} – Kopie`};
    delete cp.library_id;
    env.state.processes.push(cp);
    env.state.active_process_id = cp.id;
    env.update();
    env.notify(`„${cp.name}“ angelegt. Sie ist unabhängig vom Original.`);
  }

  async function deleteProcessAction({proc}) {
    if (visibleProcesses(env.state.processes).length < 2) return env.notify('Mindestens ein Prozess muss bleiben.', true);
    if (!(await env.confirmRemove(`Prozess „${proc.name}“ löschen?`))) return;
    env.state.processes = env.state.processes.filter((x) => x.id !== proc.id);
    for (const m of env.state.models) {
      if (m.process === proc.id) delete m.process;
      if (m.zone_processes) {
        m.zone_processes=m.zone_processes.filter(id=>id!==proc.id);
        if (!m.zone_processes.length) delete m.zone_processes;
      }
    }
    env.state.active_process_id = visibleProcesses(env.state.processes)[0].id;
    env.update();
  }

  async function addProcessAction() {
    const pr = {
      id: env.id('proc'),
      name: `Prozess ${visibleProcesses(env.state.processes).length + 1}`,
      role: 'model',
      profile_id: env.state.active_profile_id,
      selections: {},
      overrides: {},
      enabled: true,
    };
    if (env.state.profile_schema >= P.SCHEMA && env.baseFlat) {
      const src = env.activeProcess();
      pr.printer_id = src?.printer_id || env.state.active_printer_id;
      pr.values = P.pick(env.baseFlat, env.catalogByKey, ['print', 'filament']);
      pr.origins = {};
      const printer = env.printerOf(pr);
      const q = printer?.qualities?.find((x) => x.id === printer.default_quality);
      if (q) P.applyQuality(pr, q, env.catalogByKey);
      const m = env.state.filaments.find((x) => x.id === printer?.default_material);
      if (m) P.applyMaterial(pr, m, env.catalogByKey);
    }
    env.state.processes.push(pr);
    env.state.active_process_id = pr.id;
    env.openProcess();
    env.update();
  }

  async function clearOverrideAction({el, proc}) {
    if (proc.values) {
      delete proc.values[el.dataset.key];
      delete proc.origins?.[el.dataset.key];
    } else delete proc.overrides[el.dataset.key];
    env.update();
  }

  async function saveProcessAction({el, proc}) {
    if (!proc.values) return env.notify('Dieser Prozess wird gerade umgestellt. Bitte kurz warten.', true);
    const lib = (env.state.process_library ??= []);
    const asNew = el.dataset.action === 'save-process-as' || !lib.some((e) => e.id === proc.library_id);
    const name = asNew ? await env.askName('Name des gespeicherten Prozesses', proc.name) : undefined;
    if (asNew && !name) return;
    try {
      const e = P.saveToLibrary(lib, proc, {asNew, name});
      const made = env.commitPending(proc);
      env.update();
      env.notify(`Prozess „${e.name}“ gespeichert.${made.length ? `\nAngelegt: ${made.join(', ')}` : ''}`);
    } catch (err) {
      if (!err.existing) return env.notify(err.message, true);
      if (
        !(await env.confirmRemove(`${err.message}

Den gespeicherten Prozess mit den aktuellen Werten überschreiben?`))
      )
        return;
      const e = P.saveToLibrary(lib, proc, {asNew, name, overwrite: true});
      const made = env.commitPending(proc);
      env.update();
      env.notify(`Prozess „${e.name}“ überschrieben.${made.length ? `\nAngelegt: ${made.join(', ')}` : ''}`);
    }
    return;
  }

  async function resetOverridesAction({proc}) {
    if (!(await env.confirmRemove('Alle manuellen Overrides des aktiven Prozesses entfernen?'))) return;
    proc.overrides = {};
    env.update();
  }

  /** Aktionsname -> Funktion. */
  const actions = {
    'update-profile': updateProfileAction,
    'save-as-profile': saveAsProfileAction,
    'duplicate-process': duplicateProcessAction,
    'delete-process': deleteProcessAction,
    'add-process': addProcessAction,
    'clear-override': clearOverrideAction,
    ...share(['save-process', 'save-process-as'], saveProcessAction),
    'reset-overrides': resetOverridesAction,
  };
  return {actions};
}
