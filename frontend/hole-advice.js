// Bohrungen: erwartete Druckmaße und empfohlenes Aufmaß, verbunden mit den Prusa-Parametern des Prozesses.
// Reine Rechnung ohne Zugriff auf den Programmzustand (testbar).

export const DEFAULT_UNDERSIZE = 0.2;
/** Unter diesem Durchmesser schließen sich Bohrungen beim Druck oft ganz oder werden unbrauchbar. */
export const TINY = 3;

const first = v => (Array.isArray(v) ? v[0] : v);
const num = v => {
  const raw = first(v);
  const n = parseFloat(String(raw?.value ?? raw ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/**
 * `undersize`: gemessenes Untermaß einer Testbohrung in mm (Durchmesser, ohne Ausgleich).
 * Prusa-Parameter, die schon ausgleichen: `xy_size_compensation` (negativ vergrößert Löcher um 2·|Wert|) und
 * `filament_shrinkage_compensation_xy` (Prozent, skaliert das ganze Teil).
 */
export function holeAdvice(holes, values = {}, undersize = DEFAULT_UNDERSIZE) {
  const xy = num(values.xy_size_compensation);
  const shrink = num(values.filament_shrinkage_compensation_xy);
  const printed = d => d - undersize - 2 * xy + (d * shrink) / 100;
  const rows = holes.map(h => {
    const expected = printed(h.diameter);
    const warnings = [];
    if (h.diameter < TINY) warnings.push(`Ø ${h.diameter.toFixed(1)} mm: sehr klein, schließt sich leicht – eher nachbohren`);
    if (h.orientation === 'waagerecht') warnings.push('waagerecht: oben flacher/ovaler (kein Stützmaterial nötig bei kleinem Ø)');
    return {...h, expected, deviation: expected - h.diameter, warnings};
  });
  // Ein Aufmaß für alle: so viel, dass der mittlere Rest-Fehler verschwindet (nie negativ).
  const mean = holes.length ? holes.reduce((a, h) => a + h.diameter, 0) / holes.length : 0;
  const delta = Math.max(0, undersize + 2 * xy - (mean * shrink) / 100);
  return {rows, delta: Math.round(delta * 100) / 100, xy, shrink, undersize,
    alternative: delta > 0 ? `Alternativ im Prozess „Maßausgleich XY“ auf ${(-delta / 2).toFixed(2).replace('.', ',')} mm setzen (wirkt auf alle Maße des Teils).` : ''};
}
