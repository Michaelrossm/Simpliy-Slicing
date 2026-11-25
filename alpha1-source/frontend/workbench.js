// Hauptfenster: Listen links, Werkzeugfenster und Leiste rechts, Schichtvorschau unten.
import {renderSupportPanel} from './support-panel.js';
import {esc} from './process-dialog.js';
import {PLACE} from './settings-layout.js';
import {display} from './engine-config.js';
import {TOOL_COLOURS, ROLE_COLOURS} from './viewport.js';
import {toolSelect} from './feature-panels.js';

// Eigene, farbige Vektorsymbole; die Aktionsschluessel bleiben unveraendert.
const icon = body => `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;
export const TOOLS = [
  ['select', 'Auswählen', icon('<path d="M7 3v21l5-5 4 9 4-2-4-9h7z" fill="#f6f8fb" stroke="#212b36" stroke-width="1.7"/>')],
  ['move', 'Verschieben', icon('<path d="M16 4v24M4 16h24" stroke="#dce7f1" stroke-width="1.5"/><path d="M16 2l-3 5h6z" fill="#51b9f5" stroke="#a2deff"/><path d="M30 16l-5-3v6z" fill="#f16e5e" stroke="#ffad9c"/><path d="M16 30l3-5h-6zM2 16l5 3v-6z" fill="#7dcf71" stroke="#b8eea8"/><circle cx="16" cy="16" r="2.2" fill="#f6f7f7"/>')],
  ['scale', 'Skalieren', icon('<path d="M4 13l8-4 8 4-8 4z" fill="#80d4ff" stroke="#c9ecff"/><path d="M4 13v10l8 5V17z" fill="#2087cb" stroke="#a4dbf5"/><path d="M12 17l8-4v10l-8 5z" fill="#1265a8" stroke="#a4dbf5"/><path d="M19 4h9v9M28 4L17 15" fill="none" stroke="#f4c256" stroke-width="2"/>')],
  ['rotate', 'Drehen', icon('<circle cx="16" cy="16" r="7" fill="#2d567b" stroke="#8bc9f5"/><path d="M7 12a10 10 0 0 1 17-4M25 20a10 10 0 0 1-17 4" fill="none" stroke="#efb64e" stroke-width="2.5"/><path d="M24 3l1 7-7-1zM8 29l-1-7 7 1z" fill="#efb64e" stroke="#fbd284"/>')],
  ['flat', 'Auf Fläche legen', icon('<path d="M4 25h24" stroke="#9ce6a0" stroke-width="2.5"/><path d="M8 20l3-13 13 4-3 12z" fill="#91aeca" stroke="#d7e8f7" stroke-width="1.5"/><path d="M8 20l13 3-1 2H7z" fill="#f3a846" stroke="#ffd386"/><path d="M26 5v10m-3-3 3 3 3-3" fill="none" stroke="#64c8ff" stroke-width="2"/>')],
  ['supports', 'Stützstrukturen', icon('<path d="M5 5h22v3H5z" fill="#a7b9c9" stroke="#edf5fb"/><path d="M8 9v18M15 9v18M22 9v18" stroke="#ffad32" stroke-width="3"/><path d="M5 28h21" stroke="#8ad7ff" stroke-width="2"/><circle cx="24" cy="22" r="6" fill="#3989d0" stroke="#c6ecff"/><path d="M21 22h6M24 19v6" stroke="#fff" stroke-width="1.7"/>')],
  ['section', 'Querschnitt anzeigen', icon('<path d="M4 9l12-6 12 6v14l-12 6-12-6z" fill="#70879b" stroke="#d7e6f1"/><path d="M16 15l12-6v14l-12 6z" fill="#e35049" stroke="#ffb1a7"/><path d="M4 9l12 6v14L4 23z" fill="#567087" stroke="#c4d6e4"/><path d="M16 5v22" stroke="#fff" stroke-width="1.4" stroke-dasharray="2 2"/>')],
  ['paint', 'Anmalen / Stützen', icon('<path d="M17 3l11 10-11 10L7 13z" fill="#4aa5e5" stroke="#bfedff" stroke-width="1.5"/><path d="M9 17c-4 1-3 6-6 9 6 2 12 0 13-4z" fill="#efa330" stroke="#ffda88" stroke-width="1.4"/><path d="M18 5l8 7" stroke="#ebfaff" stroke-width="2"/>')],
  ['volumes', 'Modifikatoren', icon('<path d="M4 9l9-4 9 4-9 5z" fill="#8bd5ff" stroke="#caecff"/><path d="M4 9v12l9 5V14z" fill="#287eb5" stroke="#bbddf3"/><path d="M13 14l9-5v12l-9 5z" fill="#22557e" stroke="#bbddf3"/><path d="M19 16h9v11h-9z" fill="#f5b844" fill-opacity=".88" stroke="#fff0ba" stroke-width="1.5"/><path d="M23.5 18v7M20 21.5h7" stroke="#664000" stroke-width="1.4"/>')],
  ['layers', 'Variable Schichthöhe', icon('<path d="M5 8l11-5 11 5-11 5z" fill="#b5e8fb" stroke="#e1f5ff"/><path d="M5 12l11 5 11-5M5 16l11 5 11-5M5 21l11 5 11-5" fill="none" stroke="#45b2eb" stroke-width="2.4"/><path d="M7 25l9 4 9-4" fill="none" stroke="#e7a543" stroke-width="1.7"/>')],
  ['cut', 'Schneiden', icon('<path d="M6 6l10-4 10 4v9l-10 5-10-5z" fill="#70869a" stroke="#d0e0ea"/><path d="M4 17l12 6 12-6v4l-12 6-12-6z" fill="#ef554e" fill-opacity=".78" stroke="#ffb1aa" stroke-width="1.4"/><path d="M6 22v4l10 5 10-5v-4" fill="none" stroke="#aab9c7" stroke-width="1.5"/>')],
  ['text', 'Text prägen', icon('<path d="M4 7V4h23v3M15.5 5v18M10 23h11" fill="none" stroke="#91d3fa" stroke-width="3"/><path d="M4 27h24" stroke="#e8ad4b" stroke-width="2.5"/>')],
  ['measure', 'Messen', icon('<path d="M3 20L20 3l9 9-17 17z" fill="#edb543" stroke="#ffe4a6" stroke-width="1.4"/><path d="M9 18l3 3M13 14l3 3M17 10l3 3M21 6l3 3" fill="none" stroke="#704b13" stroke-width="1.5"/>')],
  ['repair', 'Netz reparieren', icon('<path d="M19 5a7 7 0 0 1 8-2l-4 4 1 3 4-1a7 7 0 0 1-9 8L9 28l-5-5 11-10a7 7 0 0 1 4-8z" fill="#5fbcae" stroke="#c0f5e8" stroke-width="1.4"/><circle cx="7" cy="25" r="1.2" fill="#f8d27a" stroke="none"/>')],
  ['object', 'Werte pro Modell', icon('<path d="M5 8h22M5 16h22M5 24h22" fill="none" stroke="#b6c5d4" stroke-width="2"/><circle cx="11" cy="8" r="3" fill="#5eb8f2" stroke="#d0edff"/><circle cx="22" cy="16" r="3" fill="#e9a94e" stroke="#ffe0ab"/><circle cx="14" cy="24" r="3" fill="#6bc88f" stroke="#d4ffe2"/>')],
  ['machine', 'Drucker', icon('<path d="M5 3h22v26H5z" fill="#4c5f70" stroke="#c4d4df" stroke-width="1.5"/><path d="M8 7h16v13H8z" fill="#222d39" stroke="#7c9bad"/><path d="M11 19l5-3 5 3-5 3z" fill="#e7a73c" stroke="#ffdb93"/><path d="M14 7h4v5l-2 2-2-2z" fill="#66bff2" stroke="#c6ecff"/><path d="M9 25h14" stroke="#9de49e" stroke-width="2"/>')],
  ['view', 'Ansichten', icon('<path d="M2 16s5-8 14-8 14 8 14 8-5 8-14 8S2 16 2 16z" fill="#637c8e" stroke="#d4e6ef" stroke-width="1.5"/><circle cx="16" cy="16" r="5.3" fill="#55b8ec" stroke="#cceeff"/><circle cx="16" cy="16" r="2.4" fill="#1a3850" stroke="#b5e3fb"/>')],
];

export const PAINT_KINDS = {
  support: {name: 'Stützen', states: [[1, 'Erzwingen', '#3186ff'], [2, 'Blockieren', '#ff3b3b']]},
  seam: {name: 'Naht', states: [[1, 'Bevorzugen', '#33d17a'], [2, 'Vermeiden', '#ff3b3b']]},
  fuzzy: {name: 'Fuzzy Skin', states: [[1, 'Fuzzy Skin', '#c36bff']]},
  color: {name: 'Mehrfarbig', states: []},
};

export function paintStates(kind, tools) {
  if (kind !== 'color') return PAINT_KINDS[kind].states;
  return Array.from({length: Math.min(tools, 16)}, (_, i) => [i + 1, `T${i}`, TOOL_COLOURS[i % TOOL_COLOURS.length]]);
}

export const VOLUME_KINDS = {
  ParameterModifier: 'Parameter-Modifikator',
  NegativeVolume: 'Negativvolumen',
  SupportEnforcer: 'Stützen erzwingen',
  SupportBlocker: 'Stützen blockieren',
};
const SHAPES = {box: 'Quader', cylinder: 'Zylinder', sphere: 'Kugel'};

// Schluessel, die die Engine pro Modell bzw. pro Modifikator annimmt.
export const VOLUME_KEYS = ['perimeters', 'fill_density', 'fill_pattern', 'top_solid_layers', 'bottom_solid_layers',
  'top_fill_pattern', 'bottom_fill_pattern', 'solid_infill_every_layers', 'perimeter_speed', 'external_perimeter_speed',
  'infill_speed', 'fuzzy_skin', 'fuzzy_skin_thickness', 'ironing'];
export const OBJECT_KEYS = [...VOLUME_KEYS, 'layer_height', 'seam_position', 'support_material', 'support_material_style',
  'support_material_threshold', 'support_material_buildplate_only', 'brim_type', 'brim_width', 'xy_size_compensation',
  'raft_layers'];

const num = (value, digits = 3) => String(+Number(value).toFixed(digits));
const option = (value, label, selected) =>
  `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
