// Kompakter Prozessdialog: Kopf mit Profil und Auto-Konfiguration, Reiter,
// links Liste der Bereiche, rechts Gruppen mit einer Zeile je Wert.
import {LAYOUT, TABS, PLACE} from './settings-layout.js';
import {display, convert, LOCKED} from './engine-config.js';
import {toolSelect} from './feature-panels.js';
import {modernHeader, networkPage} from './profile-ui.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const option = (value, label, selected) =>
  `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

export const NOZZLE = {key: 'nozzle_diameter', box: 'nozzle', type: 'Float', unit: 'mm', min: 0.05, max: 5, tip: 'Durchmesser der Düse.'};

// Die Uebersetzung der Engine enthaelt einzelne lange oder englische Einheiten.
const UNITS = {'approximate seconds': 's', layers: 'Schichten', 'money/kg': '€/kg'};

export function sourceKind(source) {
  if (!source) return 'engine';
  if (source === 'Basisprofil') return 'profile';
  if (source.startsWith('Manuell')) return 'process';
  if (source === 'Drucker' || source === 'Filament') return 'library';
  return 'auto';
}

/** Aktueller Wert, dessen Herkunft und ein moeglicher Fehler. */
export function settingState(key, ctx) {
  const spec = key === NOZZLE.key ? NOZZLE : ctx.byKey.get(key);
  const assigned = Object.hasOwn(ctx.values, key);
  const inBase = ctx.base && Object.hasOwn(ctx.base, key);
  const raw = assigned ? ctx.values[key] : inBase ? ctx.base[key] : spec?.default;
  let error = '';
  if (assigned && spec && spec !== NOZZLE) {
    try {
      convert(raw, spec, ctx.base?.[key]);
    } catch (e) {
      error = e.message;
    }
  }
  return {spec, raw, assigned, error, inBase, source: assigned ? ctx.sources[key] : ''};
}

function control(key, spec, raw, label, wide, extra = '') {
  const common = `id="s-${esc(key)}" data-setting="${esc(key)}" aria-label="${esc(label)}" ${LOCKED[key] ? 'disabled' : ''}${extra}`;
  if (spec.type === 'Bool') {
    const first = Array.isArray(raw) ? raw[0] : raw;
    return `<input type="checkbox" ${common} data-type="bool" ${[true, 1, '1', 'true'].includes(first) ? 'checked' : ''}>`;
  }
  const value = display(raw, spec);
  if (spec.type === 'Enum') {
    const known = spec.options.some(o => o.value === value);
    return `<select ${common}>${known ? '' : option(value, `${value} (ungültig)`, true)}`
      + `${spec.options.map(o => option(o.value, o.label, o.value === value)).join('')}</select>`;
  }
  if (wide || spec.element === 'String') {
    const text = value.replace(/\\n/g, '\n');
    return `<textarea ${common} data-type="script" rows="${wide ? 7 : 3}" spellcheck="false">${esc(text)}</textarea>`;
  }
  if (key === 'filament_colour') {
    return `<input type="color" ${common} value="${/^#[0-9a-f]{6}$/i.test(value) ? value : '#f3a31a'}">`;
  }
  const numeric = /Int|Float|Percentage/.test(spec.type) || spec.element === 'Float';
  return `<input type="text" ${common} class="${numeric ? 'num' : 'txt'}" value="${esc(value)}" spellcheck="false">`;
}

function unitOf(spec, raw) {
  let unit = spec.unit || '';
  if (spec.type === 'FloatOrPercentage') unit = display(raw, spec).endsWith('%') ? '' : unit.split(' / ')[0];
  if (spec.type === 'Percentage') unit = '%';
  return UNITS[unit] || unit;
}

// Wie weit eine Prusa-Stuetzeinstellung fuer die eigenen Simpliy-Stuetzen gilt (Engine-Stuetzen nutzen alle).
const FULL = 'Gilt vollständig auch für die eigenen Simpliy-Stützen.';
const NATIVE = 'Gilt nur für native Prusa-Stützen (automatische Prusa-Stützen, Pfeiler-Ersatz). Die eigenen Simpliy-Stützformen ignorieren diesen Wert.';
export const SUPPORT_COMPAT = {
  ...Object.fromEntries(['support_material_contact_distance', 'support_material_bottom_contact_distance', 'support_material_xy_spacing',
    'support_material_interface_layers', 'support_material_interface_spacing', 'support_material_spacing', 'support_material_extruder',
    'support_material_interface_extruder', 'support_material_speed', 'support_material_interface_speed', 'support_material_extrusion_width']
    .map(k => [k, ['full', FULL]])),
  support_material_angle: ['partial', 'Teilweise: Die Kontaktbahnen der eigenen Stützen laufen quer zum Winkel, auf die nächste Achse (0°/90°) gerundet. Schmale Stellen bekommen Bahnen entlang ihrer langen Seite.'],
  support_material_interface_pattern: ['partial', 'Teilweise: „rectilinear“ und „grid“ werden umgesetzt, „concentric“ wird bei den eigenen Stützen als Linien gedruckt.'],
  support_material_interface_contact_loops: ['partial', 'Teilweise: Die eigenen Stützen bekommen einen Ring in Bahnbreite um die Kontaktstelle, keine echte Engine-Schleife.'],
  support_material_bottom_interface_layers: ['partial', 'Teilweise: Bei eigenen Stützfüßen auf dem Teil wird ab 1 Lage die unterste Fußschicht zu Kontaktbahnen (Abstand = Kontakt-Linienabstand), darüber bleibt der Fuß dicht. Bei 0 bleibt der Fuß ganz dicht. -1 = wie oben.'],
  ...Object.fromEntries(['support_material_style', 'support_material_threshold', 'support_material_buildplate_only', 'dont_support_bridges',
    'support_material_enforce_layers', 'support_material_pattern', 'support_material_first_layer_density', 'support_material_synchronize_layers',
    'support_material_with_sheath', 'support_material_closing_radius', 'support_material_first_layer_expansion', 'support_tree_angle',
    'support_tree_angle_slow', 'support_tree_tip_diameter', 'support_tree_branch_diameter', 'support_tree_branch_diameter_angle',
    'support_tree_branch_diameter_double_wall', 'support_tree_branch_distance', 'support_tree_top_rate'].map(k => [k, ['native', NATIVE]])),
};
const COMPAT_MARK = {full: '●', partial: '◐', native: 'P'};

/** Extruderliste: Materialwerte gelten je Werkzeug, Prozesswerte fuer alle Werkzeuge. */
function perSlot(spec, raw, ctx) {
  let shown = raw, extra = '', scope = '';
  if (ctx.slot != null && ctx.tools > 1) {
    if (spec.box === 'filament') {
      // Einzelwert = gleicher Wert fuer alle Werkzeuge; geaendert wird nur die Stelle des gewaehlten Extruders.
      raw = Array.isArray(raw) ? raw : typeof raw === 'string' && spec.type !== 'String' && raw.includes(';') ? raw.split(';').map(s => s.trim()) : [raw];
      shown = raw[Math.min(ctx.slot, raw.length - 1)];
      const all = Array.from({length: Math.max(raw.length, ctx.tools)}, (_, i) => display(raw[Math.min(i, raw.length - 1)], {...spec, box: ''}));
      extra = ` data-slot="${ctx.slot}" data-all="${esc(all.join('; '))}"`;
      scope = `Gilt nur für Extruder ${ctx.slot + 1}`;
    } else scope = 'Gilt für alle Extruder';
  }
  return {shown, extra, scope};
}

/** Aktiver Auto-Konfig-Offset: Offset und Ergebnis hinter dem Wert. */
function offsetNote(key, spec, shown, ctx) {
  const delta = ctx.offsetOf?.get(key);
  if (!delta || !ctx.shift) return '';
  const result = display(ctx.shift(shown, delta), {...spec, box: ''});
  return `<span class="offset-note" title="Auto-Konfig-Offset aktiv">${delta > 0 ? '+' : '−'}${Math.abs(delta)} → ${esc(result)}</span>`;
}

function row({key, label}, ctx, wide) {
  const {spec, raw, error, inBase, source} = settingState(key, ctx);
  if (!spec) return '';
  // Englisch: Beschriftung aus der installierten Engine statt der deutschen Simpliy-Bezeichnung.
  if (ctx.lang === 'en' && spec.label) label = spec.label;
  const {shown, extra, scope} = perSlot(spec, raw, ctx);
  const kind = sourceKind(source);
  const origin = source || (inBase ? 'Prusa-Basisprofil' : 'Standardwert der Engine');
  const compat = SUPPORT_COMPAT[key];
  const title = [spec.tip, compat?.[1], scope, `Schlüssel: ${key}`, `Quelle: ${origin}`, LOCKED[key], error && `Fehler: ${error}`]
    .filter(Boolean).join('\n');
  const reset = (ctx.resettable ? ctx.resettable.has(key) : Object.hasOwn(ctx.proc.overrides || {}, key))
    ? `<button class="undo" data-action="clear-override" data-key="${esc(key)}" title="Manuelle Änderung zurücknehmen">↶</button>`
    : '<i></i>';
  const classes = ['s-row', wide && 'wide', error && 'invalid', ctx.highlight === key && 'found'].filter(Boolean).join(' ');
  return `<div class="${classes}" data-row="${esc(key)}" title="${esc(title)}">`
    + `<i class="src ${kind}"></i><label for="s-${esc(key)}">${compat ? `<span class="compat c-${compat[0]}" title="${esc(compat[1])}">${COMPAT_MARK[compat[0]]}</span>` : ''}${esc(label)}</label>`
    + `<span class="s-value">${control(key, spec, shown, label, wide, extra)}<span class="unit">${esc(unitOf(spec, shown))}</span>${offsetNote(key, spec, shown, ctx)}</span>`
    + `${reset}</div>`;
}

function setpointTable(group, ctx) {
  const rows = group.rows.map(({key, label}, i) => {
    const {spec, raw: all, error} = settingState(key, ctx);
    const {shown: raw, extra} = perSlot(spec, all, ctx);
    return `<tr class="${error ? 'invalid' : ''}" data-row="${esc(key)}" title="${esc(`${spec.tip}\nSchlüssel: ${key}`)}">`
      + `<td>${i ? 'ab 2' : '1'}</td>`
      + `<td>${control(key, spec, raw, label, false, extra)}<span class="unit">°C</span>${offsetNote(key, spec, raw, ctx)}</td><td></td></tr>`;
  });
  const series = group.rows.some(r => r.key === 'bed_temperature') ? 'bed' : ctx.slot != null ? `t${ctx.slot}` : group.rows.some(r => r.key === 'temperature') ? 't0' : '';
  return `<table class="setpoints"><thead><tr>${group.table.map(h => `<th>${esc(h)}</th>`).join('')}<th></th></tr></thead>`
    + `<tbody>${rows.join('')}${series ? extraRows(series, ctx) : ''}</tbody></table>`
    + (series ? `<div class="row"><button data-action="temp-row-add" data-series="${series}">Hinzufügen</button></div>` : '');
}

/** Weitere Sollwerte ab Schicht 3 (Bauraum ab Schicht 2): setzt Simpliy nach dem Slicen ein. */
function extraRows(series, ctx) {
  const list = ctx.temps?.[series] || [];
  return list.map(([layer, temp], r) => `<tr class="extra"><td>ab <input class="num" data-temp-series="${series}" data-temp-row="${r}" data-temp-col="0" value="${esc(layer)}" aria-label="Schicht"></td>`
    + `<td><input class="num" data-temp-series="${series}" data-temp-row="${r}" data-temp-col="1" value="${esc(temp)}" aria-label="Temperatur"><span class="unit">°C</span></td>`
    + `<td><button class="undo" data-action="temp-row-remove" data-series="${series}" data-row="${r}" title="Sollwert entfernen">×</button></td></tr>`).join('');
}

/** Drehzahl je Schicht wie die Engine: aus, danach linear bis zur Schicht mit voller Drehzahl. */
export function fanSchedule(off, full, speed) {
  const ramp = full > off + 1;
  const last = ramp ? full : off + 1;
  const points = [];
  for (let layer = 1; layer <= Math.min(last, 12); layer++) {
    let percent = speed;
    if (layer <= off) percent = 0;
    else if (ramp && layer < full) percent = Math.round(speed * (layer - off) / (full - off));
    points.push({layer, percent});
  }
  return {points, last};
}

function fanTable(ctx) {
  const read = key => parseFloat(display(settingState(key, ctx).raw, ctx.byKey.get(key))) || 0;
  const {points, last} = fanSchedule(read('disable_fan_first_layers'), read('full_fan_speed_layer'), read('min_fan_speed'));
  const rows = points.map(({layer, percent}, i) =>
    `<tr><td>${layer}${i === points.length - 1 && layer === last ? ' und höher' : ''}</td><td>${percent}</td></tr>`);
  if (last > points.length) rows.push('<tr><td>…</td><td>…</td></tr>');
  return '<table class="setpoints derived" title="Ergibt sich aus den Feldern darüber und der Grunddrehzahl">'
    + '<thead><tr><th>Schichtnummer</th><th>Lüftergeschwindigkeit %</th></tr></thead>'
    + `<tbody>${rows.join('')}</tbody></table>`;
}

function groupBox(group, ctx) {
  const body = group.table
    ? setpointTable(group, ctx)
    : group.rows.map(r => row(r, ctx, !!group.wide)).join('') + (group.fanTable ? fanTable(ctx) : '');
  return `<section class="s-group ${group.wide ? 'span' : ''}"><h4>${esc(group.title)}</h4><div class="s-box">${body}</div></section>`;
}

/** Eigene und unbekannte Schluessel aus Importen bleiben sichtbar und entfernbar. */
function unknownGroup(ctx) {
  const keys = Object.keys(ctx.values).filter(key => !PLACE.has(key) && !key.startsWith('simpliy.')).sort();
  if (!keys.length) return '';
  const rows = keys.map(key => `<div class="s-row" data-row="${esc(key)}" title="${esc(`Quelle: ${ctx.sources[key] || ''}`)}">`
    + `<i class="src ${sourceKind(ctx.sources[key])}"></i><label for="s-${esc(key)}">${esc(key)}</label>`
    + `<span class="s-value"><input type="text" id="s-${esc(key)}" class="txt" data-setting="${esc(key)}" value="${esc(display(ctx.values[key]))}"></span><i></i></div>`);
  return '<section class="s-group"><h4>Nicht an die Engine übergeben</h4>'
    + `<div class="s-box">${rows.join('')}</div></section>`;
}

export function searchSettings(query, byKey) {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const [key, place] of PLACE) {
    const spec = key === NOZZLE.key ? NOZZLE : byKey.get(key);
    const strong = `${place.label} ${key}`.toLocaleLowerCase();
    const all = `${strong} ${place.group} ${place.tab} ${spec?.label || ''}`.toLocaleLowerCase();
    if (words.every(word => all.includes(word))) hits.push({key, ...place, rank: words.every(w => strong.includes(w)) ? 0 : 1});
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, 30);
}

export function renderSearchResults(query, byKey) {
  if (!query.trim()) return '';
  const hits = searchSettings(query, byKey);
  if (!hits.length) return '<div class="no-hit">Keine Einstellung gefunden</div>';
  return hits.map(hit => `<button data-action="goto-setting" data-key="${esc(hit.key)}">`
    + `<b>${esc(hit.label)}</b><span>${esc(`${hit.tab} › ${hit.page} › ${hit.group}`)}</span></button>`).join('');
}

function header(ctx) {
  const {proc, bundle, profiles, categories} = ctx;
  const changes = Object.keys(proc.overrides || {}).length;
  const autos = categories.map(({category, selected}) => `<div class="pd-auto">
      <label>Auto-Konfiguration für ${esc(category.name)}</label>
      <div class="pd-auto-box">
        <select data-field="auto-select" data-cat="${esc(category.id)}" aria-label="${esc(category.name)}">
          ${category.options.map(o => option(o.id, o.name, o.id === selected?.id)).join('')}
        </select>
        <button class="dots" data-action="edit-cat" data-id="${esc(category.id)}" title="Kategorie bearbeiten">…</button>
      </div>
    </div>`).join('');

  return `<div class="pd-line first">
      <label>Prozess Name</label>
      <input data-field="process-name" value="${esc(proc.name)}">
      <label>Einstellung finden</label>
      <div class="pd-search">
        <input type="search" id="setting-search" data-live="search" value="${esc(ctx.search)}" placeholder="Suche…" autocomplete="off">
        <div id="search-results">${renderSearchResults(ctx.search, ctx.byKey)}</div>
      </div>
    </div>
    <div class="pd-line">
      <label>Profil auswählen</label>
      <select data-field="process-profile">
        ${profiles.map(p => option(p.manifest.profile_id, p.profile.name, p.manifest.profile_id === bundle.manifest.profile_id)).join('')}
      </select>
      <button data-action="update-profile" ${changes ? '' : 'disabled'} title="Manuelle Änderungen in das Profil übernehmen">Profil aktualisieren${changes ? ` (${changes})` : ''}</button>
      <button data-action="save-as-profile">Als neu speichern…</button>
      <button class="dots" data-action="open-profile" title="Profile verwalten, importieren, exportieren">…</button>
    </div>
    <div class="pd-line">
      <label>Basisprofil</label>
      <span class="pd-base ${ctx.base ? '' : 'missing'}" title="${esc(ctx.baseName)}">${esc(ctx.baseName)}</span>
      ${ctx.tools > 1 ? `<label class="inline">Werkzeug</label>${toolSelect('class="tool-pick" data-process-tool', proc.tool, ctx.tools, 'Standard (T0)')}` : ''}
      <button data-action="open-prusa-presets">Drucker / Material wählen…</button>
    </div>
    <div class="pd-autos">${autos}<button class="dots add" data-action="add-category" title="Auto-Konfiguration hinzufügen">+</button></div>`;
}

/** links die Extruder des Druckers, rechts alle Werte des gewaehlten Extruders. */
function extruderPage(page, ctx) {
  const tools = Math.max(1, ctx.tools || 1), slot = Math.min(ctx.extruder || 0, tools - 1);
  const name = i => `Extruder ${i + 1} (T${i})`;
  const items = Array.from({length: tools}, (_, i) =>
    `<button role="option" aria-selected="${i === slot}" class="${i === slot ? 'active' : ''}" data-action="pick-extruder" data-index="${i}">${esc(name(i))}</button>`).join('');
  const sub = {...ctx, slot};
  return `<div class="pd-ext">
      <div class="pd-list">
        <div class="pd-list-title">Extruder Liste<small>(Klicken Sie auf einen Extruder, um seine Einstellungen zu bearbeiten)</small></div>
        <div class="pd-list-items">${items}</div>
        ${toolButtons(ctx, 'Extruder')}
      </div>
      <div class="pd-ext-main">
        <h3>${esc(name(slot))} Einstellungen</h3>
        <div class="pd-ext-tool">Werkzeugkopfnummer <b>T${slot}</b>${tools > 1 ? '<span class="meta">Werte mit Materialbezug gelten je Extruder, Einzug und Breiten für alle (Prusa-Engine).</span>' : ''}</div>
        <div class="pd-groups flow">${page.groups.map(g => groupBox(g, sub)).join('')}</div>
      </div>
    </div>`;
}

/** Knoepfe unter einer Extruder-/Reglerliste: Anzahl der Werkzeuge wechselt die Engine-Grundlage des Druckers. */
function toolButtons(ctx, what) {
  const tools = Math.max(1, ctx.tools || 1);
  return `<button data-action="extruder-add" title="Engine-Grundlage mit einem Werkzeug mehr wählen (Druckerwerte bleiben)">${what} hinzufügen</button>`
    + `<button data-action="extruder-remove" ${tools > 1 ? '' : 'disabled'} title="Engine-Grundlage mit einem Werkzeug weniger wählen">${what} entfernen</button>`;
}

/** Temperatur-Regler-Liste links (je Extruder, Druckbett, Bauraum), rechts dessen Werte. */
function controllerPage(layout, index, ctx) {
  const tools = Math.max(1, ctx.tools || 1), slot = Math.min(ctx.extruder || 0, tools - 1);
  const items = [
    ...Array.from({length: tools}, (_, i) => ({label: `Extruder ${i + 1} (T${i})`, page: 0, slot: i, type: 'Extruder', number: `T${i}`})),
    ...layout.pages.slice(1).map((p, k) => ({label: p.name, page: k + 1, type: p.name, number: p.name === 'Druckbett' ? 'Bett' : 'Bauraum'})),
  ];
  const active = items.find(it => it.page === index && (index > 0 || it.slot === slot)) || items[0];
  const list = items.map(it => `<button role="option" class="${it === active ? 'active' : ''}" ${it.page === 0
    ? `data-action="pick-extruder" data-index="${it.slot}"` : `data-action="settings-page" data-page="${it.page}"`}>${esc(it.label)}</button>`).join('');
  const sub = {...ctx, slot: active.page === 0 ? active.slot : null};
  return `<div class="pd-ext">
      <div class="pd-list">
        <div class="pd-list-title">Temperatur-Regler Liste<small>(Klicken Sie auf einen Regler, um seine Einstellungen zu bearbeiten)</small></div>
        <div class="pd-list-items">${list}</div>
        ${toolButtons(ctx, 'Temperatur-Regler (Extruder)')}
      </div>
      <div class="pd-ext-main">
        <h3>${esc(active.label)} Einstellungen</h3>
        <div class="pd-ext-tool">Temperaturnummer <b>${esc(active.number)}</b> &nbsp; Temperaturtyp <b>${esc(active.type)}</b></div>
        <div class="pd-groups flow">${layout.pages[active.page].groups.map(g => groupBox(g, sub)).join('')}</div>
        ${active.page > 0 && /Bauraum/.test(active.label) ? `<section class="s-group"><h4>Sollwerte pro Schicht</h4><div class="s-box"><table class="setpoints"><thead><tr><th>Schichtnummer</th><th>Temperatur</th><th></th></tr></thead>
          <tbody><tr><td>1</td><td class="meta">Bauraumtemperatur oben</td><td></td></tr>${extraRows('chamber', ctx)}</tbody></table>
          <div class="row"><button data-action="temp-row-add" data-series="chamber">Hinzufügen</button></div></div></section>` : ''}
        <p class="meta">Schicht 1 und „ab 2“ setzt die Engine. Weitere Zeilen setzt Simpliy beim Slicen an der jeweiligen Schicht (M104/M140/M141).</p>
      </div>
    </div>`;
}

/** Auto-Konfig-Offset: wenn Option X einer Auto-Konfiguration aktiv ist, Parameter Y um einen Wert verschieben. */
const NUMERIC = /Int|Float|Percentage/;
function offsetPage(ctx) {
  const cats = ctx.offsetCats || [];
  const params = [...PLACE].filter(([key]) => NUMERIC.test(ctx.byKey.get(key)?.type || '') || NUMERIC.test(ctx.byKey.get(key)?.element || '') || key === NOZZLE.key)
    .map(([key, p]) => ({key, text: `${ctx.byKey.get(key)?.label || p.label} – ${p.tab} › ${p.group} › ${p.label} (${key})`}));
  const rows = (ctx.offsets || []).map((o, i) => {
    const cat = cats.find(c => c.id === o.cat);
    const on = cat && ctx.proc?.[`${o.cat}_id`] === o.option;
    const items = o.items || [{key: o.key, delta: o.delta}];
    const lines = items.map((it, k) => {
      const param = params.find(p => p.key === it.key);
      const current = ctx.values[it.key];
      return `<tr class="${on ? 'active' : ''}"><td></td><td></td>
        <td><input type="search" list="offset-params" data-offset="${i}" data-offset-item="${k}" data-offset-field="key" value="${esc(param?.text || it.key || '')}" placeholder="Parameter suchen…"></td>
        <td><input class="num" data-offset="${i}" data-offset-item="${k}" data-offset-field="delta" value="${esc(it.delta ?? '')}" placeholder="+5"></td>
        <td class="meta">${on && current !== undefined && it.key && it.delta ? esc(`${display(current, ctx.byKey.get(it.key) || {})} ${it.delta > 0 ? '+' : '−'}${Math.abs(it.delta)} → ${display(ctx.shift ? ctx.shift(current, Number(it.delta)) : current, ctx.byKey.get(it.key) || {})}`) : ''}</td>
        <td><button class="undo" data-action="offset-item-remove" data-index="${i}" data-item="${k}" title="Parameter entfernen">×</button></td></tr>`;
    }).join('');
    return `<tr class="rule ${on ? 'active' : ''}">
      <td><select data-offset="${i}" data-offset-field="cat">${option('', '– wählen –', !o.cat)}${cats.map(c => option(c.id, c.name, c.id === o.cat)).join('')}</select></td>
      <td><select data-offset="${i}" data-offset-field="option">${option('', '– wählen –', !o.option)}${(cat?.options || []).map(x => option(x.id, x.name, x.id === o.option)).join('')}</select></td>
      <td><button data-action="offset-item-add" data-index="${i}">+ Parameter</button></td><td></td>
      <td class="meta">${on ? 'aktiv' : 'nicht aktiv'}</td>
      <td><button class="undo" data-action="offset-remove" data-index="${i}" title="Regel entfernen">×</button></td></tr>${lines}`;
  }).join('');
  return `<section class="s-group span"><h4>Auto-Konfig-Offset</h4><div class="s-box">
      <p class="meta">Ist die gewählte Option einer Auto-Konfiguration aktiv, wird der Parameter beim Slicen um den Offset verschoben (z. B. Schichthöhe 0,10 mm → Düsentemperatur +5). Der eingestellte Wert selbst bleibt unverändert. Mehrere Regeln addieren sich.</p>
      <table class="setpoints offsets"><thead><tr><th>Auto-Konfiguration</th><th>Wenn Option aktiv</th><th>Parameter</th><th>Offset</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <datalist id="offset-params">${params.map(p => `<option value="${esc(p.text)}"></option>`).join('')}</datalist>
      <div class="row"><button data-action="offset-add">Regel hinzufügen</button></div>
    </div></section>`;
}

/**
 * Luefter-Liste links. Der Bauteilluefter wird von der Engine gesteuert (alle Prusa-Kuehlwerte),
 * zusaetzliche Luefter (M106 P<n>) mit eigenen Sollwerten pro Schicht setzt Simpliy nach dem Slicen ein.
 */
function fanPage(layout, ctx) {
  const fans = ctx.fans || [];
  const pick = Math.min(ctx.fan ?? -1, fans.length - 1);
  const items = [`<button role="option" class="${pick < 0 ? 'active' : ''}" data-action="pick-fan" data-index="-1">Bauteillüfter (Engine)</button>`,
    ...fans.map((f, i) => `<button role="option" class="${pick === i ? 'active' : ''}" data-action="pick-fan" data-index="${i}">${esc(`Lüfter P${f.index}${f.name ? ` – ${f.name}` : ''}`)}</button>`)].join('');
  let body;
  if (pick < 0) {
    body = `<h3>Bauteillüfter Einstellungen</h3>
      <div class="pd-ext-tool"><span class="meta">Lüfter des aktiven Extruders (M106 ohne Nummer), gesteuert von der Slicing-Engine.</span></div>
      <div class="pd-groups flow">${layout.pages.flatMap(p => p.groups).map(g => groupBox(g, ctx)).join('')}</div>`;
  } else {
    const fan = fans[pick];
    const rows = fan.setpoints.map(([layer, speed], r) => `<tr><td><input class="num" data-fan-row="${r}" data-fan-col="0" value="${esc(layer)}" aria-label="Schicht"></td>`
      + `<td><input class="num" data-fan-row="${r}" data-fan-col="1" value="${esc(speed)}" aria-label="Drehzahl"><span class="unit">%</span></td>`
      + `<td><button class="undo" data-action="fan-row-remove" data-row="${r}" title="Sollwert entfernen">×</button></td></tr>`).join('');
    body = `<h3>${esc(`Lüfter P${fan.index}`)} Einstellungen</h3>
      <div class="pd-groups flow">
        <section class="s-group"><h4>Allgemein</h4><div class="s-box">
          <div class="s-row"><i></i><label>Bezeichnung</label><span class="s-value"><input class="txt" data-fan-field="name" value="${esc(fan.name)}"></span><i></i></div>
          <div class="s-row"><i></i><label>Lüfternummer (M106 P…)</label><span class="s-value"><input class="num" data-fan-field="index" value="${esc(fan.index)}"></span><i></i></div>
        </div></section>
        <section class="s-group"><h4>Sollwerte pro Schicht</h4><div class="s-box">
          <table class="setpoints"><thead><tr><th>Schichtnummer</th><th>Lüftergeschwindigkeit</th><th></th></tr></thead><tbody>${rows}</tbody></table>
          <div class="row"><button data-action="fan-row-add">Hinzufügen</button></div>
          <p class="meta">Ein Sollwert gilt ab seiner Schicht bis zum nächsten. Vor dem ersten Sollwert und am Druckende ist der Lüfter aus.</p>
        </div></section>
      </div>`;
  }
  return `<div class="pd-ext">
      <div class="pd-list">
        <div class="pd-list-title">Lüfter Liste<small>(Klicken Sie auf einen Lüfter, um seine Einstellungen zu bearbeiten)</small></div>
        <div class="pd-list-items">${items}</div>
        <button data-action="fan-add">Lüfter hinzufügen</button>
        <button data-action="fan-remove" ${pick < 0 ? 'disabled' : ''}>Lüfter entfernen</button>
      </div>
      <div class="pd-ext-main">${body}</div>
    </div>`;
}

/** je Ereignis ein Unterreiter mit grossem Editor. */
function scriptPage(layout, index, ctx) {
  const tabs = layout.pages.map((p, i) =>
    `<button role="tab" aria-selected="${i === index}" class="${i === index ? 'active' : ''}" data-action="settings-page" data-page="${i}">${esc(p.name)}</button>`).join('');
  const rows = layout.pages[index].groups.flatMap(g => g.rows);
  return `<div class="pd-scripts"><nav class="pd-subtabs" role="tablist">${tabs}</nav>
    <div class="pd-script-body">${rows.map(r => `<div class="pd-script"><h4>${esc(r.label)}</h4>${row(r, ctx, true)}</div>`).join('')}</div></div>`;
}

export function renderProcessDialog(ctx) {
  const layout = LAYOUT[ctx.tab];
  const index = Math.min(ctx.page, layout.pages.length - 1);
  const page = layout.pages[index];
  const broken = new Set(ctx.errors.map(e => PLACE.get(e.key)?.tab));

  const tabs = TABS.map(tab =>
    `<button role="tab" aria-selected="${tab === ctx.tab}" class="${tab === ctx.tab ? 'active' : ''} ${broken.has(tab) ? 'error' : ''}" data-action="tab" data-tab="${esc(tab)}">${esc(tab)}</button>`).join('');
  const pages = layout.pages.map((p, i) =>
    `<button role="option" aria-selected="${i === index}" class="${i === index ? 'active' : ''}" data-action="settings-page" data-page="${i}">${esc(p.name)}</button>`).join('');
  void pages; void page;
  const targets = [
    ['smart', 'Automatisch (aktuelle Quelle)'],
    ['base', 'Basiswerte des Profils'],
    ['process', 'Nur dieser Prozess'],
    ...ctx.categories.map(({category, selected}) => [`cat:${category.id}`, `${category.name} → ${selected?.name || 'keine Option'}`]),
  ];

  return `<div class="overlay process-overlay">
    <section class="process-dialog" role="dialog" aria-modal="true" aria-label="Prozesseinstellungen bearbeiten">
      <div class="pd-title">
        <span class="brand-mark"></span><h2>Prozesseinstellungen bearbeiten</h2>
        <button class="x" data-action="cancel-process" title="Abbrechen">×</button>
      </div>
      <div class="pd-head">${ctx.modern ? modernHeader({...ctx, searchResults: renderSearchResults(ctx.search, ctx.byKey)}) : header(ctx)}</div>
      <nav class="pd-tabs" role="tablist">${tabs}</nav>
      <div class="pd-main single">
        <div class="pd-content" data-keep-scroll="${esc(`settings:${ctx.tab}`)}">
          ${ctx.tab === 'Stützen' ? '<div class="compat-legend"><b>Gültigkeit für eigene Simpliy-Stützen:</b> <span class="compat c-full">●</span> vollständig <span class="compat c-partial">◐</span> teilweise (Maus über das Zeichen zeigt die Abweichung) <span class="compat c-native">P</span> nur native Prusa-Stützen</div>' : ''}
          ${layout.offsets ? offsetPage(ctx) : layout.fans ? fanPage(layout, ctx) : layout.controllers ? controllerPage(layout, index, ctx) : layout.pages[0]?.extruders ? extruderPage(layout.pages[0], ctx) : layout.scripts ? scriptPage(layout, index, ctx) : `<div class="pd-groups flow">${layout.pages.map(p => p.network ? networkPage(ctx.network)
            : p.slots ? `<section class="s-group span"><h4>${esc(p.name)}</h4><div class="s-box slot-box">${ctx.slots || ''}</div></section>`
            : p.groups.map(g => groupBox(g, ctx)).join('') + (ctx.tab === 'Fortgeschritten' && p.name === 'Freie Parameter' ? unknownGroup(ctx) : '')).join('')}</div>`}
        </div>
      </div>
      <div class="pd-foot">
        ${ctx.modern ? '<span class="meta">Änderungen gelten nur für diesen Prozess. Dauerhaft speichern über „Prozess speichern“.</span>'
          : `<label>Änderungen speichern in</label>
        <select data-field="setting-edit-target">${targets.map(([v, l]) => option(v, l, v === ctx.target)).join('')}</select>`}
        <span class="legend">
          <i class="src engine"></i>Prusa <i class="src library"></i>Drucker/Filament
          <i class="src profile"></i>Profil <i class="src auto"></i>Auto <i class="src process"></i>Manuell
        </span>
        <button data-action="process-models">Modelle auswaehlen...</button>
        <button disabled title="Hoehenbereiche werden noch nicht an die Engine uebergeben">Benutzerdefinierte Zonen (in Entwicklung)</button>
        <span class="pd-errors">${ctx.errors.length ? `${ctx.errors.length} ungültige Werte` : ''}</span>
        <button class="primary" data-action="accept-process">OK</button>
        <button data-action="cancel-process">Abbrechen</button>
      </div>
    </section>
  </div>`;
}

// Ein Modell hat derzeit genau einen Prozess. Keine stillschweigende Mehrfachzuweisung.
export function processModelDraft(models, processes, activeId) {
  const ids = new Set(processes.map(p => p.id));
  return Object.fromEntries(models.map(m => [m.id, ids.has(m.process) ? m.process : activeId]));
}
export function applyProcessModelDraft(models, processes, draft) {
  const ids = new Set(processes.map(p => p.id));
  for (const model of models) if (!ids.has(draft[model.id])) throw new Error('Jedem Modell muss ein vorhandener Prozess zugeordnet sein.');
  for (const model of models) model.process = draft[model.id];
}
