// Auto-Konfigurationen: Menue, Kategorien, Optionen, Zuweisung der Einstellungen.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.
import * as P from '../profiles.js';

/** Eine Funktion fuer mehrere Aktionsnamen. */
const share = (names, fn) => Object.fromEntries(names.map((n) => [n, fn]));

/** env: siehe actionEnv in app.js. */
export function createAutoConfigActions(env) {
  const actions = {
    ...share(['store-material', 'store-quality', 'store-preset'], async ({action, el, proc}) => {
      const cat = action === 'store-material' ? 'material' : action === 'store-quality' ? 'quality' : el.dataset.kind;
      const label = env.catName(cat);
      const option = env.autoList(cat, proc).find((x) => x.id === proc[env.autoField[cat]]);
      if (option) {
        if (
          !(await env.confirmRemove(
            `„${option.name}“ (${label}) mit den ${env.controls(cat).size} zugewiesenen Einstellungen dieses Prozesses aktualisieren? Gespeicherte Prozesse bleiben unverändert.`,
          ))
        )
          return;
        env.storeAuto(proc, cat, option);
        env.update();
        env.notify(`${label} „${option.name}“ gespeichert.`);
      }
      const name = await env.askName(`Name der neuen ${label}-Option`, '');
      if (!name) return;
      const made = env.newAutoOption(proc, cat, name);
      env.update();
      env.notify(`${label} „${made.name}“ angelegt.`);
      return;
    }),
    'auto-menu': async ({el}) => {
      env.autoMenu = env.autoMenu === el.dataset.cat ? '' : el.dataset.cat;
      env.render();
    },
    'auto-add-category': async () => {
      const name = await env.askName('Name der neuen Auto-Konfiguration', '');
      if (!name) return;
      const id = `cat-${Date.now().toString(36)}`;
      env.state.auto_categories = [...P.autoCategories(env.state), {id, name}];
      env.update();
      env.notify(`Auto-Konfiguration „${name}“ angelegt. Über „…“ › Einstellungen zuweisen legst du fest, was sie steuert.`);
    },
    'auto-delete-category': async ({el}) => {
      env.autoMenu = '';
      const cat = el.dataset.cat,
        label = env.catName(cat),
        builtin = ['material', 'quality'].includes(cat);
      if (
        !(await env.confirmRemove(
          builtin
            ? `Auto-Konfiguration „${label}“ ausblenden? Die ${cat === 'material' ? 'Materialbibliothek' : 'Qualitäten der Drucker'} bleiben erhalten, Prozesse behalten ihre Werte.`
            : `Auto-Konfiguration „${label}“ mit allen Optionen löschen? Prozesse behalten ihre Werte.`,
        ))
      )
        return env.render();
      env.state.auto_categories = P.autoCategories(env.state).filter((c) => c.id !== cat);
      if (!builtin) env.state.presets = (env.state.presets || []).filter((p) => p.kind !== cat);
      for (const p of env.state.processes) delete p[`${cat}_id`];
      env.update();
    },
    ...share(['auto-new', 'auto-rename', 'auto-delete', 'auto-up', 'auto-down', 'auto-label'], async ({action, el, proc}) => {
      const cat = el.dataset.cat,
        label = env.catName(cat),
        list = env.autoList(cat, proc);
      const option = list.find((x) => x.id === proc[env.autoField[cat]]);
      env.autoMenu = '';
      if (action === 'auto-new') {
        const name = await env.askName(`Name der neuen ${label}-Option`, '');
        if (name) {
          const made = env.newAutoOption(proc, cat, name);
          env.notify(`${label} „${made.name}“ aus diesem Prozess angelegt (${env.controls(cat).size} zugewiesene Einstellungen).`);
        }
      } else if (action === 'auto-label') {
        const name = await env.askName('Name der Kategorie', label);
        if (name) {
          env.state.auto_categories = P.autoCategories(env.state).map((c) => (c.id === cat ? {...c, name} : c));
        }
      } else if (!option) return env.render();
      else if (action === 'auto-rename') {
        const name = await env.askName('Neuer Name', option.name);
        if (name) option.name = name;
      } else if (action === 'auto-delete') {
        if (!(await env.confirmRemove(`${label}-Option „${option.name}“ löschen? Prozesse behalten ihre Werte.`))) return env.render();
        if (cat === 'material') env.state.filaments = env.state.filaments.filter((x) => x !== option);
        else if (cat === 'quality') {
          const pr = env.printerOf(proc);
          pr.qualities = pr.qualities.filter((x) => x !== option);
        } else env.state.presets = env.state.presets.filter((x) => x !== option);
        delete proc[env.autoField[cat]];
      } else {
        // Verschieben innerhalb der Kategorie, auch wenn die Liste Optionen anderer Kategorien enthaelt.
        const all = cat === 'material' ? env.state.filaments : cat === 'quality' ? env.printerOf(proc).qualities : env.state.presets;
        const same = all.filter((x) => cat === 'material' || cat === 'quality' || x.kind === cat),
          i = same.indexOf(option),
          j = i + (action === 'auto-up' ? -1 : 1);
        if (j >= 0 && j < same.length) {
          const a = all.indexOf(same[i]),
            b = all.indexOf(same[j]);
          [all[a], all[b]] = [all[b], all[a]];
        }
      }
      env.update();
      return;
    }),
    'auto-assign': async () => {
      env.autoMenu = '';
      env.assignFilter = '';
      env.assignDraft = Object.fromEntries(env.autoKeys().map((k) => [k, P.categoryOf(k, env.catalogByKey, env.state)]));
      env.openModal('auto-assign');
      env.render();
    },
    'assign-apply': async () => {
      env.state.auto_keys = {...env.assignDraft};
      env.assignDraft = null;
      env.closeModal();
      env.update();
      env.notify('Zuweisung gespeichert. Sie gilt beim nächsten Auswählen oder Speichern einer Option.');
    },
    'assign-cancel': async () => {
      env.assignDraft = null;
      env.closeModal();
    },
  };
  return {actions};
}