const field = (label, attributes, value, unit = '') =>
  `<div class="d-row"><label>${esc(label)}</label><input type="number" step="any" ${attributes} value="${esc(value)}"><span>${unit}</span></div>`;
const axes = (name, values, unit) =>
  ['X', 'Y', 'Z'].slice(0, values.length).map((a, i) => field(a, `data-transform="${name}" data-axis="${i}"`, num(values[i]), unit)).join('');
const box = (title, body) => `<section class="d-group"><h4>${esc(title)}</h4><div class="d-box">${body}</div></section>`;

function settingPairs(owner, index, settings, keys, byKey) {
  const at = `data-owner="${owner}" data-index="${index}"`;
  const rows = Object.entries(settings || {}).map(([key, value]) => {
    const spec = byKey.get(key);
    const label = PLACE.get(key)?.label || key;
    let input;
    if (spec?.type === 'Enum') {
      input = `<select ${at} data-extra-key="${esc(key)}">${spec.options.map(o => option(o.value, o.label, o.value === value)).join('')}</select>`;
    } else if (spec?.type === 'Bool') {
      input = `<input type="checkbox" ${at} data-extra-key="${esc(key)}" ${value === true ? 'checked' : ''}>`;
    } else {
      input = `<input ${at} data-extra-key="${esc(key)}" value="${esc(display(value, spec))}">`;
    }
    return `<div class="d-row"><label>${esc(label)}</label>${input}<button class="undo" data-action="remove-extra" ${at} data-key="${esc(key)}">×</button></div>`;
  }).join('');
  const free = keys.filter(key => !Object.hasOwn(settings || {}, key));
  return `${rows}<select class="full" ${at} data-add-extra>${option('', '+ Wert hinzufügen …', true)}`
    + `${free.map(key => option(key, PLACE.get(key)?.label || key, false)).join('')}</select>`;
}

