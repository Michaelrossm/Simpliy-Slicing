# Simpliy Slicing – Veröffentlichungsnotizen

## Zweck
Aktueller Entwicklungsstand. Die Prusa-Engine bleibt unverändert und wird im Hintergrund verwendet.

## Änderungen
- Inkrementelle Stützenbearbeitung mit stabilen Gruppen, Abhängigkeiten und räumlicher Auswahl.
- Lokales Löschen, Hinzufügen und Verschieben; unveränderte Gruppen und gemeinsame Stämme bleiben erhalten.
- Gruppierte Kontaktgeometrie, Kontaktpolster und GPU-Instanzen; Updates nur für betroffene Gruppen.
- S3D-orientierte Welt-/Bettkoordinaten, absolute Z-Höhe ab Bett und Weltachsen-Skalierung.
- Sichtbare Move-, Rotate- und Scale-Gizmos mit dünnen Drehgriffen und Winkelanzeige.
- Benutzerdefinierte Prozesszonen mit blauen zugewiesenen und gelben Vorschau-Rahmen.
- Profile, Drucker, Filamente und Prusa-Engine-Daten bleiben im Arbeitsbereich gespeichert.

## Messungen
- 6181 Stützpunkte: rund 10,5 s Gesamtplanung und etwa 1,07 GiB Working Set im Headless-Lauf.
- Lokales Löschen einer Stütze: etwa 165–173 ms.
- Bestehende Rust- und JavaScript-Test-Suiten wurden ausgeführt; Engine-/Fixture-Tests bleiben gekennzeichnet.

## Einschränkungen
- Entwicklungs-/Alpha-Stand, nicht als zertifizierter Produktions-Slicer freigegeben.
- Für die jüngsten visuellen Änderungen ist keine vollständige manuelle Viewport-Prüfung verfügbar.
- Vor dem Druck müssen Drucker, Filament und Prozessprofil ausgewählt sein; G-Code am eigenen Drucker prüfen.
