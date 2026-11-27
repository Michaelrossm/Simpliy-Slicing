// Eine dauerhafte 3D-Ansicht: Bett, Modelle, Bemalung, Zusatzkoerper, Werkzeugwege.
// Wird beim Neuzeichnen der Oberflaeche nur umgehaengt, Kamera und Geometrie bleiben erhalten.
import * as THREE from './vendor/build/three.module.js';
import {OrbitControls} from './vendor/addons/controls/OrbitControls.js';
import {placement, keptRange, volumeMesh, insideBed, overlapping} from './geometry.js';
import {paintedTriangles} from './paint-core.js';
import {sectionPlaneSpec} from './section.js';
import {RenderPipeline} from './render-pipeline.js';
import {ToolpathRenderer} from './toolpath-render.js';
import {meshGeometry, drawnGeometry, overhangColours} from './surface-shading.js';

export const TOOL_COLOURS = ['#f3a31a', '#db5182', '#3ec0ff', '#ff4f4f', '#fbeb7d', '#7ed957', '#b084f5', '#f0f0f0'];
export const ROLE_COLOURS = {
  'Perimeter': '#ffa51f', 'External perimeter': '#ffd042', 'Overhang perimeter': '#4f7fff',
  'Internal infill': '#da4c58', 'Solid infill': '#b55fd0', 'Top solid infill': '#ffea83',
  'Bridge infill': '#74bfe4', 'Gap fill': '#f4f4f4', 'Ironing': '#ff9ec4', 'Skirt/Brim': '#77bc64',
  'Support material': '#38b99a', 'Support material interface': '#9ef0d8', 'Wipe tower': '#b3e3ab',
  'Travel': '#647789',
};
function indexed({vertices, indices}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

const PAINT_COLOURS = {support: ['#3186ff', '#ff3b3b'], seam: ['#33d17a', '#ff3b3b'], fuzzy: ['#c36bff'], color: TOOL_COLOURS};
const VOLUME_COLOURS = {NegativeVolume: '#777777', ParameterModifier: '#ffe14d', ModelPart: '#f3e2b0', SupportBlocker: '#ff4040', SupportEnforcer: '#3186ff'};

function release(object) {
  object.traverse(node => {
    if (!node.userData.shared) node.geometry?.dispose();
    for (const material of [node.material].flat()) material?.dispose();
  });
}

function empty(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    release(child);
  }
}

