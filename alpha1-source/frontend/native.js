// Rust antwortet bei grossen Netzen mit JSON-Kopf und rohen Zahlenfeldern (packet.rs).
export function readPacket(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
  const buffer = bytes.buffer;
  const headLength = new DataView(buffer, 0, 4).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headLength)));
  const arrays = {};
  for (const {name, type, offset, length} of head.arrays) {
    const Type = type === 'u32' ? Uint32Array : Float32Array;
    arrays[name] = new Type(buffer, 4 + headLength + offset, length);
  }
  return {meta: head.meta, arrays};
}

/**
 * Netz aus load_mesh. `cornerNormals` sind nur zum Zeichnen,
 * die Flaechennormalen von PaintMesh (Bemalen, Ablegen, Text) heissen `normals`.
 */
export function readMesh(data, PaintMesh) {
  const buffer = data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer;
  const [points, faces, signature] = new Uint32Array(buffer, 0, 3);
  const mesh = new PaintMesh(new Float32Array(buffer, 12, points * 3), new Uint32Array(buffer, 12 + points * 12, faces * 3));
  mesh.signature = signature;
  const drawn = 12 + points * 12 + faces * 12;
  if (buffer.byteLength >= drawn + faces * 36) mesh.cornerNormals = new Float32Array(buffer, drawn, faces * 9);
  return mesh;
}

/** Nur die neueste Antwort zaehlt, ueberholte liefern undefined. */
export function latest() {
  let turn = 0;
  let waiting = null;
  let running = false;
  async function drain() {
    running = true;
    while (waiting) {
      const {task, mine, resolve, reject} = waiting;
      waiting = null;
      try {
        const value = await task();
        resolve(mine === turn ? value : undefined);
      } catch (error) {
        if (mine === turn) reject(error);
        else resolve(undefined);
      }
    }
    running = false;
  }
  return {
    cancel() {
      turn++;
      waiting?.resolve(undefined);
      waiting = null;
    },
    run(task) {
      const mine = ++turn;
      waiting?.resolve(undefined);
      const result = new Promise((resolve, reject) => { waiting = {task, mine, resolve, reject}; });
      if (!running) drain();
      return result;
    },
  };
}
