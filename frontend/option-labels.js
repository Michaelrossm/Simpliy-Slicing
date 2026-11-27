// Eigene Bezeichnungen von Simpliy fuer Auswahlwerte, die die Uebersetzung der installierten Engine nicht enthaelt.
export const OPTION_LABELS = {
  gcode_flavor: {reprap: 'RepRap (alt)', reprapfirmware: 'RepRapFirmware / Duet', repetier: 'Repetier', teacup: 'Teacup', makerware: 'MakerWare',
    marlin: 'Marlin', marlin2: 'Marlin 2', prusabuddy: 'Prusa-Firmware (Buddy)', klipper: 'Klipper', sailfish: 'Sailfish', mach3: 'Mach3 / LinuxCNC',
    machinekit: 'Machinekit', smoothie: 'Smoothieware'},
  thumbnails_format: {PNG: 'PNG', JPG: 'JPG', QOI: 'QOI'},
  arc_fitting: {emit_center: 'Bögen mit Mittelpunkt (G2/G3 I J)'},
  ensure_vertical_shell_thickness: {partial: 'Teilweise'},
  scarf_seam_placement: {nowhere: 'Nirgends', contours: 'Nur Konturen'},
  support_material: {none: 'Keine', enforcers_only: 'Nur erzwungene Stellen', everywhere: 'Überall'},
  toolchange_ordering: {optimized: 'Optimiert', cyclic: 'Zyklisch'},
  cooling_slowdown_logic: {uniform_cooling: 'Gleichmäßig kühlen', consistent_surface: 'Gleichmäßige Oberfläche'},
  pressure_advance: {automatic_calibration: 'Automatisch kalibrieren'},
};
const PATTERNS = {rectilinear: 'Geradlinig', grid: 'Gitter', triangles: 'Dreiecke', stars: 'Sterne', cubic: 'Kubisch', line: 'Linie',
  concentric: 'Konzentrisch', honeycomb: 'Waben', gyroid: 'Gyroid', lightning: 'Blitz', monotonic: 'Monoton',
  monotoniclines: 'Monoton (Linien)', alignedrectilinear: 'Geradlinig ausgerichtet', '3dhoneycomb': '3D-Waben',
  hilbertcurve: 'Hilbert-Kurve', archimedeanchords: 'Archimedische Sehnen', octagramspiral: 'Achtstern-Spirale', adaptivecubic: 'Adaptiv kubisch',
  supportcubic: 'Stützend kubisch', zigzag: 'Zickzack'};
for (const key of ['fill_pattern', 'top_fill_pattern', 'bottom_fill_pattern']) OPTION_LABELS[key] = PATTERNS;

/** Texte der installierten Engine (Pruefsumme -> Text) in den Katalog einsetzen; sonst eigene Texte oder der Rohwert. */
export function applyEngineTexts(catalog, texts = {}, language = 'de') {
  for (const c of catalog) {
    if (c.tipHash) c.tip = texts[c.tipHash] || '';
    if (c.labelHash && texts[c.labelHash]) c.label = texts[c.labelHash];
    for (const o of c.options || []) o.label = (language === 'de' ? OPTION_LABELS[c.key]?.[o.value] : null) || (o.labelHash && texts[o.labelHash]) || o.value;
  }
  return catalog;
}
