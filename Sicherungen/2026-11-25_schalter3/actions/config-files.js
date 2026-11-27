// Dateien: Konfiguration, Profile, Drucker und Material importieren/exportieren.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.

/** env: siehe actionEnv in app.js. */
export function createConfigFilesActions(env) {
  const actions = {
    'import-profile': async () => {
      env.$('#profile-upload').click();
    },
    'export-profile': async () => {
      env.exportCurrent();
    },
    'backup-workspace': async () => {
      env.download(new Blob([JSON.stringify(env.state, null, 2)], {type: 'application/json'}), 'Simpliy-Arbeitsbereich-backup.json');
      env.notify('Arbeitsbereich als JSON gesichert.');
    },
    'export-config': async () => {
      env.exportConfig('process');
    },
    'export-printer': async () => {
      env.exportConfig('printer');
    },
    'import-config': async () => {
      env.pickFile('.json,.gcode,.gco,.g,.bgcode,.ini,.cfg,.yaml,.yml,.3mf', (f) => env.importConfigFile(f));
    },
    'import-printer-config': async () => {
      env.pickFile('.json', (f) => env.importConfigFile(f, {only: 'printer'}));
    },
    'import-prusa': async () => {
      env.pickFile('.json,.3mf,.yaml,.yml,.ini,.cfg', (f) => env.importPrusa(f, 'process'));
    },
    'import-printer': async () => {
      env.pickFile('.json,.3mf,.yaml,.yml,.ini,.cfg', (f) => env.importPrusa(f, 'printer'));
    },
    'import-material': async () => {
      env.pickFile('.json,.3mf,.yaml,.yml,.ini,.cfg', (f) => env.importPrusa(f, 'material'));
    },
    'export-material': async () => {
      const m = env.state.filaments.find((x) => x.id === env.filamentEdit);
      if (!m) return;
      env.download(
        new Blob([JSON.stringify({format: 'SimpliyMaterial', version: 1, material: m}, null, 2)], {type: 'application/json'}),
        `${m.name.replace(/[^\w.-]+/g, '_')}.simpliymaterial.json`,
      );
      env.notify('Material exportiert.');
    },
  };
  return {actions};
}