function skyTexture() {
  const top = [44, 48, 54];
  const bottom = [86, 96, 108];
  const rows = 256;
  const data = new Uint8Array(rows * 4);
  for (let i = 0; i < rows; i++) {
    for (let a = 0; a < 3; a++) data[i * 4 + a] = Math.round(bottom[a] + (top[a] - bottom[a]) * i / (rows - 1));
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 1, rows);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class Viewport {
  /** @param on {select, move, face, paint, strokeEnd} */
  constructor(on = {}) {
    this.on = on;
    this.element = document.createElement('div');
    this.element.className = 'gl-host';
    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 8000);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({antialias: true});
    this.renderer.localClippingEnabled = true;
    // Auch auf 100-%-Bildschirmen feiner rechnen als anzeigen.
    this.pixelRatio = 2;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.pipeline = new RenderPipeline(this.renderer);
    this.element.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.addEventListener('change', () => this.redraw());

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    // Licht haengt an der Kamera, damit keine Seite schwarz wird.
    for (const [intensity, x, y, z] of [[1.85, 120, 260, 300], [0.65, -280, -60, 220], [0.3, 40, -300, 60]]) {
      const light = new THREE.DirectionalLight(0xffffff, intensity);
      light.position.set(x, y, z);
      light.target.position.set(0, 0, 0);
      this.camera.add(light, light.target);
    }
    this.scene.add(this.camera);
    this.head = new THREE.Mesh(new THREE.ConeGeometry(2.2, 7, 24).rotateX(-Math.PI / 2).translate(0, 0, 3.5),
      new THREE.MeshStandardMaterial({color: '#d9dde1', roughness: 0.35, metalness: 0.4}));
    this.head.visible = false;
    this.scene.add(this.head);

    this.bedGroup = new THREE.Group();
    this.modelGroup = new THREE.Group();
    this.pathGroup = new THREE.Group();
    this.supportGroup = new THREE.Group();
    this.supportPreviewGroup = new THREE.Group();
    this.supportHint = document.createElement('div');
    this.supportHint.className = 'support-cursor-hint';
    this.element.append(this.supportHint);
    this.ring = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({color: 0xffffff, wireframe: true, transparent: true, opacity: 0.22, depthWrite: false}),
    );
    this.ring.visible = false;
    this.overlayGroup = new THREE.Group();
    this.sectionGroup = new THREE.Group();
    this.markGroup = new THREE.Group();
    this.scene.add(this.markGroup);
    this.sectionBases = new WeakMap();
    this.scene.add(this.bedGroup, this.modelGroup, this.supportGroup, this.supportPreviewGroup, this.pathGroup, this.ring, this.overlayGroup, this.sectionGroup);

    this.tool = {name: 'select'};
    this.placed = new Map(); // id -> {holder, body, paint, box, model}
    this.geometries = new WeakMap(); // PaintMesh -> BufferGeometry
    this.raycaster = new THREE.Raycaster();
    this.pointer = null;

    new ResizeObserver(() => this.resize()).observe(this.element);
    this.bindPointer();
  }

  mount(host) {
    if (this.element.parentNode !== host) host.prepend(this.element);
    this.resize();
  }

  resize() {
    const w = this.element.clientWidth;
    const h = this.element.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h, this.pixelRatio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.redraw();
  }

  redraw() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      // Nahe heran darf nichts abgeschnitten werden, weit weg muss die Tiefe genau bleiben.
      const distance = this.camera.position.distanceTo(this.controls.target);
      this.camera.near = Math.max(0.1, Math.min(5, distance / 150));
      this.camera.far = distance + 3000;
      this.camera.updateProjectionMatrix();
      if (this.toolpath) this.toolpath.mesh.material.uniforms.uPixels.value = this.element.clientHeight;
      this.pipeline.render(this.scene, this.camera);
    });
  }

  setBed(bed) {
    const key = JSON.stringify(bed);
    if (key === this.bedKey) return;
    this.bedKey = key;
    this.bed = bed;
    empty(this.bedGroup);
    const {minX, maxX, minY, maxY, height, points} = bed;
    const shape=new THREE.Shape();
    points.forEach((point,index)=>index?shape.lineTo(point[0],point[1]):shape.moveTo(point[0],point[1]));
    shape.closePath();
    const plate=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:0x90969c,side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1}));
    plate.position.z=-0.08;plate.receiveShadow=false;this.bedGroup.add(plate);
    const minor = [];
    const major = [];
    for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) (x % 50 ? minor : major).push(x, minY, 0, x, maxY, 0);
    for (let y = Math.ceil(minY / 10) * 10; y <= maxY; y += 10) (y % 50 ? minor : major).push(minX, y, 0, maxX, y, 0);
    this.addLines(minor, '#80868c');
    this.addLines(major, '#656b71');
    const frame = [];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      frame.push(p[0], p[1], 0, q[0], q[1], 0, p[0], p[1], height, q[0], q[1], height);
      if (points.length <= 8) frame.push(p[0], p[1], 0, p[0], p[1], height);
    });
    this.addLines(frame, '#8d949c');
    const axes = new THREE.AxesHelper(30);
    axes.position.set(minX, minY, 0.1);
    this.bedGroup.add(axes);
    this.setView('iso');
  }

  addLines(list, color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    this.bedGroup.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color})));
  }

  /** Vorschaubild fuer den G-Code: nur Modelle und Stuetzen, isometrisch eingepasst, transparenter Hintergrund. PNG als Base64. */
  thumbnail(width, height) {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20000);
    camera.up.set(0, 0, 1);
    camera.position.copy(center).addScaledVector(new THREE.Vector3(0.6, -1.1, 0.8).normalize(), radius / Math.sin(15 * Math.PI / 180));
    camera.lookAt(center);
    camera.add(new THREE.DirectionalLight(0xffffff, 1.9));
    this.scene.add(camera);
    // Auswahlrahmen und Hilfsobjekte gehoeren nicht ins Bild.
    const hidden = [this.bedGroup, this.pathGroup, this.ring, this.overlayGroup, this.sectionGroup, this.markGroup, this.head, this.supportPreviewGroup,
      ...this.modelGroup.children.filter(o => o.type === 'Box3Helper')].filter(g => g.visible);
    hidden.forEach(g => { g.visible = false; });
    const background = this.scene.background;
    this.scene.background = null;
    const target = new THREE.WebGLRenderTarget(width, height, {samples: 4});
    const clear = this.renderer.getClearAlpha();
    try {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(this.scene, camera);
      const pixels = new Uint8Array(width * height * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      const image = context.createImageData(width, height);
      // WebGL liest von unten nach oben.
      for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
      context.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    } finally {
      this.renderer.setRenderTarget(null);
      this.renderer.setClearAlpha(clear);
      target.dispose();
      this.scene.background = background;
      hidden.forEach(g => { g.visible = true; });
      this.scene.remove(camera);
      this.redraw();
    }
  }

  setView(name) {
    if (!this.bed) return;
    const {minX, maxX, minY, maxY, height} = this.bed;
    const size = Math.max(maxX - minX, maxY - minY, 100);
    const target = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, Math.min(40, height / 5));
    if (name === 'fit') {
      const box = new THREE.Box3().setFromObject(this.pathGroup.children.length ? this.pathGroup : this.modelGroup);
      if (box.isEmpty()) return;
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      box.getCenter(target);
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      this.camera.position.copy(target).addScaledVector(direction, Math.max(radius, 5) / Math.sin(18 * Math.PI / 180));
    } else {
      const direction = {
        iso: [0.6, -1.1, 0.8], front: [0, -1, 0.02], back: [0, 1, 0.02],
        left: [-1, 0, 0.02], right: [1, 0, 0.02], top: [0, -0.001, 1], bottom: [0, -0.001, -1],
      }[name];
      this.camera.position.copy(target).addScaledVector(new THREE.Vector3(...direction).normalize(), size * 1.65);
    }
    this.controls.target.copy(target);
    this.controls.update();
    this.redraw();
  }

  geometryOf(mesh) {
    let geometry = this.geometries.get(mesh);
    if (!geometry) {
      geometry = meshGeometry(mesh);
      this.geometries.set(mesh, geometry);
    }
    return geometry;
  }

  /** @returns Meldungen zur Platzierung */
  setModels(models, meshes, selectedId, zones = []) {
    empty(this.modelGroup);
    this.placed.clear();
    const shown = [];
    for (const model of models) {
      const mesh = meshes.get(model.path);
      if (!mesh || model.enabled === false) continue;
      const box = placement(model, mesh, this.bed);
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      const [a, b, c] = box.rows;
      const [x, y, z] = box.offset;
      holder.matrix.set(...a, x, ...b, y, ...c, z, 0, 0, 0, 1);

      const body = new THREE.Mesh(this.geometryOf(mesh), new THREE.MeshStandardMaterial({
        color: TOOL_COLOURS[Math.max(0, (model.tool || 1) - 1) % TOOL_COLOURS.length], roughness: 0.52, metalness: 0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      body.userData = {shared: true, id: model.id};
      holder.add(body);

      const range = keptRange(model);
      if (range) {
        const planes = [];
        if (range.from > -Infinity) planes.push(new THREE.Plane(new THREE.Vector3(0, 0, 1), -range.from));
        if (range.to < Infinity) planes.push(new THREE.Plane(new THREE.Vector3(0, 0, -1), range.to));
        body.material.clippingPlanes = planes.map(plane => plane.applyMatrix4(holder.matrix));
      }
      for (const volume of model.volumes || []) {
        if (volume.cut) continue;
        const data = volumeMesh(volume);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices.flat(), 3));
        geometry.setIndex(data.triangles.flat());
        const solid = volume.kind === 'ModelPart';
        const carved = volume.shape === 'text' && !solid;
        const tool = volume.settings?.extruder;
        const color = carved ? '#2a2016' : solid && tool ? TOOL_COLOURS[(tool - 1) % TOOL_COLOURS.length] : VOLUME_COLOURS[volume.kind];
        const material = solid
          ? new THREE.MeshStandardMaterial({color, roughness: 0.6, flatShading: true})
          : new THREE.MeshBasicMaterial({color, transparent: true, opacity: carved ? 0.9 : 0.3, depthWrite: false});
        holder.add(new THREE.Mesh(geometry, material));
      }
      const paint = new THREE.Group();
      holder.add(paint);
      this.modelGroup.add(holder);
      const item = {holder, body, paint, box, model, mesh};
      this.placed.set(model.id, item);
      shown.push(item);
      this.refreshPaint(model.id);
    }

    const clash = overlapping(shown.map(i => i.box));
    const warnings = [];
    shown.forEach((item, i) => {
      const outside = !insideBed(item.box, this.bed);
      if (outside) warnings.push(`${item.model.name}: außerhalb des Bauraums`);
      else if (clash.has(i)) warnings.push(`${item.model.name}: überlappt ein anderes Modell`);
      if (outside || clash.has(i)) item.body.material.color.set('#d05a4e');
      if (item.model.id === selectedId) {
        const bounds = new THREE.Box3(new THREE.Vector3(...item.box.min), new THREE.Vector3(...item.box.max));
        this.modelGroup.add(new THREE.Box3Helper(bounds, '#4db3ff'));
        // Zonen-Prozesse des Modells: halbtransparente blaue Quader ueber dem Z-Bereich.
        for (const zone of zones) {
          const z0 = Math.max(item.box.min[2], zone.from ?? item.box.min[2]);
          const z1 = Math.min(item.box.max[2], zone.to ?? item.box.max[2]);
          if (!(z1 > z0)) continue;
          const pad = 0.6;
          const size = [item.box.max[0] - item.box.min[0] + 2 * pad, item.box.max[1] - item.box.min[1] + 2 * pad, z1 - z0];
          const geometry = new THREE.BoxGeometry(...size);
          const centre = [(item.box.min[0] + item.box.max[0]) / 2, (item.box.min[1] + item.box.max[1]) / 2, (z0 + z1) / 2];
          const slab = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: '#2020ff', transparent: true, opacity: 0.35, depthWrite: false}));
          slab.position.set(...centre);
          slab.renderOrder = 5;
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({color: '#7f9cff'}));
          edges.position.set(...centre);
          this.modelGroup.add(slab, edges);
        }
      }
    });
    this.modelGroup.updateMatrixWorld(true);
    this.redraw();
    return warnings;
  }

  /** Gerade Stützen erscheinen in Weltkoordinaten und werden nicht als Modelle selektiert. */
  setSupports(views = new Map()) {
    if (!this.supportGroup || this.supportViews === views) return;
    this.supportViews = views;
    empty(this.supportGroup);
    for (const [id, view] of views) {
      if (view.stale) continue;
      const add = (geometry, flatShading, color) => {
        const material = new THREE.MeshStandardMaterial({color, roughness: 0.55, metalness: 0, flatShading, side: THREE.DoubleSide});
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = {isSupport: true, modelId: id};
        this.supportGroup.add(mesh);
      };
      if (view.pillars.indices.length) add(indexed(view.pillars), true, '#f2610c');
      if (view.body.positions.length) add(drawnGeometry(view.body.positions, view.body.normals), false, '#f2610c');
      if (view.pads.indices.length) add(indexed(view.pads), true, '#ffc08f');
    }
    this.redraw();
  }

  /** Ueberhang-Farbkarte und rote Marken an den tiefsten Punkten. */
  setAnalysis(id, settings, minima) {
    const heat = id && settings?.heatmap;
    const marks = id && settings?.detectMinima;
    const item = id ? this.placed.get(id) : null;
    const key = item ? JSON.stringify([id, !!heat, !!marks, settings.overhangAngle, item.holder.matrix.elements, item.box.offset]) : '';
    if (this.analysisKey === key && this.analysisMinima === minima && (!item || this.analysisBody === item.body)) return;
    this.analysisMinima = minima;
    this.analysisKey = key;
    this.analysisBody = item?.body;
    for (const other of this.placed.values()) {
      if (!other.heated) continue;
      other.body.material.vertexColors = false;
      other.body.material.color.copy(other.heated);
      other.body.material.needsUpdate = true;
      other.body.geometry.deleteAttribute('color');
      other.body.geometry = this.geometryOf(other.mesh);
      other.heated = null;
    }
    empty(this.markGroup);
    if (item && heat) {
      const base = this.geometryOf(item.mesh);
      const own = new THREE.BufferGeometry();
      own.setAttribute('position', base.getAttribute('position'));
      own.setAttribute('normal', base.getAttribute('normal'));
      own.setAttribute('color', new THREE.BufferAttribute(
        overhangColours(base.getAttribute('position').array, item.holder.matrix, settings.overhangAngle).map(v => Math.round(255 * (v / 255) ** 2.2)), 3, true));
      own.boundingSphere = base.boundingSphere;
      item.heated = item.body.material.color.clone();
      item.body.geometry = own;
      item.body.material.color.set('#ffffff');
      item.body.material.vertexColors = true;
      item.body.material.needsUpdate = true;
    }
    if (item && marks) {
      for (let i = 0; i < (minima?.length || 0); i += 3) {
        const mark = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10), new THREE.MeshBasicMaterial({color: '#ff2d23', depthTest: false, transparent: true, opacity: 0.85}));
        mark.position.fromArray(minima, i);
        mark.renderOrder = 40;
        this.markGroup.add(mark);
      }
    }
    this.redraw();
  }

  refreshPaint(id) {
    const item = this.placed.get(id);
    if (!item) return;
    empty(item.paint);
    const kinds = this.tool.name === 'paint' ? [this.tool.kind] : ['color', 'fuzzy', 'seam', 'support'];
    for (const kind of kinds) {
      for (const [state, list] of paintedTriangles(item.mesh, item.model.paint?.[kind])) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
        const palette = PAINT_COLOURS[kind];
        item.paint.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
          color: palette[(state - 1) % palette.length], side: THREE.DoubleSide,
        })));
      }
    }
    this.redraw();
  }

  setTool(tool) {
    const changed = tool.name !== this.tool.name || tool.kind !== this.tool.kind;
    this.tool = tool;
    if(tool.name!=='supports'||!tool.mode||tool.mode==='none')this.clearSupportPreview();
    this.ring.visible = false;
    if (tool.name !== 'flat') this.showFlatFace(null);
    if (changed) for (const id of this.placed.keys()) this.refreshPaint(id);
    this.redraw();
  }

  setOverlay(overlay) {
    empty(this.overlayGroup);
    if (overlay) {
      const onTop = color => ({color, depthTest: false, transparent: true});
      for (const point of overlay.points) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial(onTop('#53c8ff')));
        dot.position.fromArray(point);
        dot.scale.setScalar(this.camera.position.distanceTo(dot.position) * 0.005);
        this.overlayGroup.add(dot);
      }
      if (overlay.line) {
        const geometry = new THREE.BufferGeometry().setFromPoints(overlay.line.map(p => new THREE.Vector3(...p)));
        this.overlayGroup.add(new THREE.Line(geometry, new THREE.LineBasicMaterial(onTop('#53c8ff'))));
      }
    }
    this.redraw();
  }

  /** Alles, was Text und Messen ueber den angeklickten Punkt wissen muessen. */
  describe(hit, event) {
    const matrix = hit.item.holder.matrixWorld;
    const normal = hit.item.mesh.normal(hit.triangle);
    const worldNormal = new THREE.Vector3(...normal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
    const r = this.renderer.domElement.getBoundingClientRect();
    let snapped = hit.world;
    let nearest = 10; // Pixel
    for (const corner of hit.item.mesh.triangle(hit.triangle)) {
      const world = new THREE.Vector3(...corner).applyMatrix4(matrix);
      const screen = world.clone().project(this.camera);
      const distance = Math.hypot(r.left + (screen.x + 1) / 2 * r.width - event.clientX, r.top + (1 - screen.y) / 2 * r.height - event.clientY);
      if (distance < nearest) {
        nearest = distance;
        snapped = world;
      }
    }
    return {id: hit.id, point: hit.point, normal, worldNormal: worldNormal.normalize().toArray(), snapped: snapped.toArray()};
  }

  setToolpath(preview, options) {
    this.modelGroup.visible = !preview;
    this.overlayGroup.visible = !preview;
    if(this.supportGroup)this.supportGroup.visible = !preview;
    if(this.markGroup)this.markGroup.visible = !preview;
    if (!preview) {
      if (this.toolpath) this.dropToolpath();
      this.redraw();
      return null;
    }
    const fresh = this.toolpath?.preview !== preview;
    if (fresh) {
      this.dropToolpath();
      this.toolpath = new ToolpathRenderer(preview, ROLE_COLOURS);
      this.pathGroup.add(this.toolpath.mesh);
    }
    if (options.travel && !this.toolpath.travel) this.pathGroup.add(this.toolpath.buildTravel());
    const info = this.toolpath.show(options);
    const playing = Number.isFinite(options.move);
    if (this.head) {
      const at = playing ? this.toolpath.headAt(options.layer, options.move) : null;
      this.head.visible = !!at;
      if (at) this.head.position.fromArray(at.to);
    }
    // Beim ersten Anzeigen auf das Teil zoomen. Ein kleines Teil im grossen Bauraum wirkt sonst grob.
    if (fresh && this.camera && this.controls && this.lastPreview !== preview) this.setView('fit');
    this.lastPreview = preview;
    this.redraw();
    return info;
  }

  dropToolpath() {
    this.toolpath?.dispose();
    this.toolpath = null;
    this.pathGroup.clear();
    if (this.head) this.head.visible = false;
  }

  /** Bounds of the visible object for a useful default section position. */
  sectionExtent(orientation) {
    const index={X:0,Y:1,Z:2}[String(orientation).slice(1).toUpperCase()];
    if(index===undefined)return null;
    const group=this.modelGroup.visible?this.modelGroup:this.pathGroup;
    group.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(group);
    return box.isEmpty()?null:[box.min.getComponent(index),box.max.getComponent(index)];
  }

  /** View-only clipping, applied to model and G-code without changing model geometry. */
  setSection(settings) {
    this.section=settings;
    const key=JSON.stringify([settings.enabled,settings.orientation,settings.position,settings.showPlane,settings.showGizmo,this.bedKey]);
    if(key!==this.sectionKey){
      this.sectionKey=key;empty(this.sectionGroup);this.sectionPlane=null;
      if(settings.enabled&&this.bed){
        const spec=sectionPlaneSpec(settings.orientation,Number(settings.position));
        const normal=new THREE.Vector3(...spec.normal);this.sectionPlane=new THREE.Plane(normal,spec.constant);
        const bed=this.bed,size=Math.max(bed.maxX-bed.minX,bed.maxY-bed.minY,bed.height,100)*1.15;
        const center=new THREE.Vector3((bed.minX+bed.maxX)/2,(bed.minY+bed.maxY)/2,bed.height/2);center.setComponent(spec.index,Number(settings.position));
        if(settings.showPlane){const geometry=new THREE.PlaneGeometry(size,size);const material=new THREE.MeshBasicMaterial({color:0x78bdff,transparent:true,opacity:.12,side:THREE.DoubleSide,depthWrite:false});const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(center);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);this.sectionGroup.add(mesh);const border=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0xcbe9ff,transparent:true,opacity:.9}));border.position.copy(center);border.quaternion.copy(mesh.quaternion);this.sectionGroup.add(border)}
        if(settings.showGizmo){const arrow=new THREE.ArrowHelper(normal,center,size*.16,0xff6e4e,size*.05,size*.03);this.sectionGroup.add(arrow)}
      }
    }
    for(const group of [this.modelGroup,this.supportGroup,this.pathGroup].filter(Boolean))group.traverse(node=>{
      for(const material of [node.material].flat()){
        if(!material)continue;
        if(!this.sectionBases.has(material))this.sectionBases.set(material,{planes:(material.clippingPlanes||[]).slice(),clipShadows:material.clipShadows});
        const base=this.sectionBases.get(material),next=this.sectionPlane?[...base.planes,this.sectionPlane]:base.planes;
        material.clipShadows=this.sectionPlane?true:base.clipShadows;
        const current=material.clippingPlanes||[];
        if(current.length!==next.length||current.some((plane,i)=>plane!==next[i])){material.clippingPlanes=next.length?next:null;material.needsUpdate=true}
      }
    });
    this.redraw();
  }

  ray(event) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const at = new THREE.Vector2((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1);
    this.raycaster.setFromCamera(at, this.camera);
    return this.raycaster;
  }

  /** Ablegen: ebene Flaeche unter der Maus markieren (wie die spaetere Auflageflaeche). */
  showFlatFace(hit) {
    const key = hit ? `${hit.id}:${hit.triangle}` : '';
    if (this.flatFace && key && this.flatFace.id === hit.id && this.flatFace.set.has(hit.triangle)) return;
    if (this.flatFace) {
      this.flatFace.mesh.parent?.remove(this.flatFace.mesh);
      this.flatFace.mesh.geometry.dispose();
      this.flatFace.mesh.material.dispose();
      this.flatFace = null;
    }
    if (hit) {
      const mesh = hit.item.mesh;
      const tris = mesh.planar(hit.triangle);
      const pos = new Float32Array(tris.length * 9);
      tris.forEach((t, i) => mesh.triangle(t).forEach((p, k) => pos.set(p, i * 9 + k * 3)));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const overlay = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color: '#1e90ff', transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2}));
      overlay.renderOrder = 40;
      overlay.raycast = () => {};
      hit.item.holder.add(overlay);
      this.flatFace = {id: hit.id, set: new Set(tris), mesh: overlay};
    }
    this.canvasCursor?.(hit ? 'pointer' : '');
    this.redraw();
  }

  pick(event) {
    const bodies = [...this.placed.values()].map(item => item.body);
    const hit = this.ray(event).intersectObjects(bodies, false)[0];
    if (!hit) return null;
    const item = this.placed.get(hit.object.userData.id);
    const inverse = item.holder.matrixWorld.clone().invert();
    return {
      item,
      id: hit.object.userData.id,
      world: hit.point.clone(),
      point: hit.point.clone().applyMatrix4(inverse).toArray(),
      view: this.camera.position.clone().applyMatrix4(inverse).sub(hit.point.clone().applyMatrix4(inverse)).normalize().toArray(),
      triangle: hit.faceIndex,
    };
  }

  clearSupportPreview() {
    this.hoverTurn = (this.hoverTurn || 0) + 1;
    if(this.supportPreviewGroup)empty(this.supportPreviewGroup);
    if(this.supportHint)this.supportHint.textContent='';
    this.redraw();
  }

  supportTargetAt(event,mode) {
    const hit=this.pick(event);
    const onSupport=['remove','removearea','edit','editarea','take'].includes(mode)||(mode==='move'&&!this.tool.moving);
    const supportHit=onSupport&&this.supportGroup
      ?this.ray(event).intersectObjects(this.supportGroup.children,false)[0]:null;
    const onBed=this.ray(event).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,0,1),0),new THREE.Vector3());
    const validBed=onBed&&this.bed&&onBed.x>=this.bed.minX&&onBed.x<=this.bed.maxX
      &&onBed.y>=this.bed.minY&&onBed.y<=this.bed.maxY;
    const surface=hit?.id===this.tool.modelId?hit:null;
    return supportHit?{modelId:supportHit.object.userData.modelId,kind:'pillar',xyz:supportHit.point.toArray()}
      :surface?{modelId:surface.id,kind:'surface',xyz:surface.world.toArray()}
      :hit&&hit.id!==this.tool.modelId?null
      :validBed?{modelId:this.tool.modelId,kind:'bed',xyz:onBed.toArray()}:null;
  }

  async showSupportPreview(event) {
    const target = this.supportTargetAt(event, this.tool.mode);
    const turn = this.hoverTurn = (this.hoverTurn || 0) + 1;
    const preview = target ? await this.on.supportPreview?.(target) : null;
    // undefined = von einer neueren Mausposition ueberholt
    if (preview === undefined || turn !== this.hoverTurn || !this.supportPreviewGroup) return;
    empty(this.supportPreviewGroup);
    if (!preview) {
      if (this.supportHint) this.supportHint.textContent = 'Keine gueltige Position';
      this.redraw();
      return;
    }
    const geometry = indexed(preview);
    geometry.computeVertexNormals();
    const color = this.tool.mode?.startsWith('remove') ? '#ff544d' : '#51caff';
    const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, side: THREE.DoubleSide}));
    body.renderOrder = 50;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({color, depthTest: false}));
    edges.renderOrder = 51;
    this.supportPreviewGroup.add(body, edges);
    if (this.supportHint) {
      const {label, width, x, y, low, high} = preview;
      this.supportHint.textContent = `${label}: ${width.toFixed(2)} x ${width.toFixed(2)} mm | X ${x.toFixed(2)}  Y ${y.toFixed(2)} | Z ${low.toFixed(2)} - ${high.toFixed(2)} mm`;
    }
    this.redraw();
  }

  bindPointer() {
    const canvas = this.renderer.domElement;
    const paintAt = (hit, event) => this.on.paint?.(hit, {erase: event.shiftKey});

    // Capture-Phase: wir entscheiden vor OrbitControls, wem der Mausklick gehoert.
    canvas.addEventListener('pointerdown', event => {
      if(event.button!==0)return;
      if(this.section?.enabled&&this.section?.pickPoint){
        const targets=this.modelGroup.visible?[...this.placed.values()].map(item=>item.body):this.pathGroup.children.filter(x=>x.isMesh);
        const hits=this.ray(event).intersectObjects(targets,true);
        const hit=hits.find(h=>(!this.sectionPlane||this.sectionPlane.distanceToPoint(h.point)>=-1e-5)&&(h.object.material.clippingPlanes||[]).every(p=>p.distanceToPoint(h.point)>=-1e-5));
        if(hit){event.stopImmediatePropagation();this.on.sectionPoint?.(hit.point.toArray())}return;
      }
      if (!this.modelGroup.visible) return;
      const {name,mode} = this.tool;
      if(name==='supports' && mode && mode!=='none' && !event.ctrlKey && !event.altKey) {
        const target=this.supportTargetAt(event,mode);
        if(target) {
          event.stopImmediatePropagation();
          canvas.setPointerCapture(event.pointerId);
          this.pointer={x:event.clientX,y:event.clientY,owned:true,supportTarget:target};
          return;
        }
      }
      const hit = this.pick(event);
      this.pointer = {x: event.clientX, y: event.clientY, hit};
      if (!hit) return;
      if (name === 'paint' || name === 'flat' || name === 'move') {
        event.stopImmediatePropagation();
        canvas.setPointerCapture(event.pointerId);
        this.pointer.owned = true;
        if (name === 'paint') paintAt(hit, event);
        if (name === 'move') {
          this.pointer.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -hit.world.z);
          this.pointer.origin = hit.item.box.offset.slice(0, 2);
        }
      }
    }, true);

    canvas.addEventListener('pointermove', event => {
      const down = this.pointer;
      const {name} = this.tool;
      if(name==='supports' && this.tool.mode && this.tool.mode!=='none' && this.modelGroup.visible && !down){
        const now=performance.now();if(!this.supportPreviewTime||now-this.supportPreviewTime>80){this.supportPreviewTime=now;this.showSupportPreview(event)}
      } else if (name === 'flat' && this.modelGroup.visible && !down) {
        this.showFlatFace(this.pick(event));
      } else if (name === 'paint' && this.modelGroup.visible && (!down || down.owned)) {
        const hit = this.pick(event);
        this.ring.visible = !!hit && !this.tool.fill;
        if (hit) {
          const scale = Math.cbrt(Math.abs(hit.item.holder.matrix.determinant()));
          this.ring.position.copy(hit.world);
          this.ring.scale.setScalar(this.tool.radius * scale);
          if (down?.owned && hit.id === down.hit.id) paintAt(hit, event);
        }
        this.redraw();
      } else if (down?.plane) {
        const now = this.ray(event).ray.intersectPlane(down.plane, new THREE.Vector3());
        if (!now) return;
        down.position = [down.origin[0] + now.x - down.hit.world.x, down.origin[1] + now.y - down.hit.world.y];
        const matrix = down.hit.item.holder.matrix.elements;
        matrix[12] = down.position[0];
        matrix[13] = down.position[1];
        down.hit.item.holder.matrixWorldNeedsUpdate = true;
        this.redraw();
      }
    });

    const finish = event => {
      const down = this.pointer;
      this.pointer = null;
      if (!down) return;
      const still = Math.hypot(event.clientX - down.x, event.clientY - down.y) < 4;
      const {name} = this.tool;
      if (down.supportTarget && still && name==='supports') this.on.supportPoint?.(down.supportTarget);
      else if (down.supportTarget) return;
      else if (down.owned && name === 'paint') this.on.strokeEnd?.(down.hit.id);
      else if (down.position && !still) this.on.move?.(down.hit.id, down.position);
      else if (still && down.hit && name === 'flat') this.on.face?.(down.hit.id, down.hit.item.mesh.normal(down.hit.triangle));
      else if (still && down.hit && (name === 'text' || name === 'measure')) this.on.pick?.(name, this.describe(down.hit, event));
      else if (still && down.hit) this.on.select?.(down.hit.id);
    };
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('pointerleave',()=>{this.clearSupportPreview();this.showFlatFace(null)});
  }
}
