// Text als geschlossener Koerper: erhaben (weiteres Modellteil) oder graviert (Negativvolumen).
import {ShapeUtils, Vector2} from './vendor/build/three.module.js';

const CURVE_STEPS = 8;
const OVERLAP = 0.4; // damit der Text sicher mit dem Modell verschmilzt bzw. die Flaeche durchbricht

function contoursOf(commands) {
  const contours = [];
  let current = [];
  let last = [0, 0];
  const add = (x, y) => {
    const previous = current.at(-1);
    if (!previous || Math.hypot(previous[0] - x, previous[1] + y) > 1e-5) current.push([x, -y]); // Schriften zaehlen Y nach unten
  };
  const close = () => {
    while (current.length > 1 && Math.hypot(current[0][0] - current.at(-1)[0], current[0][1] - current.at(-1)[1]) < 1e-5) current.pop();
    if (current.length >= 3 && Math.abs(ShapeUtils.area(current.map(p => new Vector2(p[0], p[1])))) > 1e-6) contours.push(current);
    current = [];
  };
  for (const c of commands) {
    if (c.type === 'Z') {
      close();
      continue;
    }
    if (c.type === 'M') close();
    if (c.type === 'M' || c.type === 'L') {
      add(c.x, c.y);
    } else {
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS, u = 1 - t;
        if (c.type === 'Q') {
          add(u * u * last[0] + 2 * u * t * c.x1 + t * t * c.x, u * u * last[1] + 2 * u * t * c.y1 + t * t * c.y);
        } else {
          add(u * u * u * last[0] + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * last[1] + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y);
        }
      }
    }
    last = [c.x, c.y];
  }
  close();
  return contours;
}

function contains(polygon, [x, y]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i], polygon[j]];
    if ((a[1] > y) !== (b[1] > y) && x < a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])) inside = !inside;
  }
  return inside;
}

/** Umrisse zu Flaechen mit Loechern ordnen. */
function shapesOf(contours) {
  const parents = contours.map((contour, i) =>
    contours.map((other, j) => (i !== j && contains(other, contour[0]) ? j : -1)).filter(j => j >= 0));
  const oriented = (contour, positive) =>
    (ShapeUtils.area(contour.map(p => new Vector2(p[0], p[1]))) > 0) === positive ? contour : [...contour].reverse();
  const shapes = [];
  contours.forEach((contour, i) => {
    if (parents[i].length % 2) return;
    const holes = contours
      .filter((_, j) => parents[j].length === parents[i].length + 1 && parents[j].includes(i))
      .map(hole => oriented(hole, false));
    shapes.push({outer: oriented(contour, true), holes});
  });
  return shapes;
}

/** Zeichen fuer Zeichen, damit sich ueberlappende Buchstaben nicht gegenseitig aushoehlen. */
export function textShapes(font, text, height) {
  const scaleBase = font.tables?.os2?.sCapHeight;
  const size = scaleBase > 0 ? height * font.unitsPerEm / scaleBase : height / 0.72;
  const all = [];
  text.split('\n').forEach((line, row) => {
    const glyphs = [];
    font.forEachGlyph(line, 0, 0, size, {kerning: true}, (glyph, x) => glyphs.push({glyph, x}));
    for (const {glyph, x} of glyphs) all.push(...shapesOf(contoursOf(glyph.getPath(x, row * size * 1.2, size).commands)));
  });
  if (!all.length) return all;
  const points = all.flatMap(s => s.outer);
  const middle = [0, 1].map(a => {
    let low = Infinity, high = -Infinity;
    for (const p of points) {
      low = Math.min(low, p[a]);
      high = Math.max(high, p[a]);
    }
    return (low + high) / 2;
  });
  const move = p => [p[0] - middle[0], p[1] - middle[1]];
  return all.map(s => ({outer: s.outer.map(move), holes: s.holes.map(h => h.map(move))}));
}

export function extrude(shapes, from, to) {
  const vertices = [];
  const triangles = [];
  for (const {outer, holes} of shapes) {
    const rings = [outer, ...holes];
    const flat = rings.flat();
    const bottom = vertices.length;
    const top = bottom + flat.length;
    for (const z of [from, to]) for (const [x, y] of flat) vertices.push([x, y, z]);
    const faces = ShapeUtils.triangulateShape(
      outer.map(p => new Vector2(p[0], p[1])),
      holes.map(h => h.map(p => new Vector2(p[0], p[1]))),
    );
    for (const [a, b, c] of faces) {
      const up = (flat[b][0] - flat[a][0]) * (flat[c][1] - flat[a][1]) - (flat[b][1] - flat[a][1]) * (flat[c][0] - flat[a][0]) >= 0;
      const [q, r] = up ? [b, c] : [c, b];
      triangles.push([top + a, top + q, top + r], [bottom + a, bottom + r, bottom + q]);
    }
    let start = 0;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = start + i, b = start + ((i + 1) % ring.length);
        triangles.push([bottom + a, bottom + b, top + b], [bottom + a, top + b, top + a]);
      }
      start += ring.length;
    }
  }
  return {vertices, triangles};
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => {
  const length = Math.hypot(...v);
  return v.map(x => x / length);
};

/**
 * @param spec {text, height, depth, engrave, angle, position, normal}; position und normal in Modellkoordinaten
 * @param up   Richtung "oben" des Druckraums in Modellkoordinaten
 */
export function textVolume(font, spec, up = [0, 0, 1]) {
  if (!(spec.height >= 1 && spec.height <= 300)) throw Error('Texthöhe muss zwischen 1 und 300 mm liegen');
  if (!(spec.depth > 0 && spec.depth <= 50)) throw Error('Tiefe muss größer als 0 und höchstens 50 mm sein');
  const shapes = textShapes(font, spec.text, spec.height);
  if (!shapes.length) throw Error('Der Text enthält keine druckbaren Zeichen');
  const flat = spec.engrave ? extrude(shapes, -spec.depth, OVERLAP) : extrude(shapes, -OVERLAP, spec.depth);

  const n = unit(spec.normal);
  let guide = unit(up);
  if (Math.abs(n[0] * guide[0] + n[1] * guide[1] + n[2] * guide[2]) > 0.95) guide = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const right = unit(cross(guide, n));
  const top = cross(n, right);
  const cos = Math.cos((spec.angle || 0) * Math.PI / 180);
  const sin = Math.sin((spec.angle || 0) * Math.PI / 180);
  const vertices = flat.vertices.map(([x, y, z]) => {
    const u = x * cos - y * sin, v = x * sin + y * cos;
    return [0, 1, 2].map(a => Math.round((spec.position[a] + u * right[a] + v * top[a] + z * n[a]) * 1e5) / 1e5);
  });
  return {
    kind: spec.engrave ? 'NegativeVolume' : 'ModelPart',
    shape: 'text',
    text: {...spec},
    mesh: {vertices, triangles: flat.triangles},
    settings: {},
  };
}
