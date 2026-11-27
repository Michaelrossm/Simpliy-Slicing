// Farben eines Materials (Farb-Offsets): Zugriff auf Entwurf und Material sowie die Aktionen des Farbfensters.
// Änderungen bleiben im Entwurf (proc.pending.colors) bis „Prozess speichern“ (commitPending in app.js).
import * as P from '../profiles.js';

/** env: {state (Getter), catalogByKey (Getter), autoList, getModal, openModal, closeModal, render, update, confirmRemove} */
export function createColorActions(env) {
  const materialOf = proc => env.autoList('material', proc).find(m => m.id === proc?.material_id) || null;
  const colorsOf = proc => {
    const m = materialOf(proc);
    return m ? (proc.pending?.colors?.[m.id] ?? m.colors ?? []) : [];
  };
  const activeColorOf = proc => P.activeColor(proc, colorsOf(proc));

  /** Farben des Materials im Entwurf bearbeiten (erste Änderung kopiert die Liste in den Entwurf). */
  function editColors(proc, fn) {
    const m = materialOf(proc);
    if (!m) return false;
    const draft = ((proc.pending ??= {}).colors ??= {});
    draft[m.id] ??= structuredClone(m.colors || []);
    fn(draft[m.id]);
    return true;
  }

  /** Farbe samt Berechnungsoptionen für `P.withOffsets`. */
  const colorOptions = proc => ({list: colorsOf(proc), byKey: env.catalogByKey});

  const actions = {
    'open-colors'() {
      env.openModal('colors');
      env.render();
    },
    'close-colors'() {
      env.closeModal();
    },
    'color-pick'({proc, el}) {
      proc.color_id = el.dataset.id || '';
      env.update();
    },
    'color-add'({proc}) {
      if (!materialOf(proc)) return;
      const color = P.makeColor({taken: colorsOf(proc).map(x => x.id), name: `Farbe ${colorsOf(proc).length + 1}`});
      editColors(proc, list => list.push(color));
      proc.color_id = color.id;
      if (env.getModal() !== 'colors') env.openModal('colors');
      env.update();
    },
    async 'color-remove'({proc}) {
      const color = activeColorOf(proc);
      if (!color) return;
      if (!await env.confirmRemove(`Farbe „${color.name}“ vom Material löschen? Die Änderung gilt im Entwurf, bis der Prozess gespeichert wird.`, {title: 'Farbe löschen', ok: 'Löschen'})) return;
      editColors(proc, list => {
        const i = list.findIndex(x => x.id === color.id);
        if (i >= 0) list.splice(i, 1);
      });
      proc.color_id = '';
      env.update();
    },
  };

  /** Änderungen im Farbfenster. Liefert true, wenn das Ereignis zu diesem Modul gehört. */
  function change(el, proc) {
    if (el.dataset.colorOffset) {
      const color = activeColorOf(proc);
      if (color) {
        const value = Number(String(el.value).replace(',', '.'));
        editColors(proc, list => {
          const x = list.find(y => y.id === color.id);
          if (!x) return;
          x.offsets ??= {};
          if (Number.isFinite(value) && value !== 0) x.offsets[el.dataset.colorOffset] = value;
          else delete x.offsets[el.dataset.colorOffset];
        });
      }
      env.update();
      return true;
    }
    if (el.dataset.field === 'color-select') {
      proc.color_id = el.value;
      env.update();
      return true;
    }
    if (el.dataset.field === 'color-name' || el.dataset.field === 'color-hex') {
      const color = activeColorOf(proc);
      if (color) {
        const field = el.dataset.field === 'color-name' ? 'name' : 'colour';
        editColors(proc, list => {
          const x = list.find(y => y.id === color.id);
          if (x) x[field] = field === 'name' ? (el.value.trim() || x.name) : el.value;
        });
      }
      env.update();
      return true;
    }
    return false;
  }

  return {actions, change, materialOf, colorsOf, activeColorOf, editColors, colorOptions};
}
