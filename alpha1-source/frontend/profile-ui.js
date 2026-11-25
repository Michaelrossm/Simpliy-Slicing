// Oberflaeche der Profilverwaltung: Prozesskopf, Netzwerk, Drucker und Materialbibliothek.
import {display} from './engine-config.js';
import {materialsFor, AUTO, autoCategories} from './profiles.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;
export const HOSTS = [['prusalink', 'PrusaLink'], ['octoprint', 'OctoPrint'], ['duet', 'Duet / RepRapFirmware'], ['moonraker', 'Klipper (Moonraker)']];

/** Kopf des Prozessdialogs. */
export function modernHeader(ctx) {
  const {proc, printers, printer, materials, presets, library, dirty} = ctx;
  const select = (field, list, current, empty, extra = '') => `<select data-field="${field}" ${extra}>`
    + `${current ? '' : option('', empty, true)}${list.map(x => option(x.id, x.name, x.id === current)).join('')}</select>`;
  const categories = ctx.autoCats || [];
  const name = cat => categories.find(c => c.id === cat)?.name || AUTO[cat] || cat;
  const menu = (cat, list, current) => {
    const chosen = list.find(x => x.id === current);
    const item = (action, text, off = false) => `<button data-action="${action}" data-cat="${cat}" ${off ? 'disabled' : ''}>${esc(text)}</button>`;
    return `<div class="auto-menu" role="menu">
      ${item('auto-new', `Neue ${name(cat)}-Option aus diesem Prozess…`)}
      ${item('auto-up', 'Option nach oben', !chosen)}${item('auto-down', 'Option nach unten', !chosen)}
      ${item('auto-rename', chosen ? `„${chosen.name}“ umbenennen…` : 'Option umbenennen…', !chosen)}
      ${item('auto-delete', chosen ? `„${chosen.name}“ löschen` : 'Option löschen', !chosen)}
      <hr>${item('auto-assign', 'Einstellungen zuweisen…')}${item('auto-label', `Kategorie „${name(cat)}“ umbenennen…`)}${item('auto-delete-category', `Kategorie „${name(cat)}“ löschen`)}
      ${cat === 'material' ? `<hr>${item('open-filaments', 'Materialbibliothek…')}` : cat === 'quality' ? `<hr>${item('open-printers', 'Qualitäten des Druckers verwalten…')}` : ''}
    </div>`;
  };
  const auto = (cat, field, list, current, store, title, extra = '') => `<div class="pd-auto">
      <label>Auto-Konfiguration für ${esc(name(cat))}</label>
      <div class="pd-auto-box">${select(field, list, current, '– keine –', extra)}
        <button class="dots" data-action="${store}" ${extra} title="${esc(title)}">💾</button>
        <button class="dots" data-action="auto-menu" data-cat="${cat}" title="Optionen bearbeiten, Einstellungen zuweisen">…</button>
        ${ctx.autoMenu === cat ? menu(cat, list, current) : ''}</div></div>`;
  return `<div class="pd-line first">
      <label>Prozess Name</label>
      <input data-field="process-name" value="${esc(proc.name)}">
      <label>Einstellung finden</label>
      <div class="pd-search">
        <input type="search" id="setting-search" data-live="search" value="${esc(ctx.search)}" placeholder="Suche…" autocomplete="off">
        <div id="search-results">${ctx.searchResults}</div>
      </div>
    </div>
    <div class="pd-line">
      <label>Drucker</label>
      <span class="pd-auto-box flat">${select('proc-printer', printers, printer?.id, 'Drucker wählen')}<button class="dots" data-action="open-printers" title="Drucker verwalten: Druckereinstellungen, Qualitäten, Materialfreigaben, Import">…</button></span>
      <button data-action="import-prusa" title="PrusaSlicer-3.0-Konfiguration (.json, .3mf), 3.0-Preset (.yaml) oder Profil (.ini) in diesen Prozess laden. Nichts wird automatisch gespeichert.">Profil importieren…</button>
      <select data-field="library-load" title="Gespeicherten Prozess in diesen Prozess laden">
        ${option('', library.length ? 'Prozess laden…' : 'Keine gespeicherten Prozesse', true)}${library.map(e => option(e.id, e.name, false)).join('')}
      </select>
      <button data-action="save-process" title="Den gespeicherten Prozess mit diesen Werten überschreiben">Prozess speichern${dirty ? ' •' : ''}</button>
      <button data-action="save-process-as">Als neuen Prozess speichern…</button>
    </div>
    <div class="pd-autos">
      ${categories.map(({id}) => id === 'material'
        ? auto('material', 'proc-material', materialsFor(printer, materials), proc.material_id, 'store-material', 'Zugewiesene Werte dieses Prozesses in das gewählte Material speichern')
        : id === 'quality'
          ? auto('quality', 'proc-quality', printer?.qualities || [], proc.quality_id, 'store-quality', 'Zugewiesene Werte dieses Prozesses in die gewählte Qualität speichern')
          : auto(id, 'proc-preset', presets.filter(p => p.kind === id), proc[`${id}_id`], 'store-preset',
            'Zugewiesene Werte dieses Prozesses in die gewählte Option speichern', `data-kind="${id}"`)).join('')}
      <button class="dots add" data-action="auto-add-category" title="Neue Auto-Konfiguration hinzufügen">+</button>
    </div>`;
}

