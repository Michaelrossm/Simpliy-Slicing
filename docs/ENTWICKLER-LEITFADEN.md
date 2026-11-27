# Simpliy Slicing – Entwickler-Leitfaden (Wartung)

Kurzüberblick für Entwickler. Stand: 0.0.1-alpha.1. Ergänzt `ARCHITEKTUR.md` (ältere Grundsatzentscheidung).

## Aufbau

| Schicht | Ort | Aufgabe |
|---|---|---|
| Oberfläche | `frontend/*.js`, `styles.css` | ES-Module ohne Build-Schritt. Die Slicing-Pipeline liegt in Rust, JS ist Oberfläche und Datenmodell. |
| Kern | `src-tauri/src/*.rs` | Tauri-Befehle (`lib.rs`), Engine-Aufruf (`engine.rs`), G-Code (`gcode.rs`, `fans.rs`, `temps.rs`, `zones/`), Stützen (`supports/`), Netzwerk, Seriell. |
| Engine | PrusaSlicer 3.0 alpha14 (extern) | Nur per CLI, nie verändert. Immer mit `--datadir`. |

## Frontend-Module

| Datei | Inhalt | Zustand? |
|---|---|---|
| `app.js` | Hauptprogramm: Zustand (`state`), Rendern, Ereignisse, der noch nicht ausgelagerte Rest des Aktions-Schalters (`handleAction`). **Zentrale Datei – neue Logik in eigene Module legen.** | ja |
| `actions/*.js` | Aktionen nach Themen (siehe unten): je Modul eine Fabrik `createXActions(env)` mit `actions`, `change`, ggf. `renderDialog`. | nur eigener Dialogentwurf |
| `profiles.js` | Profil-/Prozessmodell: Material, Qualität, Auto-Konfigurationen, Offsets (`withOffsets`), Farben, Konfig-Export/-Import, G-Code-Konfigurationsblock. | nein (rein) |
| `offset-rules.js` | Auto-Konfig-Offset-Regeln bearbeiten (Altformat, Aktivierung, Alle an/aus). | nein (rein) |
| `zone-plan.js` | Zonen-Prozesse: Z-Bereiche, Schichthöhen-Abgleich, Sperrgründe. | nein (rein) |
| `process-dialog.js`, `profile-ui.js`, `color-dialog.js` | HTML-Erzeugung der Dialoge (nur Zeichenketten, keine Ereignisse). | nein |
| `settings-layout.js` | Reiter/Gruppen/Zeilen der Einstellungen; `PLACE` = Schlüssel → Ort. | nein |
| `engine-config.js`, `print-job.js`, `plate-plan.js` | Prusa-Werte umrechnen, Slicing-Auftrag bauen, Platten-/Prozessplanung. | nein |
| `viewport.js`, `toolpath-render.js`, `paint-core.js` | 3D-Ansicht (three.js), Werkzeugwege, Bemalen. | ja (Ansicht) |
| `features.js`, `workbench.js`, … | Plattenleisten, Werkzeugleiste, Netzwerk/Upload usw. | teils |

Regel: **Reine Logik gehört in Module ohne Zugriff auf `state`** (testbar mit `node --test`), `app.js` ruft sie nur auf.

## Aktions-Module (`frontend/actions/`)

`handleAction` schlägt in `actionTable` nach (Aktionsname → `async ({proc, el, bundle, p, action}) => …`); der frühere große Schalter existiert nicht mehr, unbekannte Aktionen melden nur „Unbekannte Aktion“. Feldänderungen (`data-field`) laufen über `fieldTable` (Rückgabe `true` = erledigt, sonst folgt `update()`), weitere Änderungs-Ereignisse über `earlyChange`/`lateChange`.

