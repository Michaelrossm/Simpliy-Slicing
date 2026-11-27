// Oberflaeche fuer Platten, Projekte, Upload, Text, Messen, Reparatur, Material je Werkzeug.
import {esc} from './process-dialog.js';
import {MODES} from './measure.js';

const option = (value, label, selected) =>
  `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
const number = value => Number(value).toLocaleString('de-DE', {maximumFractionDigits: 3});
const row = (label, input, unit = '') => `<div class="d-row"><label>${esc(label)}</label>${input}<span>${unit}</span></div>`;
const box = (title, body) => `<section class="d-group"><h4>${esc(title)}</h4><div class="d-box">${body}</div></section>`;

export function toolSelect(attributes, value, tools, inherit = 'wie Prozess') {
  const list = [option(0, inherit, !value)];
  for (let i = 1; i <= tools; i++) list.push(option(i, `T${i - 1}`, Number(value) === i));
  if (value > tools) list.push(option(value, `T${value - 1} (fehlt)`, true));
  return `<select ${attributes}>${list.join('')}</select>`;
}

export function renderPlateBar(plates, active, counts) {
  const tabs = plates.map(plate => `<button class="plate-tab ${plate.id === active ? 'active' : ''}" data-action="pick-plate" data-id="${esc(plate.id)}" title="${esc(plate.name)} (Doppelklick, Rechtsklick oder F2: umbenennen)"><span>${esc(plate.name)}</span><small>${counts.get(plate.id) || 0}</small></button>`
    + (plate.id === active ? `<button class="plate-edit" data-action="rename-plate" data-id="${esc(plate.id)}" title="Platte umbenennen" aria-label="Platte umbenennen"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5 3.4 10 11 2.4 13.6 5 6 12.6z M9.6 3.8l2.6 2.6"/></svg></button>` : ''));
  return `<nav class="plate-bar">
    <div class="plate-tabs" data-keep-scroll="plates">${tabs.join('')}</div>
    <button class="dots" data-action="add-plate" title="Neue Platte">+</button>
    <button class="flat-btn" data-action="duplicate-plate">Platte duplizieren</button>
    <button class="flat-btn" data-action="delete-plate">Platte löschen</button>
    <button data-action="slice-all">Alle Platten slicen</button>
  </nav>`;
}

/** Zuordnung des markierten Modells, direkt unter der Modellliste. */
export function renderAssignment({model, processes, plates}) {
  if (!model) return '';
  const process = processes.some(p => p.id === model.process) ? model.process : '';
  return `<div class="assign">
    <label for="model-process">Prozess</label>
    <select id="model-process" data-assign="process">${option('', 'markierter Prozess', !process)}${processes.map(p => option(p.id, p.name, p.id === process)).join('')}</select>
    <label for="model-plate">Platte</label>
    <select id="model-plate" data-assign="plate">${plates.map(p => option(p.id, p.name, p.id === model.plate)).join('')}</select>
  </div>`;
}

export function renderTextPanel({model, text, fonts, tools}) {
  const texts = (model?.volumes || [])
    .map((volume, index) => ({volume, index}))
    .filter(({volume}) => volume.shape === 'text');
  const choose = fonts
    ? `<select id="text-font" data-text="font">${fonts.map(f => option(f, f.replace(/\.[to]tf$/i, ''), f === text.font)).join('')}</select>`
    : '<select disabled><option>Schriften werden geladen …</option></select>';
  const editing = text.index !== null;
  return box(editing ? 'Text bearbeiten' : 'Neuer Text', `
      <textarea id="text-content" data-text="text" rows="2">${esc(text.text)}</textarea>
      <div class="d-stack"><label for="text-font">Schrift</label>${choose}</div>
      ${row('Höhe', `<input id="text-height" type="number" min="1" max="300" step="any" data-text="height" value="${esc(text.height)}">`, 'mm')}
      ${row('Tiefe', `<input id="text-depth" type="number" min="0.1" max="50" step="any" data-text="depth" value="${esc(text.depth)}">`, 'mm')}
      ${row('Drehung', `<input id="text-angle" type="number" step="any" data-text="angle" value="${esc(text.angle)}">`, '°')}
      <div class="button-row">
        <button class="${text.engrave ? '' : 'active'}" data-action="text-mode" data-engrave="0">Erhaben</button>
        <button class="${text.engrave ? 'active' : ''}" data-action="text-mode" data-engrave="1">Graviert</button>
      </div>
      ${tools > 1 && !text.engrave ? row('Werkzeug', toolSelect('data-text="tool"', text.tool, tools, 'wie Modell')) : ''}`)
    + `<p class="d-note">${editing ? 'Änderungen wirken sofort. Ein Klick aufs Modell versetzt den Text.' : 'Die Stelle auf dem Modell anklicken.'} Der Text bleibt eben. Auf Rundungen mehr Tiefe geben.</p>`
    + (editing ? '<button class="full" data-action="text-new">Weiteren Text setzen</button>' : '')
    + (texts.length ? box('Texte auf diesem Modell', texts.map(({volume, index}) => `<div class="button-row">
        <button class="text-item ${text.index === index ? 'active' : ''}" data-action="text-edit" data-index="${index}">${esc(volume.text?.text || 'Text')}</button>
        <button class="dots" data-action="text-remove" data-index="${index}">×</button></div>`).join('')) : '');
}

