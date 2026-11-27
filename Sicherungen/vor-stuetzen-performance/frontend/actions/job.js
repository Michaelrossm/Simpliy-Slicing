// Druckauftrag: Prozessfenster schliessen, slicen, exportieren.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.

/** env: siehe actionEnv in app.js. */
export function createJobActions(env) {
  async function acceptProcessAction() {
    env.closeProcess(true);
  }

  async function cancelProcessAction() {
    env.closeProcess(false);
  }

  async function sliceNowAction() {
    await env.sliceNow();
  }

  async function exportGcodeAction() {
    await env.exportGcode();
  }

  async function exportProjectAction() {
    await env.exportProject();
  }

  async function sliceAllAction() {
    await env.sliceAllPlates();
  }

  /** Aktionsname -> Funktion. */
  const actions = {
    'accept-process': acceptProcessAction,
    'cancel-process': cancelProcessAction,
    'slice-now': sliceNowAction,
    'export-gcode': exportGcodeAction,
    'export-project': exportProjectAction,
    'slice-all': sliceAllAction,
  };
  return {actions};
}