const PANELS = {
  select({model, size}) {
    return box(model.name, `<div class="d-info"><span>Größe</span><b>${size.map(v => num(v, 1)).join(' × ')} mm</b></div>`)
      + `<div class="stack"><button data-action="duplicate-model">Duplizieren</button>`
      + `<button data-action="arrange-models">Alle anordnen</button>`
      + `<button data-action="delete-model">Entfernen</button></div>`;
  },

  move({position}) {
    return box('Position der Mitte', axes('position', position, 'mm'))
      + `<p class="d-note">Das Modell kann auch direkt gezogen werden. Z kleiner 0 senkt es ins Bett, der Teil unter dem Bett wird nicht gedruckt.</p>`
      + `<div class="stack"><button data-action="center-model">Auf Bett zentrieren</button>`
      + `<button data-action="arrange-models">Alle anordnen</button></div>`;
  },

  scale({model, size, uniform}) {
    const scale = (model.scale || [100, 100, 100]).map(Math.abs);
    return box('Skalierung', axes('scale', scale, '%'))
      + box('Größe', axes('size', size, 'mm'))
      + `<label class="check"><input type="checkbox" data-tool-option="uniform" ${uniform ? 'checked' : ''}> Einheitliche Skalierung</label>`
      + box('Spiegeln', `<div class="button-row">${['X', 'Y', 'Z'].map((a, i) => `<button data-action="mirror-model" data-axis="${i}">${a}</button>`).join('')}</div>`)
      + '<button class="full" data-action="reset-scale">Zurücksetzen</button>';
  },

  rotate({model}) {
    const quick = ['X', 'Y', 'Z'].flatMap((a, i) =>
      [-90, 90].map(d => `<button data-action="turn-model" data-axis="${i}" data-degrees="${d}">${a} ${d > 0 ? '+' : '−'}90°</button>`));
    return box('Drehwinkel', axes('rotation', model.rotation || [0, 0, 0], '°'))
      + box('Schnell drehen', `<div class="button-grid">${quick.join('')}</div>`)
      + '<button class="full" data-action="reset-rotation">Zurücksetzen</button>';
  },

  flat() {
    return '<p class="d-note">Die Fläche anklicken, die auf dem Druckbett liegen soll.</p>'
      + '<button class="full" data-action="reset-rotation">Drehung zurücksetzen</button>';
  },

  paint({model, paint, tools}) {
    const kinds = Object.entries(PAINT_KINDS).map(([key, kind]) =>
      `<button class="${paint.kind === key ? 'active' : ''}" data-action="paint-kind" data-kind="${key}">${esc(kind.name)}</button>`).join('');
    let brushes = '';
    if (paint.kind === 'color' && tools < 2) {
      brushes = '<p class="d-note">Dafür ein Basisprofil mit mehreren Werkzeugen oder MMU wählen.</p>'
        + '<button class="full" data-action="open-printers">Drucker verwalten…</button>';
    } else {
      brushes = `<div class="swatches">${paintStates(paint.kind, tools).map(([value, label, colour]) =>
        `<button class="${paint.state === value ? 'active' : ''}" data-action="paint-state" data-value="${value}"><i style="background:${colour}"></i>${esc(label)}</button>`).join('')}`
        + `<button class="${paint.state === 0 ? 'active' : ''}" data-action="paint-state" data-value="0"><i></i>Radierer</button></div>`;
    }
    const automatic = paint.kind === 'support'
      ? box('Überhänge automatisch', field('Winkel bis', 'data-tool-option="angle" min="1" max="89"', paint.angle, '°')
        + '<button class="full" data-action="paint-overhangs">Überhänge markieren</button>')
      : '';
    const count = Object.keys(model.paint?.[paint.kind] || {}).length;
    return `<div class="button-grid kinds">${kinds}</div>${box('Pinsel', brushes)}`
      + box('Werkzeug', `<div class="button-row">
          <button class="${paint.fill ? '' : 'active'}" data-action="paint-mode" data-fill="0">Pinsel</button>
          <button class="${paint.fill ? 'active' : ''}" data-action="paint-mode" data-fill="1">Fläche füllen</button></div>
        ${paint.fill
    ? field('Bis Kante von', 'data-tool-option="fillAngle" min="1" max="90"', paint.fillAngle, '°')
    : field('Radius', 'data-tool-option="radius" min="0.2" max="100"', paint.radius, 'mm')}
        <label class="check"><input type="checkbox" data-tool-option="front" ${paint.front ? 'checked' : ''}> Rückseiten schützen</label>`)
      + automatic
      + '<p class="d-note">Linke Taste malt, Umschalt radiert. Neben dem Modell dreht die linke Taste die Ansicht.</p>'
      + `<div class="button-row"><button data-action="undo">Rückgängig</button><button data-action="paint-clear" ${count ? '' : 'disabled'}>Alles löschen</button></div>`;
  },

  volumes({model, byKey}) {
    const list = (model.volumes || []).map((volume, i) => {
      if (volume.shape === 'text') return '';
      const at = `data-index="${i}"`;
      return `<section class="d-group">
        <h4>${esc(VOLUME_KINDS[volume.kind])}<button class="undo" data-action="remove-volume" ${at}>×</button></h4>
        <div class="d-box">
          <div class="d-row"><label>Form</label><select data-volume="shape" ${at}>${Object.entries(SHAPES).map(([k, v]) => option(k, v, k === volume.shape)).join('')}</select><span></span></div>
          <div class="xyz"><b></b><b>X</b><b>Y</b><b>Z</b>
            ${[['position', 'Mitte'], ['size', 'Größe']].map(([key, label]) =>
    `<span>${label}</span>${volume[key].map((v, a) => `<input type="number" step="any" data-volume="${key}" ${at} data-axis="${a}" value="${num(v)}">`).join('')}`).join('')}
          </div>
          ${volume.kind === 'ParameterModifier' ? settingPairs('volume', i, volume.settings, VOLUME_KEYS, byKey) : ''}
        </div></section>`;
    }).join('');
    const add = Object.entries(VOLUME_KINDS).map(([kind, name]) =>
      `<button data-action="add-volume" data-kind="${kind}">+ ${esc(name)}</button>`).join('');
    return `<div class="stack">${add}</div>${list}<p class="d-note">Koordinaten gelten im Modell und wandern beim Drehen mit. Aufgemalte Stützen haben Vorrang vor Blocker-Körpern.</p>`;
  },

  layers({model}) {
    const rows = (model.ranges || []).map((range, i) => `<tr>${['from', 'to', 'height'].map(key =>
      `<td><input type="number" step="any" data-range="${key}" data-index="${i}" value="${num(range[key])}"></td>`).join('')}
      <td><button class="undo" data-action="remove-range" data-index="${i}">×</button></td></tr>`).join('');
    return box('Schichthöhe je Höhenbereich',
      `<table class="ranges"><tr><th>von Z</th><th>bis Z</th><th>Schicht</th><th></th></tr>${rows}</table>`
      + '<button class="full" data-action="add-range">+ Bereich</button>')
      + '<p class="d-note">Alle Angaben in mm. Außerhalb gilt die Schichthöhe des Prozesses.</p>';
  },

  cut({cutHeight, meshHeight}) {
    return box('Waagrechter Schnitt', field('Höhe', `data-tool-option="cutHeight" min="0" max="${num(meshHeight)}"`, num(cutHeight), 'mm')
      + '<div class="stack"><button data-action="cut-model" data-keep="below">Unteren Teil behalten</button>'
      + '<button data-action="cut-model" data-keep="above">Oberen Teil behalten</button>'
      + '<button data-action="cut-model" data-keep="both">In zwei Modelle teilen</button></div>')
      + '<p class="d-note">Schnitt senkrecht zur Z-Achse des Modells, umgesetzt als Negativvolumen. Die Datei bleibt unverändert.</p>';
  },

  object({model, byKey, tools}) {
    const tool = tools > 1
      ? box('Material', `<div class="d-row"><label>Werkzeug</label>${toolSelect('data-model-tool', model.tool, tools)}<span></span></div>`)
      : '';
    return tool + box('Abweichungen vom Prozess', settingPairs('object', 0, model.settings, OBJECT_KEYS, byKey));
  },
};