/** Reiter Drucker, Seite Netzwerk: Verbindung des Druckers dieses Prozesses. */
export function networkPage({printer, secret, message}) {
  if (!printer) return '<p class="hint">Kein Drucker gewählt.</p>';
  return `<section class="s-group span"><h4>Netzwerkdrucker: ${esc(printer.name)}</h4><div class="s-box">
      <div class="s-row"><i></i><label>Verbindung</label><span class="s-value"><select data-printer-net="host_type">
        ${HOSTS.map(([v, l]) => option(v, l, (printer.host_type || 'prusalink') === v)).join('')}</select></span><i></i></div>
      <div class="s-row"><i></i><label>IP-Adresse oder URL</label><span class="s-value"><input type="text" class="txt" data-printer-net="web_url" value="${esc(printer.web_url || '')}" placeholder="z. B. 192.168.1.42" spellcheck="false"></span><i></i></div>
      <div class="s-row"><i></i><label>API-Schlüssel / Passwort</label><span class="s-value"><input type="password" class="txt" data-printer-net="secret" value="${esc(secret)}" autocomplete="off" title="Wird nur bis zum Programmende im Speicher gehalten, nicht gespeichert"></span><i></i></div>
      <div class="s-row"><i></i><label></label><span class="s-value"><button data-action="printer-net-test">Verbindung testen</button> <button data-action="open-printer-web">Weboberfläche öffnen</button></span><i></i></div>
      ${message ? `<p class="${message.error ? 'error' : 'hint'}" id="net-message">${esc(message.text)}</p>` : ''}
      <p class="hint">Gilt für den Drucker, nicht nur für diesen Prozess. „Zum Drucker senden“ verwendet diese Verbindung.</p>
    </div></section>`;
}

/** Werte einer Box als Liste, gruppiert wie der Engine-Katalog. */
function editor(values, byKey, keys, attr) {
  const groups = new Map();
  for (const key of keys) {
    const spec = key === 'nozzle_diameter' ? {label: 'Düsendurchmesser', group: 'Extruder', type: 'Float', unit: 'mm'} : byKey.get(key);
    if (!spec) continue;
    const group = spec.group || 'Weitere';
    if (!groups.has(group)) groups.set(group, []);
    const value = values[key];
    const text = value === undefined ? '' : typeof value === 'object' ? display(value, spec) : String(value);
    const input = spec.multiline || /gcode$/.test(key)
      ? `<textarea data-${attr}="${esc(key)}" rows="3" spellcheck="false">${esc(text.replace(/\\n/g, '\n'))}</textarea>`
      : spec.type === 'Enum' && spec.options?.length
        ? `<select data-${attr}="${esc(key)}">${spec.options.some(o => o.value === text) ? '' : option(text, `${text} (ungültig)`, true)}${spec.options.map(o => option(o.value, o.label, o.value === text)).join('')}</select>`
      : spec.type === 'Bool'
        ? `<input type="checkbox" data-${attr}="${esc(key)}" data-type="bool" ${[true, 1, '1', 'true'].includes(Array.isArray(value) ? value[0] : value) ? 'checked' : ''}>`
        : `<input type="text" class="txt" data-${attr}="${esc(key)}" value="${esc(text)}" spellcheck="false">`;
    groups.get(group).push(`<div class="s-row" title="${esc(`${spec.tip || ''}\nSchlüssel: ${key}`)}"><i></i><label>${esc(spec.label || key)}</label>`
      + `<span class="s-value">${input}<span class="unit">${esc(spec.unit || '')}</span></span><i></i></div>`);
  }
  return [...groups].map(([title, rows]) => `<section class="s-group"><h4>${esc(title)}</h4><div class="s-box">${rows.join('')}</div></section>`).join('');
}

