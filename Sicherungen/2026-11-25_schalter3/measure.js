// Messen in Druckkoordinaten (mm, also nach Skalierung und Drehung).
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = a => Math.hypot(a[0], a[1], a[2]);

export const MODES = {
  distance: {name: 'Abstand', picks: 2, hint: 'Zwei Punkte anklicken. Nahe Ecken rasten ein.'},
  faces: {name: 'Flächen', picks: 2, hint: 'Zwei ebene Flächen anklicken.'},
  circle: {name: 'Durchmesser', picks: 3, hint: 'Drei Punkte auf dem Kreisrand anklicken.'},
};

/** @param picks [{point, normal}] */
export function measure(mode, picks) {
  if (!MODES[mode] || picks.length !== MODES[mode].picks) return null;

  if (mode === 'distance') {
    const d = sub(picks[1].point, picks[0].point);
    return {
      rows: [['Abstand', length(d), 'mm'], ['ΔX', Math.abs(d[0]), 'mm'], ['ΔY', Math.abs(d[1]), 'mm'], ['ΔZ', Math.abs(d[2]), 'mm']],
      line: [picks[0].point, picks[1].point],
    };
  }

  if (mode === 'faces') {
    const a = picks[0].normal.map(v => v / length(picks[0].normal));
    const b = picks[1].normal.map(v => v / length(picks[1].normal));
    const between = Math.atan2(length(cross(a, b)), Math.abs(dot(a, b))) * 180 / Math.PI;
    if (between >= 0.1) return {rows: [['Winkel der Ebenen', between, '°'], ['Ergänzungswinkel', 180 - between, '°']]};
    const distance = dot(sub(picks[1].point, picks[0].point), a);
    const start = picks[0].point;
    return {
      rows: [['Abstand parallel', Math.abs(distance), 'mm'], ['Winkel', 0, '°']],
      line: [start, start.map((v, k) => v + a[k] * distance)],
    };
  }

  const [a, b, c] = picks.map(p => p.point);
  const u = sub(b, a), v = sub(c, a), n = cross(u, v), nn = dot(n, n);
  if (nn < 1e-9) return {error: 'Die drei Punkte liegen auf einer Geraden.'};
  const x = cross(n, u), y = cross(v, n);
  const centre = a.map((value, k) => value + (x[k] * dot(v, v) + y[k] * dot(u, u)) / (2 * nn));
  const radius = length(sub(a, centre));
  return {
    rows: [['Durchmesser', radius * 2, 'mm'], ['Radius', radius, 'mm'], ['Mitte X', centre[0], 'mm'], ['Mitte Y', centre[1], 'mm'], ['Mitte Z', centre[2], 'mm']],
    centre,
    line: [centre, a],
  };
}
