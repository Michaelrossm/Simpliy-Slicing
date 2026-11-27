// Temperatur-, Luefter- und Extruderlisten im Prozessfenster.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.

/** Eine Funktion fuer mehrere Aktionsnamen. */
const share = (names, fn) => Object.fromEntries(names.map((n) => [n, fn]));

/** env: siehe actionEnv in app.js. */
export function createToolListsActions(env) {
  // Ansicht dieses Moduls (frueher globale Variablen in app.js); app.js liest/schreibt sie ueber `view`.
  let activeExtruder = 0;
  let activeFan = -1;
  async function pickExtruderAction({el}) {
    activeExtruder = Number(el.dataset.index) || 0;
    env.settingsPage[env.activeSettingTab] = 0;
    env.render();
  }

  async function tempRowAddAction({el}) {
    env.editTemps((t) => {
      const s = el.dataset.series,
        l = (t[s] ??= []);
      const last = l[l.length - 1];
      l.push([last ? last[0] + 1 : s === 'chamber' ? 2 : 3, last ? last[1] : s === 'chamber' ? 40 : 200]);
    });
  }

  async function tempRowRemoveAction({el}) {
    env.editTemps((t) => {
      t[el.dataset.series]?.splice(Number(el.dataset.row), 1);
    });
  }

  async function pickFanAction({el}) {
    activeFan = Number(el.dataset.index);
    env.render();
  }

  async function fanAddAction() {
    env.editFans((f) => {
      const used = new Set(f.map((x) => x.index));
      let n = 1;
      while (used.has(n)) n++;
      f.push({
        index: n,
        name: '',
        setpoints: [
          [1, 0],
          [3, 100],
        ],
      });
      activeFan = f.length - 1;
    });
  }

  async function fanRemoveAction() {
    env.editFans((f) => {
      if (activeFan >= 0) f.splice(activeFan, 1);
      activeFan = -1;
    });
  }

  async function fanRowAddAction() {
    env.editFans((f) => {
      const s = f[activeFan]?.setpoints;
      if (!s) return;
      const last = s[s.length - 1] || [0, 0];
      s.push([last[0] + 1, last[1]]);
    });
  }

  async function fanRowRemoveAction({el}) {
    env.editFans((f) => {
      f[activeFan]?.setpoints.splice(Number(el.dataset.row), 1);
    });
  }

  async function extruderAddAction({el}) {
    env.changeToolCount(el.dataset.action === 'extruder-add' ? 1 : -1);
    return;
  }

  /** Aktionsname -> Funktion. */
  const actions = {
    'pick-extruder': pickExtruderAction,
    'temp-row-add': tempRowAddAction,
    'temp-row-remove': tempRowRemoveAction,
    'pick-fan': pickFanAction,
    'fan-add': fanAddAction,
    'fan-remove': fanRemoveAction,
    'fan-row-add': fanRowAddAction,
    'fan-row-remove': fanRowRemoveAction,
    ...share(['extruder-add', 'extruder-remove'], extruderAddAction),
  };
  return {
    actions,
    view: {
      get activeExtruder() {
        return activeExtruder;
      },
      set activeExtruder(v) {
        activeExtruder = v;
      },
      get activeFan() {
        return activeFan;
      },
      set activeFan(v) {
        activeFan = v;
      },
    },
  };
}
