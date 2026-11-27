// Verbindung zum Stuetzen-Kern in Rust. Hier wird nicht gerechnet: fragen, merken, anzeigen.
import {readPacket, latest} from './native.js';
import {supportPlate, supportCount} from './support-plate.js';

/**
 * @param env {invoke, meshes, bed, resolve, changed, failed}
 *   resolve(plate) -> (model -> wirksame Prozesswerte)
 */
export function createSupportClient(env) {
  let schema = {defaults: {}, styles: {}, limits: {}, keys: []};
  const views = latest();
  const pointer = latest();
  let shown = {key: '', plate: '', models: new Map()};
  let wanted = '';
  let queue = Promise.resolve();

  const request = (models, plate, bed, marks = null) => supportPlate({
    models, meshes: env.meshes(), bed, resolve: env.resolve(plate), keys: schema.keys, marks,
  });

  /** Plan der sichtbaren Platte nachziehen. Bis dahin bleibt der bisherige stehen. */
  function refresh({models, plate, bed, marks = null}) {
    if (shown.plate !== plate) shown = {key: '', plate, models: new Map()};
    if (!marks && !models.some(supportCount)) {
      views.cancel();
      wanted = '';
      if (shown.models.size) shown = {key: '', plate, models: new Map()};
      return;
    }
    let input;
    let key;
    try {
      input = request(models, plate, bed, marks);
      key = plate + JSON.stringify(input);
    } catch (error) {
      console.error(error);
      return;
    }
    if (key === wanted) return;
    wanted = key;
    if (key === shown.key) {
      views.cancel();
      return;
    }
    views.run(() => env.invoke('support_plate', {plate: input})).then(data => {
      if (data === undefined) return;
      const {meta, arrays} = readPacket(data);
      const found = new Map();
      meta.models.forEach((model, i) => {
        const part = name => ({vertices: arrays[`${i}.${name}.vertices`], indices: arrays[`${i}.${name}.indices`]});
        found.set(model.id, {
          ...model,
          pillars: part('pillars'),
          pads: part('pads'),
          body: {positions: arrays[`${i}.body.positions`], normals: arrays[`${i}.body.normals`]},
          minima: arrays[`${i}.minima`],
        });
      });
      shown = {key, plate, models: found};
      env.changed();
    }).catch(error => {
      // wanted bleibt stehen, sonst wuerde bei jedem Zeichnen erneut gefragt.
      env.failed(`Stützen: ${error.message || error}`);
    });
  }

  /** Aenderungen laufen nacheinander, jede sieht das Ergebnis der vorigen. */
  function serial(task) {
    const done = queue.then(task);
    queue = done.catch(() => {});
    return done;
  }

  /**
   * @param apply bekommt die Antwort, nur wenn das Modell inzwischen gleich geblieben ist
   * @returns Antwort oder null
   */
  function edit({model, models, plate, bed}, op, apply) {
    return serial(async () => {
      const list = models();
      if (!list.includes(model)) return null;
      const place = bed();
      const own = () => {
        const item = request([model], plate, place).models[0];
        return JSON.stringify([item?.signature, item?.stored]);
      };
      const before = own();
      const answer = await env.invoke('support_edit', {request: {plate: request(list, plate, place), id: model.id, op}});
      if (!models().includes(model) || own() !== before) throw Error('Das Modell wurde währenddessen geändert. Bitte noch einmal.');
      apply(answer);
      return answer;
    });
  }

  async function hover({model, models, plate, bed}, mode, moving, point) {
    const data = await pointer.run(() => env.invoke('support_hover', {
      request: {plate: request(models(), plate, bed()), id: model.id, mode, moving, point},
    }));
    if (data === undefined) return undefined;
    const {meta, arrays} = readPacket(data);
    return meta && {...meta, ...arrays};
  }

  return {
    async load() { schema = await env.invoke('support_schema'); },
    schema: () => schema,
    settings: model => ({...schema.defaults, ...model?.straightSupports?.settings}),
    request,
    refresh,
    views: () => shown.models,
    /** Genaue Planung für den aktuellen Stand läuft noch (Anzeige bis dahin als Schnellansicht). */
    pending: () => !!wanted && wanted !== shown.key,
    edit,
    hover,
    settled: () => queue,
  };
}
