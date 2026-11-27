// Flow-Kalibrierung für RepRapFirmware: Übernommen aus dem eigenen Kalibrierungs-Plugin (Flow Plättchen,
// Flow-Test Einzelwand-Box und Auswertung). Reine Rechnung ohne Zugriff auf den Programmzustand (testbar).

export const DEFAULTS = {
  shared: {hotendTemp: 210, bedTemp: 55, nozzleDia: 0.4, layerH: 0.2, meshMargin: 5, printSpeed: 40, fanPct: 40,
    firstLayerSpeed: 20, travelSpeed: 150, bedW: 250, bedD: 210},
  pads: {H: 210, B: 55, C: 90, D: 4, R: 1, P: 18, G: 4, Z: 6, X: 0, Y: 0},
  box: {H: 215, B: 60, W: '', S: 40, Z: 60, X: 80, Y: 80},
  evaluation: {measured: 0.48, target: 0.45, currentFlow: 100},
  startCode: 'M98 P"0:/sys/print/start.g" S[bed0_temperature] H[extruder0_temperature] X[build_min_x] Y[build_min_y] I[build_max_x] J[build_max_y]',
  endCode: 'M221 S100\nM106 S0\nM98 P"0:/sys/print/end.g"',
};

/** Linienbreite je Düse wie im Plugin. */
export const LINE_WIDTH = {0.25: 0.30, 0.4: 0.48, 0.5: 0.60, 0.6: 0.72, 0.8: 0.96};

const SEGMENTS = {
  0: ['A', 'B', 'C', 'D', 'E', 'F'], 1: ['B', 'C'], 2: ['A', 'B', 'G', 'E', 'D'], 3: ['A', 'B', 'G', 'C', 'D'],
  4: ['F', 'G', 'B', 'C'], 5: ['A', 'F', 'G', 'C', 'D'], 6: ['A', 'F', 'G', 'C', 'D', 'E'], 7: ['A', 'B', 'C'],
  8: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], 9: ['A', 'B', 'C', 'D', 'F', 'G'],
};

export const toNum = (value, fallback) => {
  const parsed = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : fallback;
};

export function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return '0';
  return Number(value).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function fill(template, values) {
  let out = String(template || '');
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value)).split(`[${key}]`).join(String(value));
  }
  return out;
}

function startCommand(code, hotend, bed, box) {
  if (!String(code || '').trim()) throw new Error('Startcode ist leer');
  return fill(code.trim(), {
    hotendTemp: fmt(hotend, 2), bedTemp: fmt(bed, 2), minX: fmt(box.minX, 3), minY: fmt(box.minY, 3), maxX: fmt(box.maxX, 3), maxY: fmt(box.maxY, 3),
    extruder0_temperature: fmt(hotend, 2), bed0_temperature: fmt(bed, 2),
    build_min_x: fmt(box.minX, 3), build_min_y: fmt(box.minY, 3), build_max_x: fmt(box.maxX, 3), build_max_y: fmt(box.maxY, 3),
  });
}