const supportIcon=(kind)=>{
 const colors={generate:'#ffab32',add:'#55d58a',remove:'#ff7466',clear:'#ff7466',export:'#7ccfff'};
 const symbol=kind==='add'?'<path d="M20 13v9M15.5 17.5h9" stroke="#fff" stroke-width="2"/>':kind==='remove'?'<path d="M15.5 17.5h9" stroke="#fff" stroke-width="2"/>':kind==='clear'?'<path d="M16 13l8 9m0-9-8 9" stroke="#fff" stroke-width="2"/>':'<path d="M20 12v8m-3-3 3 3 3-3" fill="none" stroke="#fff" stroke-width="2"/>';
 return icon(`<path d="M5 6h19M8 7v19M14 7v19" stroke="#ffa635" stroke-width="3"/><circle cx="20" cy="18" r="7" fill="${colors[kind]}" stroke="#e1ebf2"/>${symbol}`);
};

/** Im eingebauten Dock bleiben die vorhandenen Datenaktionen und die Styles erhalten. */
export function renderSupportDock(s){
  return renderSupportPanel(s);
}

export function renderDock(tool, ctx) {
  const title = TOOLS.find(([key]) => key === tool)?.[1] || 'Werkzeuge';
  let body;
  if(tool==='supports'){
    body=renderSupportDock(ctx.support);
  } else if(tool==='section'){
    const v=ctx.section,[min,max]=ctx.sectionRange;
    const choice=['+X','-X','+Y','-Y','+Z','-Z'].map(x=>option(x,x,v.orientation===x)).join('');
    body=box('Querschnittsausrichtung',`<label class="check"><input type="checkbox" data-section="enabled" ${v.enabled?'checked':''}> Querschnitt aktivieren</label><div class="d-row"><label>Ebenentyp</label><select data-section="orientation">${choice}</select><button data-action="section-flip" title="Schnittrichtung umkehren">Flip</button></div><label>Position: <b id="section-value">${Number(v.position).toFixed(2)}</b> mm</label><div class="section-position"><input id="section-range" type="range" min="${min}" max="${max}" step="0.1" value="${v.position}" data-section="position"><input id="section-number" type="number" step="0.1" min="${min}" max="${max}" value="${v.position}" data-section="position"></div><button class="full" data-action="section-pick" ${v.enabled?'':'disabled'}>${v.pickPoint?'Punkt am Modell anklicken ...':'Position durch Punkt waehlen'}</button>`)
      +box('Darstellung',`<label class="check"><input type="checkbox" data-section="showGizmo" ${v.showGizmo?'checked':''}> Richtungspfeil anzeigen</label><label class="check"><input type="checkbox" data-section="showPlane" ${v.showPlane?'checked':''}> Ebene anzeigen</label><p class="d-note">Nur Anzeige: Modell und G-Code bleiben unveraendert.</p>`);
  } else if (tool === 'view') {
    body = `<div class="button-grid">${[['iso', 'Isometrisch'], ['top', 'Oben'], ['bottom', 'Unten'], ['front', 'Vorne'], ['back', 'Hinten'], ['left', 'Links'], ['right', 'Rechts'], ['fit', 'Einpassen']]
      .map(([key, label]) => `<button data-action="camera" data-view="${key}">${label}</button>`).join('')}</div>`;
  } else if (tool === 'machine') {
    body = box('Aktiv', `<div class="d-info"><span>Drucker</span><b>${esc(ctx.printer)}</b></div><div class="d-info"><span>Bauraum</span><b>${esc(ctx.bedText)}</b></div>`)
      + '<div class="stack"><button data-action="printer-view">Druckeransicht öffnen</button>'
      + '<button data-action="open-printers">Drucker verwalten</button></div>';
  } else if (ctx.featurePanel !== undefined) {
    body = ctx.featurePanel;
  } else if (!ctx.model) {
    body = '<p class="d-note">Zuerst links oder in der Ansicht ein Modell auswählen.</p>';
  } else if (!ctx.size) {
    body = `<p class="d-note">${esc(ctx.meshError || 'Modell wird geladen …')}</p>`;
  } else {
    body = (PANELS[tool] || PANELS.select)(ctx);
  }
  return `<div class="dock-head"><b>${esc(title)}</b><button class="x" data-action="toggle-dock" title="Ausblenden">×</button></div>`
    + `<div class="dock-scroll" data-keep-scroll="dock:${esc(tool)}">${body}</div>`;
}

