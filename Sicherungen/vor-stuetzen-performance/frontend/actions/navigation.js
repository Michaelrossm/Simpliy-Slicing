// Navigation: Dialoge oeffnen/schliessen, Auswahl, Reiter, Werkzeuge.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.
import {PLACE, TABS} from '../settings-layout.js';

/** env: siehe actionEnv in app.js. */
export function createNavigationActions(env) {
  async function closeModalAction() {
    env.closeModal();
  }

  async function savePrintersAction() {
    clearTimeout(env.saveTimer);
    env.sync();
    env.notify('Drucker gespeichert.');
  }

  async function clickBackdropAction({el}) {
    if (el.classList.contains('overlay')) env.closeModal();
  }

  async function settingsPageAction({el}) {
    env.settingsPage[env.activeSettingTab] = Number(el.dataset.page);
    env.highlightKey = '';
    env.render();
  }

  async function gotoErrorAction({el}) {
    const keys = (el.dataset.keys || '').split(',').filter((k) => PLACE.has(k));
    if (!keys.length) return;
    const next = keys[(keys.indexOf(env.highlightKey) + 1) % keys.length];
    return env.handleAction('goto-setting', {dataset: {key: next}});
  }

  async function gotoSettingAction({el}) {
    const place = PLACE.get(el.dataset.key);
    if (!place) return;
    env.activeSettingTab = place.tab;
    env.settingsPage[place.tab] = place.pageIndex;
    env.highlightKey = el.dataset.key;
    env.settingSearch = '';
    env.render();
    document.getElementById(`s-${env.highlightKey}`)?.focus();
  }

  async function printerViewAction() {
    env.printerView = true;
    env.render();
  }

  async function modelViewAction() {
    env.printerView = false;
    env.previewMode = false;
    env.render();
  }

  async function previewViewAction() {
    env.printerView = false;
    try {
      if (env.preview) env.previewMode = true;
      else await env.loadPreview(env.state.ui.active_plate);
      env.render();
    } catch (e) {
      env.notify(String(e), true);
    }
  }

  async function openPrusaPresetsAction() {
    if (!env.state.engine_path) {
      try {
        const r = await fetch('/api/engine');
        const found = await r.json();
        if (found.detected?.length) {
          env.state.engine_path = found.detected[0];
          env.markSave();
        } else {
          env.openModal('engine');
          env.render();
          env.notify('Bitte zuerst Prusa-Pfad waehlen.', true);
        }
      } catch {
        env.openModal('engine');
        env.render();
        env.notify('Bitte zuerst Prusa-Pfad waehlen.', true);
      }
    }
    try {
      env.setJobStatus('Prusa-Druckerprofile werden geladen');
      const data = await window.__TAURI__.core.invoke('query_prusa_profiles', {enginePath: env.state.engine_path, printer: null});
      env.prusaPrinters = data.printer_models
        .flatMap((m) =>
          [...(m.printer_profiles || []), ...(m.variants || []).flatMap((v) => v.printer_profiles || [])].map((p) => ({
            ...p,
            technology: m.technology,
            vendor_name: m.vendor_name,
          })),
        )
        .sort((a, b) => /^Simpliy/.test(b.name) - /^Simpliy/.test(a.name) || a.name.localeCompare(b.name));
      const sel = env.state.ui.prusa_preset;
      if (sel?.printer) {
        const p = await window.__TAURI__.core.invoke('query_prusa_profiles', {enginePath: env.state.engine_path, printer: sel.printer});
        env.prusaProfiles = p.print_profiles || [];
      }
      env.setJobStatus('Bereit');
      env.openModal('prusa-presets');
      env.render();
    } catch (e) {
      env.setJobStatus('Profilabfrage fehlgeschlagen');
      env.notify(String(e), true);
    }
  }

  async function selectMk3sBuiltinAction() {
    const builtin = env.state.profiles.find((p) => p.manifest.profile_id === 's3d-mk3s-reprapt-entwurf');
    if (!builtin) return env.notify('Das mitgelieferte MK3S-Profil fehlt.', true);
    env.state.active_profile_id = builtin.manifest.profile_id;
    env.activeProcess().profile_id = builtin.manifest.profile_id;
    env.editCat = '';
    env.editOpt = '';
    env.update();
    env.notify('MK3S-Teilprofil ausgewaehlt. Slicing bleibt bis zur vollstaendigen Portierung gesperrt.');
  }

  async function openProcessAction() {
    env.openProcess();
  }

  async function openProfileAction({proc}) {
    env.state.active_profile_id = env.processProfile(proc).manifest.profile_id;
    env.openModal('profile');
    env.profilePanel = 'auto';
    env.render();
  }

  async function openPrintersAction() {
    const own = env.printerOf(env.activeProcess());
    if (own) env.printerEdit = own.id;
    env.openModal('printers');
    env.render();
    env.loadEnginePrinters();
  }

  async function openFilamentsAction() {
    env.openModal('filaments');
    env.render();
  }

  async function openEngineAction() {
    env.openModal('engine');
    env.render();
  }

  async function helpAction() {
    env.openModal('help');
    env.helpTab = 'about';
    env.render();
    if (!env.legal && window.__TAURI__)
      env
        .invoke('legal_texts')
        .then((x) => {
          env.legal = x;
          env.render();
        })
        .catch(() => {});
  }

  async function pickModelAction({el}) {
    if (env.state.ui.selected_model_id !== el.dataset.id) {
      env.state.ui.selected_model_id = el.dataset.id;
      env.toolOptions.cutHeight = null;
      env.update();
    }
  }

  async function pickProcessAction({el}) {
    if (env.state.active_process_id !== el.dataset.id) {
      env.state.active_process_id = el.dataset.id;
      env.update();
    }
  }

  async function pickPrinterAction({el}) {
    env.state.active_printer_id = el.dataset.id;
    env.update();
  }

  async function modelUploadAction() {
    await env.importModels();
  }

  async function tabAction({el}) {
    if (TABS.includes(el.dataset.tab)) env.activeSettingTab = el.dataset.tab;
    env.highlightKey = '';
    env.render();
  }

  async function showEffectiveAction() {
    env.modal = 'profile';
    env.profilePanel = 'effektiv';
    env.render();
  }

  async function profilePanelAction({el}) {
    env.profilePanel = el.dataset.panel;
    env.render();
  }

  async function selectToolAction({el}) {
    if (el.dataset.tool === 'machine') {
      env.printerView = true;
      env.state.ui.dock_open = false;
      env.update();
    }
    if (el.dataset.tool !== 'supports') {
      env.supportMode = 'none';
      env.supportMoving = null;
    }
    const close = env.state.ui.dock_open && env.state.ui.tool === el.dataset.tool;
    if (close || el.dataset.tool !== 'section') env.sectionState.pickPoint = false;
    if (close || env.state.ui.tool !== el.dataset.tool) env.features.toolChanged();
    env.state.ui.tool = el.dataset.tool;
    env.state.ui.dock_open = !close;
    env.update();
  }

  async function toggleDockAction() {
    env.state.ui.dock_open = !env.state.ui.dock_open;
    env.update();
  }

  async function toggleLeftAction() {
    env.state.ui.left_open = env.state.ui.left_open === false ? true : false;
    env.update();
  }

  async function detectEngineAction() {
    fetch('/api/engine')
      .then((r) => r.json())
      .then((d) => {
        const el = env.$('#engine-results');
        if (!el) return;
        el.textContent = d.detected.length ? `Gefunden: ${d.detected.join(' · ')}` : 'Keine PrusaSlicer-Datei automatisch gefunden.';
        if (d.detected.length) {
          env.state.engine_path = d.detected[0];
          env.markSave();
          const input = env.$('[data-field="engine-path"]');
          if (input) input.value = env.state.engine_path;
        }
      })
      .catch((e) => env.notify(e.message, true));
  }

  /** Aktionsname -> Funktion. */
  const actions = {
    'close-modal': closeModalAction,
    'save-printers': savePrintersAction,
    'click-backdrop': clickBackdropAction,
    'settings-page': settingsPageAction,
    'goto-error': gotoErrorAction,
    'goto-setting': gotoSettingAction,
    'printer-view': printerViewAction,
    'model-view': modelViewAction,
    'preview-view': previewViewAction,
    'open-prusa-presets': openPrusaPresetsAction,
    'select-mk3s-builtin': selectMk3sBuiltinAction,
    'open-process': openProcessAction,
    'open-profile': openProfileAction,
    'open-printers': openPrintersAction,
    'open-filaments': openFilamentsAction,
    'open-engine': openEngineAction,
    help: helpAction,
    'pick-model': pickModelAction,
    'pick-process': pickProcessAction,
    'pick-printer': pickPrinterAction,
    'model-upload': modelUploadAction,
    tab: tabAction,
    'show-effective': showEffectiveAction,
    'profile-panel': profilePanelAction,
    'select-tool': selectToolAction,
    'toggle-dock': toggleDockAction,
    'toggle-left': toggleLeftAction,
    'detect-engine': detectEngineAction,
  };
  return {actions};
}
