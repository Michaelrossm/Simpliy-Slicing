# Simpliy Slicing – weiterer Entwicklungsplan

Stand: 22.11.2026. Dieser Plan ergänzt den Entwicklungsstand und ersetzt keine früheren Testberichte.

## Ziel und Ausgangslage

Simpliy Slicing soll FFF-Drucke mit einer an Simplify3D V6 angelehnten Bedienung vorbereiten. PrusaSlicer arbeitet unsichtbar als Hintergrundprozess; die Installation und ihre Originalprofile bleiben unverändert. Die Benutzeroberfläche läuft in Tauri/WebView, die Desktop-Anwendung und Dateiverarbeitung in Rust. Python ist nicht vorgesehen. Ein C++- oder Prusa-Fork wird erst geprüft, falls eine benötigte Funktion mit der vorhandenen Schnittstelle nachweislich nicht umsetzbar ist.

Bereits vorhanden sind Modellimport, 3D-Ansicht, mehrere Platten, Prozess- und Profilverwaltung, eine Verbindung zur Prusa-Engine, Slicing, Schichtvorschau, Drucker-Webfenster und Upload-Grundfunktionen. Slicing erzeugt zunächst eine temporäre Vorschau; Export und Upload sind getrennte Schritte. Die neue Modellauswahl ordnet jedes Modell genau einem Prozess zu. Diese Funktionen sind nicht automatisch mit vollständiger S3D-Gleichheit gleichzusetzen. Der dokumentierte Teststand unterscheidet automatisierte Prüfungen, Tests mit einer Engine und Tests mit einem echten Drucker.

Nach Projektunterlagen wurde 3.0.0-alpha14 getestet; die gewünschte Beta 14 muss gesondert anhand der tatsächlich vorhandenen Datei und ihrer Versionsausgabe geklärt werden. Ein echter Testdruck ist laut aktuellem Entwicklungsstand noch offen. Die persönliche MK3S-RRF-Konfiguration enthält dokumentierte Abweichungen; Makros auf dem Gerät und die Druckbarkeit sind noch zu prüfen.

## 1. Zuverlässiges Slicing und Prozesse – höchste Priorität

- Durchgehenden Test im echten Windows-Fenster durchführen: Modell laden, Drucker/Filament und Prozess wählen, slicen, Vorschau prüfen, zurück zur Modellansicht wechseln, ändern, erneut slicen und erst danach exportieren.
- Prozessdialog: Modellauswahl, Prozessnamen, Profil und Auto-Configure testen; Zuordnungen beim Speichern, Öffnen, Duplizieren und Löschen kontrollieren. Aktuell ist ein Prozess je Modell möglich. Prozesse dürfen nicht allein durch Wechsel des markierten Prozesses unbeabsichtigt andere Modelle verändern.
- Hauptprozess je Platte verständlich anzeigen. Nachweisen, welche Parameter pro Modell, pro Werkzeug oder nur für die gesamte Platte gelten. Konflikte vor dem Slicing mit konkreten Werten anzeigen; keine nicht unterstützte Einstellung unbemerkt verwerfen.
- **Benutzerdefinierte Zonen** wie in S3D: mehrere Prozesse für verschiedene Z-Höhen desselben Modells, optionale Start-/Endhöhe, Überlappungen, Lücken und Grenzen definieren. Zuerst Prusa-3MF-Höhenbereiche und unterstützte Einstellungen anhand echter Export- und Slicing-Versuche untersuchen. Eine vollständige S3D-Abbildung ist erst nach diesem Nachweis zugesagt. Nicht abbildbare Parameter klar sperren oder erklären.
- Abnahme: Ein Modell mit mindestens zwei Höhenzonen und unterschiedlichen nachweisbar unterstützten Einstellungen wird durch Simpliy gesliced; 3MF, G-Code und Vorschau zeigen die Grenzen korrekt. Projekte überstehen Speichern und erneutes Öffnen.

## 2. Drucker, Filament und persönliches Profil