const RAIL_LABELS={supports:'St\u00fctzen',section:'Querschn.',select:'Wahl',move:'Position',scale:'Gr\u00f6\u00dfe',rotate:'Drehen',flat:'Ablegen',paint:'Bemalen',volumes:'Modifier',layers:'Schicht',cut:'Schnitt',text:'Text',measure:'Messen',repair:'Reparatur',object:'Parameter',machine:'Drucker',view:'Ansicht'};
export function renderRail(active, open) {
  return TOOLS.map(([key,name,svg])=>`<button class="rail-icon ${open&&key===active?'active':''}" data-action="select-tool" data-tool="${key}" title="${esc(name)}" aria-label="${esc(name)}" aria-pressed="${open&&key===active}">${svg}<span class="rail-label">${esc(RAIL_LABELS[key]||name)}</span></button>`).join('');
}

export function renderQuickbar(active,open,preview,supportMode='none'){
  const byKey=new Map(TOOLS.map(([key,name,svg])=>[key,{name,svg}]));
  const tool=(key)=>{const item=byKey.get(key),disabled=preview&&!['section','view'].includes(key);return `<button class="quick-tool ${open&&active===key?'active':''}" data-action="select-tool" data-tool="${key}" title="${esc(item.name)}" aria-label="${esc(item.name)}" ${disabled?'disabled':''}>${item.svg}</button>`};
  const mirror=['X','Y','Z'].map((axis,i)=>`<button class="quick-axis" data-action="mirror-model" data-axis="${i}" title="An ${axis} spiegeln" ${preview?'disabled':''}>${axis}&#8596;</button>`).join('');
  return `<nav class="quickbar" aria-label="Schnellwerkzeuge">${['select','move','scale','rotate','flat'].map(tool).join('')}<span class="quick-sep"></span>${mirror}<span class="quick-sep"></span>${['paint','cut','section','supports'].map(tool).join('')}<button class="quick-support ${open&&active==='supports'&&supportMode==='add'?'active':''}" data-action="support-add" title="Gerade Stütze setzen" ${preview?'disabled':''}>+ Stütze</button><button class="quick-support ${open&&active==='supports'&&supportMode==='remove'?'active':''}" data-action="support-remove" title="Gerade Stütze entfernen" ${preview?'disabled':''}>− Stütze</button><span class="quick-sep"></span><button data-action="camera" data-view="bottom" title="Unterseite anzeigen">Unten</button><button data-action="camera" data-view="fit" title="Ansicht einpassen">Einpassen</button></nav>`;
}

