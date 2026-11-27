// Feldaenderungen im Prozess- und Bibliotheksfenster (frueherer zweiter Schalter).
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.
import * as P from '../profiles.js';

/** env: siehe actionEnv in app.js. */
export function createFieldChangeActions(env) {
  const actions = {
    'prusa-printer': async ({el, proc, bundle}) => {
      const selectedPrinter = env.prusaPrinters.find((p) => p.name === el.value);
      env.state.ui.prusa_preset = {
        printer: el.value,
        print: '',
        tool: '',
        filament: '',
        technology: selectedPrinter?.technology || 'FFF',
        extruders: selectedPrinter?.extruders_cnt || 1,
      };
      env.prusaProfiles = [];
      const wanted = el.value;
      env.update();
      if (wanted) {
        env.setJobStatus('Kompatible Profile werden geladen');
        try {
          const p = await window.__TAURI__.core.invoke('query_prusa_profiles', {enginePath: env.state.engine_path, printer: wanted});
          if (env.state.ui.prusa_preset?.printer !== wanted) return true;
          env.prusaProfiles = p.print_profiles || [];
          env.autoPickPrusa();
          env.setJobStatus('Bereit');
        } catch (err) {
          env.setJobStatus('Profilabfrage fehlgeschlagen');
          env.notify(String(err), true);
        }
      }
      env.update();
      return true;
    },
    'prusa-print': async ({el, proc, bundle}) => {
      env.state.ui.prusa_preset.print = el.value;
      env.state.ui.prusa_preset.tool = env.onlyTool(el.value);
      env.state.ui.prusa_preset.filament = '';
      delete env.state.ui.prusa_preset.filaments;
      env.autoPickPrusa();
      env.update();
      return true;
    },
    'prusa-tool': async ({el, proc, bundle}) => {
      env.state.ui.prusa_preset.tool = el.value;
      env.syncPrusaPrinter();
      env.update();
      return true;
    },
    'prusa-filament': async ({el, proc, bundle}) => {
      env.state.ui.prusa_preset.filament = el.value;
      env.syncPrusaPrinter();
      env.update();
      return true;
    },
    'process-name': async ({el, proc, bundle}) => {
      proc.name = el.value;
    },
    'proc-printer': async ({el, proc, bundle}) => {
      proc.printer_id = el.value;
      const pr = env.printerOf(proc);
      const allowed = P.materialsFor(pr, env.state.filaments);
      if (proc.material_id && !allowed.some((m) => m.id === proc.material_id)) {
        const m = env.state.filaments.find((x) => x.id === pr?.default_material) || allowed[0];
        if (m) P.applyMaterial(proc, m, env.catalogByKey);
      }
      env.notify(`Drucker „${pr?.name}“ gewählt. Prozesswerte bleiben, Druckerwerte kommen vom neuen Drucker.`);
    },
    'proc-material': async ({el, proc, bundle}) => {
      const m = env.autoList('material', proc).find((x) => x.id === el.value);
      if (m) {
        const n = env.applyAuto(proc, 'material', m);
        env.notify(`Material „${m.name}“: ${n.length} Werte in den Prozess übernommen.`);
      }
    },
    'proc-quality': async ({el, proc, bundle}) => {
      const q = env.autoList('quality', proc).find((x) => x.id === el.value);
      if (q) {
        const n = env.applyAuto(proc, 'quality', q);
        env.notify(`Qualität „${q.name}“: ${n.length} Werte übernommen.`);
      }
    },
    'proc-preset': async ({el, proc, bundle}) => {
      const pr = env.draftPresets(proc).find((x) => x.id === el.value);
      if (pr) {
        const n = env.applyAuto(proc, pr.kind, pr);
        env.notify(`${env.catName(pr.kind)} „${pr.name}“: ${n.length} Werte übernommen.`);
      } else delete proc[`${el.dataset.kind}_id`];
    },
    'process-profile': async ({el, proc, bundle}) => {
      proc.profile_id = el.value;
      env.state.active_profile_id = el.value;
    },
    'active-profile': async ({el, proc, bundle}) => {
      env.state.active_profile_id = el.value;
      proc.profile_id = el.value;
      env.editCat = '';
      env.editOpt = '';
    },
    'profile-name': async ({el, proc, bundle}) => {
      bundle.profile.name = el.value;
    },
    'category-name': async ({el, proc, bundle}) => {
      if (env.category()) env.category().name = el.value;
    },
    'option-name': async ({el, proc, bundle}) => {
      if (env.option()) env.option().name = el.value;
    },
    'auto-select': async ({el, proc, bundle}) => {
      env.switchAutoOption(proc, env.processProfile(proc), el.dataset.cat, el.value);
      return true;
    },
    'setting-edit-target': async ({el, proc, bundle}) => {
      env.settingEditTarget = el.value;
      env.render();
      return true;
    },
    'engine-path': async ({el, proc, bundle}) => {
      env.state.engine_path = el.value;
      env.meshErrors.clear();
    },
  };
  return {actions};
}
