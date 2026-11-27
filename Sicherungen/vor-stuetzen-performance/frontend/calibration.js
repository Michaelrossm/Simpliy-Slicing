// Dialog „Kalibrierung“: nur Flow, beide Varianten aus dem eigenen Kalibrierungs-Plugin (RepRapFirmware).
// Der G-Code wird erzeugt, als Datei gespeichert und über „Zum Drucker senden“ übertragen. Gestartet wird am Drucker.
import {DEFAULTS, padsJob, boxJob, newFlow, fmt} from './flow-calibration.js';
import {esc} from './process-dialog.js';

const STORE = 'simpliy.calibration.v1';

function load() {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORE) || '{}'); } catch { return {}; }
}

/**
 * @param env {invoke, render, notify, useFile(path)}  useFile öffnet den Sende-Dialog mit dieser Datei
 */
export function createCalibration(env) {
  const saved = load();
  const model = {
    tab: 'pads',
    shared: {...DEFAULTS.shared, ...saved.shared},
    pads: {...DEFAULTS.pads, ...saved.pads},
    box: {...DEFAULTS.box, ...saved.box},
    evaluation: {...DEFAULTS.evaluation, ...saved.evaluation},
    startCode: saved.startCode || DEFAULTS.startCode,
    endCode: saved.endCode || DEFAULTS.endCode,
    text: '', error: false,
  };
  const persist = () => {
    try { globalThis.localStorage?.setItem(STORE, JSON.stringify({shared: model.shared, pads: model.pads, box: model.box, evaluation: model.evaluation, startCode: model.startCode, endCode: model.endCode})); } catch { /* ohne Speicher weiter */ }
  };
  const say = (text, error = false) => { model.text = text; model.error = error; env.render(); };

  const field = (group, key, label, unit = '', step = 'any') =>
    `<div class="form-field"><label for="cal-${group}-${key}">${label}</label><div class="row"><input id="cal-${group}-${key}" type="number" step="${step}" data-cal="${group}.${key}" value="${esc(model[group][key])}"><span class="muted">${unit}</span></div></div>`;

  function build(kind) {
    const codes = {startCode: model.startCode, endCode: model.endCode};
    return kind === 'pads' ? padsJob(model.shared, model.pads, codes) : boxJob(model.shared, model.box, codes);
  }

  async function make(kind, send) {
    try {
      const gcode = build(kind);
      const name = `flow-${kind === 'pads' ? 'plaettchen' : 'box'}-${Date.now().toString(36)}.gcode`;
      const path = await env.invoke('calibration_save', {name, content: gcode});
      persist();
      if (send) {
        env.useFile(path);
        return;
      }
      say(`G-Code gespeichert: ${path}`);
    } catch (e) {
      say(e.message || String(e), true);
    }
  }

  function render() {
    const tab = model.tab;
    const tabs = [['pads', 'Flow-Plättchen'], ['box', 'Flow-Test Einzelwand-Box'], ['code', 'Start-/Endcode']]
      .map(([id, label]) => `<button class="${tab === id ? 'primary' : ''}" data-action="cal-tab" data-tab="${id}">${label}</button>`).join('');
    const shared = `<div class="form-grid">
      ${field('shared', 'nozzleDia', 'Düse', 'mm')}${field('shared', 'layerH', 'Schichthöhe', 'mm')}
      ${field('shared', 'printSpeed', 'Druckgeschwindigkeit', 'mm/s')}${field('shared', 'firstLayerSpeed', 'Erste Schicht', 'mm/s')}
      ${field('shared', 'fanPct', 'Lüfter ab Schicht 3', '%')}${field('shared', 'travelSpeed', 'Leerfahrt', 'mm/s')}
      ${field('shared', 'bedW', 'Druckbett X', 'mm')}${field('shared', 'bedD', 'Druckbett Y', 'mm')}</div>`;
    let body = '';
    if (tab === 'pads') {
      body = `${shared}<div class="form-grid">
        ${field('pads', 'H', 'Hotend', '°C')}${field('pads', 'B', 'Bett', '°C')}
        ${field('pads', 'C', 'Mitte Flow', '%')}${field('pads', 'D', 'Bereich ±', '%')}${field('pads', 'R', 'Schritt', '%')}
        ${field('pads', 'P', 'Plättchengröße', 'mm')}${field('pads', 'G', 'Abstand', 'mm')}${field('pads', 'Z', 'Schichten', '')}
        ${field('pads', 'X', 'Versatz X', 'mm')}${field('pads', 'Y', 'Versatz Y', 'mm')}</div>
        <p class="muted">Druckt Plättchen mit unterschiedlichem Flow (M221) und der Flow-Zahl darauf. Das Plättchen mit der besten Oberfläche wählen und den Wert im Slicer als Flussrate eintragen.</p>`;
    } else if (tab === 'box') {
      let result = '';
      try { result = `${fmt(newFlow(model.evaluation), 3)} %`; } catch (e) { result = e.message; }
      body = `${shared}<div class="form-grid">
        ${field('box', 'H', 'Hotend', '°C')}${field('box', 'B', 'Bett', '°C')}
        ${field('box', 'S', 'Kantenlänge', 'mm')}${field('box', 'Z', 'Schichten', '')}
        ${field('box', 'X', 'Position X', 'mm')}${field('box', 'Y', 'Position Y', 'mm')}
        <div class="form-field"><label for="cal-box-W">Linienbreite (leer = nach Düse)</label><div class="row"><input id="cal-box-W" type="number" step="any" data-cal="box.W" value="${esc(model.box.W)}"><span class="muted">mm</span></div></div></div>
        <h4>Auswertung</h4><div class="form-grid">
        ${field('evaluation', 'measured', 'Gemessene Wand', 'mm')}${field('evaluation', 'target', 'Soll-Wand', 'mm')}${field('evaluation', 'currentFlow', 'Aktueller Flow', '%')}</div>
        <p><b>Berechneter Flow: ${esc(result)}</b></p>
        <p class="muted">Box drucken, die Wandstärke mit der Schieblehre messen, hier eintragen und den berechneten Flow als Flussrate im Slicer verwenden.</p>`;
    } else {
      body = `<div class="form-field"><label for="cal-start">Startcode (Platzhalter [bed0_temperature], [extruder0_temperature], [build_min_x] …)</label><textarea id="cal-start" rows="4" data-cal="startCode">${esc(model.startCode)}</textarea></div>
        <div class="form-field"><label for="cal-end">Endcode</label><textarea id="cal-end" rows="4" data-cal="endCode">${esc(model.endCode)}</textarea></div>
        <div class="row"><button data-action="cal-reset-code">Standard wiederherstellen</button></div>`;
    }
    const actions = tab === 'code' ? '' : `<div class="row">
        <button class="primary" data-action="cal-send">G-Code erzeugen und zum Drucker senden</button>
        <button data-action="cal-save">Nur als Datei speichern</button></div>`;
    return `<div class="row">${tabs}</div>${body}${actions}
      <div id="cal-message" class="${model.error ? 'bad' : ''}">${esc(model.text)}</div>
      <div class="note-banner">Es wird nur übertragen, der Druck startet nie automatisch. Start- und Endcode rufen die Makros des Druckers auf (0:/sys/print/start.g und end.g).</div>`;
  }

  const actions = {
    'open-calibration': () => { model.text = ''; env.openModal('calibration'); env.render(); },
    'cal-tab': d => { model.tab = d.tab; model.text = ''; env.render(); },
    'cal-send': () => make(model.tab, true),
    'cal-save': () => make(model.tab, false),
    'cal-reset-code': () => { model.startCode = DEFAULTS.startCode; model.endCode = DEFAULTS.endCode; persist(); env.render(); },
  };

  /** Eingabefeld geändert; true, wenn es zu diesem Dialog gehört. */
  function change(el) {
    const path = el.dataset?.cal;
    if (!path) return false;
    if (path === 'startCode' || path === 'endCode') model[path] = el.value;
    else {
      const [group, key] = path.split('.');
      model[group][key] = el.value === '' ? '' : (Number.isFinite(Number(el.value)) ? Number(el.value) : el.value);
    }
    persist();
    env.render();
    return true;
  }

  return {render, actions, change, model};
}
