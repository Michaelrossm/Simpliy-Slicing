// Fenster „Auto-Konfig Farbe“: gleiche Fensteroptik wie die Prozessbearbeitung, aber nur die Farb-Offsets des Materials.
import {esc, settingState, offsetNote, unitOf} from './process-dialog.js';
import {COLOR_KEYS} from './profiles.js';

const LABELS = {
  temperature: 'Düsentemperatur', first_layer_temperature: 'Düsentemperatur erste Schicht',
  bed_temperature: 'Betttemperatur', first_layer_bed_temperature: 'Betttemperatur erste Schicht',
  extrusion_multiplier: 'Extrusionsmultiplikator', filament_max_volumetric_speed: 'Maximale volumetrische Geschwindigkeit',
  min_fan_speed: 'Minimale Lüftergeschwindigkeit', max_fan_speed: 'Maximale Lüftergeschwindigkeit', bridge_fan_speed: 'Brückenlüftergeschwindigkeit',
  pressure_advance_value: 'Pressure-Advance-Wert', overhang_fan_speed_0: 'Lüfter Überhang 0 %', overhang_fan_speed_1: 'Lüfter Überhang 25 %',
  overhang_fan_speed_2: 'Lüfter Überhang 50 %', overhang_fan_speed_3: 'Lüfter Überhang 75 %', disable_fan_first_layers: 'Lüfter aus für erste Schichten',
  full_fan_speed_layer: 'Volle Lüfterdrehzahl ab Schicht', fan_below_layer_time: 'Lüfter an unter Schichtzeit', slowdown_below_layer_time: 'Verlangsamen unter Schichtzeit',
  min_print_speed: 'Minimale Druckgeschwindigkeit',
};
const option = (value, label, selected) => `<option value="${esc(value)}" ${selected ? 'selected' : ''}>${esc(label)}</option>`;

function colorRow(key, ctx) {
  const {spec, raw} = settingState(key, ctx);
  if (!spec) return '';
  const base = Array.isArray(raw) ? raw[0] : raw;
  const delta = ctx.color?.offsets?.[key] ?? 0;
  const off = !ctx.color;
  const unit = unitOf(spec, base);
  return `<div class="s-row" data-row="${esc(key)}" title="${esc(`${spec.tip || ''}\nSchlüssel: ${key}`)}">
    <i class="src auto"></i><label for="co-${esc(key)}">${esc(LABELS[key] || key)}</label>
    <span class="s-value"><input type="text" id="co-${esc(key)}" class="num" data-color-offset="${esc(key)}" value="${esc(String(delta).replace('.', ','))}" ${off ? 'disabled' : ''} spellcheck="false" aria-label="${esc(LABELS[key] || key)} Farb-Offset">
      <span class="unit">${esc(unit)}</span>${off ? '' : offsetNote(key, spec, base, ctx, true)}</span><i></i></div>`;
}

/** ctx: Prozesskontext plus `colors` (Farben des Materials), `color` (gewählt oder null), `materialName`. */
export function renderColorDialog(ctx) {
  const c = ctx.color;
  return `<div class="overlay process-overlay">
    <section class="process-dialog color-dialog" role="dialog" aria-modal="true" aria-label="Auto-Konfig Farbe">
      <div class="pd-title"><span class="brand-mark"></span><h2>Auto-Konfig Farbe</h2><button class="x" data-action="close-colors" title="Zurück zum Prozess">×</button></div>
      <div class="pd-head">
        <div class="pd-line first">
          <label>Material</label><span class="pd-auto-box flat"><b>${esc(ctx.materialName || 'kein Material')}</b></span>
          <label>Farbe</label>
          <span class="swatches" role="radiogroup" aria-label="Farbe">
            <button class="swatch none ${c ? '' : 'on'}" data-action="color-pick" data-id="" title="Keine Farbe" role="radio" aria-checked="${!c}"></button>
            ${ctx.colors.map(x => `<button class="swatch ${c?.id === x.id ? 'on' : ''}" data-action="color-pick" data-id="${esc(x.id)}" style="background:${esc(x.colour)}" title="${esc(x.name)}" role="radio" aria-checked="${c?.id === x.id}"></button>`).join('')}
          </span>
          <button data-action="color-add" ${ctx.materialName ? '' : 'disabled'}>Neue Farbe</button>
        </div>
        ${c ? `<div class="pd-line">
          <label>Name der Farbe</label><input data-field="color-name" value="${esc(c.name)}">
          <label>Filamentfarbe</label><input type="color" data-field="color-hex" value="${esc(/^#[0-9a-f]{6}$/i.test(c.colour) ? c.colour : '#e53935')}">
          <button data-action="color-remove">Farbe löschen</button>
        </div>` : `<div class="pd-line"><span class="hint">Keine Farbe gewählt: Es werden keine Farb-Offsets angewendet, alle Farbkorrekturen sind 0. Gespeicherte Farben bleiben erhalten.</span></div>`}
      </div>
      <div class="pd-main single"><div class="pd-content" data-keep-scroll="colors">
        <div class="pd-groups flow">${COLOR_KEYS.map(([name, keys]) => `<section class="s-group"><h4>${esc(name)}</h4><div class="s-box">${keys.map(k => colorRow(k, ctx)).join('')}</div></section>`).join('')}</div>
        <p class="hint">Endwert = Material-Grundwert + Auto-Konfig-Offset + Farb-Offset. Bei Prozentwerten (Lüfter) gelten Prozentpunkte. Nur der Farb-Offset wird in der Farbe des Filaments dargestellt.</p>
      </div></div>
      <div class="pd-foot"><span class="meta">Änderungen gelten nur im Entwurf. Dauerhaft speichern über „Prozess speichern“.</span><button class="primary" data-action="close-colors">Fertig</button></div>
    </section></div>`;
}
