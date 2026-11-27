// Druckauftrag: Prozessfenster schliessen, slicen, exportieren.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.

/** env: siehe actionEnv in app.js. */
export function createJobActions(env) {
  const actions = {
    'accept-process': async () => {
      env.closeProcess(true);
    },
    'cancel-process': async () => {
      env.closeProcess(false);
    },
    'slice-now': async () => {
      await env.sliceNow();
    },
    'export-gcode': async () => {
      await env.exportGcode();
    },
    'export-project': async () => {
      await env.exportProject();
    },
    'slice-all': async () => {
      await env.sliceAllPlates();
    },
  };
  return {actions};
}
