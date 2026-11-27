// Fenster „Benutzerdefinierte Zonen“ und die Umschaltung der Modelle auf einen Zonen-Prozess beim Slicen.
// Das Modul besitzt den Fensterentwurf selbst; alles andere kommt ueber `env` (keine eigenen globalen Variablen).
import {esc} from '../process-dialog.js';

/** env: {render, update, openModal, closeModal} */
export function createZoneActions(env) {
  let draft = null;       // Entwurf des offenen Fensters: {fromOn, from, toOn, to, error}
  let mainProcess = null; // beim Slicen einer Zone: Id des Zonen-Prozesses (er wird Hauptprozess der Platte)

  const number = v => Number(String(v).replace(',', '.'));
  const fail = message => { if (draft) draft.error = message; env.render(); };

  function renderDialog() {
    const d = draft;
    if (!d) return '';
    const row = (val, label, field) => `<div class="zone-row"><label class="check"><input type="checkbox" data-zone="${field}On" ${d[`${field}On`] ? 'checked' : ''}> ${label}</label><input class="num" data-zone="${field}" value="${esc(String(val).replace('.', ','))}" ${d[`${field}On`] ? '' : 'disabled'}><span class="unit">mm</span></div>`;
    return `<div class="overlay app-dialog-layer"><section class="dialog app-dialog zone-dialog" role="dialog" aria-modal="true" aria-label="Benutzerdefinierte Zonen">
    <div class="dialog-head"><div><h2>Benutzerdefinierte Zonen</h2></div></div>
    <div class="dialog-body app-dialog-body"><div class="dlg-text">Definieren Sie die Region, die durch diesen Prozess gedruckt wird.</div>
      ${row(d.from, 'Drucken ab Z-Höhe', 'from')}${row(d.to, 'Hör auf, in Z-Höhe zu drucken', 'to')}
      ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
      <p class="meta">Der Prozess druckt nur in diesem Bereich; darunter und darüber gilt der Hauptprozess des Modells. Den Prozess dazu unter „Modelle auswählen…“ auf das Modell legen. Native Zonen dürfen eigene Schichthöhen haben. Hauptprozess gilt außerhalb. Überlappen sich Zonen, gewinnt die zuletzt zugewiesene Zone. Nur von der Engine unterstützte lokale Werte werden nativ übernommen; andere Werte werden vor dem Slicen gemeldet.</p></div>
    <div class="dialog-foot"><span class="grow"></span><button class="primary" data-action="zone-save">Speichern</button><button data-action="zone-cancel">Abbrechen</button></div>
  </section></div>`;
  }

  const actions = {
    'open-zones'({proc}) {
      const z = proc.zone || {};
      draft = {fromOn: !!z.fromOn, from: z.from ?? 0, toOn: !!z.toOn, to: z.to ?? 0, error: ''};
      env.openModal('zones');
      env.render();
    },
    'zone-cancel'() {
      draft = null;
      env.closeModal();
    },
    'zone-save'({proc}) {
      const d = draft;
      if (!d) return;
      if (d.fromOn && !(number(d.from) >= 0)) return fail('„Drucken ab“ braucht eine Z-Höhe von 0 oder mehr.');
      if (d.toOn && !(number(d.to) > 0)) return fail('„Hör auf bei“ braucht eine Z-Höhe größer 0.');
      if (d.fromOn && d.toOn && number(d.to) <= number(d.from)) return fail('Das Ende muss über dem Start liegen.');
      proc.zone = {fromOn: d.fromOn, from: number(d.from) || 0, toOn: d.toOn, to: number(d.to) || 0};
      draft = null;
      env.closeModal();
      env.update();
    },
  };

  /** Änderung eines Feldes im Fenster. Liefert true, wenn das Ereignis zu diesem Modul gehört. */
  function change(el) {
    if (el.dataset.zone === undefined || !draft) return false;
    const key = el.dataset.zone;
    if (key.endsWith('On')) {
      draft[key] = el.checked;
      draft.error = '';
      env.render();
    } else draft[key] = el.value;
    return true;
  }

  /** Tippen im Fenster: nur den Entwurf nachführen (kein Neuzeichnen, damit der Fokus bleibt). */
  function input(el) {
    const key = el.dataset?.zone;
    if (draft && key && !key.endsWith('On')) draft[key] = el.value;
  }

  /**
   * Führt `fn` aus, während die zugewiesenen Modelle den Zonen-Prozess als Prozess haben; danach wird alles zurückgesetzt.
   * Währenddessen ist der Zonen-Prozess Hauptprozess der Platte (`mainId`).
   */
  async function withProcess(models, zoneProcess, fn) {
    const saved = models.map(m => [m, m.process]);
    for (const m of models) if ((m.zone_processes || []).includes(zoneProcess.id)) m.process = zoneProcess.id;
    mainProcess = zoneProcess.id;
    try {
      return await fn();
    } finally {
      mainProcess = null;
      for (const [m, p] of saved) m.process = p;
    }
  }

  return {actions, change, input, renderDialog, withProcess, mainId: () => mainProcess};
}
