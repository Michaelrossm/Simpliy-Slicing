// Druckerverwaltung und Materialbibliothek.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.
import * as P from '../profiles.js';

/** env: siehe actionEnv in app.js. */
export function createLibraryActions(env) {
  // Ansicht dieses Moduls (frueher globale Variablen in app.js); app.js liest/schreibt sie ueber `view`.
  let printerEdit = '';
  let filamentEdit = '';
  async function printerNetTestAction({proc}) {
    const pr = env.printerOf(proc);
    if (!pr?.web_url) {
      env.netMessage = {text: 'Bitte die IP-Adresse eintragen.', error: true};
      env.render();
    }
    env.netMessage = {text: 'Verbindung wird geprüft …'};
    env.render();
    try {
      env.netMessage = {
        text: await env.invoke('printer_test', {
          target: {kind: pr.host_type || 'prusalink', address: pr.web_url, secret: env.features.printerSecret(pr.id)},
        }),
      };
    } catch (err) {
      env.netMessage = {text: String(err), error: true};
    }
    env.render();
  }

  async function qualityAddAction() {
    const pr = env.state.printers.find((x) => x.id === printerEdit);
    const name = pr && (await env.askName('Name der neuen Qualität', 'Eigene Qualität'));
    if (!name) return;
    const src = env.activeProcess();
    pr.qualities.push({
      id: `quality-${Date.now().toString(36)}`,
      name,
      values: Object.fromEntries(env.QUALITY_KEYS.filter((k) => Object.hasOwn(src.values || {}, k)).map((k) => [k, env.clone(src.values[k])])),
    });
    env.update();
  }

  async function qualityDefaultAction({el}) {
    const pr = env.state.printers.find((x) => x.id === printerEdit);
    if (pr) pr.default_quality = el.dataset.id;
    env.update();
  }

  async function qualityRemoveAction({el}) {
    const pr = env.state.printers.find((x) => x.id === printerEdit);
    if (!pr || !(await env.confirmRemove('Qualität löschen? Prozesse behalten ihre Werte.'))) return;
    pr.qualities = pr.qualities.filter((q) => q.id !== el.dataset.id);
    env.update();
  }

  async function chooseFilamentAction({el}) {
    filamentEdit = el.dataset.id;
    env.render();
  }

  async function newFilamentAction() {
    if (!env.baseFlat) return env.notify('Die Engine ist noch nicht bereit.', true);
    const f = P.makeMaterial({name: 'Neues Material', values: env.baseFlat, byKey: env.catalogByKey, taken: env.state.filaments.map((x) => x.id)});
    env.state.filaments.push(f);
    filamentEdit = f.id;
    env.update();
  }

  async function cloneFilamentAction() {
    const f = env.state.filaments.find((x) => x.id === filamentEdit);
    if (!f) return;
    const cp = {...env.clone(f), id: env.id('filament'), name: f.name + ' – Kopie', colors: []};
    env.state.filaments.push(cp);
    filamentEdit = cp.id;
    env.update();
  }

  async function removeFilamentAction() {
    if (env.state.filaments.length < 2) return env.notify('Mindestens ein Filament muss bleiben.', true);
    if (!(await env.confirmRemove('Filament löschen?'))) return;
    env.state.filaments = env.state.filaments.filter((x) => x.id !== filamentEdit);
    filamentEdit = env.state.filaments[0].id;
    env.state.active_filament_id = filamentEdit;
    env.update();
  }

  async function setDefaultFilamentAction() {
    const selected = env.state.filaments.find((x) => x.id === filamentEdit);
    if (!selected) return;
    if (selected.prusa_profile) {
      const preset = env.state.ui.prusa_preset;
      if (!preset?.printer || preset.printer !== selected.prusa_printer || !preset.print) {
        env.notify('Zuerst den passenden Prusa-Drucker und das Druckprofil auswaehlen.', true);
      }
      try {
        let current = env.prusaProfiles.find((x) => x.name === preset.print);
        if (!current) {
          const data = await window.__TAURI__.core.invoke('query_prusa_profiles', {enginePath: env.state.engine_path, printer: preset.printer});
          env.prusaProfiles = data.print_profiles || [];
          current = env.prusaProfiles.find((x) => x.name === preset.print);
        }
        if (!current?.filament_profiles?.includes(selected.prusa_profile)) {
          env.notify('Dieses Filament ist mit dem ausgewaehlten Prusa-Druckprofil nicht kompatibel.', true);
        }
        preset.filament = selected.prusa_profile;
      } catch (err) {
        env.notify('Kompatibilitaet konnte nicht geprueft werden: ' + String(err), true);
      }
    } else if (env.state.ui.prusa_preset?.printer) {
      env.state.ui.prusa_preset.filament = '';
    }
    env.state.active_filament_id = filamentEdit;
    env.update();
    env.notify(
      selected.prusa_profile ? 'Kompatibles Prusa-Filament ausgewaehlt.' : 'Lokales Filament gespeichert; Slicing-Uebergabe noch nicht vorhanden.',
    );
  }

  async function choosePrinterAction({el}) {
    printerEdit = el.dataset.id;
    env.render();
  }

  async function openPrinterWebAction() {
    const pr = env.state.printers.find((x) => x.id === (printerEdit || env.state.active_printer_id));
    try {
      await window.__TAURI__.core.invoke('open_printer_web', {address: pr?.web_url || ''});
    } catch (e) {
      env.notify(String(e), true);
    }
  }

  async function newPrinterAction() {
    if (!env.baseFlat) return env.notify('Die Engine ist noch nicht bereit.', true);
    const pr = P.makePrinter({
      name: 'Neuer Drucker',
      base: env.baseFlat,
      byKey: env.catalogByKey,
      skeleton: env.enginePreset() || P.DEFAULT_SKELETON,
      taken: env.state.printers.map((x) => x.id),
    });
    env.state.printers.push(pr);
    printerEdit = pr.id;
    env.update();
  }

  async function clonePrinterAction() {
    const pr = env.state.printers.find((x) => x.id === printerEdit);
    if (!pr) return;
    const cp = {...env.clone(pr), id: env.id('printer'), name: pr.name + ' – Kopie'};
    env.state.printers.push(cp);
    printerEdit = cp.id;
    env.update();
  }

  async function removePrinterAction() {
    if (env.state.printers.length < 2) return env.notify('Mindestens ein Drucker muss bleiben.', true);
    if (!(await env.confirmRemove('Drucker löschen?'))) return;
    env.state.printers = env.state.printers.filter((x) => x.id !== printerEdit);
    printerEdit = env.state.printers[0].id;
    env.state.active_printer_id = printerEdit;
    env.update();
  }

  async function setDefaultPrinterAction() {
    const chosen = env.state.printers.find((x) => x.id === printerEdit);
    if (!chosen) return;
    if (chosen.prusa_profile) {
      if (env.state.ui.prusa_preset?.printer !== chosen.prusa_profile)
        env.state.ui.prusa_preset = {
          printer: chosen.prusa_profile,
          print: '',
          tool: '',
          filament: '',
          technology: chosen.prusa_technology || 'FFF',
          extruders: chosen.extruders || 1,
        };
    } else {
      env.state.ui.prusa_preset = null;
    }
    env.state.active_printer_id = printerEdit;
    env.update();
    if (env.state.profile_schema >= P.SCHEMA) {
      const proc = env.mainProcess();
      if (proc && proc.printer_id !== printerEdit) {
        proc.printer_id = printerEdit;
        const allowed = P.materialsFor(chosen, env.state.filaments);
        if (proc.material_id && !allowed.some((m) => m.id === proc.material_id)) {
          const m = env.state.filaments.find((x) => x.id === chosen.default_material) || allowed[0];
          if (m) P.applyMaterial(proc, m, env.catalogByKey);
        }
        env.baseKey = '';
        env.update();
      }
    }
    env.notify(`Drucker „${chosen.name}“ ist jetzt aktiv.`);
  }

  async function prusaSavePrinterAction() {
    const sel = env.state.ui.prusa_preset || {},
      src = env.prusaPrinters.find((x) => x.name === sel.printer);
    if (!src) return env.notify('Bitte zuerst einen Prusa-Drucker auswaehlen.', true);
    let pr = env.state.printers.find((x) => x.prusa_profile === src.name);
    if (!pr) {
      pr = {
        id: env.id('printer'),
        name: src.name,
        manufacturer: 'Prusa Standardprofil',
        bed_x: src.bed?.width ?? 0,
        bed_y: src.bed?.height ?? 0,
        bed_z: src.bed?.max_print_height ?? 0,
        nozzle: '',
        extruders: src.extruders_cnt || 1,
        gcode_flavor: '',
        prusa_technology: src.technology,
        prusa_profile: src.name,
        web_url: '',
      };
      env.state.printers.push(pr);
    }
    printerEdit = pr.id;
    env.state.active_printer_id = pr.id;
    env.update();
    env.notify('Druckerreferenz hinzugefuegt. Duesendurchmesser und Engineprofil bitte pruefen.');
  }

  async function prusaSaveFilamentAction() {
    const sel = env.state.ui.prusa_preset || {};
    if (!sel.printer || !sel.filament) return env.notify('Bitte Drucker, Druckprofil und Filament auswaehlen.', true);
    let f = env.state.filaments.find((x) => x.prusa_profile === sel.filament && x.prusa_printer === sel.printer);
    if (!f) {
      f = {
        id: env.id('filament'),
        name: sel.filament,
        type: 'Prusa-Profil',
        prusa_profile: sel.filament,
        prusa_printer: sel.printer,
        notes: 'Verweis auf Prusa-Standardprofil; Werte werden durch Prusa bereitgestellt.',
      };
      env.state.filaments.push(f);
    }
    filamentEdit = f.id;
    env.state.active_filament_id = f.id;
    env.update();
    env.notify('Filamentreferenz hinzugefuegt.');
  }

  /** Aktionsname -> Funktion. */
  const actions = {
    'printer-net-test': printerNetTestAction,
    'quality-add': qualityAddAction,
    'quality-default': qualityDefaultAction,
    'quality-remove': qualityRemoveAction,
    'choose-filament': chooseFilamentAction,
    'new-filament': newFilamentAction,
    'clone-filament': cloneFilamentAction,
    'remove-filament': removeFilamentAction,
    'set-default-filament': setDefaultFilamentAction,
    'choose-printer': choosePrinterAction,
    'open-printer-web': openPrinterWebAction,
    'new-printer': newPrinterAction,
    'clone-printer': clonePrinterAction,
    'remove-printer': removePrinterAction,
    'set-default-printer': setDefaultPrinterAction,
    'prusa-save-printer': prusaSavePrinterAction,
    'prusa-save-filament': prusaSaveFilamentAction,
  };
  return {
    actions,
    view: {
      get printerEdit() {
        return printerEdit;
      },
      set printerEdit(v) {
        printerEdit = v;
      },
      get filamentEdit() {
        return filamentEdit;
      },
      set filamentEdit(v) {
        filamentEdit = v;
      },
    },
  };
}
