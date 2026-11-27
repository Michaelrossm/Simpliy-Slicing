// Werkzeugfenster der Stuetzen: Platzierung, Form, Erzeugung.
import {esc} from './process-dialog.js';

const option = (value, label, selected) =>
  `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
const box = (title, body) => `<section class="d-group"><h4>${esc(title)}</h4><div class="d-box">${body}</div></section>`;

export const SUPPORT_MODES = {
  add: ['Stütze setzen', 'Unterseite oder Bett anklicken'],
  fill: ['Fläche füllen', 'Überhang anklicken'],
  move: ['Kontakt versetzen', 'Erst die Stütze, dann die neue Stelle anklicken'],
  edit: ['Einstellungen anwenden', 'Stütze anklicken: Sie bekommt die Einstellungen von oben'],
  editarea: ['Auf Bereich anwenden', 'Alle zusammenhängenden Stützen bekommen die Einstellungen von oben'],
  take: ['Einstellungen übernehmen', 'Stütze anklicken: Ihre Einstellungen kommen nach oben'],
  remove: ['Einzeln löschen', 'Stütze anklicken'],
  wipe: ['Bereich wischen', 'Mit gedrückter Maustaste über Stützen oder die Überhangfläche fahren, beim Loslassen werden sie gelöscht'],
  removearea: ['Bereich entfernen', 'Entfernt alle zusammenhängenden Stützen'],
};

export const STYLE_ICONS = {
  auto: '<path d="M6 20V9M12 20V4M18 20v-7"/><path d="M3 20h18"/>',
  pillar: '<path d="M4 4v16M9.3 4v16M14.6 4v16M20 4v16" stroke-width="3"/>',
  mini: '<path d="M5 4v4M10 4v4M15 4v4M20 4v4M5 11v4M10 11v4M15 11v4M20 11v4M5 18v3M10 18v3M15 18v3M20 18v3" stroke-width="2.4"/>',
  tree: '<path d="M12 21v-7L6 8V4M12 14l6-6V4M9 11l2-4V4M15 11l-1-4V4" stroke-width="2.4"/>',
  fan: '<path d="M12 21v-9L3 5M12 12 7.5 3M12 12V2M12 12l4.5-9M12 12l9-7M8 21h8" stroke-width="2.2"/>',
  gusset: '<path d="M4 2v20" stroke-width="2"/><path d="M4 21 20 5M4 16 14 5M4 11l5-6M20 5V3M14 5V3" stroke-width="2.4"/>',
};

const TABS = {
  place: [['surfaces', 'Flächen'], ['edges', 'Kanten'], ['minima', 'Tiefpunkte'], ['rules', 'Regeln']],
  shape: [['body', 'Körper'], ['tip', 'Spitze'], ['base', 'Fuß'], ['pattern', 'Raster'], ['contact', 'Kontaktfläche'], ['print', 'Druck']],
  make: [['auto', 'Auto'], ['manual', 'Manuell']],
};

export function renderSupportPanel(s) {
  if (!s?.model) return '<p class="d-note">Bitte zuerst ein Modell auswählen.</p>';
  const v = s.settings;
  const {styles: STYLES, limits: SHAPE_LIMITS} = s.schema;
  const tabs = {place: 'surfaces', shape: 'body', make: 'auto', ...s.tabs};
  const off = s.ready ? '' : 'disabled';

  const tabRow = group => `<div class="support-tabs" role="tablist">${TABS[group].map(([id, label]) =>
    `<button role="tab" aria-selected="${tabs[group] === id}" class="${tabs[group] === id ? 'active' : ''}" data-action="support-tab" data-group="${group}" data-tab="${id}">${label}</button>`).join('')}</div>`;
  // Mit „aus Prozess“ kommen diese Werte aus den Prusa-Stützeinstellungen (Erzeugung/Organisch) und sind hier gesperrt.
  const FROM_PROCESS = new Set(['overhangAngle', 'branchAngle', 'tipWidth', 'bodyWidth']);
  const locked = key => (v.useProcess && FROM_PROCESS.has(key) ? 'disabled' : off);
  const field = (label, key, step, unit, limits = SHAPE_LIMITS[key]) =>
    `<div class="d-row"><label>${label}</label><input type="number" step="${step}" min="${limits?.[0] ?? ''}" max="${limits?.[1] ?? ''}" data-support-setting="${key}" value="${esc(v[key])}" ${locked(key)} ${v.useProcess && FROM_PROCESS.has(key) ? 'title="aus dem Prozess (Reiter Stützen)"' : ''}><span>${unit}${v.useProcess && FROM_PROCESS.has(key) ? ' · aus Prozess' : ''}</span></div>`;
  const check = (label, key) =>
    `<label class="support-check"><input type="checkbox" data-support-setting="${key}" ${v[key] ? 'checked' : ''} ${off}> ${label}</label>`;
  const choice = (label, key, options) =>
    `<div class="d-row"><label>${label}</label><select data-support-setting="${key}" ${off}>${options.map(([id, text]) => option(id, text, v[key] === id)).join('')}</select><span></span></div>`;
  const mode = key => {
    const [label, hint] = SUPPORT_MODES[key];
    return `<button class="support-action ${s.mode === key ? 'active' : ''}" data-action="support-mode" data-mode="${key}" title="${hint}" ${off}><span>${label}</span></button>`;
  };
  const note = text => `<p class="d-note">${text}</p>`;

  const place = {
    surfaces: () => check('Werte aus dem Prozess übernehmen (wie Prusa-Stützen)', 'useProcess')
      + note('Überhangwinkel, „nur Druckbett“, Kontaktabstand sowie Astwinkel, Spitzen- und Astdurchmesser kommen aus den Prusa-Stützeinstellungen des Prozesses. Ausschalten behält die Werte als eigene.')
      + check('Überhangflächen erkennen', 'detectSurfaces')
      + field('Überhangwinkel', 'overhangAngle', 1, '°', [0, 89.9])
      + field('Zusätzlich druckbar (Drucker/Kühlung)', 'printableExtra', 1, '° weniger gestützt', [0, 30])
      + check('Zusatzwinkel aus Prusa-Überhangparametern ableiten', 'printableAuto')
      + note(`Es wird ab ${Math.round((v.overhangAngle - (v.printableExtra || 0) - (v.printableBonus || 0)) * 10) / 10}° gestützt${v.printableAuto ? ` (Prusa-Parameter: −${v.printableBonus || 0}°)` : ''}. Der Zusatzwinkel nutzt dynamische Überhangtempi, Überhang-Wandlogik und Überhang-Lüfter des Prozesses (Näherung, im Druck prüfen).`)
      + field('Fläche ab', 'minArea', 1, 'mm²', [0, 100000])
      + check('Überhang farbig anzeigen', 'heatmap'),
    edges: () => check('Freie Unterkanten stützen', 'detectEdges') + note('Für schmale Kanten ohne Überhangfläche.'),
    minima: () => check('Tiefste Punkte stützen', 'detectMinima')
      + note('Stellen, an denen der Druck in der Luft beginnen würde. Sie sind rot markiert.'),
    rules: () => choice('Platzierung', 'placement', [['everywhere', 'Überall'], ['buildplate', 'Nur Druckbett']])
      + field('Mindesthöhe', 'minHeight', 0.1, 'mm', [0, 50])
      + field('Mini bis Höhe', 'miniBelow', 1, 'mm', [0, 100])
      + field('Pfeiler ab Fläche', 'pillarArea', 10, 'mm²', [1, 1000000])
      + field('Bohrungen nicht stützen bis Ø', 'boreMax', 0.5, 'mm (0 = aus)', [0, 40])
      + field('Fasen nicht stützen bis Breite', 'chamferMax', 0.5, 'mm (0 = aus)', [0, 10])
      + field('Fase: so viel steiler als Schwelle', 'chamferTol', 1, '°', [0, 30])
      + note('„Pfeiler ab Fläche“ und „Mini bis Höhe“ gelten für den Stil „Gemischt“. Waagerechte Bohrungen werden am Netz erkannt (Zylinderanpassung); kleine Rundbögen druckt man ohne Stütze.'),
  }[tabs.place] || (() => '');

  const styleOrder = Object.keys(STYLE_ICONS).filter(id => STYLES[id]);
  const styles = [['auto', 'Gemischt'], ...styleOrder.map(id => [id, STYLES[id]])].map(([id, label]) =>
    `<button class="style-card ${v.style === id ? 'active' : ''}" data-action="support-style" data-style="${id}" ${off}><svg viewBox="0 0 24 24" aria-hidden="true">${STYLE_ICONS[id]}</svg><span>${label}</span></button>`).join('');
  const shape = {
    body: () => field('Astbreite', 'bodyWidth', 0.1, 'mm') + field('Astwinkel', 'branchAngle', 1, '°')
      + field('Verdickung', 'thicken', 5, '%') + field('Spitzen je Fächer', 'fanCount', 1, ''),
    tip: () => field('Kontaktbreite', 'contactWidth', 0.1, 'mm') + field('Halsbreite', 'tipWidth', 0.1, 'mm') + field('Spitzenhöhe', 'tipHeight', 0.1, 'mm'),
    base: () => field('Fußbreite', 'baseWidth', 0.5, 'mm') + field('Fußhöhe', 'baseHeight', 0.5, 'mm'),
    pattern: () => field('Stützen-Abstand', 'spacing', 0.5, 'mm', [0.5, 30])
      + field('Mini-Breite', 'miniWidth', 0.1, 'mm', [0.8, 6])
      + choice('Pfeiler-Stil', 'build', [['snug', 'Nahtlos'], ['process', 'wie Prozess']]),
    // Kontaktfläche: überschreibt die Werte aus dem Prozess für die eigenen Stützen (0 / −1 / „wie Prozess“ = Prozesswert).
    contact: () => choice('Muster', 'contactPattern', [['process', 'wie Prozess'], ['rectilinear', 'Linien'], ['concentric', 'Konzentrisch'], ['grid', 'Gitter (nur eigene Körper)']])
      + field('Kontaktlagen', 'contactLayers', 1, '(0 = Prozess)', [0, 8])
      + field('Dichte', 'contactDensity', 5, '% (0 = Prozess)', [0, 100])
      + field('Winkel', 'contactAngle', 5, '° (−1 = Prozess)', [-1, 180])
      + choice('Kontaktschleifen', 'contactLoops', [['process', 'wie Prozess'], ['on', 'an'], ['off', 'aus']])
      + field('Tempo', 'contactSpeed', 1, 'mm/s (0 = Prozess)', [0, 500])
      + field('Abstand oben (Z)', 'contactZ', 0.05, 'mm (−1 = Prozess)', [-1, 2])
      + field('Abstand seitlich', 'xyGap', 0.1, 'mm (0 = Prozess)', [0, 5])
      + note('Nur Werte, die du hier änderst, ersetzen den Prozess; alles auf „0“, „−1“ oder „wie Prozess“ lässt die Prozesswerte gelten.'),
    print: () => field('Tempo Stützkörper', 'bodySpeed', 1, 'mm/s (0 = Prozess)', [0, 500])
      + field('Bahnbreite', 'lineWidth', 0.05, 'mm (0 = Prozess)', [0, 2])
      + field('Wände', 'bodyWalls', 1, '', [1, 4])
      + check('Füllung und Muster wie Prusa-Stützen (aus Stützmuster und -abstand)', 'bodyLikePrusa')
      + field('Füllung Körper', 'bodyInfill', 5, '% (0 = hohl)', [0, 100])
      + choice('Füllmuster', 'bodyPattern', [['rectilinear', 'Linien'], ['grid', 'Gitter'], ['triangles', 'Dreiecke'], ['honeycomb', 'Waben'], ['gyroid', 'Gyroid'], ['concentric', 'Konzentrisch']])
      + note('Mehr Wände und eine Füllung machen breite Stützkörper steifer; hohl und mit einer Wand drucken sie am schnellsten.'),
  }[tabs.shape] || (() => '');

  const make = {
    auto: () => choice('Vorhandene', 'existing', [['replace', 'ersetzen'], ['add', 'behalten, ergänzen']])
      + `<button class="support-action full primary-action" data-action="support-generate" ${off}><span>Automatische Stützen erzeugen</span></button>`
      + `<div class="stack">${mode('remove')}${mode('wipe')}
      <button data-action="support-clear-auto" ${s.automatic?.length ? '' : 'disabled'}>Alle automatischen entfernen</button></div>`,
    manual: () => `<div class="stack">${mode('add')}${mode('fill')}${mode('remove')}${mode('wipe')}
      <button data-action="support-clear-all" ${s.count ? '' : 'disabled'}>Alle Stützen entfernen</button></div>`,
    edit: () => `<div class="stack">${mode('move')}${mode('edit')}${mode('editarea')}${mode('take')}
      <button data-action="support-edit-all" ${s.count ? off : 'disabled'}>Auf alle anwenden</button></div>`,
    remove: () => `<div class="stack">${mode('remove')}${mode('removearea')}
      <button data-action="support-clear-auto" ${s.automatic?.length ? '' : 'disabled'}>Automatische Stützen entfernen</button>
      <button data-action="support-clear-all" ${s.count ? '' : 'disabled'}>Alle Stützen entfernen</button></div>`,
  }[tabs.make] || (() => '');

  const counts = new Map();
  for (const p of [...(s.automatic || []), ...(s.manual || [])]) {
    const style = p.style || 'pillar';
    counts.set(style, (counts.get(style) || 0) + 1);
  }
  const summary = [...counts].map(([style, n]) => `<div class="d-info"><span>${STYLES[style] || esc(style)}</span><b>${n}</b></div>`).join('');
  const hint = SUPPORT_MODES[s.mode]?.[1];

  return box('Platzierung', tabRow('place') + place())
    + box('Form', `<div class="style-grid">${styles}</div>${tabRow('shape')}${shape()}`)
    + box('Erzeugung', tabRow('make') + make())
    + (hint ? `<p class="d-note mode-hint">${hint}</p>` : '')
    + (s.stale ? '<p class="d-note bad">Modell verändert: Die Stützen werden beim Slicen automatisch angepasst.</p>' : '')
    + box('Übersicht', `${summary}<div class="d-info"><span>Stützen</span><b>${s.count} (${s.manual?.length || 0} manuell)</b></div>
        ${s.substituted ? note(`${s.substituted} ohne passende Gruppe oder Wand werden als einzelne, möglichst gerade Stütze gedruckt.`) : ''}
        ${s.fallback ? note(`${s.fallback} ohne freien Weg werden als Pfeiler gedruckt.`) : ''}
        ${s.skipped ? `<p class="d-note bad">${s.skipped} erreichen das Druckbett nicht.</p>` : ''}
        <button class="full" data-action="support-optimize" ${s.count && !s.stale ? '' : 'disabled'}>Stützgeometrie neu optimieren</button>
        <button class="full" data-action="support-export" ${s.count && !s.stale ? '' : 'disabled'}>Stützen als STL exportieren</button>`)
    + note('Abstand, Tempo und Bahnbreite kommen aus dem Prozess. Stehen dort 0 Kontaktlagen, werden 2 verwendet.');
}