export function renderPrinterManager({printers, printer, materials, byKey, filter, tools = 1}) {
  const keys = Object.keys(printer?.settings || {}).filter(k => !filter || `${k} ${byKey.get(k)?.label || ''}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) =>
    String(byKey.get(a)?.group).localeCompare(String(byKey.get(b)?.group)) || (byKey.get(a)?.order ?? 0) - (byKey.get(b)?.order ?? 0));
  const list = printers.map(p => `<button class="edit-entry ${p.id === printer?.id ? 'active' : ''}" data-action="choose-printer" data-id="${esc(p.id)}">${esc(p.name)}<div class="meta">${esc(p.manufacturer || p.model || '')}</div></button>`).join('');
  const qualities = (printer?.qualities || []).map(q => `<div class="row"><input data-quality-name="${esc(q.id)}" value="${esc(q.name)}">`
    + `<span class="meta">${Object.keys(q.values).length} Werte</span><button data-action="quality-default" data-id="${esc(q.id)}" ${printer.default_quality === q.id ? 'disabled' : ''}>Standard</button>`
    + `<button class="danger" data-action="quality-remove" data-id="${esc(q.id)}">Löschen</button></div>`).join('');
  const allowed = new Set(printer?.materials || []);
  const mats = materials.map(m => `<label class="check"><input type="checkbox" data-printer-material="${esc(m.id)}" ${allowed.has(m.id) ? 'checked' : ''}> ${esc(m.name)}</label>`).join('');
  return `<div class="printer-grid">
    <div class="printer-list"><h3 class="section-title">Meine Drucker</h3>${list}
      <div class="editor-tools"><button data-action="new-printer">+ Drucker</button><button data-action="clone-printer">Duplizieren</button>
      <button class="danger" data-action="remove-printer">Löschen</button><button data-action="import-printer">Prusa-Drucker importieren…</button></div></div>
    <div class="editor-col">${printer ? `
      <div class="form-grid">
        <div class="form-field"><label>Druckername</label><input data-printer-field="name" value="${esc(printer.name)}"></div>
        <div class="form-field"><label>Druckermodell</label><input data-printer-field="model" value="${esc(printer.model || '')}"></div>
        <div class="form-field"><label>Hersteller</label><input data-printer-field="manufacturer" value="${esc(printer.manufacturer || '')}"></div>
        <div class="form-field"><label>Anzahl Werkzeuge (Extruder)</label>
          <select data-printer-engine>${[1, 2, 3, 4, 5, 6, 7, 8].map(n => option(n, `${n} Werkzeug${n > 1 ? 'e' : ''}`, n === tools)).join('')}</select>
          <span class="meta">Kein Druckermodell als Grundlage: Die Engine bekommt nur eine neutrale Konfiguration, alle Werte kommen aus Simpliy.</span></div>
      </div>
      <h4>Freigegebene Materialien <span class="meta">(keine Auswahl = alle)</span></h4><div class="check-grid">${mats}</div>
      <div class="form-field"><label>Standardmaterial</label><select data-printer-field="default_material">${option('', '– keines –', !printer.default_material)}${materials.map(m => option(m.id, m.name, m.id === printer.default_material)).join('')}</select></div>
      <div class="note-banner">Alle Druckwerte (auch Bauraum, Skripte und Maschinengrenzen) werden im Prozess eingestellt.</div>` : ''}
    </div></div>`;
}

export function renderMaterialLibrary({materials, material, byKey, filter}) {
  const keys = Object.keys(material?.settings || {}).filter(k => !filter || `${k} ${byKey.get(k)?.label || ''}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) =>
    String(byKey.get(a)?.group).localeCompare(String(byKey.get(b)?.group)) || (byKey.get(a)?.order ?? 0) - (byKey.get(b)?.order ?? 0));
  const list = materials.map(m => `<button class="edit-entry ${m.id === material?.id ? 'active' : ''}" data-action="choose-filament" data-id="${esc(m.id)}">`
    + `<span class="swatch" style="background:${esc(/^#[0-9a-f]{6}$/i.test(m.colour || '') ? m.colour : 'transparent')}"></span>${esc(m.name)}<div class="meta">${esc([m.manufacturer, m.type].filter(Boolean).join(' · '))}</div></button>`).join('');
  return `<div class="printer-grid">
    <div class="printer-list"><h3 class="section-title">Materialbibliothek</h3>${list}
      <div class="editor-tools"><button data-action="new-filament">+ Material</button><button data-action="clone-filament">Duplizieren</button>
      <button class="danger" data-action="remove-filament">Löschen</button><button data-action="import-material">Importieren…</button><button data-action="export-material">Exportieren</button></div></div>
    <div class="editor-col">${material ? `
      <div class="form-grid">
        <div class="form-field"><label>Materialname</label><input data-filament-field="name" value="${esc(material.name)}"></div>
        <div class="form-field"><label>Hersteller</label><input data-filament-field="manufacturer" value="${esc(material.manufacturer || '')}"></div>
        <div class="form-field"><label>Materialtyp</label><input data-filament-field="type" value="${esc(material.type || '')}"></div>
        <div class="form-field"><label>Farbe</label><input type="color" data-filament-field="colour" value="${esc(/^#[0-9a-f]{6}$/i.test(material.colour || '') ? material.colour : '#ffffff')}"></div>
      </div>
      <h4>Materialeinstellungen (${keys.length})</h4>
      <input type="search" data-live="material-filter" placeholder="Einstellung filtern…" value="${esc(filter || '')}">
      <div class="pd-groups">${editor(material.settings, byKey, keys, 'material-setting')}</div>
      <div class="note-banner">Die Bibliothek ist die Vorlage. Prozesse erhalten beim Auswählen eine eigene Kopie, gespeicherte Prozesse ändern sich hier nicht.</div>` : ''}
    </div></div>`;
}

