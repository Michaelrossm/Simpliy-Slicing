// Vorschau aus Rust (gcode.rs): Spalten statt Objekte je Weg.
export function readPreview({meta, arrays}) {
  let before = 0;
  const moveCounts = meta.layers.map(layer => {
    const count = layer.end - before;
    before = layer.end;
    return count;
  });
  return {...meta, data: arrays, moveCounts};
}
