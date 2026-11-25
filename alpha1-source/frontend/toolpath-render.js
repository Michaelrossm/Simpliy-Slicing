// Werkzeugwege als runde Raupen: eine Form je Segment, Lage und Breite/Hoehe rechnet die Grafikkarte.
// Schichtregler, Filter und Abspielen aendern nur Uniforms, die Geometrie bleibt stehen.
import * as THREE from './vendor/build/three.module.js';

const ROLE_LIMIT = 64;

/** Einheitsraupe. position = (quer, hoch, laengs), end = 0 am Anfang, 1 am Ende. */
export function beadShape(sides, capRings) {
  const rings = [];
  for (let i = capRings; i >= 0; i--) {
    const a = i / capRings * Math.PI / 2;
    rings.push([Math.cos(a), -Math.sin(a), 0]);
  }
  for (let i = 0; i <= capRings; i++) {
    const a = i / capRings * Math.PI / 2;
    rings.push([Math.cos(a), Math.sin(a), 1]);
  }
  const position = [];
  const end = [];
  const index = [];
  for (const [radius, along, which] of rings) {
    for (let k = 0; k < sides; k++) {
      const a = k / sides * Math.PI * 2;
      position.push(Math.cos(a) * radius, Math.sin(a) * radius, along);
      end.push(which);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < sides; k++) {
      const a = r * sides + k;
      const b = r * sides + (k + 1) % sides;
      if (r > 0) index.push(a, b, a + sides);
      if (r < rings.length - 2) index.push(b, b + sides, a + sides);
    }
  }
  return {position, end, index};
}

function detailFor(count) {
  if (count < 120_000) return [10, 3];
  if (count < 350_000) return [8, 2];
  if (count < 800_000) return [6, 1];
  return [4, 1];
}

const VERTEX = /* glsl */`
attribute float end;
attribute vec3 beadFrom;
attribute vec3 beadTo;
attribute vec2 beadSize;
attribute vec3 beadColour;
attribute vec3 beadInfo; // Schicht, Rolle, Nummer in der Schicht

uniform float uFirst;
uniform float uLast;
uniform float uMove;
uniform float uDim;
uniform float uRole;
uniform float uPixels;

varying vec3 vColour;
varying vec3 vNormal;
varying vec3 vView;
#include <clipping_planes_pars_vertex>

void main() {
  float layer = beadInfo.x;
  bool hidden = layer < uFirst || layer > uLast
    || (uRole >= 0.0 && abs(beadInfo.y - uRole) > 0.5)
    || (layer == uLast && beadInfo.z > uMove);
  if (hidden) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 delta = beadTo - beadFrom;
  float run = length(delta.xy);
  vec3 along = run > 1e-5 ? vec3(delta.xy / run, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 side = vec3(-along.y, along.x, 0.0);
  vec2 radius = beadSize * 0.5;
  // Die Z-Angabe im G-Code ist die Oberkante der Raupe.
  vec3 centre = mix(beadFrom, beadTo, end) - vec3(0.0, 0.0, radius.y);
  vec3 offset = side * position.x * radius.x + vec3(0.0, 0.0, position.y * radius.y) + along * position.z * radius.x;
  vec3 n = normalize(side * position.x / radius.x + vec3(0.0, 0.0, position.y / radius.y) + along * position.z / radius.x);
  vec4 mvPosition = modelViewMatrix * vec4(centre + offset, 1.0);
  // Schichten unter etwa zwei Pixeln glatt schattieren, sonst entstehen Ringmuster.
  float seen = beadSize.y * projectionMatrix[1][1] * 0.5 * uPixels / max(0.001, -mvPosition.z);
  vec3 flatN = abs(position.y) > 0.97 ? n : normalize(vec3(n.xy, n.z * smoothstep(1.2, 4.0, seen)) + vec3(0.0, 0.0, 1e-4));
  vNormal = normalMatrix * flatN;
  vView = -mvPosition.xyz;
  vColour = pow(beadColour, vec3(2.2)) * (layer < uLast ? uDim : 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;

const FRAGMENT = /* glsl */`
varying vec3 vColour;
varying vec3 vNormal;
varying vec3 vView;
#include <clipping_planes_pars_fragment>

