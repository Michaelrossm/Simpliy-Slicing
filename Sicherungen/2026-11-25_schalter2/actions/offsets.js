// Auto-Konfig-Offset-Editor: Entwurf der Regeln, gewählte Ansicht (Kategorie/Option) und alle zugehörigen Aktionen.
// Die Regelliste wird mit `offset-rules.js` bearbeitet; der Entwurf liegt in proc.pending.offsetRules und wird erst mit
// „Prozess speichern“ (commitPending in app.js) in state.auto_offsets übernommen.
import * as P from '../profiles.js';
import * as R from '../offset-rules.js';
import {PLACE} from '../settings-layout.js';

/**
 * env: {state (Getter), catalogByKey (Getter), autoList, autoField, printerOf, offsetsOf,
 *       notify, confirmRemove, render, update}
 */
export function createOffsetActions(env) {
  let view = {cat: '', option: ''}; // betrachtete Kategorie/Option (unabhängig von der im Prozess aktiven Option)

  /** Offset-Regeln im Entwurf: die erste Änderung kopiert die globalen Regeln in den Entwurf. */
  function draft(proc) {
    const pending = (proc.pending ??= {});
    if (!pending.offsetRules) {
      pending.offsetRules = structuredClone([...(env.state.auto_offsets || []), ...(pending.offsets || [])]);
      delete pending.offsets;
    }
    return pending.offsetRules;
  }

  /** Aufgelöste Ansicht: gewählte Kategorie/Option, sonst die im Prozess aktive Option. */
  function viewOf(proc) {
    const cats = P.autoCategories(env.state);
    const cat = cats.find(c => c.id === view.cat)?.id || cats[0]?.id || '';
    const options = env.autoList(cat, proc);
    const option = options.find(o => o.id === view.option)?.id
      || options.find(o => o.id === proc?.[env.autoField[cat]])?.id || options[0]?.id || '';
    return {cat, option};
  }

  /** Startwert eines neuen Parameters (Schichthöhen-Temperaturen bekommen die Standardstufe). */
  const startDelta = (proc, v, key) => P.defaultOffset(v.cat, env.autoList(v.cat, proc), v.option, key);

  /** Parameter der Option im Entwurf holen (bei Bedarf deaktiviert anlegen). */
  function item(proc, key, forView) {
    const v = forView || viewOf(proc);
    return R.itemFor(draft(proc), v, key, startDelta(proc, v, key));
  }

  /**
   * Optionaler Vorschlag für den Temperatur-Offset (ab Schicht 2) einer Schichthöhen-Option in ganzen Grad.
   * Grundlage ist nur der Durchfluss (Schichthöhe × Extrusionsbreite × Geschwindigkeit) gegen die Materialgrenze:
   * ab 80 % der Grenze +1 °C je 2 Prozentpunkte darüber, höchstens +20 °C. Ohne diese Daten gibt es keinen Vorschlag.
   */
  async function suggest(proc) {
    const v = viewOf(proc);
    if (v.cat !== 'quality') return;
    const option = env.autoList('quality', proc).find(o => o.id === v.option);
    if (!option) return;
    const num = x => {
      const a = Array.isArray(x) ? x[0] : x;
      const n = parseFloat(String(a?.value ?? a).replace(',', '.'));
      return Number.isFinite(n) ? n : NaN;
    };
    const val = key => (option.values && key in option.values ? option.values[key] : proc.values?.[key]);
    const layer = num(val('layer_height'));
    const speed = num(val('perimeter_speed'));
    const nozzle = num(proc.values?.nozzle_diameter ?? env.printerOf(proc)?.settings?.nozzle_diameter);
    const maxFlow = num(proc.values?.filament_max_volumetric_speed);
    const widthRaw = String(val('perimeter_extrusion_width') ?? '');
    const width = widthRaw.endsWith('%') ? (nozzle * parseFloat(widthRaw)) / 100 : num(widthRaw) || nozzle * 1.125;
    if (![layer, speed, width].every(x => x > 0)) return env.notify('Für diese Option fehlen Schichthöhe, Geschwindigkeit oder Extrusionsbreite – es gibt keinen belastbaren Vorschlag.', true);
    if (!(maxFlow > 0)) return env.notify('Für das Material ist keine maximale volumetrische Geschwindigkeit hinterlegt – ohne diese Grenze erfinde ich keine Temperaturwerte.', true);
    const flow = layer * width * speed;
    const percent = Math.round((flow / maxFlow) * 100);
    const delta = Math.min(20, Math.round((percent - 80) / 2));
    if (delta <= 0) return env.notify(`Durchfluss ${flow.toFixed(1)} mm³/s = ${percent} % der Materialgrenze (${maxFlow} mm³/s): kein Temperatur-Offset nötig.`);
    const existing = ['first_layer_temperature', 'temperature'].map(k => item(proc, k, v)).filter(it => it.enabled !== false && Number(it.delta));
    const text = `Vorschlag (kein Naturgesetz, bitte prüfen):\n\nDurchfluss ${flow.toFixed(1)} mm³/s = ${percent} % der Materialgrenze (${maxFlow} mm³/s).\nVorgeschlagen: Düsentemperatur ab Schicht 2 +${delta} °C.\nDie Temperatur der ersten Schicht bleibt unverändert.${existing.length ? '\n\nAchtung: Vorhandene aktive Offsets dieser Option werden überschrieben.' : ''}`;
    if (!await env.confirmRemove(text, {title: 'Temperatur-Offset vorschlagen', ok: 'Übernehmen', cancel: 'Verwerfen'})) return;
    const target = item(proc, 'temperature', v);
    target.delta = delta;
    target.enabled = true;
    env.update();
  }

  const actions = {
    'offset-cat'({el}) {
      view = {cat: el.dataset.cat, option: ''};
      env.render();
    },
    'offset-item-remove'({proc, el}) {
      R.removeItem(draft(proc), viewOf(proc), el.dataset.key);
      env.update();
    },
    async 'offset-suggest'({proc}) {
      await suggest(proc);
    },
  };

  /** Änderungen im Editor. Liefert true, wenn das Ereignis zu diesem Modul gehört. */
  function change(el, proc) {
    const data = el.dataset;
    if (data.offsetOn !== undefined) {
      item(proc, data.offsetOn).enabled = el.checked;
      env.update();
      return true;
    }
    if (data.offsetAllOption !== undefined || data.offsetAllCat !== undefined) {
      const v = viewOf(proc);
      const ids = data.offsetAllCat !== undefined ? env.autoList(v.cat, proc).map(o => o.id) : [v.option];
      const rules = draft(proc);
      const extra = v.cat === 'quality' ? P.DEFAULT_QUALITY_ITEMS.map(d => d.key) : [];
      for (const optionId of ids) R.setAllEnabled(rules, {cat: v.cat, option: optionId}, el.checked, extra, key => startDelta(proc, {cat: v.cat, option: optionId}, key));
      env.update();
      return true;
    }
    if (data.offsetMaster !== undefined) {
      const v = viewOf(proc);
      const rules = draft(proc);
      let hit = rules.filter(o => o.cat === v.cat && o.option === v.option);
      if (!hit.length) {
        const rule = {cat: v.cat, option: v.option, items: []};
        rules.push(rule);
        hit = [rule];
      }
      for (const rule of hit) rule.enabled = el.checked;
      env.update();
      return true;
    }
    if (data.offsetDelta !== undefined) {
      const n = Number(String(el.value).replace(',', '.').replace('−', '-').replace('+', ''));
      if (!Number.isFinite(n)) {
        env.notify('Bitte eine Zahl eingeben, z. B. -5 oder +3.', true);
        return true;
      }
      const key = data.offsetDelta;
      item(proc, key).delta = env.catalogByKey.get(key)?.type === 'Int' ? Math.round(n) : n;
      env.update();
      return true;
    }
    if (data.field === 'offset-option') {
      view.option = el.value;
      env.render();
      return true;
    }
    if (data.field === 'offset-add-param') {
      const m = /\(([a-z0-9_]+)\)\s*$/.exec(el.value) || /^([a-z0-9_]+)$/.exec(el.value.trim());
      if (!el.value.trim()) return true;
      if (!(m && PLACE.has(m[1]))) {
        env.notify('Parameter aus der Liste wählen.', true);
        return true;
      }
      item(proc, m[1]).enabled = true;
      env.update();
      return true;
    }
    return false;
  }

  return {actions, change, viewOf, draft, item};
}
