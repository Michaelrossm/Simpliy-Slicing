// Druckerverwaltung und Materialbibliothek.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.
import * as P from '../profiles.js';

/** env: siehe actionEnv in app.js. */
export function createLibraryActions(env) {
  const actions = {
    'printer-net-test': async ({proc}) => {
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
    },
    'quality-add': async () => {
      const pr = env.state.printers.find((x) => x.id === env.printerEdit);
      const name = pr && (await env.askName('Name der neuen Qualität', 'Eigene Qualität'));
      if (!name) return;
      const src = env.activeProcess();
      pr.qualities.push({
        id: `quality-${Date.now().toString(36)}`,
        name,
        values: Object.fromEntries(env.QUALITY_KEYS.filter((k) => Object.hasOwn(src.values || {}, k)).map((k) => [k, env.clone(src.values[k])])),
      });
      env.update();
    },
    'quality-default': async ({el}) => {
      const pr = env.state.printers.find((x) => x.id === env.printerEdit);
      if (pr) pr.default_quality = el.dataset.id;
      env.update();
    },
    'quality-remove': async ({el}) => {
      const pr = env.state.printers.find((x) => x.id === env.printerEdit);
      if (!pr || !(await env.confirmRemove('Qualität löschen? Prozesse behalten ihre Werte.'))) return;
      pr.qualities = pr.qualities.filter((q) => q.id !== el.dataset.id);
      env.update();
    },
    'choose-filament': async ({el}) => {
      env.filamentEdit = el.dataset.id;
      env.render();
    },
    'new-filament': async () => {
      if (!env.baseFlat) return env.notify('Die Engine ist noch nicht bereit.', true);
      const f = P.makeMaterial({name: 'Neues Material', values: env.baseFlat, byKey: env.catalogByKey, taken: env.state.filaments.map((x) => x.id)});
      env.state.filaments.push(f);
      env.filamentEdit = f.id;
      env.update();
    },
    'clone-filament': async () => {
      const f = env.state.filaments.find((x) => x.id === env.filamentEdit);
      if (!f) return;
      const cp = {...env.clone(f), id: env.id('filament'), name: f.name + ' – Kopie', colors: []};
      env.state.filaments.push(cp);
      env.filamentEdit = cp.id;
      env.update();
    },
    'remove-filament': async () => {
      if (env.state.filaments.length < 2) return env.notify('Mindestens ein Filament muss bleiben.', true);
      if (!(await env.confirmRemove('Filament löschen?'))) return;
      env.state.filaments = env.state.filaments.filter((x) => x.id !== env.filamentEdit);
      env.filamentEdit = env.state.filaments[0].id;
      env.state.active_filament_id = env.filamentEdit;
      env.update();
    },
    'set-default-filament': async () => {
      const selected = env.state.filaments.find((x) => x.id === env.filamentEdit);
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
      env.state.active_filament_id = env.filamentEdit;
      env.update();
      env.notify(
        selected.prusa_profile ? 'Kompatibles Prusa-Filament ausgewaehlt.' : 'Lokales Filament gespeichert; Slicing-Uebergabe noch nicht vorhanden.',
      );
    },
    'choose-printer': async ({el}) => {
      env.printerEdit = el.dataset.id;
      env.render();
    },
    'open-printer-web': async () => {
      const pr = env.state.printers.find((x) => x.id === (env.printerEdit || env.state.active_printer_id));
      try {
        await window.__TAURI__.core.invoke('open_printer_web', {address: pr?.web_url || ''});
      } catch (e) {
        env.notify(String(e), true);
      }
    },
    'new-printer': async () => {
      if (!env.baseFlat) return env.notify('Die Engine ist noch nicht bereit.', true);
      const pr = P.makePrinter({
        name: 'Neuer Drucker',
        base: env.baseFlat,
        byKey: env.catalogByKey,
        skeleton: env.enginePreset() || P.DEFAULT_SKELETON,
        taken: env.state.printers.map((x) => x.id),
      });
      env.state.printers.push(pr);
      env.printerEdit = pr.id;
      env.update();
    },
    'clone-printer': async () => {
      const pr = env.state.printers.find((x) => x.id === env.printerEdit);
      if (!pr) return;
      const cp = {...env.clone(pr), id: env.id('printer'), name: pr.name + ' – Kopie'};
      env.state.printers.push(cp);
      env.printerEdit = cp.id;
      env.update();
    },
    'remove-printer': async () => {
      if (env.state.printers.length < 2) return env.notify('Mindestens ein Drucker muss bleiben.', true);
      if (!(await env.confirmRemove('Drucker löschen?'))) return;
      env.state.printers = env.state.printers.filter((x) => x.id !== env.printerEdit);
      env.printerEdit = env.state.printers[0].id;
      env.state.active_printer_id = env.printerEdit;
      env.update();
    },
    'set-default-printer': async () => {
      const chosen = env.state.printers.find((x) => x.id === env.printerEdit);
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
      env.state.active_printer_id = env.printerEdit;
      env.update();
      if (env.state.profile_schema >= P.SCHEMA) {
        const proc = env.mainProcess();
        if (proc && proc.printer_id !== env.printerEdit) {
          proc.printer_id = env.printerEdit;
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
    },
    'prusa-save-printer': async () => {
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
      env.printerEdit = pr.id;
      env.state.active_printer_id = pr.id;
      env.update();
      env.notify('Druckerreferenz hinzugefuegt. Duesendurchmesser und Engineprofil bitte pruefen.');
    },
    'prusa-save-filament': async () => {
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
      env.filamentEdit = f.id;
      env.state.active_filament_id = f.id;
      env.update();
      env.notify('Filamentreferenz hinzugefuegt.');
    },
  };
  return {actions};
}
