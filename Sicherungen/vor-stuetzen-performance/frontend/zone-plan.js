// Zonen-Prozesse (Z-Bereiche): reine Hilfsfunktionen ohne Zugriff auf den Programmzustand.
// Die eigentliche Zusammensetzung des G-Codes macht Rust (src-tauri/src/zones/).

/** Z-Bereich eines Prozesses ({from, to} in mm, null = offen) oder null ohne Zone. */
export const zoneOf = proc => {
  const z = proc?.zone;
  if (!z) return null;
  const n = v => Number(String(v).replace(',', '.'));
  return {from: z.fromOn && Number.isFinite(n(z.from)) ? n(z.from) : null, to: z.toOn && Number.isFinite(n(z.to)) ? n(z.to) : null};
};

/** Hat der Prozess einen aktiven Z-Bereich? */
export const zoneActive = proc => {
  const z = zoneOf(proc);
  return !!(z && (z.from != null || z.to != null));
};

/** Aktive Zonen der Zonen-Prozesse, die einem Modell zugewiesen sind. */
export function zonesOfModel(model, processes) {
  return (model?.zone_processes || [])
    .map(id => processes.find(p => p.id === id))
    .filter(p => p && zoneActive(p))
    .map(zoneOf);
}

const first = v => (Array.isArray(v) ? v[0] : v);
const isOn = v => [true, 1, '1', 'true', 'everywhere', 'enforcers_only'].includes(first(v));

/** Zahl aus einem Prusa-Wert; Prozentwerte beziehen sich auf `base` (Schichthoehe). */
export function millimetres(value, base = 0) {
  const raw = first(value);
  const text = String(raw?.value ?? raw ?? '');
  const n = parseFloat(text.replace(',', '.'));
  return (text.endsWith('%') || raw?.is_percent === true) ? (n * base) / 100 : n;
}

/** Schichthoehe und erste Schichthoehe aus Prozesswerten. */
export function layerHeights(values) {
  const h = millimetres(values.layer_height);
  return [h, millimetres(values.first_layer_height, h)];
}

/** Unterschiedliche Sollwerte des Schichtrasters: null, wenn Haupt- und Zonen-Prozess zusammenpassen. */
export function heightMismatch(mainValues, zoneValues, tolerance = 1e-6) {
  const [h0, f0] = layerHeights(mainValues);
  const [h1, f1] = layerHeights(zoneValues);
  return Math.abs(h0 - h1) > tolerance || Math.abs(f0 - f1) > tolerance ? {h0, f0, h1, f1} : null;
}

const mm = n => n.toFixed(2).replace('.', ',');

export const heightMessage = (mainName, zoneName, m) =>
  `Die Schichthöhen der beteiligten Prozesse passen nicht zusammen. Hauptprozess „${mainName}“: ${mm(m.h0)} mm (erste Schicht ${mm(m.f0)} mm), `
  + `Zonen-Prozess „${zoneName}“: ${mm(m.h1)} mm (erste Schicht ${mm(m.f1)} mm). Bitte gleiche Schichthöhen verwenden.`;

/**
 * Sperrgruende fuer Zonen (nur sicher zusammensetzbare Faelle sind freigegeben). Liefert den Text oder null.
 * `info`: {models, tools, hasSupportPlate, mainValues, zoneValues: [values...]}
 */
export function zoneBlockReason({models, tools, hasSupportPlate, mainValues, zoneValues}) {
  if (models > 1) return 'Zonen-Prozesse sind vorerst nur mit einem Modell auf der Platte freigegeben: Bei mehreren Modellen könnte ein Zonenwechsel die Bahnen der anderen Modelle ersetzen. Bitte das Modell auf eine eigene Platte legen.';
  if (tools > 1) return 'Zonen-Prozesse sind vorerst nicht mit mehreren Werkzeugen oder Reinigungsturm freigegeben.';
  if (hasSupportPlate || isOn(mainValues.support_material) || zoneValues.some(v => isOn(v.support_material))) {
    return 'Zonen-Prozesse sind vorerst nicht mit Stützen freigegeben: Eine Stütze könnte an der Zonengrenze unterbrochen werden.';
  }
  return null;
}
