# Untersuchung: eigene Stützen und Prusa-Kontaktfläche

Stand 22.11.2026. Die Versuche sind keine Testdrucke und die untersuchte Übergabe ist in der Anwendung noch gesperrt.

**Ueberholt durch 0.10.1:** Der ModelPart-Weg ist entfernt, siehe ENTWICKLUNGSSTAND.md.

## Fragestellung

Eigene quadratische Pfeiler möglichst nah an den Modellüberhang führen und Prusa nur den darüberliegenden Kontaktbereich erzeugen lassen. Die eigene Pfeilergeometrie ist derzeit eine Ansicht/Exportgeometrie, keine native Prusa-Stützrolle.

## Technischer Befund

Der Quellcode von PrusaSlicer 3.0.0-alpha14 definiert 3MF-Volumina ModelPart, NegativeVolume, ParameterModifier, SupportBlocker und SupportEnforcer. Eine 3MF-Volumenrolle für einen fertig erzeugten Supportkörper oder eine fertige Support-Interface-Geometrie ist darin nicht vorhanden. SupportEnforcer beeinflusst die von Prusa selbst erzeugten Stützen; das Volumen wird nicht einfach als fertiger Stützkörper gesliced.

Ein eigenes Versuchs-3MF mit einem überhängenden Bauteil und einem 4 mm breiten Erzwinger erzeugte echte G-Code-Rollen „Support material“ und „Support material interface“. Prusa verbreitert oder verändert die Stütze dabei. Die 3D-Vorschau eines vorgegebenen Pfeilers wäre deshalb keine genaue Vorschau des G-Codes.

Bei einem zweiten Versuch wurde zusätzlich ein eigener quadratischer Pfeiler als ModelPart bis Z 8,8 mm eingefügt, das Modell begann bei Z 10 mm, der Erzwinger überdeckte die Unterseite. Mit Stützstil „grid“ entstanden zusätzliche Stützbahnen neben dem Pfeiler und bis zur ersten Schicht. Mit „snug“ und Schließradius 0 entstanden in diesem einfachen Beispiel Supportbahnen erst ab Z 9,1 und Kontaktbahnen ab Z 9,317 bis Z 9,8. Die 0,2 mm zum Modell entsprachen dem verwendeten Prusa-Kontaktabstand. Der eigene Pfeiler war für die Engine allerdings ein normales ModelPart, keine Support-Rolle.

Bei demselben Versuchsaufbau mit Pfeileroberkante Z 9,7 mm, Modellunterkante Z 10 mm und 0,2 mm Prusa-Kontaktabstand wurden keine Stütz- oder Kontaktbahnen ausgegeben. Ein verbleibender Zwischenraum von 0,1 mm für Prusa ist bei diesem Profil und den verwendeten Schichten daher nicht ausreichend. Dies beweist keine allgemeine Mindestgröße für andere Schicht- und Düseneinstellungen.

## Weiterer notwendiger Nachweis

- Saubere Übergabe getrennter eigener Stützkörper mit eigener Druckkonfiguration untersuchen; ModelPart-Semantik, Anordnung, Kollisionen und Mehrwerkzeug sind nicht mit Prusa-Support gleichzusetzen.
- Mindesthöhe für Kontaktbahnen anhand tatsächlicher Schichtgrenzen, Kontaktabstand und Interface-Schichten berechnen und bei zu kleinen Lücken prüfen.
- Mehrere Pfeiler, verschiedene Höhen, schräge Flächen, benachbarte Bauteile, kleine Kontaktflächen und vorhandene reguläre Prusa-Stützen anhand des tatsächlichen G-Codes vergleichen.
- Nur freigeben, wenn der eigene Körper, die ausgewählte Position, Kontakt- und Bodenabstand sowie die Schnittstellenbahnen im gesamten Auftrag nachweisbar zusammenpassen. Die Ergebnisvorschau muss die echten Prusa-Werkzeugwege zeigen.
- Abschließend reale Testdrucke; ein erfolgreicher G-Code-Export allein belegt keine Druckbarkeit.

Testartefakte wurden temporär unter `%TEMP%/simpliy-enforcer-study` angelegt. Die Funktion `supportEnforcerVolume` im Frontend ist nur vorbereitender, nicht in den Slicing-Auftrag integrierter Code. Die Slicing-Sperre für eigene Stützen bleibt aktiv.

## Interner Stützprozess: weiterer Versuch

Die Einstellungen des eigenen Stützkörpers können in alpha14 als `volume_settings` eines separaten ModelPart-Volumens übergeben werden. Ein realer Vergleich auf Z 3,5–5 mm am 4-mm-Pfeiler zeigte: Das normale Bauteil-/Pfeilerprofil erzeugte innere und äußere Wände sowie Füllung; der Pfeiler mit internem Parameter `perimeters = 1` hatte nur die äußere Wand. Mit `fill_density = {value: 0, is_percent: true}` entfiel im untersuchten Pfeilerbereich auch die Füllung. Der einfache Zahlenwert `0` wurde dagegen nicht wie beabsichtigt übernommen. Die normalen Objektwerte blieben separat.

Im weiteren Test mit 0,15 mm Schichthöhe, 0,2 mm Kontaktabstand, zwei Interface-Lagen und 0,95 mm reserviertem Bereich erzeugte Prusa echte `Support material`- und `Support material interface`-Bahnen. Diese Zahlen sind ein experimenteller Sicherheitsaufschlag, keine bewiesene allgemeine Mindesthöhe. Im Quellcode ist unter `experimentalSupportProcess` eine Vorbereitung für einen internen Körperprozess und einen Kontakt-Erzwinger ergänzt. Sie prüft, dass nur pro Volumen verfügbare Werte übergeben werden, und sperrt zu kurze Pfeiler. Sie ist noch nicht mit dem Slicing-Auftrag verbunden. Stützkörper werden im Versuch als ModelPart gesliced und besitzen nicht die native Support-Rolle.

Offen bleiben insbesondere die durchgehende Verwendung der normalen Support-Parameter, Prüfung der gesamten Pfeiler auf Durchdringung anderer Modellbereiche, unterschiedliche Werkzeug-/Materialeinstellungen, mehrere benachbarte und übereinanderliegende Pfeiler, Wechselwirkungen mit anderen Modellen und mit automatischen Prusa-Stützen. Erst nach Tests dieser Fälle darf die Sperre aufgehoben werden.
