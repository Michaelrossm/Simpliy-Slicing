// Automatische Ausrichtung: Welche Fläche soll aufs Druckbett? Bewertet die sechs Achsrichtungen und die größten
// ebenen Flächen nach Überhangfläche (braucht Stützen), Aufstandsfläche und Bauhöhe. Reine Rechnung (testbar).

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Dreiecke als {normal, area, centre}. */
function facets(vertices, indices) {
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const p = [0, 1, 2].map(k => [vertices[indices[t + k] * 3], vertices[indices[t + k] * 3 + 1], vertices[indices[t + k] * 3 + 2]]);
    const c = cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const length = Math.hypot(...c);
    if (length < 1e-12) continue;
    out.push({normal: c.map(v => v / length), area: length / 2, points: p});
  }
  return out;
}

/** Kandidaten: sechs Achsen und die Normalen der größten Ebenen (auf 2° gerundet gruppiert). */
function candidates(list) {
  const groups = new Map();
  for (const f of list) {
    const key = f.normal.map(v => Math.round(v * 30)).join(',');
    const g = groups.get(key) || {normal: [0, 0, 0], area: 0};
    g.area += f.area;
    for (let i = 0; i < 3; i++) g.normal[i] += f.normal[i] * f.area;
    groups.set(key, g);
  }
  const big = [...groups.values()].sort((a, b) => b.area - a.area).slice(0, 12)
    .map(g => { const l = Math.hypot(...g.normal) || 1; return g.normal.map(v => v / l); });
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], ...big];
}

/**
 * @param angle Überhangwinkel in Grad (ab hier wird gestützt)
 * @returns {normal, score, overhang, contact, height} der besten Lage; `normal` zeigt nach außen und kommt aufs Bett
 */
export function bestOrientation(vertices, indices, angle = 45) {
  const list = facets(vertices, indices);
  if (!list.length) return null;
  const limit = Math.cos((angle * Math.PI) / 180);
  const total = list.reduce((sum, f) => sum + f.area, 0);
  let best = null;
  for (const down of candidates(list)) {
    // Höhe über dem Bett: Abstand in Richtung -down
    let low = Infinity, high = -Infinity;
    for (const f of list) for (const p of f.points) { const h = -dot(p, down); low = Math.min(low, h); high = Math.max(high, h); }
    let overhang = 0, contact = 0;
    for (const f of list) {
      const facing = dot(f.normal, down); // 1 = zeigt genau nach unten
      if (facing <= limit) continue;
      const base = Math.min(...f.points.map(p => -dot(p, down))) - low;
      if (facing > 0.999 && base < 0.05) contact += f.area;
      else overhang += f.area;
    }
    const height = high - low;
    // Überhang zählt am stärksten; kleine Aufstandsfläche und große Höhe kosten zusätzlich
    const score = overhang / total + (contact < 0.01 * total ? 0.5 : 0) + 0.05 * (height / Math.cbrt(total));
    if (!best || score < best.score) best = {normal: down, score, overhang, contact, height};
  }
  return best;
}