| Modul | Aktionen / Inhalt | Eigener Zustand |
|---|---|---|
| `offsets.js` | Auto-Konfig-Offset-Editor: `offset-cat`, `offset-item-remove`, `offset-suggest`, Änderungen (An/Aus, Master, Alle, Delta, Option, Parameter hinzufügen), Vorschlag | betrachtete Kategorie/Option |
| `colors.js` | Farben des Materials: `open/close-colors`, `color-pick/add/remove`, Offset-/Name-/Farbwert-Änderungen; Helfer `materialOf`, `colorsOf`, `activeColorOf`, `editColors`, `colorOptions` | – (Entwurf im Prozess) |
| `zones.js` | Zonenfenster (`open-zones`, `zone-save`, `zone-cancel`), `withProcess` für Zonen-Slices | Fensterentwurf, Zonen-Hauptprozess |
| `model-assignment.js` | Dialog „Modelle für Prozesse“: `process-models`, `apply-process-models` | Entwürfe Hauptprozess/Zonen-Haken |
| `favorites.js` | `fav-add`, `fav-remove`, Live-Suche | Suchtext |
| `process-reset.js` | `reset-process` | – |
| `navigation.js` | Dialoge öffnen/schließen, Auswahl (Modell/Prozess/Drucker), Reiter, Werkzeuge, Ansichten | – |
| `job.js` | Prozessfenster schließen (`accept/cancel-process`), slicen, exportieren | – |
| `tool-lists.js` | Temperatur-, Lüfter- und Extruderlisten | – |
| `process-ops.js` | Prozess anlegen/duplizieren/löschen/speichern, Overrides, Profil aktualisieren | – |
| `config-files.js` | Konfiguration, Profile, Drucker, Material importieren/exportieren, Arbeitsbereich sichern | – |
| `auto-config.js` | Auto-Konfig-Menü, Kategorien, Optionen, Zuweisung der Einstellungen, in Option speichern | – |
| `profile-editor.js` | Älterer Profildialog: Kategorien, Optionen, Zuweisungen, Basiswerte | – |
| `library.js` | Druckerverwaltung und Materialbibliothek | – |
| `field-changes.js` | Feldänderungen im Prozess-/Bibliotheksfenster (`data-field`): `proc-material`, `proc-quality`, `proc-printer`, … | – |

**Regeln für Aktions-Module:** Abhängigkeiten nur über `env` (aus `actionEnv` in `app.js`; Funktionen als Weiterleitungen, Werte als Getter, veränderliche Ansichts-Variablen wie `printerEdit` zusätzlich als Setter). Reine Importe (`P`, `PLACE`, …) importiert das Modul selbst. Keine eigenen Globals außer dem Dialogentwurf des Moduls, kein Zugriff auf `document` außer über `env.byId`. Neue Aktion = Eintrag in einem Modul, nicht im Schalter. Tests mit Attrappen-`env`: `tests/action-modules.test.mjs`.

## Datenmodell (Auszug, Arbeitsbereich `workspace.json`)

- `state.processes[]`: Prozess = `values` (Prusa-Werte), `origins`, `printer_id`, `material_id`, `color_id`, `quality_id`, `extras_id`, `change_id`, `zone` (`{fromOn,from,toOn,to}`), `pending` (Entwurf).
- `state.filaments[]`: Material mit `settings` und `colors[]` (Farb-Offsets).
- `state.printers[].qualities[]`, `state.presets[]`: Auto-Konfig-Optionen.
- `state.auto_offsets[]`: Regeln `{cat, option, enabled?, items:[{key, delta, enabled?}]}` (Altformat `key/delta` bleibt gültig).
- `state.favorites[]`: Schlüssel der Favoriten-Einstellungen.
- `state.models[]`: `process` (Hauptprozess), `zone_processes[]` (zusätzliche Zonen-Prozesse).

### Entwurfsprinzip (wichtig)

Änderungen im Prozessfenster gelten nur für den **Entwurf** (`proc.pending`: importierte Optionen, `offsetRules`, `colors`). Erst „Prozess speichern“ ruft `commitPending` und schreibt in die globalen Listen. „Abbrechen“ stellt den Schnappschuss wieder her (`dialogSnapshot`), „Prozess zurücksetzen“ lädt den gespeicherten Stand.