/** Einstellungen zuweisen: welche Auto-Konfiguration steuert welche Einstellung. */
export function renderAssign({rows, draft, filter, categories = []}) {
  const words = (filter || '').toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(r => words.every(w => `${r.label} ${r.key} ${r.tab}`.toLowerCase().includes(w)));
  const choices = [['', 'Keiner'], ...categories.map(c => [c.id, c.name])];
  const body = shown.map(r => `<tr><td>${esc(r.label)}<small>${esc(r.tab)} · ${esc(r.key)}</small></td>
    <td><select data-assign-key="${esc(r.key)}">${choices.map(([v, l]) => option(v, l, (draft[r.key] || '') === v)).join('')}</select></td></tr>`).join('');
  const counts = categories.map(c => `${c.name}: ${rows.filter(r => draft[r.key] === c.id).length}`).join(' · ');
  return `<p>Wählen Sie für jede Einstellung, welche Auto-Konfiguration sie steuern soll. „Keiner“, wenn die Einstellung nur im Prozess gilt.
      Auswählen einer Option setzt genau die zugewiesenen Einstellungen, 💾 speichert genau diese.</p>
    <div class="row"><label>Filtereinstellungen</label><input type="search" data-live="assign-filter" value="${esc(filter || '')}" placeholder="Filter…" autocomplete="off" style="flex:1"></div>
    <p class="meta">${esc(counts)} · ${shown.length} von ${rows.length} angezeigt</p>
    <div class="assign-list"><table><thead><tr><th>Einstellung</th><th style="width:210px">Auto-Konfigurationskategorie</th></tr></thead><tbody>${body}</tbody></table></div>`;
}
