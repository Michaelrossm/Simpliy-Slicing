# Simpliy Slicer – Checkliste vor öffentlicher Veröffentlichung

**Lizenzgeber eigener proprietärer Komponenten: Michael Roßmann**  
**Lizenzziel:** kostenlose private und gewerbliche Nutzung, kostenlose unveränderte Weitergabe, **kein entgeltlicher Weiterverkauf der proprietären Simpliy-Software** durch Dritte.

- [ ] Namen des Lizenzgebers überall als **Michael Roßmann** führen und tatsächliche Rechteinhaberschaft an Code, Designs und Assets prüfen; Beiträge Dritter nicht pauschal ihm zuordnen
- [ ] Vollständige ladungsfähige Anschrift und E-Mail ergänzen
- [ ] Endnutzer-Lizenz vor Installation bzw. Download wirksam einbeziehen und im Programm bereitstellen
- [ ] Gewerbliche Nutzung ausdrücklich erlauben, insbesondere bezahlte 3D-Druckaufträge und Verkauf gedruckter Teile
- [ ] Verbot des entgeltlichen **Vertriebs der proprietären Simpliy-Software** ausdrücklich auf diese Komponenten begrenzen
- [ ] Prüfung, ob und in welchem Umfang das Verkaufsverbot unter deutschem/EU-Recht und insbesondere bei Erschöpfungstatbeständen durchsetzbar ist
- [ ] Technische und rechtliche Trennung zwischen Simpliy und PrusaSlicer anhand des tatsächlichen Quellcodes und Kommunikationswegs von OSS-erfahrenem Juristen prüfen lassen (CLI-Aufruf allein garantiert Unabhängigkeit nicht)
  - Stand 24.11.2026 (technisch umgesetzt): kein Fork, keine Prusa-Dateien/Texte im Lieferumfang, Engine wird nicht mitgeliefert, Aufruf als getrennter Prozess, Texte zur Laufzeit aus der installierten Engine. In Lizenz §6 und THIRD-PARTY-NOTICES beschrieben.
- [ ] Keine AGPL-Bestandteile unter zusätzlichen Vertriebsbeschränkungen ausliefern; PrusaSlicer darf nach AGPLv3 auch entgeltlich weitergegeben werden
- [x] Exakte Version der Engine: wird nicht mitgeliefert; geprüft mit 3.0.0-alpha14 (Tag version_3.0.0-alpha14)
- [ ] Bei Verbreitung von PrusaSlicer-Binärdateien alle AGPLv3-Pflichten einschließlich Copyright, Lizenztext, korrespondierendem Quellcode und erforderlicher Buildinformationen erfüllen
- [x] Komponenten und Abhängigkeiten inventarisiert (KOMPONENTEN.md: 232 Rust-Pakete, three.js, opentype.js; keine GPL/AGPL-Bibliothek in Simpliy)
- [ ] Weitere Copyright-, MIT-, Apache-2.0- und sonstige Lizenzpflichten erfüllen
- [x] Keine fremden Slicer-Quellcodes, Icons oder Assets übernommen; im Programm keine Nennung fremder Slicer-Produkte
- [ ] Keine irreführenden Behauptungen über Verbindung mit Prusa Research
- [ ] Installer/ZIP/Webseite und Hilfe > Lizenzen liefern EULA und THIRD-PARTY-NOTICES mit aus
- [ ] Impressum/Anbieterkennzeichnung, Datenschutz, Aktualisierungen und Verbraucherschutz je nach Vertriebsmodell prüfen
- [ ] Haftungsklauseln unter Berücksichtigung des konkreten Gratis-Angebots prüfen lassen
- [ ] Technische Warnung zu Alpha-Engine, Sicherheit und 3D-Druck ergänzen
- [ ] Rechtsberatung mit Schwerpunkt deutsches IT-Recht und AGPLv3 vor Veröffentlichung durchführen lassen
