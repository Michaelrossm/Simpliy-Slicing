# Simpliy Slicer – Drittanbieter-Lizenzen und Hinweise (Vorlage)

**Stand: 24. November 2026**  
**Lizenzgeber der eigenständigen proprietären Simpliy-Komponenten:** Michael Roßmann  
**Urheberrechtshinweis:** © 2026 Michael Roßmann, soweit er Urheber bzw. berechtigter Rechteinhaber ist.

Diese Datei muss anhand des **tatsächlich ausgelieferten Builds** und sämtlicher enthaltenen Abhängigkeiten vervollständigt werden. Sie ersetzt nicht die vollständigen Lizenztexte.

**Wichtig:** Das in der Simpliy-EULA geregelte Verbot des kommerziellen Weiterverkaufs gilt nur für die proprietären Simpliy-Komponenten, nicht für Komponenten unter der GNU AGPL oder anderen Open-Source-Lizenzen. Insbesondere erlaubt die AGPLv3 unter ihren Bedingungen auch eine entgeltliche Weitergabe.

## PrusaSlicer
- Projekt und Urheber: Prusa Research und Mitwirkende
- **Verhältnis zu Simpliy:** externer Slicing-Kern. Simpliy ist kein Fork von PrusaSlicer, enthält keinen PrusaSlicer-Code, keine PrusaSlicer-Dateien und keine PrusaSlicer-Texte und verändert PrusaSlicer nicht. Simpliy startet das vom Nutzer installierte, unveränderte Programm als getrennten Prozess über die Kommandozeile.
- Mitgeliefert: **nein**. Der Nutzer installiert PrusaSlicer selbst oder über die Download-Hilfe in Simpliy direkt aus der offiziellen GitHub-Veröffentlichung von Prusa Research.
- Mit Simpliy geprüfte Version: 3.0.0-alpha14 (andere Versionen nur nach ausdrücklicher Bestätigung des Nutzers)
- Lizenz: GNU Affero General Public License Version 3 (AGPLv3)
- Projekt: https://github.com/prusa3d/PrusaSlicer
- Lizenz: https://github.com/prusa3d/PrusaSlicer/blob/master/LICENSE
- Quellcode der jeweiligen Version: https://github.com/prusa3d/PrusaSlicer/releases (z. B. Tag version_3.0.0-alpha14)
- AGPLv3-Lizenztext: liegt der offiziellen PrusaSlicer-Veröffentlichung bei; zusätzlich https://www.gnu.org/licenses/agpl-3.0.html
- Änderungen an PrusaSlicer: keine (unverändert)

Es besteht keine offizielle Zusammenarbeit mit oder Freigabe durch Prusa Research.

## Three.js
- Urheber: three.js authors
- Lizenz: MIT
- Projekt/Lizenz: https://threejs.org/license/
- Enthaltene Version: 0.187.0 (mit OrbitControls und STLLoader), Lizenzdatei: frontend/vendor/LICENSE-three.txt

## opentype.js
- Urheber: Frederik De Bleser
- Lizenz: MIT, Lizenzdatei: frontend/vendor/opentype/LICENSE

## Tauri und Rust-Bibliotheken
- Urheber: Tauri Contributors und die jeweiligen Autoren
- Lizenzen: überwiegend MIT / Apache-2.0; einzelne Pakete MPL-2.0, BSD, ISC, Zlib, Unicode-3.0, CDLA-Permissive-2.0
- Vollständige Liste mit Version und Lizenz je Paket: Hilfe › Lizenzen › Komponenten (KOMPONENTEN.md, erzeugt aus dem tatsächlichen Build)

## Weitere Bibliotheken, Schriften, Icons und Assets

| Bestandteil | Version | Rechteinhaber | Lizenz | Lizenztext/Bezugsquelle |
|---|---|---|---|---|
| [eintragen] | [eintragen] | [eintragen] | [eintragen] | [eintragen] |

JavaScript- und Rust-Abhängigkeiten, native Bibliotheken, Fonts, Icons und etwaige fremde 3D-Assets anhand der tatsächlichen Auslieferung prüfen.

## Hinweis im Programm

„Simpliy Slicer: Eigene proprietäre Komponenten © 2026 Michael Roßmann. Kostenfreie private und gewerbliche Nutzung ist erlaubt; der entgeltliche Weitervertrieb der proprietären Simpliy-Software ist ohne Genehmigung untersagt. PrusaSlicer und andere Open-Source-Komponenten unterliegen ausschließlich ihren jeweiligen freien Lizenzen. Die GNU AGPLv3 erlaubt unter ihren Bedingungen ausdrücklich auch die entgeltliche Weitergabe von PrusaSlicer. Simpliy Slicer ist kein offizielles Prusa-Produkt. Weitere Informationen unter Hilfe > Open-Source-Lizenzen.“
