// Was Rust von einer Platte fuer die Stuetzen braucht.
import {placement, volumeMesh} from './geometry.js';

const QUICK_COLOURS = {pillar: 0xf2610c, mini: 0xf2610c, tree: 0xe8853a, fan: 0xe8853a, gusset: 0xe8853a};

/**
 * Schnellansicht: jede Stütze als Kopie einer Grundsäule, nur Lage, Höhe und Breite (GPU-Instancing).
 * Nur Stützen, deren Modell seit der Erzeugung nicht bewegt wurde (Signatur gleich).
 */
export function quickSupports({models, meshes, bed}) {
  const out = [];
  for (const model of models) {
    const stored = model.straightSupports;
    const mesh = meshes.get(model.path);
    if (!stored || !mesh || model.enabled === false) continue;
    const box = placement(model, mesh, bed);
    if (stored.signature !== supportSignature(model, mesh, box)) continue;
    const spacing = Number(stored.settings?.spacing) || 3;
    for (const p of [...(stored.automatic || []), ...(stored.manual || [])]) {
      if (!(p.topZ > p.bottomZ)) continue;
      const style = p.style || 'pillar';
      const body = ['tree', 'fan', 'gusset'].includes(style);
      const width = body ? 1.4 : Math.max(0.4, (Number(p.size) || spacing) * 0.6);
      out.push({x: p.x, y: p.y, bottom: p.bottomZ, top: p.topZ, width, colour: QUICK_COLOURS[style] ?? 0xf2610c});
    }
  }
  return out;
}

export const supportCount = model =>
  (model?.straightSupports?.automatic?.length || 0) + (model?.straightSupports?.manual?.length || 0);

const isCut = model => (model.volumes || []).some(volume => volume.cut);

/** Steht so im Arbeitsbereich. Form nicht aendern, sonst gelten gespeicherte Stuetzen als veraltet. */
export function supportSignature(model, mesh, box) {
  return JSON.stringify([model.path, mesh.signature ?? null, box.rows, box.offset,
    (model.volumes || []).filter(v => v.cut).map(v => [v.cut, v.position, v.size])]);
}

/**
 * @param resolve model -> wirksame Prozesswerte
 * @param keys Prozesswerte, die Rust braucht (support_schema)
 */
export function supportPlate({models, meshes, bed, resolve, keys, tools = 1, marks = null}) {
  const present = models.filter(model => model.enabled !== false && meshes.get(model.path));
  return {
    bed: {minX: bed.minX, maxX: bed.maxX, minY: bed.minY, maxY: bed.maxY},
    tools,
    marks,
    models: present.map(model => {
      const mesh = meshes.get(model.path);
      const box = placement(model, mesh, bed);
      const values = resolve(model);
      const resolved = {};
      for (const key of keys) if (values[key] !== undefined) resolved[key] = values[key];
      return {
        id: model.id,
        path: model.path,
        signature: supportSignature(model, mesh, box),
        rows: box.rows,
        offset: box.offset,
        cut: isCut(model),
        parts: (model.volumes || []).filter(v => v.kind === 'ModelPart' && !v.cut).map(v => volumeMesh(v)),
        stored: model.straightSupports ?? null,
        resolved,
        rangeHeights: (model.ranges || []).map(range => range.height),
      };
    }),
  };
}
