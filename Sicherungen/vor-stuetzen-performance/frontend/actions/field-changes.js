// Feldaenderungen im Prozess- und Bibliotheksfenster (frueherer zweiter Schalter).
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.
import * as P from '../profiles.js';

/** env: siehe actionEnv in app.js. */
export function createFieldChangeActions(env) {
  async function prusaPrinterAction({el, proc, bundle}) {
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
  }

  async function prusaPrintAction({el, proc, bundle}) {
    env.state.ui.prusa_preset.print = el.value;
    env.state.ui.prusa_preset.tool = env.onlyTool(el.value);
    env.state.ui.prusa_preset.filament = '';
    delete env.state.ui.prusa_preset.filaments;
    env.autoPickPrusa();
    env.update();
    return true;
  }

  async function prusaToolAction({el, proc, bundle}) {
    env.state.ui.prusa_preset.tool = el.value;
    env.syncPrusaPrinter();
    env.update();
    return true;
  }

  async function prusaFilamentAction({el, proc, bundle}) {
    env.state.ui.prusa_preset.filament = el.value;
    env.syncPrusaPrinter();
    env.update();
    return true;
  }

  async function processNameAction({el, proc, bundle}) {
    proc.name = el.value;
  }

  async function procPrinterAction({el, proc, bundle}) {
    proc.printer_id = el.value;
    const pr = env.printerOf(proc);
    const allowed = P.materialsFor(pr, env.state.filaments);
    if (proc.material_id && !allowed.some((m) => m.id === proc.material_id)) {
      const m = env.state.filaments.find((x) => x.id === pr?.default_material) || allowed[0];
      if (m) P.applyMaterial(proc, m, env.catalogByKey);
    }
    env.notify(`Drucker „${pr?.name}“ gewählt. Prozesswerte bleiben, Druckerwerte kommen vom neuen Drucker.`);
  }

  async function procMaterialAction({el, proc, bundle}) {
    const m = env.autoList('material', proc).find((x) => x.id === el.value);
    if (m) {
      const n = env.applyAuto(proc, 'material', m);
      env.notify(`Material „${m.name}“: ${n.length} Werte in den Prozess übernommen.`);
    }
  }

  async function procQualityAction({el, proc, bundle}) {
    const q = env.autoList('quality', proc).find((x) => x.id === el.value);
    if (q) {
      const n = env.applyAuto(proc, 'quality', q);
      env.notify(`Qualität „${q.name}“: ${n.length} Werte übernommen.`);
    }
  }

  async function procPresetAction({el, proc, bundle}) {
    const pr = env.draftPresets(proc).find((x) => x.id === el.value);
    if (pr) {
      const n = env.applyAuto(proc, pr.kind, pr);
      env.notify(`${env.catName(pr.kind)} „${pr.name}“: ${n.length} Werte übernommen.`);
    } else delete proc[`${el.dataset.kind}_id`];
  }

  async function processProfileAction({el, proc, bundle}) {
    proc.profile_id = el.value;
    env.state.active_profile_id = el.value;
  }

  async function activeProfileAction({el, proc, bundle}) {
    env.state.active_profile_id = el.value;
    proc.profile_id = el.value;
    env.editCat = '';
    env.editOpt = '';
  }

  async function profileNameAction({el, proc, bundle}) {
    bundle.profile.name = el.value;
  }

  async function categoryNameAction({el, proc, bundle}) {
    if (env.category()) env.category().name = el.value;
  }

  async function optionNameAction({el, proc, bundle}) {
    if (env.option()) env.option().name = el.value;
  }

  async function autoSelectAction({el, proc, bundle}) {
    env.switchAutoOption(proc, env.processProfile(proc), el.dataset.cat, el.value);
    return true;
  }

  async function settingEditTargetAction({el, proc, bundle}) {
    env.settingEditTarget = el.value;
    env.render();
    return true;
  }

  async function enginePathAction({el, proc, bundle}) {
    env.state.engine_path = el.value;
    env.meshErrors.clear();
  }

  /** Aktionsname -> Funktion. */
  const actions = {
    'prusa-printer': prusaPrinterAction,
    'prusa-print': prusaPrintAction,
    'prusa-tool': prusaToolAction,
    'prusa-filament': prusaFilamentAction,
    'process-name': processNameAction,
    'proc-printer': procPrinterAction,
    'proc-material': procMaterialAction,
    'proc-quality': procQualityAction,
    'proc-preset': procPresetAction,
    'process-profile': processProfileAction,
    'active-profile': activeProfileAction,
    'profile-name': profileNameAction,
    'category-name': categoryNameAction,
    'option-name': optionNameAction,
    'auto-select': autoSelectAction,
    'setting-edit-target': settingEditTargetAction,
    'engine-path': enginePathAction,
  };
  return {actions};
}
