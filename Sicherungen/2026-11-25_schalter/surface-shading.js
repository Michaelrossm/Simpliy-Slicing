// Die Normalen rechnet Rust (shading.rs). Hier nur verpacken und einfaerben.
import * as THREE from './vendor/build/three.module.js';

/** Eigene Punkte je Ecke. Die Dreiecksnummern bleiben gleich (wichtig fuer Malen und Klicken). */
export function meshGeometry({vertices, indices, cornerNormals}) {
  const positions = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const from = indices[i] * 3;
    positions[i * 3] = vertices[from];
    positions[i * 3 + 1] = vertices[from + 1];
    positions[i * 3 + 2] = vertices[from + 2];
  }
  return drawnGeometry(positions, cornerNormals);
}

export function drawnGeometry(positions, normals) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Ueberhangfarben je Dreieck in Bettlage: unter der Schwelle blau, dann gelb bis rot. */
export function overhangColours(position, matrix, threshold) {
  const e = matrix.elements;
  const out = new Uint8Array(position.length);
  const safe = [135, 200, 250];
  const warn = [250, 214, 52];
  const bad = [198, 32, 28];
  for (let i = 0; i < position.length; i += 9) {
    const p = [];
    for (let k = 0; k < 9; k += 3) {
      const x = position[i + k], y = position[i + k + 1], z = position[i + k + 2];
      p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    }
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2];
    const vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz;
    let z = ux * vy - uy * vx;
    if (matrix.determinant() < 0) z = -z;
    const onBed = p[2] < 0.02 && p[5] < 0.02 && p[8] < 0.02;
    // 0 Grad = senkrecht, 90 Grad = waagerechte Unterseite
    const angle = onBed ? 0 : Math.asin(Math.max(0, Math.min(1, -z / (Math.hypot(x, y, z) || 1)))) * 180 / Math.PI;
    let colour = safe;
    if (angle >= threshold - 1e-3) {
      const t = Math.max(0, Math.min(1, (angle - threshold) / Math.max(1, 90 - threshold)));
      colour = warn.map((v, a) => Math.round(v + (bad[a] - v) * t));
    }
    for (let k = 0; k < 9; k++) out[i + k] = colour[k % 3];
  }
  return out;
}
