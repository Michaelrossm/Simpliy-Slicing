// Alles, was ein Modell im Arbeitsbereich veraendert, mit Rueckgaengig.
import {bestOrientation} from './orientation.js';
import {placement, arrange, rotationToBed, overlapping, insideBed} from './geometry.js';

const copy = value => structuredClone(value);
const numberOr = (value, fallback) => {
  const n = Number(value);
  return value === '' || !Number.isFinite(n) ? fallback : n;
};

/**
 * @param env {state, selected, mesh, meshes, bed, id, notify}: Zugriffe auf den aktuellen Zustand
 */
export function createModelActions(env) {
  const history = [];
  const future = []; // Rückgängig gemachte Zustände, für „Wiederholen“

  const snapshot = () => {
    const state = env.state();
    return JSON.stringify({models: state.models, plates: state.plates, active: state.ui.active_plate});
  };
  const restore = text => {
    const {models, plates, active} = JSON.parse(text);
    const state = env.state();
    state.models = models;
    if (plates) {
      state.plates = plates;
      state.ui.active_plate = active;
    }
  };
  const remember = () => {
    history.push(snapshot());
    future.length = 0; // Eine neue Änderung beendet die Wiederholen-Kette
    if (history.length > 30) history.shift();
  };
  const withModel = change => (...args) => {
    const model = env.selected();
    if (!model) {
      env.notify('Bitte zuerst ein Modell auswählen.', true);
      return false;
    }
    remember();
    change(model, ...args);
    return true;
  };

  function boxOf(model) {
    const mesh = env.meshes().get(model.path);
    return mesh ? placement(model, mesh, env.bed()) : null;
  }

  /** Neuer Platz nahe der Bettmitte, ohne die vorhandenen Teile zu verschieben. */
  function placeFree(model) {
    const box = boxOf(model);
    if (!box) return;
    const others = env.state().models.filter(m => m !== model && m.plate === model.plate && m.enabled !== false).map(boxOf).filter(Boolean);
    const bed = env.bed();
    const cx = (bed.minX + bed.maxX) / 2;
    const cy = (bed.minY + bed.maxY) / 2;
    const spots = [];
    for (let x = bed.minX; x <= bed.maxX; x += 5) for (let y = bed.minY; y <= bed.maxY; y += 5) spots.push([x, y]);
    spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    for (const spot of [[cx, cy], ...spots]) {
      const move = [spot[0] - box.offset[0], spot[1] - box.offset[1], 0];
      const moved = {min: box.min.map((v, a) => v + move[a]), max: box.max.map((v, a) => v + move[a])};
      if (!insideBed(moved, bed)) continue;
      const padded = {min: moved.min.map(v => v - 3), max: moved.max.map(v => v + 3)};
      if (others.some(other => overlapping([padded, other]).size)) continue;
      model.position = spot;
      return;
    }
  }

  return {
    remember,
    placeFree,

    undo() {
      if (!history.length) return false;
      future.push(snapshot());
      restore(history.pop());
      return true;
    },

    redo() {
      if (!future.length) return false;
      history.push(snapshot());
      restore(future.pop());
      return true;
    },

    clear() {
      history.length = 0;
      future.length = 0;
    },

    transform: withModel((model, name, axis, raw, uniform) => {
      if (name === 'position' && axis === 2) {
        // S3D uses the build plate as the origin.  Z is therefore the absolute
        // bottom height, not the model-local sink value.
        const z = numberOr(raw, Number(model.bedZ) || 0);
        model.bedZ = Math.max(0, z);
        delete model.sink;
      } else if (name === 'position') {
        model.position = [...boxOf(model).offset.slice(0, 2)];
        model.position[axis] = numberOr(raw, model.position[axis]);
      } else if (name === 'rotation') {
        model.rotation = [...(model.rotation || [0, 0, 0])];
        model.rotation[axis] = numberOr(raw, model.rotation[axis]);
      } else {
        const scale = [...(model.scale || [100, 100, 100])];
        const old = Math.abs(scale[axis]);
        const current = name === 'size' ? boxOf(model).size[axis] : old;
        const wanted = numberOr(raw, current);
        if (!(wanted > 0) || !(current > 0)) return;
        const factor = wanted / current;
        for (let a = 0; a < 3; a++) if (uniform || a === axis) scale[a] *= factor;
        model.scale = scale;
      }
    }),

    moveTo(id, position) {
      const model = env.state().models.find(m => m.id === id);
      if (!model) return;
      remember();
      model.position = position.map(v => Math.round(v * 100) / 100);
    },

    layOnFace(id, normal) {
      const model = env.state().models.find(m => m.id === id);
      if (!model) return;
      remember();
      model.rotation = rotationToBed(normal, model.scale);
    },

    /** Beste Lage: die Fläche mit der geringsten Überhangfläche kommt aufs Bett (Näherung, Stützen werden nicht geplant). */
    autoOrient() {
      const model = env.selected();
      if (!model) {
        env.notify('Bitte zuerst ein Modell auswählen.', true);
        return false;
      }
      const mesh = env.mesh(model);
      const best = mesh && bestOrientation(mesh.vertices, mesh.indices, 45);
      if (!best) return false;
      remember();
      model.rotation = rotationToBed(best.normal, model.scale);
      delete model.position; // neu auf dem Bett zentrieren, sonst ragt das gedrehte Teil leicht über den Rand
      env.notify(`Beste Lage gesetzt: Überhangfläche ${best.overhang.toFixed(0)} mm², Aufstandsfläche ${best.contact.toFixed(0)} mm², Höhe ${best.height.toFixed(1)} mm.`);
      return true;
    },

    turn: withModel((model, axis, degrees) => {
      model.rotation = [...(model.rotation || [0, 0, 0])];
      model.rotation[axis] = ((model.rotation[axis] + degrees + 540) % 360) - 180;
    }),

    mirror: withModel((model, axis) => {
      model.scale = [...(model.scale || [100, 100, 100])];
      model.scale[axis] *= -1;
    }),

    resetScale: withModel(model => delete model.scale),
    resetRotation: withModel(model => delete model.rotation),
    center: withModel(model => delete model.position),

    duplicate: withModel(model => {
      const twin = {...copy(model), id: env.id('model')};
      env.state().models.push(twin);
      placeFree(twin);
      env.state().ui.selected_model_id = twin.id;
    }),

    remove: withModel(model => {
      const state = env.state();
      state.models = state.models.filter(m => m !== model);
      state.ui.selected_model_id = state.models.filter(m => m.plate === model.plate).at(-1)?.id || '';
    }),

    arrangeAll() {
      const state = env.state();
      const models = state.models.filter(m => m.plate === state.ui.active_plate && m.enabled !== false && env.meshes().has(m.path));
      if (!models.length) return false;
      const centres = arrange(models.map(boxOf), env.bed());
      if (!centres) {
        env.notify('Die Modelle passen nicht gemeinsam auf das Druckbett.', true);
        return false;
      }
      remember();
      models.forEach((model, i) => (model.position = centres[i]));
      return true;
    },

    addVolume: withModel((model, kind) => {
      let low = [Infinity, Infinity, Infinity];
      let high = [-Infinity, -Infinity, -Infinity];
      const v = env.mesh(model).vertices;
      for (let i = 0; i < v.length; i++) {
        low[i % 3] = Math.min(low[i % 3], v[i]);
        high[i % 3] = Math.max(high[i % 3], v[i]);
      }
      const round = n => Math.round(n * 100) / 100;
      (model.volumes ??= []).push({
        kind,
        shape: 'box',
        position: low.map((l, a) => round((l + high[a]) / 2)),
        size: low.map((l, a) => Math.max(2, round((high[a] - l) / 2))),
        settings: kind === 'ParameterModifier' ? {perimeters: 4} : {},
      });
    }),

    editVolume: withModel((model, index, key, axis, value) => {
      const volume = model.volumes?.[index];
      if (!volume) return;
      if (key === 'shape') volume.shape = value;
      else volume[key][axis] = numberOr(value, volume[key][axis]);
    }),

    removeVolume: withModel((model, index) => model.volumes?.splice(index, 1)),

    addRange: withModel(model => {
      const ranges = (model.ranges ??= []);
      const from = ranges.length ? Math.max(...ranges.map(r => r.to)) : 0;
      ranges.push({from, to: from + 5, height: 0.1});
    }),

    editRange: withModel((model, index, key, value) => {
      const range = model.ranges?.[index];
      if (range) range[key] = numberOr(value, range[key]);
    }),

    removeRange: withModel((model, index) => model.ranges?.splice(index, 1)),

    /**
     * Schnittebene. `position`: Abstand vom tiefsten Punkt entlang `axis` (0 = x, 1 = y, 2 = z) in mm,
     * `tilt`: Neigung der Ebene in Grad (dreht die Normale zur nächsten Achse). Gerade Z-Schnitte wie bisher.
     */
    cut: withModel((model, position, keep, axis = 2, tilt = 0) => {
      const v = env.mesh(model).vertices;
      let reach = 1;
      const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < v.length; i++) {
        reach = Math.max(reach, Math.abs(v[i]));
        low[i % 3] = Math.min(low[i % 3], v[i]);
        high[i % 3] = Math.max(high[i % 3], v[i]);
      }
      reach += 5;
      const angle = (Number(tilt) || 0) * Math.PI / 180;
      const next = (axis + 1) % 3;
      const normal = [0, 0, 0];
      normal[axis] = Math.cos(angle);
      normal[next] = Math.sin(angle);
      const centre = [0, 1, 2].map(i => (low[i] + high[i]) / 2);
      centre[axis] = axis === 2 && !angle ? position : low[axis] + position;
      // Achsen des Schnittkörpers: n = Normale, u und v spannen die Ebene auf
      const helper = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const unit = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
      const u = unit(cross(helper, normal));
      const w = unit(cross(normal, u));
      const slab = (cut, side) => ({
        cut, kind: 'NegativeVolume', shape: 'box', settings: {},
        position: centre.map((c, i) => c + normal[i] * side * reach / 2),
        size: [reach * 2, reach * 2, reach],
        orientation: [u, w, normal],
      });
      const removeAbove = slab('above', 1);
      const removeBelow = slab('below', -1);
      if (keep === 'both') {
        const top = {...copy(model), id: env.id('model'), name: `${model.name} (oben)`};
        (top.volumes ??= []).push(removeBelow);
        (model.volumes ??= []).push(removeAbove);
        model.name += ' (unten)';
        env.state().models.push(top);
        placeFree(top);
      } else {
        (model.volumes ??= []).push(keep === 'below' ? removeAbove : removeBelow);
      }
    }),

    setExtra: withModel((model, owner, index, key, value) => {
      const holder = owner === 'volume' ? model.volumes?.[index] : model;
      if (!holder) return;
      holder.settings ??= {};
      if (value === undefined) delete holder.settings[key];
      else holder.settings[key] = value;
    }),
  };
}