void main() {
  #include <clipping_planes_fragment>
  vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 v = normalize(vView);
  vec3 key = normalize(vec3(0.35, 0.65, 0.68));
  vec3 fill = normalize(vec3(-0.7, -0.15, 0.55));
  float light = 0.34 + 0.70 * max(dot(n, key), 0.0) + 0.22 * max(dot(n, fill), 0.0);
  float gloss = pow(max(dot(n, normalize(key + v)), 0.0), 40.0) * 0.10;
  gl_FragColor = vec4(vColour * light + vec3(gloss), 1.0);
  #include <colorspace_fragment>
}`;

/** Farbe 0..1 auf Blau, Cyan, Gruen, Gelb, Rot. */
const RAMP = [[0.16, 0.38, 0.92], [0.10, 0.74, 0.90], [0.28, 0.83, 0.36], [0.98, 0.84, 0.16], [0.93, 0.24, 0.16]];
export function rampColour(t) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  return RAMP[i].map((v, a) => v + (RAMP[i + 1][a] - v) * (x - i));
}

export class ToolpathRenderer {
  constructor(preview, roleColours) {
    this.preview = preview;
    this.roleColours = roleColours;
    const {roles, layers, count, data} = preview;
    this.roles = roles;
    this.roleId = new Map(roles.map((role, i) => [role, i]));
    this.count = count;
    this.data = data;
    this.endOfLayer = Uint32Array.from(layers, layer => layer.end);
    this.travelEnd = Uint32Array.from(layers, layer => layer.travelEnd);
    this.countWidth = Math.min(roles.length, ROLE_LIMIT);

    const {from, to} = data;
    const size = new Float32Array(count * 2);
    const info = new Float32Array(count * 3);
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    let i = 0;
    this.endOfLayer.forEach((end, l) => {
      for (let order = 0; i < end; i++, order++) {
        const width = Math.max(0.05, Math.min(3, data.width[i] || 0.42));
        const height = Math.max(0.02, Math.min(1.5, data.height[i] || 0.2));
        size[i * 2] = width;
        size[i * 2 + 1] = height;
        info[i * 3] = l;
        info[i * 3 + 1] = Math.min(ROLE_LIMIT - 1, data.role[i]);
        info[i * 3 + 2] = order;
        for (let a = 0; a < 3; a++) {
          const at = i * 3 + a;
          const under = a === 2 ? height : width / 2;
          const over = a === 2 ? 0 : width / 2;
          low[a] = Math.min(low[a], from[at] - under, to[at] - under);
          high[a] = Math.max(high[a], from[at] + over, to[at] + over);
        }
      }
    });
    this.info = info;

    const shape = beadShape(...detailFor(count));
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(shape.index);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(shape.position, 3));
    geometry.setAttribute('end', new THREE.Float32BufferAttribute(shape.end, 1));
    const instanced = (name, array, items, normalised = false) =>
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(array, items, normalised));
    instanced('beadFrom', from, 3);
    instanced('beadTo', to, 3);
    instanced('beadSize', size, 2);
    instanced('beadInfo', info, 3);
    instanced('beadColour', new Uint8Array(count * 3), 3, true);
    geometry.boundingBox = count ? new THREE.Box3(new THREE.Vector3(...low), new THREE.Vector3(...high)) : new THREE.Box3();
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
    // Die Form selbst liegt am Ursprung und darf die Grenzen nicht bestimmen.
    geometry.computeBoundingBox = () => {};
    geometry.computeBoundingSphere = () => {};

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {uFirst: {value: 0}, uLast: {value: 0}, uMove: {value: Infinity}, uDim: {value: 1}, uRole: {value: -1}, uPixels: {value: 800}},
      clipping: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = (raycaster, hits) => this.raycast(raycaster, hits);

    this.travel = null;
    this.ranges = new Map();
  }

  range(metric, role) {
    const key = `${metric}|${role}`;
    if (!this.ranges.has(key)) {
      const values = this.data[metric];
      const only = role === 'all' ? -1 : this.roleId.get(role) ?? ROLE_LIMIT;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < this.count; i++) {
        if (only >= 0 && this.data.role[i] !== only) continue;
        const v = values[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      this.ranges.set(key, {min: Number.isFinite(min) ? min : null, max});
    }
    return this.ranges.get(key);
  }

  paint(metric, role) {
    const key = metric === 'type' ? 'type' : `${metric}|${role}`;
    if (this.paintKey === key) return;
    this.paintKey = key;
    const attribute = this.mesh.geometry.getAttribute('beadColour');
    const out = attribute.array;
    const colour = new THREE.Color();
    const roleRgb = this.roles.map(type => {
      colour.set(this.roleColours[type] || '#c8c8c8').convertLinearToSRGB();
      return [colour.r, colour.g, colour.b];
    });
    const byType = metric === 'type';
    const {min, max} = byType ? {} : this.range(metric, role);
    const values = byType ? null : this.data[metric];
    for (let i = 0; i < this.count; i++) {
      const rgb = byType ? roleRgb[this.data.role[i]]
        : !Number.isFinite(values[i]) ? [0.6, 0.6, 0.6]
        : rampColour(max > min ? (values[i] - min) / (max - min) : 0.5);
      for (let a = 0; a < 3; a++) out[i * 3 + a] = Math.round(rgb[a] * 255);
    }
    attribute.needsUpdate = true;
  }

  buildTravel() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.data.travel, 3));
    this.travel = new THREE.LineSegments(geometry,
      new THREE.LineBasicMaterial({color: 0x9fb4c6, transparent: true, opacity: 0.45, depthWrite: false}));
    this.travel.frustumCulled = false;
    return this.travel;
  }

  /** @returns {{shown:number,total:number,min:number|null,max:number}} */
  show(options) {
    const end = Math.max(0, Math.min(this.endOfLayer.length - 1, options.layer));
    const start = options.single ? end : Math.max(0, Math.min(end, options.minLayer || 0));
    const role = options.role ?? 'all';
    const roleNumber = role === 'all' ? -1 : this.roleId.get(role) ?? ROLE_LIMIT;

    const u = this.mesh.material.uniforms;
    u.uFirst.value = start;
    u.uLast.value = end;
    u.uRole.value = roleNumber;
    u.uMove.value = options.move ?? Infinity;
    // Abdunkeln nur beim Blaettern: Das fertige Teil soll in voller Farbe stehen.
    u.uDim.value = !options.single && end < this.endOfLayer.length - 1 ? 0.5 : 1;
    this.mesh.geometry.instanceCount = this.endOfLayer[end];
    this.paint(options.metric, role);

    if (this.travel) {
      this.travel.visible = !!options.travel && role === 'all';
      const before = start ? this.travelEnd[start - 1] : 0;
      this.travel.geometry.setDrawRange(before * 2, (this.travelEnd[end] - before) * 2);
    }

    let shown = 0;
    if (role === 'all') {
      shown = this.endOfLayer[end] - (start ? this.endOfLayer[start - 1] : 0);
    } else if (roleNumber < this.countWidth) {
      for (let l = start; l <= end; l++) shown += this.data.roleCounts[l * this.countWidth + roleNumber];
    }
    const {min, max} = options.metric === 'type' ? {min: null, max: -Infinity} : this.range(options.metric, role);
    return {shown, total: shown, min, max};
  }

  movesIn(layer) {
    return this.endOfLayer[layer] - (layer ? this.endOfLayer[layer - 1] : 0);
  }

  /** Ende des n-ten Segments einer Schicht, fuer den Druckkopf beim Abspielen. */
  headAt(layer, move) {
    const n = this.movesIn(layer);
    if (!n) return null;
    const first = layer ? this.endOfLayer[layer - 1] : 0;
    const at = (first + Math.max(0, Math.min(n - 1, Math.floor(move)))) * 3;
    return {to: Array.from(this.data.to.subarray(at, at + 3))};
  }

  raycast(raycaster, hits) {
    const u = this.mesh.material.uniforms;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const point = new THREE.Vector3();
    for (let i = 0; i < this.mesh.geometry.instanceCount; i++) {
      const layer = this.info[i * 3];
      if (layer < u.uFirst.value || (u.uRole.value >= 0 && this.info[i * 3 + 1] !== u.uRole.value)) continue;
      if (layer === u.uLast.value && this.info[i * 3 + 2] > u.uMove.value) continue;
      const {from, to, height, width} = this.data;
      const drop = (height[i] || 0.2) / 2;
      a.set(from[i * 3], from[i * 3 + 1], from[i * 3 + 2] - drop);
      b.set(to[i * 3], to[i * 3 + 1], to[i * 3 + 2] - drop);
      const reach = (width[i] || 0.42) / 2;
      if (raycaster.ray.distanceSqToSegment(a, b, point) > reach * reach) continue;
      hits.push({point: point.clone(), distance: raycaster.ray.origin.distanceTo(point), object: this.mesh});
    }
  }

  dispose() {
    for (const part of [this.mesh, this.travel]) {
      part?.geometry.dispose();
      part?.material.dispose();
    }
  }
}