export function renderMeasurePanel({mode, picks, result}) {
  const {picks: needed, hint} = MODES[mode];
  let body = '';
  if (result?.error) body = box('Ergebnis', `<p class="bad">${esc(result.error)}</p>`);
  else if (result) body = box('Ergebnis', `<div class="measure-result">${result.rows.map(([label, value, unit]) => `<div class="d-info"><span>${esc(label)}</span><b>${number(value)} ${unit}</b></div>`).join('')}</div>`);
  return `<div class="stack">${Object.entries(MODES).map(([key, m]) => `<button class="${key === mode ? 'active' : ''}" data-action="measure-mode" data-mode="${key}">${esc(m.name)}</button>`).join('')}</div>
    <p class="d-note">${esc(hint)} (${picks.length}/${needed})</p>${body}
    <button class="full" data-action="measure-clear">Neu messen</button>`;
}

export function renderRepairPanel({model, report, tolerance, holes = {}}) {
  if (!model) return '<p class="d-note">Zuerst ein Modell auswählen.</p>';
  let result = '';
  if (report) {
    const s = report.after || report;
    const lines = [['Dreiecke', s.triangles], ['Offene Kanten', s.open], ['Mehrfachkanten', s.shared], ['Verdrehte Kanten', s.flipped]];
    result = box(report.after ? 'Nach der Reparatur' : 'Prüfung',
      `<p class="repair-state ${s.closed ? 'good' : 'bad'}">${s.closed ? 'Geschlossen, keine Netzfehler' : report.after ? 'Nicht vollständig reparierbar' : 'Netzfehler gefunden'}</p>`
      + lines.map(([label, value]) => `<div class="d-info"><span>${label}</span><b>${value.toLocaleString('de-DE')}</b></div>`).join('')
      + (report.after ? `<p class="d-note">${report.holes} Löcher geschlossen, ${report.removed} Dreiecke entfernt, ${report.flipped} umgedreht.</p>` : ''));
  }
  return `<button class="full" data-action="repair-check">Netz prüfen</button>
    ${box('Reparieren', row('Punkte verschweißen bis', `<input id="repair-tolerance" type="number" min="0.00001" max="1" step="any" data-repair="tolerance" value="${tolerance}">`, 'mm')
      + '<button class="full" data-action="repair-apply">Netz reparieren</button>')}
    ${result}
    ${renderHolesBox(holes)}
    ${model.original_path ? '<button class="full" data-action="repair-revert">Original wiederherstellen</button>' : ''}
    <p class="d-note">Die Originaldatei bleibt unverändert. Sich durchdringende Flächen werden nicht aufgelöst, große Löcher werden eben geschlossen.</p>`;
}

/** Bohrungen: gefundene Bohrungen mit erwartetem Druckmaß und Aufmaß-Empfehlung. */
function renderHolesBox({advice, undersize = 0.2}) {
  const list = advice
    ? (advice.rows.length
      ? `<table class="holes"><thead><tr><th>Ø</th><th>Lage</th><th>Länge</th><th>gedruckt ≈</th></tr></thead><tbody>${advice.rows.map(r =>
        `<tr title="${esc(r.warnings.join('; '))}"><td>${number(r.diameter)} mm</td><td>${esc(r.orientation)}</td><td>${number(r.depth)} mm</td><td>${number(r.expected)} mm${r.warnings.length ? ' ⚠' : ''}</td></tr>`).join('')}</tbody></table>`
        + advice.rows.flatMap(r => r.warnings).filter((w, i, a) => a.indexOf(w) === i).map(w => `<p class="d-note bad">${esc(w)}</p>`).join('')
        + `<p class="d-note">Bereits ausgleichend im Prozess: Maßausgleich XY ${number(advice.xy)} mm, Schrumpf XY ${number(advice.shrink)} %. Empfohlenes Aufmaß: <b>${number(advice.delta)} mm</b>. ${esc(advice.alternative)}</p>`
        + `<button class="full" data-action="hole-adjust" ${advice.delta > 0 ? '' : 'disabled'}>Bohrungen um ${number(advice.delta)} mm vergrößern</button>`
      : '<p class="d-note">Keine Bohrungen gefunden.</p>')
    : '';
  return box('Bohrungen', `<button class="full" data-action="hole-scan">Bohrungen suchen</button>`
    + row('Untermaß deiner Testbohrung', `<input type="number" min="0" max="2" step="0.05" data-repair="undersize" value="${undersize}">`, 'mm')
    + list
    + '<p class="d-note">Gedruckte Löcher werden zu klein. Miss eine Testbohrung und trage das Untermaß ein; Simpliy rechnet den Ausgleich im Prozess (Maßausgleich XY, Schrumpf) mit ein und speichert eine angepasste Kopie.</p>');
}

