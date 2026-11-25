# Drittanbieter

## PrusaSlicer (AGPL-3.0)

- `frontend/engine-catalog.json` wird von `tools/generate-catalog.mjs` aus PrusaSlicer 3.0.0-alpha14
  erzeugt und enthält dessen Parameterbeschreibungen und deutsche Übersetzungen.
- `frontend/paint-core.js` implementiert das Dateiformat der Dreiecksbemalung (TriangleSelector) nach,
  `src-tauri/src/project.rs` das 3MF-Projektformat. Beides entstand anhand des Quellcodes.
- Die Engine selbst läuft unverändert als externer Prozess.

**Vor einer Weitergabe von Simpliy zu klären:** `Cargo.toml` nennt MIT. Übernommene Texte und am
Quellcode orientierte Formate können AGPL-Pflichten auslösen. Für die private Nutzung ist das
unkritisch. Für eine Veröffentlichung entweder unter AGPL-3.0 stellen oder die Texte ersetzen und
die Formatmodule rechtlich prüfen lassen.

## three.js (MIT)

`frontend/vendor/`

## opentype.js 1.3.4 (MIT)

`frontend/vendor/opentype/`, unverändert aus dem npm-Paket; enthält tiny-inflate (MIT).
Schriften werden von Windows gelesen und nicht mitgeliefert. Für geprägten Text gilt die Lizenz der Schrift.