- Vorhandene Prusa-FFF-Drucker, Druck- und Filamentprofile über die installierte, geprüfte Engine durchsuchbar anbieten; Kompatibilität und verfügbare Varianten anzeigen. Katalog hängt von der jeweiligen Installation ab.
- Eigene Drucker und Filamente auf vollständige Slicing-Übergabe prüfen, inklusive Bettform, Werkzeugen, Düsen, G-Code-Typ und Temperatur. Fehlende Werte oder nicht kompatible Kombinationen vor dem Slicing anzeigen.
- Persönliches MK3S-RepRapFirmware-Profil mit der tatsächlichen S3D-FFF und den benötigten Druckermakros abgleichen: Düse, Temperaturen, Extrusion, Rückzug, Kühlung, Start-/Endcode und Material-/Qualitätsvarianten. Die vorhandene Abweichungsliste fortschreiben; den gesperrten Entwurf nicht als druckfertig ausgeben.
- Matrix S3D ↔ Simpliy/Prusa erstellen: direkt übernommen, angenähert, nicht verfügbar und nur in Prusa vorhanden. Jeden Eintrag anhand Quellprofil, Engine-Verhalten und Test belegen; nicht jede gleich benannte Einstellung wirkt identisch.
- Abnahme: Einstellungen erscheinen in der effektiven Engine-Konfiguration bzw. im erzeugten G-Code; anschließend kontrollierter Testdruck mit dem tatsächlichen Drucker und seinen Makros.

## 3. Vorschau und Modellansicht

- Schichtansicht mit Legende und Filtern für Werkzeugwegtyp, Geschwindigkeit, Schichthöhe und berechneten Volumenfluss gegen echte Prusa-G-Code-Beispiele prüfen. Sollwerte von tatsächlich gemessenen Werten unterscheiden.
- Einzelne und mehrere Schichten, Bereichsschieber, aktuelle Schicht, Fahrwege, Rückzüge, Werkzeug und Statistik gut erkennbar darstellen; Farben, Hervorhebung, Größen und Performance bei großen Dateien überprüfen.
- Schattierung direkt am Bauteil verbessern, Unteransicht und Kamerasteuerung testen. Aus der Vorschau muss jederzeit die Bearbeitungsansicht erreichbar sein; Änderungen markieren alte Slicing-Ergebnisse als veraltet.
- Querschnitt in Modell- und Schichtansicht testen: ±X/±Y/±Z, Position, Richtung, Punktwahl, Ebene und Pfeil. Der aktuelle Ansichtsschnitt verändert weder Modell noch Druckdaten und erzeugt noch keine geschlossene Schnittfläche. Gefüllte Schnittflächen und robuste Konturen als Erweiterung untersuchen.
- Abnahme: Mehrere reale G-Code-Dateien, große Modelle und alle Kamerarichtungen im Fenster geprüft; Vorschauwerte stimmen mit G-Code-Daten überein.

## 4. S3D-orientierte Bedienung und Bearbeitungswerkzeuge

- Rechte Werkzeugleiste, Kontextbereiche und untere Schnellleiste visuell und funktional auf verschiedenen Fenstergrößen prüfen; Symbole, Beschriftungen, Hinweise und aktive Zustände eindeutig machen. Statusanzeige dauerhaft sichtbar halten.
- Import, Auswahl, Mehrfachauswahl, Anordnen, Verschieben, Drehen, Skalieren, Spiegeln, auf Fläche legen, Rückgängig/Wiederholen und Bauvolumenprüfung durchgängig prüfen.
- Prusa-nahe Funktionen wie Anmalen, Modifikatoren, variable Schichthöhe, Text, Messen und Netzreparatur einzeln bis zu Projektdatei und Slicing testen. Bekannte Grenzen wie fehlender Kantenfang, Text auf Rundungen und Selbstdurchdringungen dokumentieren.
- Abnahme: Jede angezeigte aktive Funktion bewirkt das Erwartete und bleibt nach Speichern/Öffnen erhalten, sofern sie Teil des Projekts ist. Nicht verfügbare Funktionen bleiben eindeutig markiert.

