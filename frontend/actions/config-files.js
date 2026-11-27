// Dateien: Konfiguration, Profile, Drucker und Material importieren/exportieren.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.

/** env: siehe actionEnv in app.js. */
export function createConfigFilesActions(env) {
  async function importProfileAction() {
    env.$('#profile-upload').click();
  }

  async function exportProfileAction() {
    env.exportCurrent();
  }

  async function backupWorkspaceAction() {
    env.download(new Blob([JSON.stringify(env.state, null, 2)], {type: 'application/json'}), 'Simpliy-Arbeitsbereich-backup.json');
    env.notify('Arbeitsbereich als JSON gesichert.');
  }

  async function exportConfigAction() {
    env.exportConfig('process');
  }

  async function exportPrinterAction() {
    env.exportConfig('printer');
  }

  async function importConfigAction() {
    env.pickFile('.json,.gcode,.gco,.g,.bgcode,.ini,.cfg,.yaml,.yml,.3mf', (f) => env.importConfigFile(f));
  }

  async function importPrinterConfigAction() {
    env.pickFile('.json', (f) => env.importConfigFile(f, {only: 'printer'}));
  }

  async function importPrusaAction() {
    env.pickFile('.json,.3mf,.yaml,.yml,.ini,.cfg', (f) => env.importPrusa(f, 'process'));
  }

  async function importPrinterAction() {
    env.pickFile('.json,.3mf,.yaml,.yml,.ini,.cfg', (f) => env.importPrusa(f, 'printer'));
  }

  async function importMaterialAction() {
    env.pickFile('.json,.3mf,.yaml,.yml,.ini,.cfg', (f) => env.importPrusa(f, 'material'));
  }

  async function exportMaterialAction() {
    const m = env.state.filaments.find((x) => x.id === env.filamentEdit);
    if (!m) return;
    env.download(
      new Blob([JSON.stringify({format: 'SimpliyMaterial', version: 1, material: m}, null, 2)], {type: 'application/json'}),
      `${m.name.replace(/[^\w.-]+/g, '_')}.simpliymaterial.json`,
    );
    env.notify('Material exportiert.');
  }

  /** Aktionsname -> Funktion. */
  const actions = {
    'import-profile': importProfileAction,
    'export-profile': exportProfileAction,
    'backup-workspace': backupWorkspaceAction,
    'export-config': exportConfigAction,
    'export-printer': exportPrinterAction,
    'import-config': importConfigAction,
    'import-printer-config': importPrinterConfigAction,
    'import-prusa': importPrusaAction,
    'import-printer': importPrinterAction,
    'import-material': importMaterialAction,
    'export-material': exportMaterialAction,
  };
  return {actions};
}