### Berechnung der Slicing-Werte

`Endwert = Grundwert + Auto-Konfig-Offset + Farb-Offset`, danach Rundung und Begrenzung auf den Prusa-Bereich (`profiles.js` → `withOffsets`). Die Engine erhält nur fertige Werte.

## Zonen (Mehrprozess-Slicing)

1. `app.js` `prepareJob` baut den Hauptauftrag und je Zonen-Prozess einen weiteren (`withZoneProcess`, `opts.quiet`).
2. `checkZoneSafety` (Frontend) sperrt unsichere Fälle vorab (`zone-plan.js`).
3. Rust `engine.rs` `slice_with_zones` slict alle Aufträge als Text-G-Code und ruft `zones::merge`:
   - `zones/layers.rs`: Schichten zerlegen, Raster prüfen (Toleranz 0,001 mm).
   - `zones/state.rs`: Druckerzustand scannen, Übergangsbefehle berechnen oder ablehnen.
   - `zones/mod.rs`: Zuordnung (`von < z ≤ bis`), Überlappungsprüfung, Ausgabe mit `; Simpliy-Zone:`-Kommentaren.
4. Details und Grenzen: `ENTWICKLUNGSSTAND.md`, Nachtrag 12/13.

## Tests

```
node --test tests/                 # JS (Oberfläche, Profile, Module)
cd src-tauri && cargo test --lib   # Rust (inkl. zones, G-Code, Stützen)
```

`tests/printer-ui.test.mjs` startet `app.js` in einer Sandbox (`vm`); neue Importe in `app.js` müssen dort in die Modulliste (`pure`, `Z`, `R`) eingetragen werden.

## Bauen und Prüfen in der echten App

```
set CARGO_TARGET_DIR=<Projekt>\src-tauri\target-build
npx tauri build --no-bundle
```

Testinstanz: `APPDATA`, `LOCALAPPDATA`, `WEBVIEW2_USER_DATA_FOLDER` auf einen Testordner, `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9339`; nur Instanzen beenden, deren Pfad `target-build` enthält. Vor dem Ersetzen der EXE unter `src-tauri\target\release` immer eine Sicherung in `Sicherungen\` anlegen.

## Konventionen

- Deutsche Oberflächentexte; „S3D/Simplify3D“ nie in Oberfläche oder Code nennen.
- Keine nativen Browser-Dialoge (`confirm`/`prompt`/`alert`): `confirmRemove`, `askName`, `notify` verwenden.
- Neue Einstellungen mit Reiter-Zuordnung in `settings-layout.js` eintragen (jeder Prusa-Schlüssel genau einmal).
- Neue Oberflächen-Zeichenketten in `i18n.js` ergänzen, wenn Englisch sichtbar sein soll.
- Rust: Module klein halten (`zones/` als Vorbild), Tests im selben Modul (`#[cfg(test)]`).

## Prusa-Engine-Version

`engine::VERSION` ist nur die zuletzt geprüfte Referenz (derzeit 3.0.0-alpha15). Jede 3.x-Engine, die die benötigten Kommandozeilen-Optionen hat (`engine::probe`), wird akzeptiert. `actions/engine-update.js` holt beim Start (höchstens alle 12 h, abschaltbar im Engine-Dialog) die neueste 3.x-Version über `engine_auto_update` (Rust `updates::auto_update_engine`), prüft sie und schaltet um; die alte Version bleibt installiert. Neue Prusa-Optionen einer neuen Version erscheinen unter „Freie Parameter“, bis sie in `engine-catalog.json` und `settings-layout.js` eingetragen sind (Vergleich: `PrusaSlicer.exe --help-fff` beider Versionen).

## Eigene Stützen: Einstellungen

