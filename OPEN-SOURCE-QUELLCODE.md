# Quellcode und Lizenzen der weiterverbreiteten Open-Source-Abhängigkeiten

[**Deutsch 🇩🇪**](OPEN-SOURCE-QUELLCODE.md) · [**English 🇬🇧**](OPEN-SOURCE-QUELLCODE_EN.md)

## Simpliy Slicing 0.0.0-alpha.1

Simpliy Slicing verwendet Bibliotheken mit verschiedenen Open-Source-Lizenzen.
Die eigene Benutzeroberfläche und die eigenständigen Simpliy-Funktionen werden
dadurch nicht pauschal als Open Source lizenziert.

### MPL-2.0-Komponenten des Windows-Builds

Die folgenden Rust-Crates sind in der zum Windows-Build `0.0.0-alpha.1`
erstellten Abhängigkeitsliste (`Cargo.lock`/`cargo tree`) mit MPL-2.0
aufgeführt:

| Komponente | Version | Upstream-Quellcode |
|---|---|---|
| cssparser | 0.37.0 | https://crates.io/crates/cssparser/0.37.0 |
| cssparser-macros | 0.7.1 | https://crates.io/crates/cssparser-macros/0.7.1 |
| dtoa-short | 0.3.5 | https://crates.io/crates/dtoa-short/0.3.5 |
| option-ext | 0.2.0 | https://crates.io/crates/option-ext/0.2.0 |
| selectors | 0.38.0 | https://crates.io/crates/selectors/0.38.0 |

Der zugehörige vollständige Quellcode wird im Release als Archiv
`Simpliy-Slicing-0.0.0-alpha.1-MPL-Sources.zip` bereitgestellt.
Das Archiv enthält die unveränderten Original-Crate-Pakete im
`.crate`-Format, den MPL-2.0-Lizenztext und SHA-256-Prüfsummen.
Diese Pakete sind Quellcodearchive im tar.gz-Format und lassen sich
mit Standard-Archivwerkzeugen öffnen.

**Original-Lizenztext:** https://www.mozilla.org/en-US/MPL/2.0/

Weitere in Simpliy verwendete Open-Source-Pakete haben insbesondere
MIT-, Apache-2.0-, BSD-, ISC- und andere Lizenzen. Dafür gelten
ebenfalls die jeweils erforderlichen Hinweise und Lizenztexte.
Die Zusammenstellung dieses MPL-Quellcodearchivs ersetzt die
vollständige Drittanbieter-Lizenzprüfung nicht.

### PrusaSlicer

Der Slicing-Kern wird nicht als Bestandteil von Simpliy ausgeliefert;
PrusaSlicer muss separat installiert werden und unterliegt der
**GNU AGPLv3**. Original-Quellen:
https://github.com/prusa3d/PrusaSlicer

Die Prusa-kompatiblen Formatmodule von Simpliy wurden noch nicht
abschließend auf etwaige Übernahme urheberrechtlich geschützter
Implementierungsteile geprüft. Die Bereitstellung der MPL-Quellen
ist **kein Nachweis**, dass für alle weiteren Simpliy-Module bereits
sämtliche Copyleft-Fragen geklärt sind.

### Hinweis

Diese Übersicht ist eine technische Quellcodebereitstellung für die
im Build ermittelten MPL-Abhängigkeiten, keine anwaltliche Freigabe.
Ändert sich die Liste der Abhängigkeiten in einem späteren Build,
muss dieses Archiv entsprechend aktualisiert werden.
