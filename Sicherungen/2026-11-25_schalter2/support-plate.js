// Was Rust von einer Platte fuer die Stuetzen braucht.
import {placement, volumeMesh} from './geometry.js';

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
