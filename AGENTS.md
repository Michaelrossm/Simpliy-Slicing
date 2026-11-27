# Codex Agents – Simpliy Slicing

Siehe `CLAUDE.md` und `README.md` als verbindliche Regeln.

## Entwicklungsreihenfolge
1. Rust/Tauri-2-Quellprojekt in einem echten Windows-MSVC-Build verifizieren.
2. Bridging- und Profildatenvalidierung (Import, Export, Persistenz, Kategorien-Priorität) stabilisieren.
3. Bestehende S3D-orientierte Tools und Panelbreiten optimieren.
4. 3D-Viewer integrieren, ohne Auto-Configure zu beschädigen.
5. PrusaSlicer 3.0 über **versionsgeprüfte CLI** verbinden; Konfiguration ohne Schreiben in Prusas Profilordner.
6. Eigene Stützenkörper und kleine, getrennte Kontaktinterface-Geometrien vor dem Slicing anzeigen.

**Keine** Migration zurück zu Tkinter oder Python-Webserver. Keine unbelegten Erfolgsmeldungen über native Builds, echte Druckpfade oder Materialzuweisungen. Nutzerprofile nie ungefragt löschen. Modulgrenzen respektieren.
