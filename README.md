# Simpliy Slicing

**Ein Windows-Slicer für die Vorbereitung und Vorschau von 3D-Druckprojekten.** Simpliy Slicing verbindet eine eigene Oberfläche und Stützwerkzeuge mit einer separat installierten PrusaSlicer-Engine.

![G-Code-Vorschau in Simpliy Slicing](bilder/vorschau.png)

> **Frühe Alpha:** Die Software befindet sich in Entwicklung. Prüfe Druckereinstellungen, Stützen und G-Code vor jedem Druck. Ein erfolgreicher Slice ersetzt keinen Testdruck.

## Funktionen

- Modelle auf Druckplatten platzieren und Prozesse sowie Druck- und Materialeinstellungen verwalten.
- Eigene Stützen erzeugen und bearbeiten; Kontaktbereiche und die Kombination mit automatischen Stützen werden beim Slicing geprüft. Bei Problemen kann auf eine sichere Variante zurückgefallen werden.
- G-Code mit Schicht- und Werkzeugwegansicht vorbereiten und anschließend speichern oder an einen unterstützten Drucker hochladen.
- Modelle im Querschnitt betrachten und Druckprojekte als 3MF speichern.

### Stützen und Querschnitt

![Beispiel für Stützstrukturen](bilder/stuetzen.png)

![Querschnitt in Simpliy Slicing](bilder/querschnitt.png)

## Installation und Voraussetzungen

Ein erstes Windows-Release wird vorbereitet. Sobald es freigegeben ist, findest du die Dateien unter [Releases](../../releases). Benötigt werden Windows, Microsoft Edge WebView2 Runtime und eine **separat installierte** kompatible PrusaSlicer-Version. Getestet wurde mit PrusaSlicer 3.0.0-alpha14. PrusaSlicer ist nicht im Simpliy-Paket enthalten.

1. Release-Paket vollständig herunterladen und entpacken.
2. Simpliy Slicing starten und bei Bedarf den Pfad zur PrusaSlicer-Installation auswählen.
3. Drucker- und Materialprofil prüfen, Modell importieren und slicen.
4. Vorschau und Stützen kontrollieren; G-Code erst danach speichern oder hochladen.

Die Kombination eigener und automatischer Stützen kann durch Schutzbereiche eingeschränkt sein; wenn die Prüfung nicht erfolgreich ist, wird ein sicherer Rückfall angezeigt. Für diese Kombination Text-G-Code verwenden. Die tatsächlichen Möglichkeiten hängen von der Version und der gewählten Konfiguration ab.

## Projektstatus und Hinweise

Simpliy Slicing ist ein eigenständiges Projekt und kein offizielles Produkt von Prusa Research. PrusaSlicer wird als separater Prozess verwendet. Die Screenshots zeigen eine frühe Entwicklungsversion; Details können sich ändern. Für Fehlerberichte kannst du die [Issues](../../issues) nutzen. Bitte keine Zugangsdaten oder privaten Druckerinformationen veröffentlichen.

Der Quellcode des Projekts wird derzeit nicht öffentlich bereitgestellt. Lizenz- und Drittanbieterangaben werden für die Veröffentlichung vorbereitet.