function endLines(code, values) {
  if (!String(code || '').trim()) throw new Error('Endcode ist leer');
  return fill(code.trim(), values).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

function lineWidthOf(nozzle, override) {
  const mapped = LINE_WIDTH[Number(nozzle)];
  if (override !== '' && override !== null && override !== undefined) return toNum(override, -1);
  if (!mapped) throw new Error('Düse nicht unterstützt. Erlaubt: 0,25 / 0,4 / 0,5 / 0,6 / 0,8');
  return mapped;
}

const FILAMENT_AREA = Math.PI * (1.75 / 2) ** 2;

// ---------- Variante 1: Flow-Plättchen ----------

function travel(lines, state, x, y, z, cfg) {
  state.e = Math.max(0, state.e - cfg.travelRetract);
  lines.push(`G1 E${fmt(state.e, 5)} F${fmt(cfg.fRetract, 0)}`);
  lines.push(`G1 Z${fmt(z + cfg.travelZhop, 3)} F${fmt(cfg.fZ, 0)}`);
  lines.push(`G1 X${fmt(x, 3)} Y${fmt(y, 3)} F${fmt(cfg.fMove, 0)}`);
  lines.push(`G1 Z${fmt(z, 3)} F${fmt(cfg.fZ, 0)}`);
  state.e += cfg.travelRetract;
  lines.push(`G1 E${fmt(state.e, 5)} F${fmt(cfg.fRetract, 0)}`);
}

function extrude(lines, state, x, y, length, cfg) {
  state.e += cfg.ePerMM * length;
  lines.push(`G1 X${fmt(x, 3)} Y${fmt(y, 3)} F${fmt(cfg.fDraw, 0)} E${fmt(state.e, 5)}`);
}

function segment(lines, state, seg, x, y, w, h, z, cfg) {
  const at = {
    A: [[x, y + h], [x + w, y + h, w]],
    B: [[x + w, y + h], [x + w, y + h / 2, h / 2]],
    C: [[x + w, y + h / 2], [x + w, y, h / 2]],
    D: [[x, y], [x + w, y, w]],
    E: [[x, y + h / 2], [x, y, h / 2]],
    F: [[x, y + h], [x, y + h / 2, h / 2]],
    G: [[x, y + h / 2], [x + w, y + h / 2, w]],
  }[seg];
  travel(lines, state, at[0][0], at[0][1], z, cfg);
  extrude(lines, state, at[1][0], at[1][1], at[1][2], cfg);
}

function label(lines, state, value, x, y, size, z, cfg) {
  const text = String(Math.round(value));
  const count = text.length;
  const margin = 1.2;
  const gap = cfg.digitGap;
  const room = Math.max(6, size - 2 * margin);
  const maxW = Math.max(room - (count - 1) * gap, count * 2.2) / count;
  const w = Math.max(2.2, Math.min(cfg.digitW, maxW));
  const h = Math.min(room, cfg.digitH * (w / cfg.digitW));
  const total = count * w + (count - 1) * gap;
  let cursor = x + (size - total) / 2;
  const base = y + (size - h) / 2;
  for (const ch of text) {
    if (ch === '-') {
      segment(lines, state, 'G', cursor, base, w, h, z, cfg);
    } else {
      for (const seg of SEGMENTS[Number(ch)] || []) segment(lines, state, seg, cursor, base, w, h, z, cfg);
    }
    cursor += w + gap;
  }
}

/** Plättchen mit M221-Stufen, Zahl auf jedem Plättchen. Liefert G-Code-Text. */
export function padsJob(shared, form, codes) {
  const s = {...DEFAULTS.shared, ...shared};
  const p = {...DEFAULTS.pads, ...form};
  const hotend = toNum(p.H, s.hotendTemp), bed = toNum(p.B, s.bedTemp);
  const layerH = toNum(s.layerH, 0.2);
  const center = toNum(p.C, 90), delta = toNum(p.D, 4), step = toNum(p.R, 1);
  const size = toNum(p.P, 18), gap = toNum(p.G, 4), layers = Math.floor(toNum(p.Z, 6));
  const printSpeed = Math.max(1, toNum(s.printSpeed, 40)), firstSpeed = Math.max(1, toNum(s.firstLayerSpeed, 20));
  const fan = Math.max(0, Math.min(100, toNum(s.fanPct, 40)));
  const margin = Math.max(0, toNum(s.meshMargin, 5));
  if (layerH <= 0) throw new Error('Schichthöhe muss > 0 sein');
  if (size < 12) throw new Error('Plättchengröße zu klein (min. 12)');
  if (gap < 2) throw new Error('Abstand zu klein (min. 2)');
  if (layers < 4) throw new Error('Schichten je Plättchen muss ≥ 4 sein');
  if (step <= 0) throw new Error('Schritt muss > 0 sein');
  if (delta < 0) throw new Error('Delta muss ≥ 0 sein');
  const lineW = lineWidthOf(s.nozzleDia, s.lineW);
  if (lineW <= 0) throw new Error('Linienbreite ungültig');
  const from = center - delta, to = center + delta;
  const count = Math.floor((to - from) / step + 1);
  if (count < 1) throw new Error('Ungültiger Flow-Bereich');
  const cols = Math.min(5, count);
  const rows = Math.floor((count - 1) / cols) + 1;
  const totalW = cols * size + (cols - 1) * gap, totalH = rows * size + (rows - 1) * gap;
  const startX = toNum(s.bedW, 250) / 2 - totalW / 2 + toNum(p.X, 0);
  const startY = toNum(s.bedD, 210) / 2 - totalH / 2 + toNum(p.Y, 0);
  const box = {minX: startX - margin, minY: startY - margin, maxX: startX + totalW + margin, maxY: startY + totalH + margin};
  if (box.minX < 0 || box.minY < 0 || box.maxX > toNum(s.bedW, 250) || box.maxY > toNum(s.bedD, 210)) throw new Error('Die Plättchen passen nicht aufs Druckbett');
  const cfg = {
    ePerMM: (lineW * layerH) / FILAMENT_AREA, travelRetract: 0.2, travelZhop: 0.3, fRetract: 1800, fZ: 1200,
    fMove: toNum(s.travelSpeed, 150) * 60, fDraw: firstSpeed * 60, digitW: 5.5, digitH: 9, digitGap: 1.6,
  };
  const lines = ['; Flow-Plättchen (direkter Druckjob, keine Makros im /sys nötig)', startCommand(codes.startCode, hotend, bed, box), 'M106 S0', 'G90', 'M82', 'G92 E0'];
  const state = {e: 0};
  const origin = i => [startX + (i % cols) * (size + gap), startY + Math.floor(i / cols) * (size + gap)];
  for (let layer = 0; layer < layers; layer++) {
    cfg.fDraw = (layer === 0 ? firstSpeed : printSpeed) * 60;
    if (layer === 2) lines.push(`M106 S${fmt(fan / 100, 4)}`);
    const z = layerH * (layer + 1);
    lines.push(`G1 Z${fmt(z, 3)} F${fmt(cfg.fZ, 0)}`);
    for (let i = 0; i < count; i++) {
      lines.push(`M221 S${fmt(from + i * step, 3)}`);
      const [px, py] = origin(i);
      let dir = (layer + i) % 2;
      for (let y = py; y <= py + size + 0.0001; y += lineW) {
        if (dir === 0) { travel(lines, state, px, y, z, cfg); extrude(lines, state, px + size, y, size, cfg); dir = 1; }
        else { travel(lines, state, px + size, y, z, cfg); extrude(lines, state, px, y, size, cfg); dir = 0; }
      }
    }
  }
  for (let i = 0; i < count; i++) {
    const [px, py] = origin(i);
    lines.push(`M221 S${fmt(from + i * step, 3)}`);
    label(lines, state, from + i * step, px, py, size, layerH * layers, cfg);
  }
  lines.push(...endLines(codes.endCode, {hotendTemp: fmt(hotend, 2), bedTemp: fmt(bed, 2), minX: fmt(box.minX, 3), minY: fmt(box.minY, 3), maxX: fmt(box.maxX, 3), maxY: fmt(box.maxY, 3)}));
  lines.push('M400', '; Ende Flow-Plättchen', '');
  return lines.join('\n');
}

// ---------- Variante 2: Flow-Test (Einzelwand-Box) ----------

export function boxJob(shared, form, codes) {
  const s = {...DEFAULTS.shared, ...shared};
  const p = {...DEFAULTS.box, ...form};
  const hotend = toNum(p.H, s.hotendTemp), bed = toNum(p.B, s.bedTemp);
  const layerH = toNum(s.layerH, 0.2);
  const printSpeed = Math.max(1, toNum(s.printSpeed, 40)), firstSpeed = Math.max(1, toNum(s.firstLayerSpeed, 20));
  const size = toNum(p.S, 40), layers = Math.floor(toNum(p.Z, 60));
  const x0 = toNum(p.X, 80), y0 = toNum(p.Y, 80);
  const margin = Math.max(0, toNum(s.meshMargin, 5));
  const fan = Math.max(0, Math.min(100, toNum(s.fanPct, 40)));
  if (hotend < 0) throw new Error('Hotend-Temperatur muss ≥ 0 sein');
  if (bed < 0) throw new Error('Bett-Temperatur muss ≥ 0 sein');
  if (layerH <= 0) throw new Error('Schichthöhe muss > 0 sein');
  if (size <= 5) throw new Error('Kantenlänge ist zu klein');
  if (layers <= 0) throw new Error('Schichtzahl muss > 0 sein');
  const lineW = lineWidthOf(s.nozzleDia, p.W);
  if (lineW <= 0) throw new Error('Linienbreite muss > 0 sein');
  const box = {minX: x0 - margin, minY: y0 - margin, maxX: x0 + size + margin, maxY: y0 + size + margin};
  if (box.minX < 0 || box.minY < 0 || box.maxX > toNum(s.bedW, 250) || box.maxY > toNum(s.bedD, 210)) throw new Error('Die Box passt nicht aufs Druckbett');
  const perMM = (lineW * layerH) / FILAMENT_AREA;
  const brimLines = 4;
  const outer = size + 2 * brimLines * lineW;
  const lines = ['; Flow-Test Einzelwand-Box', startCommand(codes.startCode, hotend, bed, box), 'M106 S0', 'G90', 'M82', 'G92 E0',
    `G1 X${fmt(x0, 3)} Y${fmt(y0, 3)} F9000`, `G1 Z${fmt(layerH, 3)} F1200`];
  let e = 0;
  const side = (x, y, len, f, first) => {
    e += perMM * len;
    lines.push(`G1 X${fmt(x, 3)} Y${fmt(y, 3)}${first ? ` F${fmt(f, 0)}` : ''} E${fmt(e, 5)}`);
  };
  for (let i = 0; i < layers; i++) {
    if (i === 2) lines.push(`M106 S${fmt(fan / 100, 4)}`);
    lines.push(`G1 Z${fmt(layerH * (i + 1), 3)} F900`);
    const feed = (i === 0 ? firstSpeed : printSpeed) * 60;
    if (i < 2) {
      for (let b = 0; b < brimLines; b++) {
        const ring = outer - 2 * b * lineW;
        const rx = x0 - brimLines * lineW + b * lineW, ry = y0 - brimLines * lineW + b * lineW;
        lines.push(`G1 X${fmt(rx, 3)} Y${fmt(ry, 3)} F9000`);
        side(rx + ring, ry, ring, feed, true);
        side(rx + ring, ry + ring, ring);
        side(rx, ry + ring, ring);
        side(rx, ry, ring);
      }
    }
    side(x0 + size, y0, size, feed, true);
    side(x0 + size, y0 + size, size);
    side(x0, y0 + size, size);
    side(x0, y0, size);
  }
  lines.push(...endLines(codes.endCode, {hotendTemp: fmt(hotend, 2), bedTemp: fmt(bed, 2), minX: fmt(box.minX, 3), minY: fmt(box.minY, 3), maxX: fmt(box.maxX, 3), maxY: fmt(box.maxY, 3)}));
  lines.push(`M118 S"Flow-Test: Duese=${fmt(toNum(s.nozzleDia, 0.4), 2)}mm Soll-Wand=${fmt(lineW, 3)}mm"`, '');
  return lines.join('\n');
}

/** Auswertung: neue Flussrate in % aus gemessener und Soll-Wandstärke. */
export function newFlow({measured, target, currentFlow}) {
  const m = toNum(measured, 0), t = toNum(target, 0), c = toNum(currentFlow, 0);
  if (m <= 0) throw new Error('Gemessene Wandstärke muss größer als 0 sein');
  if (t <= 0) throw new Error('Soll-Wandstärke muss größer als 0 sein');
  if (c <= 0) throw new Error('Aktueller Flow muss größer als 0 sein');
  return c * (t / m);
}
