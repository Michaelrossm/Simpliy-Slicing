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

export function unitOf(spec, raw) {
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
  over_support_interface_speed: ['native', 'Neu in PrusaSlicer 3.0.0-alpha15: bremst Bahnen, die direkt auf einer Prusa-Stützkontaktschicht ohne Abstand (löslich) gedruckt werden. Die eigenen Simpliy-Stützen ignorieren diesen Wert.'],
  over_support_interface_acceleration: ['native', 'Neu in PrusaSlicer 3.0.0-alpha15: begrenzt die Beschleunigung über einer Prusa-Stützkontaktschicht ohne Abstand (löslich). Die eigenen Simpliy-Stützen ignorieren diesen Wert.'],
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

const sign = n => `${n > 0 ? '+' : '−'}${Math.abs(n)}`;

/** Offsets hinter dem Wert. Ohne Farbe: Auto-Konfig-Offset und Ergebnis. Mit Farb-Offset: Grundwert, Auto-Offset, Farb-Offset (in Filamentfarbe) und Endwert. */
export function offsetNote(key, spec, shown, ctx, always = false) {
  const delta = ctx.offsetOf?.get(key) || 0;
  const cdelta = ctx.colorOf?.get(key) || 0;
  if (!ctx.shift || (!delta && !cdelta && !always)) return '';
  const plain = v => display(v, {...spec, box: ''});
  if (!cdelta && !always) return `<span class="offset-note" title="Auto-Konfig-Offset aktiv">${sign(delta)} → ${esc(plain(ctx.shift(shown, delta)))}</span>`;
  const unit = unitOf(spec, shown);
  const result = ctx.shiftClamped(delta ? ctx.shift(shown, delta) : shown, cdelta, spec);
  return `<span class="offset-note calc" title="Grundwert + Auto-Konfig-Offset + Farb-Offset">${esc(plain(shown))}${unit ? ` ${esc(unit)}` : ''}`
    + `${delta ? ` ${sign(delta)}` : ''} <b class="color-offset" style="${esc(ctx.colorStyle?.(ctx.colorHex) || '')}">${sign(cdelta)}</b>`
    + ` = ${esc(plain(result))}${unit ? ` ${esc(unit)}` : ''}</span>`;
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
  const reset = ctx.favMode ? `<button class="undo" data-action="fav-remove" data-key="${esc(key)}" title="Aus den Favoriten entfernen">×</button>` : ((ctx.resettable ? ctx.resettable.has(key) : Object.hasOwn(ctx.proc.overrides || {}, key))
    ? `<button class="undo" data-action="clear-override" data-key="${esc(key)}" title="Manuelle Änderung zurücknehmen">↶</button>`
    : '<i></i>');
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

/** Favoriten: Suche ueber alle Einstellungen, Klick fuegt hinzu. */
export function renderFavResults(query, byKey, favs = []) {
  if (!query.trim()) return '';
  const hits = searchSettings(query, byKey);
  if (!hits.length) return '<div class="no-hit">Keine Einstellung gefunden</div>';
  return hits.map(hit => `<button data-action="fav-add" data-key="${esc(hit.key)}" ${favs.includes(hit.key) ? 'disabled' : ''}>`
    + `<b>${esc(hit.label)}</b><span>${esc(`${hit.tab} › ${hit.page} › ${hit.group}`)}${favs.includes(hit.key) ? ' · bereits Favorit' : ''}</span></button>`).join('');
}

function favoritesPage(ctx) {
  const favs = (ctx.favs || []).filter(key => PLACE.has(key));
  const rows = favs.map(key => row({key, label: PLACE.get(key).label}, {...ctx, favMode: true}, false)).join('');
  return `<section class="s-group span fav-page"><h4>Favoriten</h4><div class="s-box">
      <div class="fav-search"><input type="search" id="fav-search" data-live="fav-search" value="${esc(ctx.favSearch || '')}" placeholder="Einstellung suchen und anklicken, um sie hinzuzufügen…" autocomplete="off">
        <div id="fav-results" class="fav-results">${renderFavResults(ctx.favSearch || '', ctx.byKey, favs)}</div></div>
      ${rows || '<p class="meta">Noch keine Favoriten. Oben eine Einstellung suchen und anklicken.</p>'}
    </div></section>`;
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

/** Auto-Konfig-Offset: je Auto-Konfiguration ein Unterreiter, darin die Regeln der betrachteten Option. */
const NUMERIC = /Int|Float|Percentage/;
const DEFAULT_ITEMS = [
  {key: 'first_layer_temperature', label: 'Düsentemperatur – erste Schicht'},
  {key: 'temperature', label: 'Düsentemperatur – ab Schicht 2'},
];
const fmtDelta = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${String(Math.abs(n)).replace('.', ',')}`;

function offsetPage(ctx) {
  const cats = ctx.offsetCats || [];
  const view = ctx.offsetView || {};
  const cat = cats.find(x => x.id === view.cat);
  if (!cat) return '<section class="s-group span"><h4>Auto-Konfig-Offset</h4><div class="s-box"><p class="meta">Es gibt noch keine Auto-Konfiguration.</p></div></section>';
  const tabs = cats.map(x => `<button role="tab" aria-selected="${x.id === cat.id}" class="${x.id === cat.id ? 'active' : ''}" data-action="offset-cat" data-cat="${esc(x.id)}">${esc(x.name)}</button>`).join('');
  const optionId = view.option;
  const active = ctx.proc?.[`${cat.id}_id`];
  // Angezeigte Parameter einer Option: vorhandene Regeln plus (bei Schichthoehen) die Standardtemperaturen.
  const shownFor = optId => {
    const rs = (ctx.offsets || []).filter(o => o.cat === cat.id && o.option === optId);
    const its = rs.flatMap(o => (o.items || [{key: o.key, delta: o.delta}]).map(it => ({...it})));
    const virt = cat.id === 'quality' ? DEFAULT_ITEMS.filter(d => !its.some(it => it.key === d.key))
      .map(d => ({key: d.key, delta: ctx.offsetDefault ? ctx.offsetDefault(cat.id, optId, d.key) : 0, enabled: false, virtual: true})) : [];
    const all = [...virt, ...its].filter(it => it.key);
    all.sort((x, y) => (DEFAULT_ITEMS.findIndex(d => d.key === x.key) + 99) % 99 - (DEFAULT_ITEMS.findIndex(d => d.key === y.key) + 99) % 99);
    return {rules: rs, shown: all, master: !rs.some(o => o.enabled === false)};
  };
  const {rules, shown, master} = shownFor(optionId);
  const everything = (cat.options || []).map(x => shownFor(x.id));
  const stateOf = list => (list.every(Boolean) ? 'all' : list.some(Boolean) ? 'some' : 'none');
  const catState = stateOf(everything.flatMap(e => e.shown.map(it => e.master && it.enabled !== false)));
  const optState = stateOf(shown.map(it => master && it.enabled !== false));
  void rules;
  const optionActive = optionId === active;

  const line = it => {
    const spec = ctx.byKey.get(it.key) || {};
    const label = DEFAULT_ITEMS.find(d => d.key === it.key)?.label || PLACE.get(it.key)?.label || spec.label || it.key;
    const on = it.enabled !== false && master;
    const raw = ctx.values[it.key];
    const base = Array.isArray(raw) ? raw[0] : raw;
    const unit = spec.unit ? (UNITS[spec.unit] || spec.unit) : '';
    let preview = '';
    if (base !== undefined && ctx.shift) {
      const delta = Number(it.delta) || 0;
      const color = ctx.colorOf?.get(it.key) || 0;
      const text = v => `${display(v, {...spec, box: ''})}${unit ? ` ${unit}` : ''}`;
      if (optionActive) {
        const raw2 = ctx.shift(base, ctx.offsetOf?.get(it.key) || 0);
        const result = ctx.shiftClamped(raw2, color, spec);
        const unclamped = ctx.shift(raw2, color);
        preview = `${esc(text(base))}${(ctx.offsetOf?.get(it.key)) ? ` <span>${fmtDelta(ctx.offsetOf.get(it.key))}</span>` : ''}${color ? ` <b class="color-offset" style="${esc(ctx.colorStyle?.(ctx.colorHex) || '')}">${fmtDelta(color)}</b>` : ''} = <b>${esc(text(result))}</b>`
          + (String(display(unclamped, {...spec, box: ''})) !== String(display(result, {...spec, box: ''})) ? ' <em class="limit">(auf gültigen Bereich begrenzt)</em>' : '')
          + (!on && delta ? ' <em>(Offset aus)</em>' : '');
      } else {
        const result = ctx.shiftClamped(base, delta, spec);
        preview = `${esc(text(base))} ${fmtDelta(delta)} = ${esc(text(result))} <em>(wenn die Option aktiv ist)</em>`;
      }
    }
    return `<tr class="${on ? 'on' : 'off'}" data-row="${esc(it.key)}">
      <td><input type="checkbox" data-offset-on="${esc(it.key)}" ${it.enabled !== false ? 'checked' : ''} ${master ? '' : 'disabled'} aria-label="${esc(label)} anwenden"></td>
      <td><label>${esc(label)}</label><div class="meta">${esc(it.key)}</div></td>
      <td><input class="num" data-offset-delta="${esc(it.key)}" value="${esc(it.delta ? fmtDelta(Number(it.delta)) : '0')}" ${master ? '' : 'disabled'} aria-label="${esc(label)} Offset"><span class="unit">${esc(unit)}</span></td>
      <td class="meta calc">${preview}</td>
      <td>${it.virtual || DEFAULT_ITEMS.some(d => d.key === it.key) ? '' : `<button class="undo" data-action="offset-item-remove" data-key="${esc(it.key)}" title="Parameter entfernen">×</button>`}</td></tr>`;
  };
  const params = [...PLACE].filter(([key]) => NUMERIC.test(ctx.byKey.get(key)?.type || '') || NUMERIC.test(ctx.byKey.get(key)?.element || '') || key === NOZZLE.key)
    .filter(([key]) => !shown.some(it => it.key === key))
    .map(([key, p]) => `${ctx.byKey.get(key)?.label || p.label} – ${p.tab} › ${p.group} › ${p.label} (${key})`);

  return `<section class="s-group span offset-editor"><h4>Auto-Konfig-Offset</h4><div class="s-box">
      <nav class="pd-subtabs" role="tablist">${tabs}</nav>
      <div class="offset-head">
        <label class="check all"><input type="checkbox" data-offset-all-cat ${catState === 'all' ? 'checked' : ''} data-state="${catState}"> Alle Offsets aller Optionen dieser Auto-Konfiguration</label>
      </div>
      <div class="offset-head">
        <label>Option</label>
        <select data-field="offset-option">${(cat.options || []).map(x => option(x.id, `${x.id === active ? '● ' : ''}${x.name}${x.id === active ? ' (aktiv im Prozess)' : ''}`, x.id === optionId)).join('')}</select>
        <label class="check"><input type="checkbox" data-offset-master ${master ? 'checked' : ''}> Offsets für diese Option verwenden</label>
        <span class="meta">${optionActive ? 'Diese Option ist im Prozess aktiv.' : 'Nicht aktiv im Prozess – Bearbeiten ist trotzdem möglich.'}</span>
      </div>
      <table class="setpoints offsets"><thead><tr><th><input type="checkbox" data-offset-all-option ${optState === 'all' ? 'checked' : ''} data-state="${optState}" title="Alle Parameter dieser Option" aria-label="Alle Parameter dieser Option"></th><th>Parameter</th><th>Offset</th><th>Vorschau (Grundwert + Offsets = Ergebnis)</th><th></th></tr></thead><tbody>${shown.map(line).join('')}</tbody></table>
      <datalist id="offset-params">${params.map(p => `<option value="${esc(p)}"></option>`).join('')}</datalist>
      <div class="row"><input type="search" list="offset-params" data-field="offset-add-param" placeholder="+ Parameter hinzufügen (suchen)…" autocomplete="off">
        ${cat.id === 'quality' ? '<button data-action="offset-suggest" title="Optionaler Vorschlag aus Durchfluss und Materialgrenze, in ganzen Grad. Wird erst nach Bestätigung übernommen.">Temperatur-Offsets vorschlagen</button>' : ''}
</div>
      <p class="meta">Ergebnis = Grundwert + Auto-Konfig-Offset + Farb-Offset. Mehrere aktive Offsets addieren sich. Deaktivierte Offsets zählen als 0, ihre Werte bleiben gespeichert. Der eingestellte Grundwert bleibt unverändert.</p>
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
  const broken = new Set(ctx.errors.map(e => PLACE.get(e.key)?.tab));

  const tabs = TABS.map(tab =>
    `<button role="tab" aria-selected="${tab === ctx.tab}" class="${tab === ctx.tab ? 'active' : ''} ${broken.has(tab) ? 'error' : ''}" data-action="tab" data-tab="${esc(tab)}">${esc(tab)}</button>`).join('');
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
          ${layout.favorites ? favoritesPage(ctx) : layout.offsets ? offsetPage(ctx) : layout.fans ? fanPage(layout, ctx) : layout.controllers ? controllerPage(layout, index, ctx) : layout.pages[0]?.extruders ? extruderPage(layout.pages[0], ctx) : layout.scripts ? scriptPage(layout, index, ctx) : `<div class="pd-groups flow">${layout.pages.map(p => p.network ? networkPage(ctx.network)
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
        <button data-action="open-zones" title="Nur einen Z-Bereich mit diesem Prozess drucken">Benutzerdefinierte Zonen${ctx.zoneOn ? ' •' : ''}…</button>
        ${ctx.errors.length ? `<button class="pd-errors" data-action="goto-error" data-keys="${esc(ctx.errors.map(e => e.key).join(','))}"
          title="${esc(ctx.errors.map(e => `${ctx.byKey?.get(e.key)?.label || e.key}: ${e.message || ''}`).join(String.fromCharCode(10)))}">⚠ ${ctx.errors.length === 1
            ? `1 ungültiger Wert: ${esc(ctx.byKey?.get(ctx.errors[0].key)?.label || ctx.errors[0].key)}` : `${ctx.errors.length} ungültige Werte`} – anzeigen</button>` : ''}
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
