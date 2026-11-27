// „Prozess zurücksetzen“: nur der Entwurf des aktuellen Prozesses geht auf den gespeicherten Stand zurück.
// Gespeicherte Prozesse, Materialien und Auto-Konfigurationen bleiben unverändert.
import * as P from '../profiles.js';

/** env: {state (Getter), notify, confirmRemove, update, invalidateBase} */
export function createProcessResetActions(env) {
  return {
    actions: {
      async 'reset-process'({proc}) {
        const library = env.state.process_library || [];
        const entry = library.find(x => x.id === proc.library_id);
        if (!entry) return env.notify('Dieser Prozess wurde noch nicht gespeichert.', true);
        if (!P.unsaved(proc, library)) return env.notify('Der Prozess entspricht bereits dem gespeicherten Stand.');
        const ok = await env.confirmRemove(`Alle ungespeicherten Änderungen dieses Prozesses verwerfen und auf den gespeicherten Stand „${entry.name}“ zurücksetzen?`,
          {title: 'Prozess zurücksetzen', ok: 'Zurücksetzen', cancel: 'Abbrechen'});
        if (!ok) return;
        P.loadFromLibrary(proc, entry);
        env.invalidateBase();
        env.update();
        env.notify('Prozess auf den gespeicherten Stand zurückgesetzt.');
      },
    },
  };
}
