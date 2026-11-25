# Simpliy Slicing v0.0.0-alpha.1 — Quellcode

Copyright © 2026 Michael Roßmann für die von ihm entwickelten Simpliy-Bestandteile.

## Nachvollziehbarer Quellstand

- Ursprung: `Michaelrossm/Simpliy-Slicing-Source` (privates Repository)
- Commit: `0495ac4f15454e3255a39bff66e1395642d72486`
- Zugehöriges Release: https://github.com/Michaelrossm/Simpliy-Slicing/releases/tag/v0.0.0-alpha.1
- Enthalten: 140 Originaldateien mit unveränderten Git-Blob-SHA-Werten, darunter Rust-/Tauri-/JavaScript-Quellen, Drittanbieterbibliotheken, Tests, Buildanleitungen und Lizenzdokumentation.

Die ursprünglich im privaten Repository liegenden lokalen Drucker- und Materialtestprofile unter `profiles/` sowie das umfangreiche Prusa-Testdatenverzeichnis `test-prusa-data/` wurden bewusst nicht ins Release aufgenommen; sie sind weder Anwendungscode noch für den normalen Build erforderlich.

## Lizenz und Einschränkungen

Die eigenen Simpliy-Bestandteile unterliegen `legal/LIZENZ.md`: unentgeltliche private und gewerbliche Nutzung; ein Verkauf proprietärer Simpliy-Softwarebestandteile durch Dritte ist ohne Genehmigung untersagt, soweit rechtlich wirksam. Fremde Software und Bibliotheken unterliegen ausschließlich den jeweiligen Originallizenzen.

**Die im Alpha-1-Quellstand enthaltene Lizenz ist als ENTWURF gekennzeichnet und enthält noch Platzhalter für Anschrift und E-Mail.** Eine abschließende juristische Prüfung steht aus.

**Ungeklärte Copyleft-Frage:** Die Herkunft und Lizenzpflicht von Prusa-kompatiblen Formatimplementierungen insbesondere in `frontend/paint-core.js` und `src-tauri/src/project.rs` sind noch nicht abschließend geklärt. Rechte aus einer etwaig einschlägigen AGPLv3 oder anderen Open-Source-Lizenz bleiben ausdrücklich unberührt. Die Veröffentlichung des Quellcodes ist keine Rechtsfreigabe des gesamten Lizenzmodells.

PrusaSlicer wird nicht mitgeliefert und muss getrennt installiert werden.

## Kompilierung

Unter Windows: Node.js, Rust/MSVC, Tauri und WebView2 entsprechend `README.md`; dann `npm install`, `npm run check:js`, `npm test`, `npm run build`. Es wird keine byteidentische Reproduzierbarkeit der EXE mit abweichenden Toolchain-Versionen behauptet.