function modelBadges(model, processes = []) {
  const marks = [];
  const own = processes.find(p => p.id === model.process);
  if (own) marks.push(own.name);
  if (Object.values(model.paint || {}).some(layer => Object.keys(layer).length)) marks.push('bemalt');
  const texts = (model.volumes || []).filter(v => v.shape === 'text').length;
  const bodies = (model.volumes?.length || 0) - texts;
  if (texts) marks.push('Text');
  if (bodies) marks.push(`${bodies} Körper`);
  if (model.original_path) marks.push('repariert');
  if (model.tool) marks.push(`T${model.tool - 1}`);
  if (model.ranges?.length) marks.push('var. Schicht');
  const straight=(model.straightSupports?.automatic?.length||0)+(model.straightSupports?.manual?.length||0);
  if(straight)marks.push(`${straight} Stützen`);
  if (Object.keys(model.settings || {}).length) marks.push('eigene Werte');
  return marks.join(', ');
}

export function renderSidebar({models, assignment = '', usage = new Map(), selected, meshErrors, processes, activeProcess, slicing, collapsed}) {
  const modelRows = models.map(model => {
    const problem = meshErrors.get(model.path) || (model.path ? '' : 'Datei neu importieren');
    return `<div class="list-row ${model.id === selected ? 'selected' : ''}" data-action="pick-model" data-id="${esc(model.id)}" title="${esc(problem || model.path)}">
      <input type="checkbox" data-model-enabled="${esc(model.id)}" ${model.enabled === false ? '' : 'checked'} title="Mitdrucken">
      <span class="truncate grow">${esc(model.name)}<small class="${problem ? 'bad' : ''}">${esc(problem || modelBadges(model, processes))}</small></span></div>`;
  }).join('');
  const processRows = processes.map(proc =>
    `<div class="list-row ${proc.id === activeProcess ? 'selected' : ''}" data-action="pick-process" data-edit="process" data-id="${esc(proc.id)}" title="Doppelklick: Einstellungen"><span class="truncate grow">${esc(proc.name)}</span>${usage.has(proc.id) ? `<small>${usage.get(proc.id)}</small>` : ''}</div>`).join('');

  return `<aside class="sidebar ${collapsed ? 'collapsed' : ''}">
    <div class="left-group">
      <div class="left-title">Modelle</div>
      <div class="left-items" data-keep-scroll="models">${modelRows || '<div class="mini-empty">Kein Modell geladen</div>'}</div>
      <div class="button-row"><button data-action="model-upload">Importieren</button><button data-action="delete-model">Entfernen</button></div>
      <button class="full" data-action="arrange-models">Zentrieren und anordnen</button>
      ${assignment}
    </div>
    <div class="left-group">
      <div class="left-title">Prozesse</div>
      <div class="left-items" data-keep-scroll="processes">${processRows}</div>
      <div class="button-row"><button data-action="add-process">Hinzufügen</button><button data-action="duplicate-process">Duplizieren</button><button data-action="delete-process">Löschen</button></div>
      <button class="full" data-action="open-process">Prozesseinstellungen bearbeiten</button>
    </div>
    <button class="slice ${slicing ? 'running' : ''}" data-action="${slicing ? 'cancel-slice' : 'slice-now'}">${slicing ? 'Slicing abbrechen' : 'Jetzt slicen'}</button>
  </aside>`;
}

