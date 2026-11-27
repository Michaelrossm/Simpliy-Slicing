# Entwicklungsplan Simpliy Slicing

Stand: 21.11.2026. Arbeitsordner: T:\Simply slicer\Entwicklung\Simpliy-Slicing.

## Ziel und Grenzen

Eigenstaendiger Windows-Slicer mit einer an Simplify3D angelehnten Bedienung und eigenen interaktiven Stuetzen. Eine unveraenderte PrusaSlicer-3.0-Installation liefert nach Moeglichkeit das Slicing. Keine Nutzung proprietaerer Simplify3D-Dateien oder -Assets. Rust/Tauri fuer Desktop, Projekt und Prozesssteuerung; bei Geometriebedarf eine geeignete C++-Bibliothek ueber eine klar abgegrenzte Schnittstelle. Kein Python in der Anwendung. WebView-Technik fuer die Oberflaeche ist bereits Teil von Tauri.

Ein installierter PrusaSlicer ist ein externer Prozess, keine automatisch vollstaendige Programmierschnittstelle. Die CLI kann nicht zwingend alle GUI-Funktionen darstellen. Zunaechst echte 3.0-Schnittstellen nachweisen; ein eigener Prusa-Fork oder eingebetteter Quellcode ist eine spaetere Architekturentscheidung nur bei konkret belegter Notwendigkeit. Lizenzpflichten vor Verteilung pruefen.

## 0. Reproduzierbarer Start und echte Tests (P0)

- Rust-MSVC, C++-Buildtools und WebView2 pruefen; Cargo-Abhaengigkeiten beziehen, Buildfehler beheben und einen wiederholbaren Windows-Build erstellen.
- Fenster starten, Pfadermittlung, Dateidialoge, Speicherung und Fehlerausgaben manuell pruefen. Bestehende Nutzerdaten sichern.
- Einen STL-Testwuerfel ueber die Oberflaeche slicen, Ergebnis und Rueckgabecode pruefen. Abbruch, ungueltige Engine, ungueltige Eingabe, vorhandenes Ausgabeziel und Pfade mit Leerzeichen testen.
- Ausgabe zunaechst in temporaere Datei schreiben und erst nach erfolgreicher Pruefung ersetzen; abgestuerzte Prozesse und grosse Logs kontrollieren.
- Abnahme: dokumentierter Build und ein nachweislich aus dem Fenster erzeugter G-Code.

## 1. Verlaesslicher Slicing-Kern (P0)

- Version per CLI bestimmen und unterstuetzte Builds explizit fuehren; alpha14 und gewuenschte beta14 getrennt testen. Installation automatisch finden und manuell auswaehlen koennen.
- Versionierte JSON-Konfiguration und 3MF-Einbettung anhand echter 3.0-Exporte pruefen. Drucker-, Material- und Prozessprofile korrekt aufloesen und nur belegte Parameter uebergeben. Einstellungen und Fehler sichtbar machen; unbekannte Werte niemals stillschweigend verwerfen.
- Prusa-Daten isolieren; keine Originalprofile ueberschreiben. Slicing asynchron mit Fortschritt, Abbruch und lesbarem Protokoll; keine Shell-Interpolation.
- Profile anhand realer Drucker und Filamente testen. GUI-Einstellungen muessen nachweisbar im G-Code bzw. in der Engine-Konfiguration ankommen.
- Abnahme: STL/3MF, mehrere Profile und Fehlerfaelle automatisch sowie mindestens ein End-to-End-Test durch die GUI.

## 2. Vollstaendige Arbeitsoberflaeche und Projekt (P1)

