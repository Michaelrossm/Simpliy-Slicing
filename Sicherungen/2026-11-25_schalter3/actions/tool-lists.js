// Temperatur-, Luefter- und Extruderlisten im Prozessfenster.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.

/** Eine Funktion fuer mehrere Aktionsnamen. */
const share = (names, fn) => Object.fromEntries(names.map((n) => [n, fn]));

/** env: siehe actionEnv in app.js. */
export function createToolListsActions(env) {
  const actions = {
    'pick-extruder': async ({el}) => {
      env.activeExtruder = Number(el.dataset.index) || 0;
      env.settingsPage[env.activeSettingTab] = 0;
      env.render();
    },
    'temp-row-add': async ({el}) => {
      env.editTemps((t) => {
        const s = el.dataset.series,
          l = (t[s] ??= []);
        const last = l[l.length - 1];
        l.push([last ? last[0] + 1 : s === 'chamber' ? 2 : 3, last ? last[1] : s === 'chamber' ? 40 : 200]);
      });
    },
    'temp-row-remove': async ({el}) => {
      env.editTemps((t) => {
        t[el.dataset.series]?.splice(Number(el.dataset.row), 1);
      });
    },
    'pick-fan': async ({el}) => {
      env.activeFan = Number(el.dataset.index);
      env.render();
    },
    'fan-add': async () => {
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
        env.activeFan = f.length - 1;
      });
    },
    'fan-remove': async () => {
      env.editFans((f) => {
        if (env.activeFan >= 0) f.splice(env.activeFan, 1);
        env.activeFan = -1;
      });
    },
    'fan-row-add': async () => {
      env.editFans((f) => {
        const s = f[env.activeFan]?.setpoints;
        if (!s) return;
        const last = s[s.length - 1] || [0, 0];
        s.push([last[0] + 1, last[1]]);
      });
    },
    'fan-row-remove': async ({el}) => {
      env.editFans((f) => {
        f[env.activeFan]?.setpoints.splice(Number(el.dataset.row), 1);
      });
    },
    ...share(['extruder-add', 'extruder-remove'], async ({el}) => {
      env.changeToolCount(el.dataset.action === 'extruder-add' ? 1 : -1);
      return;
    }),
  };
  return {actions};
}