Die Simpliy-Stützen (`src-tauri/src/supports/`) nehmen ihre Werte aus dem Prozess; die Panel-Reiter „Kontaktfläche“ und „Druck“ überschreiben sie (`Settings` in `types.rs`, Umsetzung in `overrides.rs`, Vorgabe 0 / −1 / „process“ = Prozesswert). `overrides::apply` schreibt die Werte beim Erzeugen des `Item` in die Prozesswerte, `overrides::forwarded` reicht geänderte Prusa-Schlüssel je Objekt an die Engine weiter (für Stützen, die Prusa selbst druckt). Körper-Einstellungen (Wände, Füllung, Muster) gelten für Baum/Fächer/Knotenblech.

## Rust-Aufteilung (`src-tauri/src`)

`lib.rs` enthält Start, Arbeitsbereich, Profil-Import/-Export, Slicing-Befehle und die Handlerliste. Ausgelagert (Befehle als `pub`, Handlerliste mit Modulpfad, `use super::*;` für gemeinsame Hilfen):

| Modul | Inhalt |
|---|---|
| `fonts.rs` | Systemschriften listen/lesen |
| `printer_net.rs` | Verbindungstest, Upload, Weboberfläche des Druckers |
| `dialogs.rs` | Native Dateidialoge |
| `thumbnails.rs` | Vorschaubilder im G-Code (inkl. Test) |
| `tests/*.rs` | Test-Module von `lib.rs` (`#[cfg(test)]`, `#[path]`) |
| `zones/` | Zonen-Zusammensetzer (siehe oben) |

## Ansichts-Zustand der Module

Die früheren globalen Ansichts-Variablen gehören jetzt den Modulen und sind über `view` erreichbar (`libraryActions.view.printerEdit`, `profileEditorActions.view.editCat/editOpt/profilePanel`, `autoConfigActions.view.autoMenu/assignDraft/assignFilter`, `toolListsActions.view.activeExtruder/activeFan`). Andere Module greifen über `env` darauf zu.

## Nächste sinnvolle Aufräum-Schritte

- Die Render-Funktionen für Drucker-/Materialdialog und Profildialog (`renderPrinterDialog`, `renderFilamentDialog`, `renderProfileDialog`) in die Module `library` bzw. `profile-editor` verlegen.
- Gemeinsame Ansichts-Variablen (`previewMode`, `printerView`, `modal`) in ein eigenes Ansichts-Modul legen.
- Die Funktionen der generierten Module sind benannt, aber noch dicht geschrieben; beim Anfassen weiter aufteilen.
- `lib.rs`: Arbeitsbereich/Profildateien (`workspace.rs`, `profile_files.rs`) und die Slicing-Befehle (`slicing.rs`) auslagern.

## Versionen und Update-Kanäle

Simpliy-Version: `0.0.1-alpha.1` (`Cargo.toml`, `tauri.conf.json`, `package.json`). Update-Kanal (`state.ui.update_channel`: alpha | beta | release) gilt für Simpliy-Updates (`updates::check_app`) und die Prusa-Engine (`auto_update_engine`). `updates::stability` ordnet Versionen per Vorabkennung ein (alpha/dev = Alpha, beta/rc = Beta, ohne = Release), `updates::allows` filtert je Kanal; Reihenfolge alpha < beta < rc < release.

## Eigene Stützen nach Prusa-Werten

`Settings::from_process` (`supports/types.rs`) richtet Erzeugung und Form nach den Prusa-Stützeinstellungen des Prozesses (Schalter `useProcess`, Vorgabe an): Überhangwinkel ← `support_material_threshold`, nur Druckbett ← `support_material_buildplate_only`, Kontaktabstand, Astwinkel/Spitze/Ast ← `support_tree_*`. `bodyLikePrusa` leitet Füllmuster und Dichte der Körper aus `support_material_pattern`/`-spacing` ab. Wird in `Item::new` und nach jeder Einstellungsänderung angewendet; ausgeschaltet bleiben die zuletzt übernommenen Werte als eigene stehen. Das Panel sperrt die gesteuerten Felder („aus Prozess“).