- Modellimport mit echten Dateipfaden, Projekt speichern/oeffnen, Mehrfachauswahl, loeschen und rueckgaengig machen.
- WebGL-Viewer mit Druckbett, Kamera, STL und 3MF; Position, Drehen, Skalieren, auf Flaeche legen, automatische Anordnung und Kollisions-/Bauraumpruefung.
- Drucker, Material, Prozess und Auto-Configure in dieselbe Slicing-Konfiguration integrieren. Reiter, Eingabevalidierung, Einheiten und Parameterquellen klar darstellen.
- G-Code-Vorschau nach Schicht und Werkzeug; Status und geschaetzte Zeiten nur aus echten Daten.
- Abnahme: Projekt schliessen/oeffnen, Geometrie und Einstellungen bleiben erhalten und das resultierende Slicing entspricht der Vorschau.

## 3. Prusa-Funktionen erschliessen (P1/P2)

- Aus der installierten Engine das Konfigurationsschema und verfuegbare Optionen auslesen, nach Version speichern und in Bediengruppen abbilden.
- Prusa-native Stuetzen, Modifier, Nahtoptionen, variable Schichthoehe und Multimaterial einzeln auf CLI- und 3MF-Unterstuetzung untersuchen und implementieren, soweit technisch belegt.
- Fuer nicht erreichbare GUI-Funktionen eine begruendete Alternative dokumentieren; keine vollstaendige Gleichheit versprechen. Regressionstests pro Engineversion.

## 4. Eigenes Support Studio (P2)

- Anforderungen und Bedienung spezifizieren: Ueberhang erkennen, automatische Vorschlaege, manuelles Setzen/Loeschen, Dichte und Abstand, Saeulen-/Verzweigungsform, Kontaktgroesse und -abstand; undo/redo und Vorschau.
- Geometrieprototype mit robusten, lizenzkompatiblen Bibliotheken und problematischen Meshes testen. Koerper und Kontaktinterface getrennt modellieren, Schnittmengen und Kollisionen pruefen.
- Nachweisen, wie Prusa 3.0 Support-Koerper, Modifier und Interface mit korrekter Rolle und bei Bedarf separatem Werkzeug verarbeitet. 3MF-Roundtrip und G-Code schichtweise kontrollieren. Falls CLI/3MF diese Semantik nicht ausreichend traegt, Alternativen und Aufwand evaluieren, erst dann ueber Fork/Einbettung entscheiden.
- Vergleichsfaelle: Bruecken, kleine Kontaktflaechen, Innenraeume, verzweigte Formen, duenne Waende und Mehrmaterial. Erst nach Geometrie- und Drucktests als einsatzbereit kennzeichnen.

## 5. Produktreife (P3)

- Einstellungsassistent, Migration und Backups; abgestuerzte Jobs und defekte Projekte sauber behandeln.
- Automatisierte Windows-Builds, Regression und Versionsmatrix; reproduzierbare Installationspakete, Lizenzen und Drittanbieterhinweise.
- Grosse Modelle, Speicherverbrauch, Geschwindigkeit und Bedienbarkeit pruefen; Testdrucke fuer reale Geraete dokumentieren.

## Aktueller Stand

Die Vorbereitungsoberflaeche wurde kopiert. Ein direkter Test der mitgelieferten PrusaSlicer-3.0.0-alpha14-CLI erzeugte G-Code aus einem Testwuerfel. Ein erster GUI-Aufruf wurde implementiert, aber nativer Build und End-to-End-Bedienung sind noch nicht verifiziert. Simpliy-Parameter, Modellliste, 3D-Ansicht und eigene Stuetzen sind noch nicht mit dem Slicing verbunden. Naechster Meilenstein ist P0, nicht die Behauptung eines fertigen Slicers.

## Fortschritt 21.11.2026

Cargo-Abhaengigkeiten heruntergeladen; cargo check erfolgreich. Der Tauri-Entwicklungsbuild wurde erfolgreich erstellt und das Windows-Fenster gestartet (Prozess antwortet). Der Slicing-Weg durch die Oberflaeche ist noch nicht als End-to-End-Test bestaetigt. Der direkte CLI-Test bleibt der einzige verifizierte G-Code-Test. Vorhandene Ausgabedateien werden vom neuen Export abgelehnt.
