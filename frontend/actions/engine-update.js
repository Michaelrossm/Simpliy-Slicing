// Prusa-Engine automatisch aktuell halten: beim Start (hoechstens alle 12 Stunden) nach einer neueren 3.x-Version suchen,
// installieren und umschalten. Die bisherige Engine bleibt installiert; unvertraegliche Versionen werden nicht uebernommen.

/** env: {state (Getter), notify, update, setJobStatus, resetEngine} */
export function createEngineUpdateActions(env) {
  const HOURS = 12;
  let running = false;

  /** Sucht und installiert die neueste Engine. `force`: auch wenn die Pruefung abgeschaltet ist oder kuerzlich lief. */
  async function check({force = false} = {}) {
    const state = env.state;
    if (running || !window.__TAURI__ || !state?.engine_path) return;
    state.ui ??= {};
    if (!force) {
      if (state.ui.engine_auto_update === false) return;
      if (Date.now() - Number(state.ui.engine_checked_at || 0) < HOURS * 3600 * 1000) return;
    }
    running = true;
    state.ui.engine_checked_at = Date.now();
    try {
      env.setJobStatus('Suche nach neuer Prusa-Engine');
      const result = await window.__TAURI__.core.invoke('engine_auto_update', {current: state.engine_path, channel: state.ui.update_channel || 'alpha'});
      if (result) {
        state.engine_path = result.path;
        env.resetEngine();
        env.update();
        env.notify(`Prusa-Engine automatisch auf ${result.version} aktualisiert (vorher ${result.previous}). Die alte Version bleibt installiert und ist unter Hilfe › Slicing-Engine wählbar.`);
      } else if (force) {
        env.notify('Die Prusa-Engine ist bereits die neueste Version.');
      }
    } catch (error) {
      // Kein Netz: still bleiben. Unvertraegliche neue Version oder ausdruecklicher Aufruf: melden.
      if (force || /nicht übernommen|nicht kompatibel/.test(String(error))) env.notify(String(error), true);
    } finally {
      running = false;
      env.setJobStatus('Bereit');
    }
  }

  const actions = {
    async 'engine-check-now'() {
      await check({force: true});
    },
  };

  const fields = {
    // Update-Kanal fuer Simpliy und die Prusa-Engine: alpha, beta oder release.
    'update-channel': async ({el}) => {
      env.state.ui.update_channel = ['alpha', 'beta', 'release'].includes(el.value) ? el.value : 'alpha';
      env.state.ui.engine_checked_at = 0;
      env.resetUpdateInfo();
      env.update();
      return true;
    },
    'engine-auto-update': async ({el}) => {
      env.state.ui.engine_auto_update = el.checked;
      env.update();
      return true;
    },
  };

  return {actions, fields, check};
}
