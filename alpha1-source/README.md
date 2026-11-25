# Simpliy Slicing v0.10 – Rust/Tauri Desktop

## Ziel

Dies ist die **korrigierte technische Basis**: Rust/Tauri 2 als nativer Windows-Desktop-Host mit HTML/CSS/JavaScript-Oberfläche und später PrusaSlicer 3.0 als externer C++-Slicing-Engine. **Kein Python, kein Tkinter, kein lokaler Webserver und kein separat gestarteter Browser.** Tauri verwendet unter Windows die Edge-WebView2-Laufzeit innerhalb des eigenen Programmfensters.

## Status (0.10.0)

Kompakte Prozessoberfläche mit allen FFF-Parametern von PrusaSlicer 3.0.0-alpha14, Slicing über die externe
Engine, Anmalen, Modifikatoren, variable Schichthöhe, Schneiden, Schichtvorschau, mehrere Prozesse und Platten, Projekte, Material je Werkzeug,
Text, Messen, Netzreparatur und Upload zum Drucker.
Was geprüft und was offen ist, steht in `ENTWICKLUNGSSTAND.md`. Kein Testdruck, noch keine eigenen Stützen.

## Windows: erstmaliger Build

Benötigt: Windows 10/11, Microsoft C++ Build Tools (Desktop C++), WebView2 Runtime, Rust (`rustup` mit MSVC Toolchain), Node.js LTS.

1. Dieses ZIP vollständig entpacken.
2. `npm install` **einmal bewusst selbst ausführen** (lädt die Tauri-JavaScript-Buildwerkzeuge).
3. `Starten-Windows.cmd` ausführen: startet `npm run dev` und öffnet ein **natives Simpliy-Slicing-Fenster**, keinen Browser.
4. Später `Build-Windows.cmd` ausführen, um eine installierbare Windows-Version zu erstellen (NSIS).

Die Batch-Dateien prüfen nur die Voraussetzungen und installieren nichts eigenmächtig.

Zur PrusaSlicer-Integration: Ein installierter PrusaSlicer 3.0 wird später via CLI angebunden. Der momentane Prusa-Pfad-Dialog erkennt nur Kandidaten und verändert keine Prusa-Profile.

## Bedienlogik

- Rechts außen: Symbolleiste. Beim Anklicken erscheint **links davon** das Kontextfenster. Erneutes Einklappen vergrößert die Arbeitsfläche.
- Unten: zusätzliche Schnellwerkzeuge.
- Links: Modell- und Prozessliste gleichzeitig; einblendbar.
- Prozessdialog: **alle Parameter nur in normalen Reitern**. Auto-Configure-Optionen speichern Werte-Patches und können mehrere Register gleichzeitig steuern. Beliebig viele Kategorien und Optionen sind vorgesehen; Priorität = Reihenfolge der Kategorien, Prozess-Overrides zuletzt.
- Geplante Werkzeuge sind deaktiviert, solange keine 3D-/Prusa-Anbindung vorliegt.

## Projektstruktur

```text
frontend/                WebView-Oberfläche (kein Browser-Server)
  app.js                 Prozessdialoge und Profile aus v0.4
  tauri-bridge.js        Schnittstellenübersetzer JS -> Rust
  catalog.json           Vorläufiger (!) Parameterkatalog
  initial_state.json     Start-Arbeitsbereich mit Demo-Profil
src-tauri/               Rust/Tauri-Hauptfenster und Dateioperationen
examples/                Beispielprofil (.simpliyprofile)
tests/                   Kleine statische/Bridge-Regressionstests
.github/workflows/       Windows-Build/Checks
CLAUDE.md / AGENTS.md     Entwicklungsvorgaben
```

Die alten Tkinter-Dateien werden **nicht** in diese neue Codebasis übernommen. Eine separat bereitgestellte v0.7.1-Version behebt nur den bestehenden Python-Startfehler.

## Datenschutz / Grenzen

Rust speichert nur in `%APPDATA%\SimpliySlicing\workspace.json`. Vorhandene Prusa-Installationen und Profile werden nicht überschrieben. Exportierte Simpliy-Profile sind ZIP-Dateien mit manifest.json und profile.json. Der Rust-Importer ist eine erste Portierung und muss vor produktivem Einsatz weiter gehärtet und Windows-getestet werden. Unbekannte Prusa-Parameter dürfen nicht stillschweigend falsch interpretiert werden.

Tests: `npm run check:js` und `npm test` (Node.js). Ein grüner JavaScript-Test ersetzt **keine native Rust-/Windows-Buildprüfung**.