const ROLE_NAMES = {
  'Perimeter': 'Innenwand', 'External perimeter': 'Außenwand', 'Overhang perimeter': 'Überhang',
  'Internal infill': 'Füllung', 'Solid infill': 'Massiv', 'Top solid infill': 'Oberseite',
  'Bridge infill': 'Brücke', 'Gap fill': 'Lücke', 'Ironing': 'Bügeln', 'Skirt/Brim': 'Skirt/Brim',
  'Support material': 'Stützen', 'Support material interface': 'Stützen-Kontakt', 'Wipe tower': 'Reinigungsturm',
  'Travel': 'Leerfahrt',
};

export const PREVIEW_METRICS = [
  ['type', 'Wegtyp', ''], ['speed', 'Geschwindigkeit', 'mm/s'], ['height', 'Schichthöhe', 'mm'], ['width', 'Bahnbreite', 'mm'],
  ['flow', 'Volumenfluss', 'mm³/s'], ['fan', 'Lüfter', '%'], ['temperature', 'Temperatur', '°C'], ['tool', 'Werkzeug', ''],
];

export function renderPreviewControls(preview, view, {path, stale}) {
  const layer = preview.layers[view.layer];
  const roles = [...preview.roles].sort();
  const check = (key, label) => `<label><input type="checkbox" data-preview="${key}" ${view[key] ? 'checked' : ''}> ${label}</label>`;
  const legend = view.metric === 'type'
    ? roles.map(role => `<span><i style="background:${ROLE_COLOURS[role] || '#c8c8c8'}"></i>${esc(ROLE_NAMES[role] || role)}</span>`).join('')
    : '<span class="preview-gradient-label"><span id="preview-range"></span><i class="preview-gradient" aria-label="Blau niedrig, Rot hoch"></i></span>'; 
  const moves = preview.moveCounts[view.layer];
  return `<div class="preview-controls">
    <div class="preview-row play-row">
      <button class="play" id="preview-play" data-action="preview-play" title="Druck abspielen">${view.playing ? '❚❚' : '▶'}</button>
      <select data-preview="rate" title="Abspieltempo">${[1, 4, 16, 64].map(r => option(r, `${r}×`, r === Number(view.rate || 4))).join('')}</select>
      <label>Bahn <b id="preview-move-label">${Math.min(moves, view.move ?? moves)} / ${moves}</b></label>
      <input id="preview-move" type="range" min="0" max="${moves}" value="${Math.min(moves, view.move ?? moves)}" data-preview="move">
    </div>
    <div class="preview-row">
      <label>Schicht <b id="preview-layer-label">${view.layer + 1} / ${preview.layers.length}</b> Z <span id="preview-layer-height">${layer.z === null ? '–' : layer.z.toFixed(2)}</span> mm</label>
      <input id="preview-layer" type="range" min="0" max="${preview.layers.length - 1}" value="${view.layer}" data-preview="layer">
      <label>Farbe <select data-preview="metric">${PREVIEW_METRICS.map(([k, l]) => [k, l]).map(([k, l]) => option(k, l, k === view.metric)).join('')}</select></label>
      <label>Weg <select data-preview="role">${option('all', 'Alle', view.role === 'all')}${roles.map(r => option(r, ROLE_NAMES[r] || r, r === view.role)).join('')}</select></label>
      ${check('single', 'Nur diese Schicht')}${check('travel', 'Leerfahrten')}
    </div>
    <div class="preview-row"><label>Ab Schicht <b id="preview-min-label">${(view.minLayer || 0)+1}</b></label><input id="preview-min-layer" type="range" min="0" max="${preview.layers.length - 1}" value="${view.minLayer || 0}" data-preview="minLayer" ${view.single?'disabled':''}></div>
    <div class="preview-row legend-row">${legend}<span class="preview-highlight">Aktuelle Schicht hell, darunterliegende abgedunkelt</span></div>
    <div class="preview-note ${stale ? 'stale' : ''}" title="${esc(path)}">${stale ? 'Veraltet, bitte neu slicen. ' : ''}${esc(path)}${view.metric==='flow'?' | Volumenfluss aus Sollgeschwindigkeit und Filamentdurchmesser berechnet; keine Messung.':''}${preview.arcs?' | Nicht erkannte Kreisboegen vereinfacht.':''}</div>
  </div>`;
}