## 5. Druckerverbindung und Ausgabe

- IP/URL je Drucker speichern, Weboberfläche im Programm öffnen und Fehler verständlich darstellen. Bestehende Upload-Wege für unterstützte Systeme gezielt mit echten Geräten testen; Protokolle und Unterschiede je System anzeigen.
- Vorschau, Export und Upload getrennt halten; nur aktuelle Slicing-Ergebnisse verwenden. Bestehende Dateien, Authentifizierung und Verschlüsselung je Zielsystem überprüfen.
- Direkten Druckstart nur für nachweislich unterstützte Systeme entwickeln; Upload und tatsächlicher Druckstart sind getrennte Aktionen. Test zunächst gegen Simulator, danach gegen einen geeigneten realen Drucker.
- Abnahme: exportierte und hochgeladene Datei stimmt mit dem zuletzt geslicten Auftrag überein; Fehlermeldungen und unterbrochene Übertragungen sind nachvollziehbar.

## 6. Eigene S3D-ähnliche Stützen – nach stabilem Slicing

- Zuerst Bedienung und gewünschtes Ergebnis festlegen: automatische Platzierung, einzelne Stützen und Gruppen hinzufügen/entfernen, Raster, Überhangwinkel, Säulenabstand, Kontaktfläche, Abstände und Rückgängig.
- Eigene, rechtlich zulässige Geometrie entwickeln; keine Übernahme proprietären S3D-Codes oder von Markenassets. Ergebnisse vor dem Slicing sichtbar machen. Stützeinstellungen im normalen Prozessdialog führen; interne Hilfsprozesse nicht als Benutzerprozesse anzeigen.
- Körper und Kontaktbereiche samt Einstellungen zuverlässig an die Prusa-Engine übergeben. An kritischen Modellen testen: Überhänge, Brücken, kleine Kontakte, Innenräume und dünne Wände. Prüfen, ob 3MF/Engine die gewünschte Semantik tatsächlich unterstützt.
- Abnahme: visuelle Kontrolle, schichtweiser G-Code-Vergleich und Testdrucke belegen Position, Haftung und Entfernbarkeit. Bis dahin bleiben die eigenen Stützwerkzeuge deaktiviert; vorhandene Prusa-Stützen werden separat geprüft.

## 7. Stabilität, Verteilung und Dokumentation

- Projekt-/Profilformate, Backups, Wiederherstellung und Kompatibilität alter Arbeitsbereiche testen; keine bestehenden Nutzerprofile überschreiben. Große Dateien, defekte Modelle, Programmabbruch und gleichzeitige Aufgaben berücksichtigen.
- Windows-Build und Installation reproduzierbar machen; Abhängigkeiten, Lizenzpflichten und unterstützte Prusa-Versionen dokumentieren. Alpha 14 und gewünschte Beta 14 nur nach separater Prüfung unterstützen.
- Für jeden Meilenstein festhalten: automatisierter Test, echter Engine-Test, Oberflächentest und gegebenenfalls echter Drucktest. GUI- oder Druckertests nicht aus einem erfolgreichen Build ableiten.

## Empfohlene Reihenfolge

1. Prozesszuordnung im echten Fenster prüfen und Höhenzonen mit Engine-Nachweis umsetzen.
2. Persönliches MK3S-Profil und Prusa-Drucker-/Filamentauswahl zuverlässig fertigstellen.
3. Vorschau, Querschnitt und S3D-orientierte Bedienung im Fenster prüfen und verbessern.
4. Druckerverbindung und Upload an realen Geräten prüfen.
5. Erst danach eigene Stützen entwickeln und durch Testdrucke absichern.

Der nächste konkrete Arbeitsschritt ist die technische Untersuchung der Z-Höhenbereiche mit der vorhandenen Prusa-Version und einem kleinen Vergleichsmodell. Falls deren Schnittstelle nicht alle gewünschten S3D-Prozesse erlaubt, wird die Einschränkung samt Alternative dokumentiert, bevor die Funktion als fertig gilt.