/** Abschnitt im Dialog „Drucker / Material“. */
export function renderMaterials({tools, preset, filaments, bundle, assigned, library = []}) {
  if (tools < 2) {
    return '<div class="note-banner">Material je Werkzeug erscheint hier, sobald ein Drucker mit mehreren Werkzeugen oder MMU gewählt ist.</div>';
  }
  // Zuerst die zentrale Materialbibliothek, danach aeltere Profil-Optionen (bestehende Zuordnungen bleiben gueltig).
  const sources = library.filter(m => m.settings).map(m => ({value: `lib:${m.id}`, label: `Bibliothek: ${m.name}`})).concat(bundle.profile.categories
    .filter(category => category.options.some(o => Object.hasOwn(o.assignments || {}, 'temperature')))
    .flatMap(category => category.options.map(o => ({value: `${category.id}|${o.id}`, label: `${category.name}: ${o.name}`}))));
  const names = [...new Set(filaments)];
  const rows = Array.from({length: tools}, (_, i) => {
    const chosen = assigned?.[i + 1] || '';
    const missing = chosen && !sources.some(s => s.value === chosen);
    const prusa = i
      ? `<select data-slot-filament="${i}">${option('', 'wie T0', !preset.filaments?.[i])}${names.map(n => option(n, n, n === preset.filaments?.[i])).join('')}</select>`
      : `<span class="truncate" title="${esc(preset.filament)}">${esc(preset.filament || 'oben wählen')}</span>`;
    return `<tr><td>T${i}</td><td>${prusa}</td><td><select data-slot-material="${i + 1}">${option('', i && preset.filaments?.[i] ? 'aus dem Prusa-Material' : 'aus dem Prozess', !chosen)}${missing ? option(chosen, 'Option fehlt', true) : ''}${sources.map(s => option(s.value, s.label, s.value === chosen)).join('')}</select></td></tr>`;
  });
  return `<h3 class="section-title">Material je Werkzeug</h3>
    <table class="assign-table materials"><thead><tr><th>Werkzeug</th><th>Prusa-Material</th><th>Eigenes Material</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p class="helper">Eigenes Material überschreibt Temperatur, Lüfter und weitere Filamentwerte nur für dieses Werkzeug. Ein Prozess mit eigenem Werkzeug hat Vorrang. Start-Skript und Einzug gelten für die ganze Platte.</p>`;
}

export function renderUploadDialog({printers, printer, secret, file, busy, message}) {
  if (!printer) return '<div class="hint">Zuerst unter „Meine Drucker“ einen Drucker anlegen.</div>';
  const kinds = [['duet', 'Duet / RepRapFirmware'], ['octoprint', 'OctoPrint'], ['moonraker', 'Klipper / Moonraker'], ['prusalink', 'PrusaLink (API-Schlüssel)']];
  const kind = printer.host_type || 'duet';
  return `<div class="form-grid">
      <div class="form-field"><label for="upload-printer">Drucker</label><select id="upload-printer" data-upload="printer">${printers.map(p => option(p.id, p.name, p.id === printer.id)).join('')}</select></div>
      <div class="form-field"><label for="upload-kind">Anschlussart</label><select id="upload-kind" data-upload="kind">${kinds.map(([v, l]) => option(v, l, v === kind)).join('')}</select></div>
      <div class="form-field"><label for="upload-address">IP-Adresse oder URL</label><input id="upload-address" data-upload="address" value="${esc(printer.web_url || '')}" placeholder="z. B. 192.168.1.42"></div>
      <div class="form-field"><label for="upload-secret">${kind === 'duet' ? 'Passwort (leer: reprap)' : 'API-Schlüssel'}</label><input id="upload-secret" type="password" autocomplete="off" data-upload="secret" value="${esc(secret)}"></div>
    </div>
    <div class="form-field"><label>Datei</label><div class="row">
      <span class="pd-base ${file && !file.stale ? '' : 'missing'}" id="upload-file">${file ? esc(`${file.stale ? 'Veraltet: ' : ''}${file.name || file.path}`) : 'Erst slicen oder eine Datei wählen'}</span>
      <button data-action="upload-choose">Datei wählen…</button></div></div>
    <div class="row">
      <button data-action="upload-test" ${busy ? 'disabled' : ''}>Verbindung testen</button>
      <button class="primary" data-action="upload-send" ${busy || !file ? 'disabled' : ''}>Zum Drucker senden</button>
      <button data-action="upload-start" ${busy || !file ? 'disabled' : ''} title="Lädt hoch und startet den Druck sofort, nach ausdrücklicher Bestätigung">Hochladen und drucken …</button>
      <span id="upload-message" class="${message.error ? 'bad' : ''}">${esc(message.text)}</span>
    </div>
    <div class="note-banner">„Zum Drucker senden“ lädt nur hoch. Der Druck startet nur über „Hochladen und drucken …“ nach ausdrücklicher Bestätigung. Das Passwort bleibt nur bis zum Schließen des Programms im Speicher. Verbindung ohne Verschlüsselung, nur im eigenen Netz benutzen.</div>`;
}
