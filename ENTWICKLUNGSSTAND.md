# Simpliy Slicing - Entwicklungsstand

## Unabhängige eigene Stützen lokal hinzufügen und verschieben

- Der vorhandene Einzelbearbeitungspfad plant einen neuen eigenen Kontakt mit dem regulären Rust-Planer gegen die Modellgeometrie. Er übernimmt den Ast nur, wenn dessen gesamte XY-Hülle einschließlich Füßen, Kontaktpolstern und Sicherheitsabständen von vorhandenen Stützen getrennt ist. Beim Versetzen wird zuerst die bisherige Geometrie über den vorhandenen Löschpfad gekürzt.
- Der echte Prusa-Test kombinierte zwei Fächergruppen mit einer einzelnen hinzugefügten und danach verschobenen Stütze. Die angeforderten Stile Baum, Fächer, Knotenblech, Mini und Pfeiler wurden als separate Aufträge geprüft. Die Einzelkontakte dürfen entsprechend der bisherigen Formlogik auf einen geraden Ast ausweichen, wenn Partner oder passende Wand fehlen. Das Schnittprotokoll für Baum, Fächer und Knotenblech bestätigte in beiden Schritten die lokale Planung des unabhängigen Astes.
- Alle fünf Aufträge ergaben jeweils vier von vier Stützen ohne Warnung. Ein separater Rust-Test bestätigt den Rückfall auf den Gruppenplaner, wenn ein neuer Fächerkontakt nahe beim vorhandenen Arm liegt. 161 Rust-Tests und der Windows-Release-Build bestanden.
- Die gemessene Rust-Zeit im Debug-Build betrug rund 52–71 ms für das Hinzufügen und 54–80 ms für das Verschieben eigener Stützen in dieser kleinen Szene. Diese Zeiten enthalten kein Slicing und keinen GPU-Transfer.
- Die Wiederholungsmessung in der 6181-Punkte-Szene ergab 173 ms für die lokale Löschung. Alle verbliebenen Astlinien behielten ihre Koordinaten. Der ursprüngliche Plan behielt den Referenz-Fingerabdruck `6087d7aceb678fdc`.
- Beim Berühren vorhandener Stützen bleibt die vollständige Planung zuständig. Der lokale Anschluss an vorhandene Stämme, getrennte Kontaktgeometrie pro Gruppe und gruppengenaue Vorschau-Updates bleiben offen. Beim Anhängen werden die zusammengefassten Geometriedaten des betroffenen Modells kopiert. Die bekannten Qualitätsprobleme der großen Referenzszene wurden in diesem Arbeitsschritt nicht korrigiert.

## Native Pfeiler lokal hinzufügen und verschieben

- Der Rust-Planer erkennt eine einzelne neue oder versetzte native Prusa-Stützvorgabe. Über den vorhandenen Gruppenindex prüft er mögliche Astkonflikte und kontrolliert zusätzlich die Polster- und Kontaktflächen auf der Platte. Bei einem möglichen Konflikt oder einer nicht unterstützten Änderung greift der reguläre Planer.
- Wenn die neue Position frei ist, bleibt die vollständige eigene Stützgeometrie dieselbe Speicherreferenz mit derselben Vorschau-Revision. Das vorhandene Pfeilerprotokoll liefert die geänderten Pfeilergruppen an den Viewport. Die globale Schnellansicht während ausstehender Anfragen bleibt bestehen.
- Im echten Prusa-Test mit zwei Fächergruppen dauerte das Hinzufügen eines freien Pfeilers 0,681 ms, sein Versetzen 0,702 ms. Das sind Rust-Messwerte im Debug-Build für diese kleine Szene. Prusa erzeugte nach den Bearbeitungen vier von vier Stützen ohne Warnungen. 160 Rust-Tests bestanden.
- Der Windows-Release-Build war erfolgreich. Die Wiederholungsmessung für die lokale Löschung bei 6181 Punkten ergab 169 ms bei unveränderten Koordinaten aller verbliebenen Astlinien. Der ursprüngliche Plan behielt den Referenz-Fingerabdruck `6087d7aceb678fdc`.
- Das lokale Hinzufügen und Versetzen eigener verzweigter Stützen, dauerhaft getrennte Kontaktgeometrie pro Astgruppe, gruppengenaue Schnellansicht und vollständige Qualitätsprüfung aller Formen bleiben offen.

## Räumlich begrenzte Kontaktaufbereitung nach dem Löschen

- Gelöschte Rohpolster, Füße vollständig gelöschter Gruppen und der Einflussbereich gelöschter Kontaktpunkte bestimmen den Startbereich. Der Rust-Plan erweitert ihn über benachbarte Rohquader und fertige Druckflächen, bis keine weitere geometrische Abhängigkeit gefunden wird. Nur dieser Bereich läuft durch die vorhandene Kontaktaufbereitung. Bei zu großem Bereich greift der vollständige Kontaktaufbau.
- In der Szene mit 6181 Stützpunkten wurde 1 von 575 Astgruppen zugeschnitten. Die Kontaktaufbereitung erfasste 2141 von 77245 Rohquadern. Die Planung dauerte 0,165 s. Das liegt unter einer Sekunde und über 100 ms. Alle verbliebenen Astlinien behielten genau ihre Koordinaten.
- Im echten Prusa-Fächertest mit zwei Gruppen blieben nach dem lokalen Schnitt drei Stützen ohne Warnung. Der Test verglich zusätzlich den lokalen Kontaktaufbau mit dem vollständigen Kontaktaufbau auf denselben verbleibenden Ästen.
- Der separate 6181-Punkte-Prüflauf mit `SIMPLIY_VERIFY_LOCAL_CONTACTS=1` bestätigte ebenfalls gleiche Quader für Polster, Streifen und Bahnen bis zur Vergleichsauflösung von 0,0000001 mm. Dieser Prüflauf enthält absichtlich eine zusätzliche vollständige Kontaktberechnung und zählt nicht zur 165-ms-Messung. 159 Rust-Tests bestanden und der Windows-Release-Build wurde erstellt.
- Kontaktflächen außerhalb des Bereichs werden weiterhin in gemeinsame Modellausgaben kopiert. Es gibt noch keine dauerhaften Kontaktobjekte je Gruppe, gruppengenauen GPU-Updates oder lokalen Pfad für Hinzufügen und Verschieben. Weitere Engine-Prüfungen und die bekannten Qualitätsprobleme bleiben offen.

## Lokales Entfernen bei mehreren Astgruppen

- Gelöschte Kontakt-IDs werden über den Gruppenindex zugeordnet. Der Plan kürzt ausschließlich Astlinien der betroffenen Gruppen und entfernt die Füße vollständig entfallener Gruppen. Verbleibende Astlinien und Füße behalten ihre Koordinaten. Bei der Ausgabe werden die Netze und Kontaktlagen des Modells weiterhin gemeinsam zusammengesetzt. Die bestehenden Kontakt-Caches können dabei unveränderte Flächen übernehmen.
- Der echte Prusa-Test mit zwei Fächern auf einem Modell hat nach einer lokalen Löschung drei verbleibende Stützen ohne Warnung erzeugt. Die Astkoordinaten des weiter entfernten Fächers wurden vor und nach dem Löschschritt direkt verglichen. Der Rust-Schritt dauerte im Debug-Build 202,745 ms.
- In der 6181-Punkte-Szene wurde beim Löschen eines Astkontakts 1 von 575 Gruppen zugeschnitten. Alle verbleibenden Astlinien behielten exakt ihre Koordinaten. Die Gesamtdauer lag bei 3,609 s, davon 3,523 s für die modellweite Zusammenstellung der Kontaktlagen. 1380 Kontaktgruppen wurden untersucht, 157 berechnet und 1223 aus dem vorhandenen Cache übernommen. Das ursprüngliche Modell behielt den Referenz-Fingerabdruck `6087d7aceb678fdc`.
- 159 Rust-Tests bestanden, 22 wurden standardmäßig übersprungen. Der gezielte echte Prusa-Test lief separat und bestand. Der Windows-Release-Build war erfolgreich.
- Hinzufügen und Verschieben bleiben bei der regulären Planung. Die Vorschau überträgt weiterhin die fertig zusammengesetzte Modellgeometrie. Die Zuständigkeit der einzelnen Astgruppen erlaubt noch kein gruppengenaues GPU-Update. Weitere Engine-Tests aller Stützenformen und die Korrektur der bekannten Qualitätspunkte stehen aus.

## Gemeinsame Stämme lokal kürzen

- Der Rust-Plan speichert für jede Astlinie die IDs der getragenen Kontakte. Bei einer eindeutigen einzelnen eigenen Gruppe eines Modells können gelöschte Kontakte und ihre ausschließlich benötigten Segmente entfernt werden. Der Plan behält Koordinaten von Stamm, Füßen und verbleibenden Armen und erzeugt die Kontaktlagen der betroffenen Gruppe erneut.
- Ein Fächer mit zwei Kontakten wurde lokal auf einen Kontakt gekürzt. Die Rust-Planung dauerte im Debug-Build 54,654 ms. Prusa 3.0 erzeugte echte Stützbahnen. Die strenge Prüfung meldete 1 von 1 Stützen, keinen schwachen Kontakt und keine schwebende Stelle. Ein früher Versuch mit abweichenden Schichtwerten meldete schwachen Kontakt und eine schwebende Stelle. Im bestandenen Versuch wurden die Schichtwerte von Planer und Engine abgeglichen und weiter auseinanderliegende Kontaktpunkte gewählt.
- Die 6181-Punkte-Referenz mit Segmentzuordnung behielt den Fingerabdruck `6087d7aceb678fdc`. Die erneute Messung der nativen Löschung ergab 51 ms. Das ist kein Laufzeitnachweis einer verzweigten Teiländerung im großen Modell.
- Bei mehreren eigenen Gruppen auf demselben Modell, unklaren Ersatzpfaden, Hinzufügen und Verschieben läuft weiterhin der reguläre Planer. Die betroffene Modellgeometrie wird beim lokalen Astschnitt für GPU und Export neu zusammengesetzt. Unveränderte Modellgeometrie bleibt über die vorhandene Revision erhalten. Die Schnellansicht ist noch nicht gruppengenau.

## Lokale Löschung mit beibehaltener Stützgeometrie

- Entfernt eine Bearbeitung ausschließlich unveränderte native Prusa-Vorgaben, übernimmt der Rust-Plan die bestehenden Astnetze, Stämme und Kontaktlagen über dieselbe `Arc`-Referenz. Der Eintrag im Kollisionsfeld war ein Hindernis, keine tragende Fläche für eigene Äste. Ebenso kann die einzige eigene Astgruppe eines Modells komplett entfallen, wenn alle ihre Kontakte gelöscht wurden und keine Ersatz- oder übersprungenen Stützen die Zuordnung unklar machen.
- In der 6181-Punkte-Szene dauerte die native Löschung im Headless-Planer 69 ms. Alle 575 Astgruppen wurden übernommen. Null Astgruppen neu berechnet, null Astnetze kopiert. Der Eingabevergleich und die native Pfeilerliste werden weiterhin verarbeitet. Die Messung umfasst weder GUI noch Prusa.
- Die Vorschau verwendet Geometrierevisionen, damit unveränderte Äste und Kontaktlagen beim Antwortpaket und beim GPU-Aufbau entfallen. Die separate Aktion „Stützgeometrie neu optimieren“ berechnet den Plan für die vorhandenen Kontaktpunkte neu. Die vorherige G-Code-Vorschau gilt danach als veraltet.
- Eine Teiländerung an einer verzweigten Gruppe oder eine Änderung mit unklarer Tragwirkung fällt weiterhin auf den vollständigen Planer zurück. Teilgruppen-Neuplanung, dauerhaftes Speichern über den begrenzten Plan-Cache hinaus und eine räumlich begrenzte Schnellansicht fehlen noch.
- 158 Rust-Tests bestanden, 21 regulär übersprungen. Der Windows-Release-Build war erfolgreich. Der separate echte Prusa-Lauf der Referenzszene erzeugte G-Code in 78,623 s. Die strenge Stützenprüfung meldete weiterhin 13 Pfeilerwarnungen, 546 auffällige Astproben und zwei schwebende Stellen. Dieser Engine-Lauf prüfte die unbearbeitete Referenzszene.

## Gruppenbesitz für fertige Äste im Rust-Plan

- Baum-, Fächer- und Knotenblechgruppen behalten im fertigen Modellplan die sortierten Kontakt-IDs und die Bereiche ihrer Äste, Stämme und Fußgeometrie. Die Gruppen verweisen über Bereiche auf die vorhandenen Geometriearrays. Die Kontakt-ID wird bei der Stützenauswahl direkt im Gruppenindex nachgeschlagen.
- Ein XY-Kachelindex hält die von Ästen und Füßen belegten Bereiche. Er dient der Kandidatensuche, erfasst aber noch keine Abhängigkeiten aus verworfenen Routen, Nachbarschaftswahl und gemeinsam geschnittenen Kontaktflächen. Der sichere Rückfall bleibt die bestehende vollständige Planung.
- Die 6181-Punkte-Szene lieferte 575 Astgruppen bei identischem Referenz-Fingerabdruck `6087d7aceb678fdc`. Die Indexabfrage für den zuerst getesteten nativen Pfeiler fand 23 räumliche Kandidaten in 0,011 ms. Das ist die reine Abfragezeit, keine lokale Löschzeit. Die vollständige Planung nach dieser Löschung dauerte 17,457 s bei parallel laufenden Prüfungen.
- Beim gezielt ausgewählten Astkontakt lieferte die Abfrage die eigene Gruppe und 23 räumliche Kandidaten in 0,001 ms. Der anschließende vollständige Löschplan dauerte 11,994 s. Mit geleertem Routencache waren es 14,760 s bei identischem geordnetem Geometrie-Fingerabdruck. 157 Rust-Tests bestanden. Windows-Release-Build erfolgreich. Prusa erzeugte G-Code in 65,743 s. Die strenge Stützenprüfung blieb wegen der bekannten 13 Pfeilerwarnungen, 546 auffälligen Astproben und zwei schwebenden Stellen rot.

## Lokale Wiederverwendung der Kontaktbahnen im Rust-Backend

- Zusammenhängende Kontaktflächen einer Lage werden über ihre exakten Rasterzellen, die räumlich ausgewählten Kontaktpunkte und die Druckparameter identifiziert. Unveränderte Gruppen übernehmen fertige Kontaktbahnen und dichte Restflächen aus einem gemeinsamen Cache mit geschätztem Limit von 32 MiB. Die gleiche Berechnung liefert die Daten für den Slicing-Auftrag.
- Nach einer Löschung in der Szene mit 6181 Stützpunkten wurden 1380 Kontaktgruppen untersucht, davon 157 neu berechnet und 1223 übernommen. Die gesamte Planung nach der Löschung dauerte 13,305 s. Der Lauf enthielt parallele Prüfungen. Der Wert misst die Gesamtplanung, keine reine Kontaktlaufzeit.
- Astvereinigungen, die Ermittlung der Kontaktflächen und die Zusammenführung in den Modellplan laufen weiterhin gemeinsam. Die Kontaktgruppen werden beim Zusammenführen kopiert. Ein übergreifender Abhängigkeitsgraph für Äste und gemeinsame Stämme sowie lokale Änderungen ohne Untersuchung entfernter Gruppen bleiben offen.
- Referenz mit geleertem Routen-Cache und weiter aktivem Kontakt-Cache: 18,431 s, gleicher Fingerabdruck einschließlich Ausgabereihenfolge. Der Dreifachlauf erreichte 1,055 GiB Peak Working Set. 157 Rust-Tests bestanden, 21 wurden regulär übersprungen. Der Release-Build war erfolgreich. Der echte Prusa-Engine-Lauf erzeugte in 83,51 s G-Code und scheiterte in der strengen Qualitätsprüfung weiterhin an 13 Pfeilerwarnungen, 546 Astproben und zwei schwebenden Stellen.

## Deltaübertragung für Pfeiler im Viewport

- Fertig geplante native Pfeiler werden pro Modell in 16-mm-XY-Zellen gruppiert. Der Server vergleicht je Gruppe die exakten Geometriedaten und vergibt eine Revision. Nur geänderte Gruppen übertragen Instanzdaten. Der Viewport behält bestehende GPU-Instanzen für unveränderte Gruppen und gibt entfernte Instanzen frei.
- Im automatisierten Löschtest werden zunächst drei Pfeiler in zwei Gruppen übertragen. Nach der Löschung wird ein Pfeiler übertragen. Die entfernte Gruppe behält dieselbe Revision und sendet keine Instanzdaten.
- Das ist eine inkrementelle Vorschauübertragung für Pfeiler. Der Planer untersucht weiterhin die Kontaktliste. Verzweigte Körper, gemeinsame Stämme, Kontaktbahnen und die Schnellansicht bleiben auf dem bisherigen Pfad. Die Zeitziele für lokale Änderungen sind damit noch nicht nachgewiesen.
- Windows-Release-Build erfolgreich. Der echte Prusa-Lauf erzeugte in 70,77 s G-Code. Die strenge Prüfung scheitert weiterhin an 13 Pfeilerwarnungen, 546 auffälligen Astproben und den zwei bekannten schwebenden Stellen. 157 Rust-Tests, die JavaScript-Suite und der zusätzliche Test zum Erhalt unveränderter GPU-Instanzen bestanden.

## Wiederverwendung nach einzelnen Stützenänderungen

- Baum-Startwege und ihre Fußpolster bleiben über Planungen hinweg im begrenzten Cache, wenn Modellgeometrie, Prozesswerte und die Hindernisse innerhalb der möglichen Suchreichweite übereinstimmen. Astvereinigungen und Kontaktbahnen werden weiterhin gemeinsam aufgebaut.
- Mit `SIMPLIY_BENCH_DELETE=1` prüft der Headless-Test eine einzelne Löschung in der 6181-Punkte-Szene. Der Lauf ergab 17,285 s mit vorhandenen Routen und 20,776 s mit leerem Routen-Cache, bei identischem Geometrie-Fingerabdruck einschließlich Ausgabereihenfolge. Der parallele Release-Build beeinflusste die absoluten Zeiten. Der Spitzenwert von 1,049 GiB umfasst die drei Planungen des Vergleichstests.

## Stützenqualität, Routen und Instancing (27.11.2026)

- Sicherung vor dieser Fortsetzung: `T:\Simply slicer\Sicherungen\2026-11-26_213729_vor-stuetzenqualitaet`. Keine GitHub-Änderung.
- 6181-Punkte-Headless-Test: 9,720 s insgesamt, 9,689 s Planung, 0,953 GiB Peak Working Set. Vorher 13,642 s und 0,955 GiB auf derselben Testszene. Ein Einzelwert, keine Garantie für andere Modelle; RAM ohne GPU und separaten Prusa-Prozess. Geometrie-Fingerabdruck unverändert `6087d7aceb678fdc`.
- Erste gerade Baumrouten werden innerhalb einer Planung mit bitgenauem Schlüssel wiederverwendet. Der maximal 8192 Einträge umfassende Zwischenspeicher wird bei Änderung des Kollisionsfelds geleert und beim Abbruch nicht befüllt. Das Limit betrifft Einträge, nicht eine harte Byte-Obergrenze. Unabhängiger Test vergleicht Wiederholung und Ergebnis nach Änderung der Hindernisse mit frischer Berechnung. Lokale, kollisionssichere Neuberechnung einzelner Äste mit Erhalt gemeinsamer Stämme ist weiterhin offen.
- Identische unselektierte Modellkopien ohne Bemalung, Schnitte oder Volumen werden im Viewport gemeinsam instanziert, mit eigener Transformation und Farbe. Auswahl und ungeeignete Fälle verwenden vorhandene Einzelobjekte; Auswahlschnitt, Ressourcenfreigabe und Raycasting sind automatisiert geprüft. Auch wiederholte Analyse-Markierungen sind instanziert. Weitere Ast-/Kopf-/Fußgeometrien sind nicht umfassend instanziert. Keine Vereinfachung für den Slicing-Auftrag.
- Die 559 Warnpositionen der 6181-Punkte-Szene sind 13 Pfeilerprüfungen und 546 Ast-Prüfproben; sie sind nicht 559 getrennte Stützen. Die Ausgabe unterscheidet jetzt diese Gruppen. Bei zwei Pfeilerprüfungen wurde Modellmaterial an der ersten Lücke nachgewiesen, ohne die Warnung zu entfernen; die vollständige Tragfähigkeit bleibt zu prüfen. Zwei schwebende Bereiche bei etwa X120/Y133/Z46,68 und X168/Y146/Z50,08 bleiben ungeklärt und werden weiterhin gemeldet. Auch die ersten fünf Astproben konnten nicht als Fehlmeldung nachgewiesen werden. Keine Freigabe als druckfertig.
- 558 gegenüber 559: Die unkomprimierten Inhalte der erzeugten 3MF-Dateien waren bytegleich. Zwei Läufe der unveränderten Prusa-Engine mit demselben 3MF und denselben Argumenten erzeugten unterschiedliche G-Code-Bewegungen und 558 beziehungsweise 559 Warnpositionen; jeweils zwei schwebende Stellen. Die Abweichung entsteht daher bei der Engine-Ausgabe, nicht durch einen anderen Geometrie-Fingerabdruck.
- Puller X122/Y102/Z29,3: Eine gefundene Kontaktverbesserung verursachte eine zusätzliche schwebende Stelle und bleibt verworfen. Keine sichere automatische Korrektur. Getrennte Kollisions- und Kontaktpunkt-Caches, umfassende Abbruchtests und ein sicherer Nachweis instanzierter 3MF-Stützrollen bleiben offen.
- Echter Engine-Slice nach der Routenoptimierung: G-Code mit Stützbahnen nach 57,831 s erzeugt; der strenge Test schlägt erwartungsgemäß wegen 13 Pfeilerprüfungen, 546 Ast-Prüfstellen und 2 schwebenden Stellen fehl. Das ist kein bestandener Qualitäts- oder Drucktest.
- Automatisierte Tests: 156 Rust bestanden, 21 ignoriert; 145 JavaScript bestanden. Der Release-Build liegt separat in `src-tauri\target\release\simpliy-slicing.exe`. Keine echte Viewport-Prüfung: Computer-Use-Verbindung zum Host nicht verfügbar. Die laufende Installation wurde nicht ersetzt.


## Performance-Fortsetzung vom 26.11.2026

- Sicherung vor dieser Fortsetzung: `T:\Simply slicer\Sicherungen\2026-11-26_204607_vor-performance-fortsetzung`. Kein GitHub-Zugriff.
- Reproduzierbarer Headless-Test: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\benchmark-supports.ps1`. Er liest `Sstützen-teststl/Stützen-gedreht.stl`, erzeugt mit Stil Gemischt und 1 mm Abstand exakt 6181 Punkte, prüft, dass alle 6181 bei der Planung ankommen, und meldet Phasen, Geometrie-Fingerabdruck und Peak Working Set. Er arbeitet ohne GUI und verändert keinen gespeicherten Arbeitsbereich.
- Identische Testsituation im gesicherten Referenzstand: 24,84 s Gesamt; aktueller Stand 14,10 s und 0,955 GiB Peak Working Set (Windows-Prozess des Headless-Planungstests, ohne GPU und ohne separaten Engine-Prozess). Die erste eigene Referenz-RAM-Messung hatte einen Integerüberlauf und ist ungültig; der zuvor vom Nutzer gemeldete Referenzwert war 3,3 GB. Der Zeitwert 5–10 s ist noch nicht erreicht. Im aktuellen Lauf: Wegplanung 10,55 s, Polsteraufteilung 2,76 s, Kontaktbahnen insgesamt 3,45 s.
- Kontaktpolster: Statt einer Hash-Tabelle mit je zwei Höhenlisten für jede 0,05-mm-Zelle werden Rechtecke nach XY und Höhe indiziert und nur tatsächlich benachbarte Rechtecke geprüft. Das 0,05-mm-Raster bleibt für die exakte Ausgabe erhalten. Referenztests vergleichen Top-Zellen und belegte Volumina auch bei Überlappung und Kachelgrenzen. Beide 6181-Punkte-Planungen ergaben exakt denselben kanonischen Fingerabdruck `6087d7aceb678fdc`. Mit den Prozesswerten des Engine-Tests ergaben beide `9bcf721fc9bbdc1d`; Hashgleichheit ist ein starker Vergleich, kein mathematischer Vollbeweis für alle Eingaben.
- Wegplanung: exakte nächste Fußentfernung mit sortierter X-Suche und stabile Auswahl nur der fünf nächsten Vereinigungs-Kandidaten statt vollständiger Sortierung; Referenztests vergleichen mit vollständiger Suche bzw. stabilem Sortieren. Äste verwenden einmal berechnete Kreispunkte; ein Test vergleicht die Koordinaten mit der ursprünglichen Berechnung. Modellgeometrie wird bei der Feldkonstruktion referenziert statt kopiert. Das vorhandene GPU-Instancing für Quader bleibt bestehen; allgemeines Ast-/Kopf-/Fuß-Instancing ist noch nicht umgesetzt.
- Caches für Pläne und transformierte Modellanalysen haben getrennte, größenbasierte Grenzen von geschätzt 256 bzw. 128 MiB zusätzlich zu den bisherigen Anzahlgrenzen. Die Schätzung deckt wesentliche Arrays ab, ist keine harte Obergrenze des Prozess-RAM; dynamisch wachsende Indizes und referenzierte Objekte können zusätzlichen Speicher benötigen. Getrennte Caches für Kollisionsfelder und einzelne Kontaktpunkte sowie eine kollisionssicher inkrementelle Astneuberechnung fehlen noch.
- Veraltete Ansichtsberechnungen geben ihr Abbruch-Token an parallele Worker weiter und prüfen es in Kontakt- und Wegsuchschleifen. Im Headless-Test wurde bei 6181 Punkten nach 0,3 s abgebrochen und nach insgesamt 0,336 s ein Abbruch statt eines Plans zurückgegeben. Slicing ohne Ansichtstoken wird nicht dadurch abgebrochen. Nicht alle möglichen langen Schleifen sind bereits separat abbruchgetestet.
- JavaScript: Die Differenz 130/142 kam von vier `*.test.js`-Dateien mit zwölf Tests, die das npm-Skript mit `*.test.mjs` ausgeschlossen hatte. `npm test` enthält jetzt beide Dateitypen und alle 142 bestehen.
- Echter Prusa-Engine-Slice der gedrehten 6181-Punkte-Szene: G-Code erzeugt; Prüfung meldet 559 nicht durchgehende Stützen und zwei schwebende Stellen. Referenzstand: 558 nicht durchgehende Stützen, dieselben zwei schwebenden Koordinaten. Der strenge Headless-Slicetest bewertet Warnungen inzwischen als Fehler. Die Abweichung um eine Meldung ist nicht geklärt; identische Plan-Fingerabdrücke belegen noch keine Identität der von Prusa erzeugten G-Code-Bahnen. Keine Freigabe als druckfertige Testszene.
- Puller X122/Y102/Z29,3: Prusa-Nachversuch beseitigt den schwachen Kontakt, erzeugt aber eine schwebende Stelle (0 -> 1) und wird deshalb verworfen. Warnung bleibt richtig; keine sichere automatische Reparatur gefunden.
- 3MF: Der lokal vorliegende Prusa-Importer unterstützt Komponentenreferenzen mit Transformationen, legt aber pro Referenz ein Volumen an. Nutzen und korrekte Stützrollen für wiederverwendete Ressourcen sind nicht per Engine-Test nachgewiesen; Slicing baut weiterhin vollständige Netze und verwendet keine vereinfachte Vorschau.
- Computer-Use-Verbindung zum nativen Host und Browser-Host nicht verfügbar; echter Viewport wurde nicht geprüft. Die aktuelle Benutzeranwendung wurde nicht geschlossen oder ersetzt.
- Abschließende Standardtests: 153 Rust bestanden, 21 ignoriert; 142 JavaScript bestanden. Separater Release-Build `src-tauri/target/release/simpliy-slicing.exe` erfolgreich. Wegen der offenen Warnungen und fehlenden Viewport-Prüfung nicht in die laufende Installation übernommen.

## Performance-Zwischenstand vom 26.11.2026 (Codex)

- Sicherung vor der Änderung: `T:\Simply slicer\Sicherungen\2026-11-26_203521_vor-performance-codex`.
- `supports/contact_lines.rs`: Für die Zuordnung der Stützpunkte zu Kontaktflächen wird ein räumlicher XY-Kachelindex aufgebaut. Kandidaten werden in der ursprünglichen Reihenfolge verarbeitet; die bisherige exakte Prüfung der benachbarten Rasterzellen bleibt erhalten. Bei sehr großen Suchbereichen wird auf den linearen Scan zurückgefallen. Die eigentliche Kontaktgeometrie und die Engine wurden nicht verändert.
- Vergleichstests: Die indizierte Punktwahl stimmt bei positiven und negativen Koordinaten mit der linearen Auswahl überein. Ein Vergleich der vollständigen Kontaktbahn- und Restquader-Ausgabe gegen den linearen Pfad besteht auch für Grid und Schleifen. 148 Rust-Tests bestanden, 19 externe Tests regulär übersprungen; 130 JavaScript-Tests bestanden.
- Echter Engine-Test mit dem vorhandenen Puller-Auftrag: 30 von 30 Stützen erzeugt und G-Code mit Stützbahnen ausgegeben. Die Prüfung meldet einen schwachen Kontakt bei X122/Y102/Z29,3; dieser Befund ist nicht mit der 6181-Stützen-Szene gleichzusetzen.
- Separater Release-Build `src-tauri/target/release/simpliy-slicing.exe` erfolgreich; laufendes Programm liegt unter `target-build/release` und wurde nicht ausgetauscht.
- Die Messung mit 6181 Stützen und der echte Viewport-Vergleich stehen aus: Die Computer-Use-Verbindung zum Fenster war nicht verfügbar. Deshalb liegen für diese Änderung keine neuen Zeit- oder RAM-Werte vor und die Zielwerte sind nicht nachgewiesen. Das aktive Programm wurde nicht geschlossen und eine nicht visuell verifizierte EXE nicht eingesetzt.
- Weiterhin offen: Rechteck-/Nachbarschaftsberechnung ohne Rasterzellen, umfassende Geometrie-Wiederverwendung, getrennte speicherbegrenzte Caches, inkrementelle Astneuberechnung, Abbruch in parallelen und langen Schleifen, 3MF-Instanzen mit Engine-Nachweis und Einsparung weiterer Kopien. Insbesondere ist das Abbruch-Token threadlokal; Worker-Threads übernehmen es derzeit nicht automatisch. Keine Aussage, dass diese Punkte bereits funktionieren.

## Stand 0.0.0-alpha.1, Nachtrag 4: keine Engine-Texte im Lieferumfang, Offset-Anzeige, Überschreiben (24.11.2026)

- engine-catalog.json enthält keine PrusaSlicer-Texte mehr: Beschriftung/Beschreibung/Auswahltext nur als FNV-1a-Prüfsumme des englischen Originals (tools/generate-catalog.mjs).
  Zur Laufzeit liest `engine_texts.rs` die Übersetzungsdatei der installierten Engine (resources/localization/de/LC_MESSAGES/PrusaSlicer.mo) und löst die Prüfsummen auf (alpha14: 265/353 Beschriftungen, 235/330 Beschreibungen; Rest gab es nur englisch).
  Fehlende Auswahltexte mit eigenen Simpliy-Bezeichnungen (frontend/option-labels.js). Einheiten unübersetzt, Anzeige über UNITS.
  Alter Katalog gesichert: Sicherungen/2026-11-24_icons-vorher/engine-catalog-mit-prusa-texten.json.
- Lizenz §6, THIRD-PARTY-NOTICES und Checkliste: Simpliy ist kein Fork, Engine extern, unverändert, nicht mitgeliefert, getrennter Prozess (Originale in T:\Simply slicer\Lizenz geändert, Sicherung Sicherungen/2026-11-24_lizenz-vorher). Über-Dialog entsprechend.
- Offset-Anzeige: hinter jedem betroffenen Wert (alle Reiter und Sollwerttabellen) „−5 → 255“, in der Offset-Liste „260 −5 → 255“.
- Prozess überschreiben: gleichnamiger gespeicherter Prozess wird nach Bestätigung überschrieben (saveToLibrary overwrite), statt mit „existiert bereits“ abzubrechen.
- Tests: 95 Rust, 75 JS, GUI e30–e37 bestanden.

## Stand 0.0.0-alpha.1, Nachtrag 3: Updates, Engine-Installation, Grafik, Lizenzen, Sollwerte (24.11.2026)

- Hilfe-Dialog mit Reitern Über / Updates / Slicing-Engine / Lizenzen (`updates.rs`, Befehle check_app_update, download_app_update, engine_releases, install_engine, download_progress, legal_texts, set_app_icon).
  - Simpliy-Updates: GitHub-Repository in `updates::APP_REPO` (leer) oder im Dialog einstellbar; lädt nur in den Download-Ordner.
  - PrusaSlicer: listet 3.x-Releases von github.com/prusa3d/PrusaSlicer (Asset PrusaSlicer-<v>.zip), installiert nach %LOCALAPPDATA%\SimpliySlicing\engines\<v>.
    Geprüft nur 3.0.0-alpha14; andere nach Bestätigung, dann in enginesreigegeben.json freigegeben (Engine::open akzeptiert sie).
    Versionsvergleich: „alpha14“ wird als alpha.14 gelesen (sonst wäre alpha14 < alpha9).
  - Getestet (Testordner): alpha14 von GitHub geladen, entpackt, aktiv, RJ45 damit gesliced.
- Grafikpaket: icons/icon.png (512) + icon.ico, frontend/assets/logo.png + icon-64.png; alte Icons gesichert in Sicherungen/2026-11-24_icons-vorher. Symbol und Logo im Über-Dialog änderbar (state.ui.app_icon / app_logo).
- Lizenzen: legal/LIZENZ.md, THIRD-PARTY-NOTICES.md (Vorlagen aus T:\Simply slicer\Lizenz), KOMPONENTEN.md (232 Rust-Pakete aus cargo tree, three.js, opentype.js). three.js-Lizenz nach frontend/vendor/LICENSE-three.txt.
  Cargo.toml: license „MIT“ ersetzt durch license-file (widersprach dem Weiterverkaufsverbot), authors Michael Roßmann; tauri.conf bundle copyright/publisher/licenseFile.
- Offsets: eine Regel mit mehreren Parametern (items), alte Regeln gelten weiter. Temperatur: weitere Sollwerte pro Schicht für jeden Extruder, Druckbett (ab Schicht 3) und Bauraum (ab 2), eingesetzt von `temps.rs` (M104 T/M140/M141).
- Keine Erwähnung von S3D/Simplify3D mehr in Oberfläche und Programmcode (nur zwei interne Kennungen alter Arbeitsbereiche).
- Doppelte Schichthöhen bei Migration + Umstellung behoben.
- Tests: 93 Rust, 74 JS, GUI e30–e35 bestanden.

## Stand 0.0.0-alpha.1, Nachtrag 2: Schichthöhe, Standard-Zuordnung, Auto-Konfig-Offset (23.11.2026)

- Startfehler behoben (Statusleiste las state.ui.prusa_preset.printer). Drucker-Dialog: keine Qualitäten, keine Druckereinstellungen mehr (nur im Prozess), Speichern-Knopf.
- Maschinengrenzen im Reiter Geschwindigkeiten.
- Auto-Konfiguration „Qualität“ heißt „Schichthöhe“; Optionen 0,10–0,30 mm (bis 0,8 × Düse) mit eigenen Werten (layerHeightValues: Decklagen aus 0,8/0,6 mm, Geschwindigkeiten mit 12 mm³/s-Grenze, fein ×0,8).
  Einmalige Umstellung (state.layer_scheme = 1, Sicherung vorher): alte erzeugte Qualitäten ersetzt, importierte bleiben, Prozesswerte unverändert; Prozesse ohne passende Qualität bekommen die Schichthöhe ihres Werts.
- Standard-Zuordnung fest: Filamentwerte + Einzug → Material, QUALITY_KEYS → Schichthöhe, Brim/Skirt/Raft → Ergänzungen. Inhalte importierter Profile bestimmen sie nicht mehr. Eigene Zuweisungen (auto_keys) haben Vorrang.
- Reiter „Auto-Konfig-Offset“: Regeln {Auto-Konfiguration, Option, Parameter (durchsuchbar, 238 Zahlenwerte), Offset}; gespeichert in state.auto_offsets, angewendet beim Slicen (layersOf → P.withOffsets), eingestellter Wert bleibt.
  Geprüft: 0,10 mm aktiv, Düsentemperatur +5 → G-Code 265 statt 260.
- Tests: 74 JS, GUI e30–e34 bestanden.

## Stand 0.0.0-alpha.1, Nachtrag: neutrale Engine-Grundlage, Lüfter, G-Code-Kopf (23.11.2026)

- Keine Prusa-Druckermodelle mehr als Grundlage. Simpliy installiert beim Öffnen der Engine ein eigenes neutrales Engine-Paket
  (`src-tauri/src/neutral/`, Ziel `<SimpliySlicing>/prusa-cli/presets/local/simpliy-fff`, nur Simpliys eigener Engine-Datenordner).
  Grundlage „Simpliy Neutral“ bzw. „Simpliy nT Neutral, …“ (1–8 Werkzeuge), keine Herstellerwerte (Engine-Standardwerte).
  Drucker speichern nur noch die Werkzeuganzahl (`engine = neutralSkeleton(n)`); alte Prusa-Grundlagen werden zur Laufzeit auf die neutrale mit gleicher Werkzeuganzahl abgebildet.
  Prusa-Profile werden nur noch beim Import gelesen; danach bleibt keine Prusa-Kennung im Drucker.
- Geprüft mit alpha14: Nach der Migration besitzt Simpliy in allen Prozessen jeden Wert selbst (0 Werte aus dem MK3S-Profil).
  RJ45 mit neutraler Kennung: Filament 4217,40 mm und Zeit 1 h 38 min 10 s identisch zur MK3S-Kennung; restliche Zeilenunterschiede gibt es auch zwischen zwei gleichen MK3S-Läufen (Reihenfolge).
  Wichtig: Der Düsendurchmesser steht in Prusa 3.0 in `preset.hw_config.tools[].features`, Simpliy setzt ihn dort (engine-config.js).
- Kühlung wie S3D: Lüfterliste (Bauteillüfter der Engine + zusätzliche Lüfter). Zusätzliche Lüfter: Nummer (M106 P<n>), Bezeichnung, Sollwerte pro Schicht;
  gespeichert als Prozesswert `simpliy.fans`, eingesetzt von Rust (`fans.rs`) nach jedem `;LAYER_CHANGE`, am Ende aus.
- G-Code-Kopf wie S3D: „; G-Code generated by Simpliy Slicing Version <Version>“, Datum (UTC), Slicing-Engine, „; Settings Summary“ mit Prozess, Auto-Konfigurationen, Modellen, Drucker und allen Werten (≈770 Zeilen).
- Tests: 90 Rust, 72 JS, GUI e27/e30/e31/e32 bestanden.

## Stand 0.0.0-alpha.1 (23.11.2026), Versionsschema neu begonnen (vorher intern 0.13.6)

- Extruder hinzufügen/entfernen (Extruder- und Temperatur-Reiter): wählt eine Engine-Grundlage mit einem Werkzeug mehr/weniger (gleicher Hersteller bevorzugt, z. B. Prusa XL 2T), Druckerwerte bleiben.
- Temperatur wie S3D: Regler-Liste (Extruder je Werkzeug, Druckbett, Bauraum), rechts Temperaturnummer/-typ, Sollwerte Schicht 1 / ab 2, Leerlauftemperatur. Weitere Schicht-Sollwerte kennt Prusa nicht.
- Werte je Extruder werden als Liste je Werkzeug gespeichert (vorher Text „a; b“).
- GUI e31 (Extruder + Temperatur) bestanden, JS 72.

## Stand 0.13.6: Extruder wie S3D, Skripte mit Unterreitern, untere Kontaktlagen, Prusa-Kompatibilität (23.11.2026)

- Prozessdialog 1440 x 900. Reiterfolge wie S3D: Extruder, Schicht, Wände, Ergänzungen, Füllung, Stützen, Temperatur, Kühlung, Geschwindigkeiten, Beschleunigung, Material, Multimaterial, Filamentwechsel, Drucker, Skripte, Fortgeschritten.
- Extruder: links Extruderliste (Anzahl vom Drucker), rechts „Extruder n (Tn) Einstellungen“ mit Allgemein, Überquell-Kontrolle (Einzug), Abwischen, Z-Hop-Bereich, Rampe, Einzug beim Werkzeugwechsel, Extrusionsbreiten. Reiter „Einzug“ entfällt.
  Materialwerte (z. B. Extrusionsmultiplikator) gelten je Extruder (data-slot, nur diese Stelle wird geändert); Einzug/Breiten sind in Prusa 3.0 Prozesswerte und gelten für alle Extruder (Tooltip sagt das).
  Nicht in Prusa vorhanden (S3D): Ausrollen (Coasting), Wischstrecke, Retraktionsskript.
- Skripte: alle G-Code-Skripte im Reiter Skripte mit Unterreitern Start, Schichtwechsel, Werkzeugwechsel, Objektwechsel, Pause / Farbwechsel, Ende, Nachbearbeitung; Editor füllt die Seite.
- Untere Kontaktlagen (support_material_bottom_interface_layers, -1 = wie oben): ab 1 wird die unterste Schicht der Füße auf dem Teil zu Kontaktbahnen (Abstand Bahnbreite + Kontakt-Linienabstand), darüber bleibt der Fuß dicht. Einschichtige Füße und zu kleine Stellen bleiben dicht. 0 = Fuß ganz dicht (wie bisher).
  RJ45 (Nutzerprozess, Standard -1 = 0): unverändert. Mit 2 Lagen / Abstand 1,0: 0 schwebend, 0 Warnungen, Z 0,1, Deckung 23,4 %.
- Stützen-Reiter: Zeichen ● vollständig / ◐ teilweise / P nur native Prusa-Stützen, Abweichung im Tooltip, Legende oben.
- Korrektur zu 0.13.5: Die Tabelle unten stammt aus dem Lauf vor dem Einbau von Winkel/Grid/Schleife. Ausgelieferter Stand 0.13.5 (= 0.13.6 mit Standardwerten): Deckung 25,6 %, Kontaktbahn 293 mm, dicht 0 %, max. Stelle 27 %, 0 schwebend, Z 0,1.
- Tests: 86 Rust, 72 JS, GUI e27 + e30 (Fixture) bestanden.

## Stand 0.13.5: Kontaktschicht mit allen Prusa-Parametern, neue Reiterordnung (23.11.2026)

Sicherung vorher: `T:/Simply slicer/Sicherungen/2026-11-23_1935_0.13.4-vor-Restkontakt`.

Kontaktbahnen (`supports/contact_lines.rs`):
- Rasterlage je Kontaktstelle so, dass die meisten Stützpunkte getroffen werden (Toleranz Bahnbreite/2 + 0,4 mm);
  nur übrige Punkte bekommen eine eigene Bahn. Randreihen, wenn der Rand > 0,75 Bahnabstände von der nächsten Bahn liegt.
  Zellen > 1,5 Bahnabstände von jeder Bahn bleiben dicht.
- Füße (`Routed.feet`) getrennt: Ihre Oberseite trägt den Ast und wird nicht in Bahnen umgewandelt (Fehler aus 0.13.4).
- Versuch „Säulenspitze zählt als Unterbau“ verworfen (schwebende Bahn an der Bohrungsdecke, Spitzen weichen bis 1,8 mm aus).
- Prusa-Parameter der Kontaktschicht: `support_material_angle` (breite Stellen quer dazu, auf Achse gerundet; schmale
  entlang ihrer Länge), `support_material_interface_pattern` grid (beide Richtungen), concentric (als Linien, mit Hinweis),
  `support_material_interface_contact_loops` (Schleife in Bahnbreite), `support_material_interface_extruder`
  (Kontaktbahnen und -polster). Bereits berücksichtigt: Kontaktabstand oben/unten, Kontaktlagen (Polsterdicke),
  Linienabstand der Kontaktlagen, Stützabstand, Bahnbreite, Kontaktgeschwindigkeit, XY-Abstand.
  Nicht anwendbar auf eigene Formen (gelten für Prusas eigene Stütze): pattern, closing_radius, synchronize_layers,
  enforce_layers, threshold, buildplate_only, style, with_sheath, first_layer_density/expansion, dont_support_bridges.
  Offen: `support_material_bottom_interface_layers` (Füße bleiben dicht).

| RJ45, Nutzerprozess | 0.13.3 | 0.13.5 | S3D |
|---|---|---|---|
| Deckung gesamt | 56,5 % | 24,1 % | 28,1 % |
| Bahnen dicht an dicht | 62 % | 0 % | 23 % |
| Stellen > 50 % (max) | 3 (73 %) | 0 (30 %) | 1 (54 %) |
| Kontaktbahn | 706 mm | 227 mm | 255 mm |
| schwebend / Warnungen / Z | 0 / 0 / 0,1 | 0 / 0 / 0,1 | – |

Fläche „neu ohne Stützbahn ≤ 3 mm“ 1,75 mm² bei X80 Y110 Z16: Messartefakt der Lagenwahl; dort druckt keine der beiden
Versionen Stütze (G-Code-Lagen identisch). Platte 25,2 %, dicht 0 %. Puller alle Varianten und 38 Vergleichsfälle:
schwebend 0, unter 25 % 0 (XY 0,5: 3 Meldungen wie vorher).

Prozessdialog: 17 Reiter, „Andere“ aufgelöst. Neu: Einzug (Einzug, Abwischen, Z-Hop-Bereich, Rampe), Beschleunigung
(Beschleunigungen, Durchsatz, Maschinengrenzen), Material (Materialdaten, Pressure Advance, Schrumpfung, Filament-Durchsatz),
Filamentwechsel (MMU mit einem Extruder). Perimetergenerator zu Wände, Profilverweise zu Drucker, Notizen zu Fortgeschritten.
Neuordnung prüft beim Laden, dass alle 355 Einstellungen zugeordnet sind. Reiterleiste bricht bei Bedarf zweizeilig um.

Tests: 84 Rust, 72 JS; GUI e12, e14b, e17, e20, e21, e23–e28 bestanden mit festen Vorlagen
(scratch `fixtures/rj45-1343.json`, `run-fix.sh`, `run-fixpet.sh`), unabhängig vom aktuellen Nutzer-Arbeitsbereich.
Offen: Testdruck zur Ablösbarkeit.

## Stand 0.13.4: Kontaktbahnen statt dichter Kontaktpolster (23.11.2026)

Sicherung vorher: `T:/Simply slicer/Sicherungen/2026-11-23_1723_0.13.2-vor-Waende-Druckeransicht` (Stützen-Quellen = 0.13.3).

- Versuch native Prusa-Kontaktlagen auf eigenen Körpern (Körper als Teil des Bauteils, Erzwinger über Kontakt):
  verworfen. Platte: 2 % Kontakt unter den Punkten, 29/29 nicht durchgehend, nur 6 Stützbahnen. Zwischen Säulenspitze
  und Teil (2–3 Schichten) legt die Engine keine Stütze an; ohne Polster bräuchte sie eigene Stütze bis zum Bett.
- Neu `supports/contact_lines.rs` (Standard; `SIMPLIY_CONTACT=dense` nur für Vergleiche): Polster und Streifen in
  Zellsäulen (0,05 mm); je Säule wird die oberste Schicht durch einzelne Bahnen ersetzt (Block in Bahnbreite × Schicht,
  Volumen mit 1 Wand/Arachne, ohne Füllung und Decklage). Darunter bleibt das Polster dicht und trägt.
  Regeln: Bahnen entlang der längeren Seite; durch jeden Stützpunkt läuft eine Bahn; Bahnabstand = Bahnbreite +
  Stützabstand (mit Kontaktlagen im Prozess: deren Linienabstand, `Env.contact_gap`); Bahnen nur über Zellen, die rundum
  eine halbe Bahnbreite getragen sind; einschichtige Stellen ohne Unterbau und Stellen ohne gültige Bahn bleiben dicht.
  Eigene Stützformen unverändert; Prozesswert `support_material_spacing` neu in `PROCESS_KEYS`.
- Messwerkzeug scratch `contactmetric.mjs`: Deckung gesamt, je Kontaktstelle (max, >50 %), Bahnen dicht an dicht,
  echte Z-Lücke (flächengewichtet), Fläche ohne Stützbahn im Umkreis 3 mm, Bahnlänge, Druckzeit.

| RJ45, Nutzerprozess (Abstand 1,4, 0 Kontaktlagen, Z 0,1) | bisher | Kontaktbahnen | S3D 5.1.2 |
|---|---|---|---|
| Deckung gesamt | 56,5 % | 33,7 % | 28,1 % |
| Bahnen dicht an dicht | 62 % | 37 % | 23 % |
| Stellen > 50 % (max) | 3 (73 %) | 1 (57 %) | 1 (54 %) |
| Kontaktbahn | 706 mm | 370 mm | 255 mm |
| Z-Lücke | 0,1 | 0,1 | 0,1 |
| Fläche ohne Stützbahn ≤ 3 mm | 55,1 mm² | 55,4 mm² | 34,9 mm² |
| schwebend / Kontaktwarnungen | 0 / 0 | 0 / 0 | – |
| Druckzeit (Schätzung) | 64,3 min | 64,3 min | 65,7 min |

Platte (`flach-tree`): Deckung 65,5 → 25,2 %, dicht an dicht 62 → 0 %, schwebend 0. Puller alle Varianten und
38 Vergleichsfälle: schwebend 0, unter 25 % 0 (XY 0,5: 3 Meldungen wie vorher). GUI-Suiten bestanden (e12/e20 brauchen
eine Platte bzw. den Arbeitsbereich von 13:43; der aktuelle Nutzer-Arbeitsbereich hat 3 Platten).
Offen: Testdruck zur Ablösbarkeit; Rest dichter Kontakt an runden/schmalen Stellen (Bohrungsdecke).

## Stand 0.13.3: Reiter Wände, eigene Kategorien, Druckeransicht im Hauptfenster (23.11.2026)

Sicherung vorher: `T:/Simply slicer/Sicherungen/2026-11-23_1723_0.13.2-vor-Waende-Druckeransicht`.

- Neuer Reiter „Wände“ (Wände, Wandqualität, Fuzzy Skin, Naht); „Schicht“ enthält Schichten, Ober-/Unterseite, Bügeln.
- Alle Gruppen eines Reiters fließen durch 2 (breit: 3) Spalten, keine Lücken zwischen Bereichen.
- Auto-Konfigurationen als Liste `state.auto_categories`: „+“ legt eigene Kategorien an (Optionen in `state.presets`
  mit `kind` = Kategorie-ID), „…“ › Kategorie löschen (eigene samt Optionen; Material/Qualität nur ausgeblendet).
- Prusa-Standardprofil-Dialog nicht mehr erreichbar über Oberfläche; Engine-Grundlage (Werkzeuganzahl) wählt man in der
  Druckerverwaltung aus der Druckerliste der Engine. Druckerverwaltung öffnet mit dem Drucker des Prozesses.
- Ansichten „Modell | G-Code | Drucker“ (Schichten → G-Code). „Drucker“ zeigt die Weboberfläche als eigene Webansicht im
  Hauptfenster (Tauri `unstable`, `add_child`; ohne Simpliy-Befehle; bei offenen Dialogen ausgeblendet). Ohne Adresse
  Hinweis auf Prozess › Drucker › Netzwerk. Das Drucker-Symbol der rechten Leiste öffnet diese Ansicht.
- Geprüft: 72 JS-, 77 Rust-Tests; GUI e12 (Mehrfachmaterial jetzt über Engine-Grundlage + Bibliothek), e14b, e17, e20,
  e21, e23–e27, e28 neu (Wände, Kategorien, Druckeransicht gegen lokalen Testserver, nur ein Fenster).

### Kontaktgenerierung: Ausgangsmessung (scratch `contactmetric.mjs`)

Gleiches Teil (RJ45), gleiche gestützte Fläche: S3D 5.1.2 Deckung 28 %, Kontaktbahn 255 mm, Bahnabstand 1,59 mm,
65,7 min. Simpliy 0.13 Deckung 56 %, 635 mm, 0,78 mm, 64,4 min. Ziel: ~28–30 % Deckung ohne schwebende Stellen.
Noch keine Änderung an der Kontaktgenerierung.

## Stand 0.13.2: Prozessdialog wie Simplify3D (23.11.2026)

Sicherung vorher: `T:/Simply slicer/Sicherungen/2026-11-23_1610_0.13.1-vor-S3D-Dialog`.

- Jeder Reiter ist eine Seite (Bereiche als Überschriften, zwei Spalten), keine Unterseiten-Liste mehr.
- Neuer Reiter „Multimaterial“ (vor Fortgeschritten): Material je Werkzeug, Werkzeugzuordnung, Filamentwechsel/MMU,
  Reinigungsturm, Nachtropfen, Werkzeugwechsel- und Pause/Farbwechsel-Skripte.
- Auto-Konfigurationen: 💾 speichert, „…“-Menü: neue Option aus dem Prozess, nach oben/unten, umbenennen, löschen,
  Einstellungen zuweisen, Kategorie umbenennen (Material zusätzlich: Materialbibliothek; Qualität: Drucker verwalten).
- „Einstellungen zuweisen“ (wie S3D, mit Filter): `state.auto_keys` = Einstellung → material/quality/extras/change/keine.
  Auswählen setzt genau die zugewiesenen Einstellungen, 💾 speichert genau diese. Ohne eigene Zuweisung: Filamentwerte und
  übernommene S3D-Materialwerte → Material, dann Prozessänderung, Ergänzungen, Qualität (`profiles.js: defaultCategory`).
- Obere Leiste: „Profile“, „Drucker / Material“, „Meine Drucker“, „Filamente“ entfernt. Druckerverwaltung über „…“ neben dem
  Drucker im Prozess, dort auch „Prusa-Systemprofil übernehmen…“; Materialbibliothek über das Material-„…“-Menü.
- Geprüft: 72 JS-, 77 Rust-Tests; GUI e12, e14b, e17, e20, e21, e23–e27 bestanden (e27 neu: Reiter, Menü, Zuweisung).

### Testdruck des Nutzers (RJ45, S3D 5.1.2 gegen Simpliy), Befund

- Stützen verschmelzen stärker als in S3D. S3D-Profil: keine dichten Stützlagen, Stütze 30 %, 1 Schicht Abstand.
  Simpliy baut eigene Kontaktpolster dicht (aus `support_material_interface_spacing`, hier ~74 %) und schmale
  Kontaktstreifen mit 100 % (seit 0.12.1 gegen schwebende Stellen); der Abstand (0,1 mm) ist gleich.
- Versuche (nicht übernommen, Quellen zurückgesetzt): Polster ganz locker → 0 → 10 schwebende Stellen.
  Nur oberste Lage locker (eigenes Volumen 29 %, auch für Streifen): Engine-Ergebnis unter den Punkten kaum lockerer
  (Bahnlänge oberste Lage 223 → 206 mm). Ursache in der Engine ungeklärt; nächster Schritt: kontrollierter Einzeltest
  (ebene Überhang-Platte), welche Wegart Prusa für ein 1-Schicht-Volumen mit 29 % erzeugt.
- Oberfläche: Fluss je mm gleich oder geringer als S3D; Prusa füllt Massivflächen rechnerisch zu 100 %
  (Abstand = Breite − h·(1−π/4)), S3D etwa 94 %. Innenbrücken über Füllung druckt Prusa dick (0,19 mm²), nicht sichtbar.
- Messwerkzeuge: scratch `flow.mjs`, `bridges.mjs`, `toplayer.mjs`, `toptypes.mjs`; Testbaum `p17` / `target17p`.

## Stand 0.13.1: Restpunkte aus 0.13.0 (23.11.2026)

Sicherung vorher: `T:/Simply slicer/Sicherungen/2026-11-23_1506_0.13.0-vor-Restpunkte`.

- Binärer G-Code: Prusa 3.0 alpha14 schreibt über die Kommandozeile auch mit `binary_gcode = 1` nur Text. Bisherige
  „.bgcode“ waren Text mit falscher Endung. Neu `src-tauri/src/bgcode.rs`: Simpliy wandelt den Text selbst in bgcode
  (libbgcode-Aufbau, unkomprimiert, CRC32, Datei-/Drucker-/Druck-/Slicer-Metadaten, G-Code-Blöcke bis 64 KiB an Zeilenenden).
  Stützkörper werden vorher gekennzeichnet (fehlte im Binärzweig). Vorschaubilder als Block 5 nach den Drucker-Metadaten.
  Geprüft mit eigenem, unabhängigem Leser (Node, zlib-CRC32); nicht mit einem Prusa-Werkzeug oder Drucker.
- Schließen: Hat ein aus der Bibliothek stammender Prozess ungespeicherte Änderungen, hält Rust das Schließen an
  (`set_unsaved`, `simpliy-close-requested`, `close_app`) und die Oberfläche fragt nach. Ohne solche Prozesse schließt
  das Fenster sofort (ein Fehler in der Oberfläche kann das Schließen nicht blockieren).
- Material je Werkzeug: Auswahl aus der Materialbibliothek (`lib:<id>`), ältere Profil-Optionen bleiben gültig.
- Geprüft: 71 JS- und 77 Rust-Tests; GUI e26 (bgcode mit 2 Vorschaubildern, alle CRC gültig; Rückfrage beim Schließen
  über WM_CLOSE), e12 (Material je Werkzeug aus der Bibliothek), e14b, e17, e20, e21, e23, e24, e25 bestanden.
  Testvorlagen: e12 braucht `run-pet.sh` (setzt PETcF aus der Bibliothek), e14b/e21 den Puller-Arbeitsbereich.
- Prusa-Ordner unverändert bis auf das Engine-Protokoll `PrusaSlicer3-dev/shared_runtime/log*.txt` (nicht vermeidbar).
- Offen: kein Testdruck; bgcode nicht an einem Prusa-Drucker geprüft.

## Stand 0.13.0: Profilsystem wie Simplify3D, Prusa nur als Engine (23.11.2026)

Sicherung vorher (mit Kopie des Nutzer-Arbeitsbereichs): `T:/Simply slicer/Sicherungen/2026-11-23_1343_0.12.4-vor-Profilsystem`.
Die Umstellung legt beim ersten Start zusätzlich eine Arbeitsbereichs-Sicherung an (`backup_workspace`).

### Architektur (verbindlich)

Simpliy-Verwaltung → vollständige Konfiguration → PrusaSlicer 3.0 → G-Code → Simpliy.
- Wirksame Werte je Slicing neu: Engine-Gerüst (nur Struktur/Werkzeuganzahl) ← `drucker.settings` ← `prozess.values`.
  Drucker und Prozess enthalten jeden Engine-Wert selbst, das Gerüst liefert keine versteckten Werte.
- Engine läuft nur mit Simpliys Datenordner (`SimpliySlicing/prusa-cli`). Prusa-Ordner werden nur gelesen.
  Geprüft: `%APPDATA%/PrusaSlicer` und `PrusaSlicer3-dev` (720 Dateien) bytegenau gleich, außer
  `PrusaSlicer3-dev/shared_runtime/log*.txt`: Dorthin schreibt die Engine ihr Protokoll immer (auch mit `--datadir`,
  `--loglevel=0` oder umgeleitetem APPDATA). Nicht verhinderbar ohne Engine-Änderung.

### Datenmodell (`frontend/profiles.js`, Oberfläche `frontend/profile-ui.js`)

- `state.profile_schema = 2` (Dateiformat `schema` bleibt 1, ältere EXE lesen weiter). Alte Felder bleiben erhalten.
- Drucker: `settings` (alle Druckerwerte), `engine` (Gerüst), `qualities`, `default_quality`, `materials` (Freigabe, leer = alle),
  `default_material`, Netzwerk `host_type`/`web_url` (Schlüssel nur im Speicher).
- Materialbibliothek `state.filaments`: `settings` mit allen Filamentwerten. Auswahl kopiert in den Prozess,
  zurück nur über „Material zentral speichern“.
- Vorrang: Qualität setzt nur Druckwerte, Material nur Filamentwerte (keine Überschneidung), danach Ergänzungen/Prozessänderung
  (`state.presets`), eigene Eingaben zuletzt.
- Prozess: `values` (vollständig), `origins`, `printer_id`, `material_id`, `quality_id`, `extras_id`, `change_id`, `library_id`.
  Dialog bearbeitet einen Entwurf (OK/Abbrechen). Dauerhaft: `state.process_library` über „Prozess speichern“ /
  „Als neuen Prozess speichern“. Import speichert nie automatisch.
- Migration: S3D-Kategorien → Material in Bibliothek, Qualität an den Drucker, Ergänzung/Prozessänderung → Voreinstellungen;
  Druckerwerte des Profils → Drucker; Vorauswahl der Kategorien wird berücksichtigt; Entwurf und Kopie desselben Profils
  ergeben keine Doppelungen.
- Prusa-Dialog „Drucker / Material“ ist Importquelle: vollständige Auswahl → eigener Simpliy-Drucker mit diesem Gerüst
  (`syncPrusaPrinter`), auch Mehrwerkzeug.

### Prusa-Import (`src-tauri/src/prusa_import.rs`, Befehl `prusa_import`)

3.0-JSON (`--save`), 3.0-3MF (`Metadata/PrusaSlicer3_project.json`), 2.x-3MF, 3.0-YAML-Presets (Eltern über die Engine,
bedingte Varianten werden gemeldet), 2.x-ini einzeln oder Paket (inherits in der Datei, Systemeltern über die Engine).
Unbekannte 3.0-Schlüssel werden gemeldet und bleiben unter Fortgeschritten › Freie Parameter erhalten.
Ziele: Prozess (Drucker/Material nach Rückfrage), Druckerverwaltung, Materialbibliothek. Material-Export als `.simpliymaterial.json`.

### Weitere Änderungen

- Reiter „Ausgabe“ heißt „Drucker“, Seite „Netzwerk“: Verbindung, IP, Schlüssel, Verbindungstest, Weboberfläche.
- Vorschaubilder: Die Engine rendert über die Kommandozeile keine Thumbnails. Simpliy rendert sie (`Viewport.thumbnail`)
  in den Größen aus `thumbnails` und schreibt sie im Prusa-Format in den G-Code (`add_thumbnails`). Nur Text-G-Code.
- Absenken: Position Z < 0 senkt das Modell ins Bett (`model.sink`), die Engine druckt nichts unter Z=0.
- Prozess duplizieren; eine Platte verlangt einen Drucker für alle Prozesse.

### Geprüft

- 71 JS-Tests (neu `tests/profiles.test.mjs`), 74 Rust-Tests (neu Import- und Vorschaubild-Tests).
- GUI mit Kopie des Nutzer-Arbeitsbereichs (e23): Umstellung, wirksame Konfiguration identisch zu 0.12.4 (alle Schlüssel des
  G-Code-Kopfs außer Objektumriss), Wiederholung identisch, Dialog, Netzwerk, Materialwechsel/Abbrechen, Bibliothek.
- e24: zwei Prozesse (260 °C/0,1 mm vs. YAML-Import 247 °C/0,25 mm) wirken in der Engine, zurück ohne Reste, Druckerwechsel wirkt.
- e25: Vorschaubilder 300×300/64×64 gültig; 5 mm abgesenkt → 5 mm niedriger, nichts unter Z=0.
- Echte Dateien: 2.x „My Settings.ini“ (196 Werte), 3.0-JSON, 3.0-YAML mit Systemeltern.
- Rückfallsuiten e12 (mit Testprofil-Material), e14b, e17, e20, e21 (mit Puller) bestanden.

### Offen

- Vorschaubild für binären G-Code (.bgcode) fehlt.
- Warnung beim Schließen bei ungespeicherten Prozessen fehlt (Markierung • am Knopf „Prozess speichern“ vorhanden).
- Material je Werkzeug (Mehrfach-Extruder) nutzt noch die alten Profil-Materialien, nicht die neue Bibliothek.
- Kein Testdruck.

## Stand 0.12.4: Slicen ohne gespeichertes Werkzeugprofil (23.11.2026)

Sicherung vorher: `T:/Simply slicer/Sicherungen/2026-11-23_1325_0.12.3-vor-Basisprofil`.

- Ursache: Beim Waehlen eines Druckprofils wurde das Werkzeugprofil geleert und nie wieder gesetzt. Fuer Einzelwerkzeug-Drucker
  liefert die Engine genau eines (`no tool`). Slicen verlangte alle vier Profile und oeffnete deshalb den Profildialog.
- Loesung (`frontend/app.js`, `onlyTool`/`fillTool`): Gibt es genau ein Werkzeugprofil, wird es gesetzt: beim Waehlen des
  Druckprofils, beim Laden des Arbeitsbereichs (einmal je Auswahl) und vor dem Slicen. Bei mehreren bleibt die Wahl beim Nutzer.
- Geprueft im Testbuild mit Kopie des Nutzer-Arbeitsbereichs (Prozess MK3S RRF Test, Material Easy ABS-Sunlu):
  kein Dialog, Slicing fertig, G-Code M104 S260 / M140 S55 = Werte des S3D-Profils. Im Kopf steht `filament_type = PLA`
  aus dem Prusa-Basisfilament; das ist nur Kennzeichnung.
- e14b mit Puller-Arbeitsbereich bestanden, 61 JS-Tests bestanden. e14b mit dem aktuellen Arbeitsbereich (RJ45-Modul) passt
  nicht zur Suite (erwartet den Puller).

## Stand 0.12.3: Kontakt und automatische Stuetzen (23.11.2026)

- Schwache Kontakte von Pfeilern oder Mini-Stuetzen auf dem Modell werden bei Bedarf in einem zweiten Slicing-Lauf mit Prusas eigener Stuetzgeometrie versucht. Uebernommen wird dieser Lauf nur, wenn weniger schwache Kontakte und keine neu erkannten fehlenden, gebrochenen, schwebenden oder kollidierenden Stuetzen vorliegen. Sonst bleibt das erste Ergebnis mit Warnung erhalten. Die gespeicherten Stuetzen werden nicht veraendert.
- Eigene Stuetzkoerper und automatische Prusa-Stuetzen koennen zusammen verwendet werden: temporaere Sperrbereiche schuetzen eigene Stuetzen, und das Programm untersucht die tatsaechlichen G-Code-Bahnen auf Ueberlappungen und schwebende Stellen. Wenn der Versuch nicht sicher geprueft werden kann oder die Pruefung scheitert, wird automatisch erneut ohne Prusa-Automatik gesliced und dies angezeigt. Innerhalb der Schutzbereiche koennen automatische Stuetzen entfallen; eine vollstaendige automatische Abdeckung wird nicht garantiert.
- Die Kombination wird fuer binaeren G-Code abgelehnt, solange dessen Bahnen nicht gleichwertig geprueft werden koennen. Fuer diese Kombination Text-G-Code verwenden. Andere direkte Exportpfade verwenden den bisherigen sicheren Rueckfall.
- Echter Puller mit 30 Stuetzen: Der zuvor schwache Kontakt wurde im geprueften Wiederholungslauf verbessert, ohne verbleibende Warnung. Auch ein Lauf mit angeforderter Automatik wurde geprueft; drei Drehungs-/Schichthoehenvarianten wurden mit der echten Engine getestet. 69 Rust- und 61 JavaScript-Tests bestanden. Kein physischer Testdruck; die grafische Oberflaeche konnte in dieser Umgebung nicht visuell geprueft werden.
- Der bestehende Arbeitsbereich blieb unveraendert. Die aeltere unmittelbar folgende Bestandsaufnahme beschreibt den Zustand vor dieser Aenderung.

## Weitere Pruefung der offenen Punkte (23.11.2026)

- Neuer Regressionstest `foot_does_not_count_cells_blocked_by_xy_clearance`: Eine gueltige Auflage wird durch ein Hindernis innerhalb des XY-Abstands ausgeschlossen. Der aktuelle Code besteht, eine Gegenprobe mit Zaehlen vor der XY-Pruefung scheitert. Dieser kuenstliche Fall prueft gezielt die Reihenfolge, ersetzt aber nicht den Engine-Test an der Bohrung.
- Puller aus dem gespeicherten Arbeitsbereich, testweise Stil Pfeiler, XY 0,5 mm, Schicht 0,2 mm und Kontaktabstand 0,2 mm: echte Prusa-Engine meldet 30 von 30 Stuetzen und weiter einen schwachen Kontakt bei X122/Y102/Z29,3. Eine testweise erweiterte seitliche Suche aenderte dieses Ergebnis nicht und wurde verworfen. Die Warnung nennt jetzt den Weg zum Werkzeug ?Kontakt versetzen? und den XY-Abstand als moegliche Ursache.
- Gegenprobe zu automatischen Prusa-Stuetzen plus eigenen Koerpern: Dieselbe Puller-Szene wurde experimentell mit Prusa-Automatik gesliced. Eine erste raeumliche Analyse der getrennt markierten G-Code-Bahnsegmente fand zahlreiche Ueberlappungen auf denselben Schichten. Diese Analyse ist ein Hinweis auf Kollisionen, kein vollstaendiger Geometrietest. Das sichere Abschalten der Prusa-Automatik bleibt deshalb bestehen.
- Der schwache Wandkontakt und gleichzeitige automatische Prusa-Stuetzen mit eigenen Koerpern sind weiterhin offen. Kein Testdruck.


## Stand 0.12.2: keine schwebenden Stellen mehr in der Vergleichsreihe (23.11.2026), gilt vor allen aelteren Abschnitten

Sicherung vorher: `T:\Simply slicer\Sicherungen\2026-11-23_0833_0.12.1-vor-Restfix`.

Ursachen der Reste aus 0.12.1 (gemessen am echten G-Code):
- Prusa-Pfeiler und Mini auf dem Teil (Stil Pfeiler bzw. Gemischt): Prusa legt die unterste Stuetzlage auf
  gekruemmte Flaechen (Bohrungsboden, Schraege). Eine Bahn liegt dann ueber der abfallenden Seite in der Luft.
- XY-Abstand 0,5 mm in der Querbohrung: `resting_foot` zaehlte eine Fusszelle als tragend, bevor der XY-Abstand
  geprueft war. Im runden Boden blieb nur ein Streifen, den die Engine nicht druckt; die Saeule begann in der Luft.

Loesung:
- `types::is_column`: Pfeiler und Mini mit Auflage auf dem Teil baut das Programm als gerade Saeule
  (Schaft wie Baum, Kontaktflaeche in Pfeilerbreite, kein Zusammenfuehren, zaehlt nicht als Ersatzform).
  Findet sie keinen Weg, bleibt es beim eingestellten Prusa-Pfeiler (nicht beim 2,4-mm-Ersatz). Vom Bett baut weiter Prusa.
  Ein 4 mm breiter Schaft stand auf Schraegen mit Luecken im Fuss, deshalb hoechstens Baumschaftbreite.
- `contact::resting_foot`: Zellen zaehlen erst nach der XY-Pruefung als tragend.
  (Eine Breitenregel je Fusslage wurde verworfen: Sie nahm an Schraegen die untersten Stufen weg.)

Gemessen: 38 Faelle schwebend 18 -> 0 (0.12.1: 4), Kontakt 91 -> 95 %, unter 25 % 10 -> 1.
Schichthoehen 0,15/0,2/0,25, Abstand 0,2, Bahnbreite 0,45, XY 0,5 mm, Drehungen 15-135 Grad: ueberall 0 schwebend.
Rust-Test `a_pillar_on_the_part_becomes_a_straight_column`. Fuer den Fuss gibt es keinen Unit-Test: Nachgebaute
Graeben und Treppenboeden zeigten den Fehler auch mit altem Code nicht; belegt ist er nur am echten Puller mit XY 0,5.

Offen:
- Punkt 122/102 Z29,3 am Puller liegt etwa 0,5 mm vor einer senkrechten Wand. Der XY-Abstand verbietet Stuetze
  direkt dort, deshalb 38-48 % Kontakt (Stil Pfeiler 14 %, wird gemeldet). Ohne Verschmelzen mit der Wand nicht loesbar.
- Bei Stil Pfeiler sind Prusas automatische Stuetzen fuer das Modell aus, sobald eine Saeule auf dem Teil steht (wie bei Baum).
- Kein Testdruck.

## Stand 0.12.1: keine schwebenden Ersatzpfeiler, Kanten mit Kontakt (22.11.2026)

Sicherung vorher: `T:\Simply slicer\Sicherungen\2026-11-22_2107_0.12.0-vor-Kontaktfix`.

Ursachen am Puller des Nutzers (gemessen am echten G-Code):
- Schwebend: Fand eine Form keinen Weg, wurde sie ein 2,4 mm schmaler Prusa-Pfeiler auf dem Teil. An 45-Grad-Fasen
  druckt Prusa daraus Streifen, denen einzelne Schichten fehlen. Breitere Pfeiler helfen nicht (bei 5 mm wurden 16 statt 5 Stellen Pfeiler).
- Kantenpunkt X118 Y98: Unter der Aussenkante der Fase blieb nur ein Keil. Schmale Streifen der Kontaktlage trafen
  das Linienmuster (Kontaktlinien-Abstand) nur zufaellig, deshalb mal 0 %, mal 40 % Kontakt.
- Pruefung: Sie mass nur dort, wo gebaut wurde (immer erfolgreich), und kannte keine schwebenden Bahnen.

Loesung (`supports/shapes.rs`, `contact.rs`, `inspect.rs`, `generate.rs`, `job.rs`):
- Bevor eine Stelle auf dem Teil Pfeiler wird, rueckt die Spitze bis 1,8 mm zur Seite, wenn dort Kontakt zum Punkt
  und ein gerader Weg moeglich ist. Sie bekommt eine eigene gerade Saeule. Vom Bett aus bleibt es beim Pfeiler.
- Liegt der Punkt auf einer Aussenkante, reicht die Kontaktlage zwei Bahnen ueber die Kante.
- Streifen der Kontaktlage schmaler als zwei Musterlinien (und die Schicht darunter) werden voll gedruckt
  (eigenes Volumen mit 100 %). Schmaler als eine Bahn traegt eine Schicht die naechste nur senkrecht.
- Pruefung: Kontakt wird an der echten Unterseite gemessen (Radius 0,9 mm, unter 25 % = Warnung), schwebende
  Stuetzinseln werden gemeldet. Gilt fuer eigene Formen und Prusa-Pfeiler.

Gemessen (38 Faelle alt gegen neu, je echte Engine): schwebende Stellen 18 -> 4, mittlerer Kontakt 91 -> 94 %,
Stellen unter 25 % 10 -> 2. Puller des Nutzers 5x wiederholt: 3 -> 0 schwebend, Kantenpunkt 0 -> 100 %.
Gedreht (15-135 Grad) und verschoben: ueberall 0 schwebend. Andere Schichthoehen, Abstand 0,2, Bahnbreite 0,45: 0 schwebend.
Gegenprobe: Der alte G-Code wird jetzt mit den 3 Stellen und dem Kantenpunkt beanstandet.

Offen:
- Die 4 Reste sind Prusas eigene Pfeiler/Mini (Stil Pfeiler bzw. Gemischt) in der Querbohrung und am Konus. Sie werden jetzt gemeldet.
- Punkt 122/102 Z29,3 am Puller: 81 -> 38 % Kontakt (Spitze rueckt aus der Fase), dafuer kein schwebender Pfeiler.
- Mit XY-Abstand 0,5 mm bleiben 2 schwebende Mini-Stuetzen in der Bohrung (gemeldet).
- Kein Testdruck.

## Stand 0.12.0: Rechenkern in Rust (22.11.2026)

Sicherung vor dem Umbau: `T:\Simply slicer\Sicherungen\2026-11-22_1934_0.11.2-vor-Rust`.
Aeltere Abschnitte nennen JS-Dateien, die es seit 0.12.0 nicht mehr gibt.

### Was wo liegt

| Aufgabe | Jetzt | Vorher |
|---|---|---|
| Stuetzen finden, Wege, Kontakt, Plan, Bearbeiten | `src-tauri/src/supports/` | `support-core/field/contact/shapes/plan/workflow/placement.js` |
| Stuetzen in den Auftrag | `supports/job.rs` | `print-job.js` |
| Pruefung am G-Code | `supports/inspect.rs` | `support-validation.js` |
| G-Code lesen | `gcode.rs` | `gcode-parser.js` |
| Netz pruefen und reparieren | `repair.rs` | `repair.js` |
| Glatte Normalen | `shading.rs` | `surface-shading.js` |
| Nummerierung der Platten beim Start | `plates.rs` | neu |
| Nur ein Programm je Arbeitsbereich, Schreibschutz | `instance.rs` | neu |

Bewusst in JS geblieben:
- Oberflaeche, three.js/WebGL und die Farbkarte: laufen in der WebView.
- Lage beim Ziehen (`geometry.js`) und Bemalen (`paint-core.js`): muessen bei jeder Mausbewegung sofort da sein.
- Textkoerper (`text-mesh.js`): brauchen opentype.js.
- Wertepruefung und Plattenwerte (`engine-config.js`, `plate-plan.js`): antworten beim Tippen im Dialog.

### Regeln fuer den weiteren Ausbau

- Stuetzenlogik nur in Rust. JS fragt ueber `support-client.js` und zeichnet.
- Prozesswerte fuer die Planung: Liste `PROCESS_KEYS` in `supports/types.rs`. Neue Schluessel dort eintragen.
- Die Signatur aus `support-plate.js` steht in gespeicherten Arbeitsbereichen. Form nicht aendern.
- `mesh.normals` = Flaechennormalen (Bemalen, Ablegen, Text), `mesh.cornerNormals` = nur Zeichnen. Nicht vermischen.
- Platten: `named: true` = vom Nutzer benannt. Standardnamen werden nur beim Programmstart neu nummeriert.
- Ein laufendes Simpliy haelt `%APPDATA%\SimpliySlicing\instance.lock`. EXE-Staende vor 0.12 kennen die Sperre nicht.
  Gegen sie schuetzt nur die Schreibpruefung beim Speichern dieses Programms, nicht umgekehrt.

### Geprueft

- 928 Vergleichsfaelle gegen 0.11.2 ohne Abweichung (Toleranz Koordinaten 1e-4, Normalen 2e-3);
  Gegenprobe mit verfaelschten Daten meldet alle 928.
- 38 echte Engine-Laeufe alt gegen neu: 16 befehlsgleich. Die 22 anderen haben gleiches Pruefergebnis und
  gleich viele schwebende Stellen. Stichprobe: Die Engine liefert schon fuer denselben alten Auftrag zweimal
  verschiedenen G-Code, deshalb ist Befehlsgleichheit dort kein brauchbares Kriterium.
- Gemessen (Summe der Vergleichsfaelle): G-Code lesen 1649 -> 241 ms, Reparatur 329 -> 49 ms,
  Stuetzenplanung 38,8 -> 17,0 s. Die Slicing-Zeit selbst bestimmt die Engine und bleibt gleich.
- GUI-Testbuild: alle Stuetzarten und Werkzeuge, Vorschau, Text, Ablegen, Bemalen, Reparatur, Projekte,
  Platten, Sperre, Schreibschutz.

### Offen, unveraendert aus 0.11.2

- Puller des Nutzers: 3 kurze schwebende Stellen aus schmalen Prusa-Ersatzpfeilern.
- Ein Kantenpunkt (X118 Y98 Z31,9) ohne Kontakt wird von der Pruefung nicht gemeldet.
- Kein Testdruck. Stuetzen mit MMU und BGCode sind am Drucker ungeprueft.
- Vorschau bis 250 MB G-Code.

## Stand 0.11.2: gerade Wege (22.11.2026)

Meldung des Nutzers: Stuetzen stark geknickt, gerade waere oft besser. Die schrittweise Wegsuche (1 mm) ist ersetzt.

- Reihenfolge je Stuetze: senkrecht zum Bett, senkrecht aufs Teil, eine Gerade zum Bett, hoechstens ein Knick, Pfeiler.
- Baeume vereinigen sich nur mit geraden Aesten und geradem Stamm, wenn das mindestens 6 mm und 20 % Weg spart.
  Waagerechte Richtungsumkehr ist ausgeschlossen. Ersatz fuer Faecher/Knotenblech waechst nicht zusammen.
- Keine eigene Auflage auf Grund steiler als rund 25 Grad (schwebte oder streifte). Fuesse benachbarter Saeulen
  beruehren sich nicht.
- Fenstertitel traegt die Version aus Cargo.toml.

Rest: einzelne Streifstellen am Fuss neben Stufen (wenige mm Bahn), einzelne Randpunkte mit weniger Kontakt als Prusa,
schmale Prusa-Ersatzpfeiler mit kurzen schwebenden Bahnen. Keine Sperre gegen zwei gleichzeitig laufende Programme
(beide schreiben denselben Arbeitsbereich). Kein Testdruck.

## Stand 0.11.1: Kontakt und Auflage der Stuetzformen (22.11.2026)

Fehler in 0.11.0: Spitzen waren flache kleine Scheiben (dichter Kontakt 16-47 % statt 91 % beim Original), Aeste konnten
auf Kegeln ohne Auflage enden, der Abstand rundete teils auf das Doppelte. Die damalige Pruefung erkannte das nicht,
weil ihr eine einzelne Bahn als Kontakt reichte und sie Schweben nicht pruefte.

- `support-contact.js`: Kopf folgt der Unterseite (Kontaktbreite 4 mm), XY-Beschnitt wie Prusa, jede Schicht muss auf der
  darunter stehen. Fuss fuellt bis zur echten Oberflaeche.
- Kopf und Fuss sind ein zweites ModelPart im Stuetzobjekt: ohne Wand, Linien mit Interface-Abstand und -Tempo.
  Der hohle Ast hat keine Deckel mehr.
- Abstaende gelten auf den Schnittebenen (Schichtmitte): ceil(Abstand / Schicht) Schichten.
- Wegfindung behaelt beim Zusammenwachsen einen Weg zum Bett. Vor einem Ersatzpfeiler kommt ein schlanker Ast.
- `inspectSupports` misst Kontaktflaeche an bis zu 12 Punkten und meldet schwachen Kontakt.

Geprueft am G-Code gegen Prusa-Pfeiler an denselben Punkten (46 Kombinationen plus Stand des Nutzers): keine schwebende
Insel der eigenen Formen. Knotenblech beruehrt am Wandanker absichtlich.
Rest: einzelne Streifstellen um 2,5 mm Bahn am schlanken Fuss im Testfall "Puller, alles Baum".
Prusas eigene schmale Pfeiler zeigen an Kegeln vereinzelt schwebende Inseln (auch im Original). Kein Testdruck.

## Stand 0.11.0: Stuetzarten, Renderer, Fortschritt (22.11.2026)

Vorgabe des Nutzers: alle Stuetzarten wie Simplify3D V6, Prozentbalken beim Slicen, Vorschau mindestens wie V6.
Massstab waren die oeffentliche V6-Seite und ihre Bilder. V6 selbst lag nicht vor (installiert ist 5.1.2).

### Stuetzen

| Art | Druckweg |
|---|---|
| Pfeiler, Mini | `SupportEnforcer`, Prusa baut sie |
| Baum, Faecher, Knotenblech | eigenes Objekt je Modell (`inline`-Netz): 1 Wand, hohl, Deckel = Kontaktlagen, Stuetzen-Tempo |
| Gemischt | Regeln waehlen Mini, Pfeiler oder Baum |

- `support-field.js` Kollisionen, `support-shapes.js` Wege, `support-plan.js` gemeinsamer Plan fuer Ansicht und Slicing.
- Ohne freien Weg: Ersatzpfeiler 2,4 mm. Ohne Wand bzw. Gruppe: Baum. Beides wird angezeigt.
- Knotenblech beruehrt die Wand am Fuss absichtlich. Alle anderen Formen halten Abstand.
- Die Engine kennt die Formen nur als Objekte. Rust benennt deren `;TYPE:`-Kommentare in Stuetzrollen um,
  Fahrbefehle bleiben unveraendert. Dafuer wird `gcode_label_objects` auf `octoprint` gesetzt, falls es aus ist.
  In BGCode bleiben die Engine-Rollen stehen.
- Mit diesen Formen: Prusa-Automatik aus, Pfeilerfuss ohne Verbreiterung in Schicht 1. Mit Raft werden sie zu Pfeilern.
  Nicht mit "Objekte einzeln drucken" und Vasenmodus.
- Die Engine rechnet die Formen nicht wie Stuetzen: Brueckenkuehlung, Luefter und Zeitschaetzung folgen Objektregeln.

### Vorschau und Fortschritt

- `toolpath-render.js`: instanzierte Raupen, keine Kuerzung, Schichtwechsel ohne Neuaufbau, Abspielen.
- `render-pipeline.js`: MSAA, doppelte Aufloesung, Umgebungsverdeckung. `surface-shading.js`: Kantenglaettung 35 Grad.
- Prozent aus den Stufenmeldungen der Engine, kein gemessener Rechenanteil.

### Nicht umgesetzt aus V6

Maschinenmodell und Achsenbewegung, Druckkopf-Simulation fuer IDEX/Werkzeugwechsler, AMS/Bambu, Netzreduktion,
Bild-Hilfen an Parametern. Die 40+ V6-Stuetzparameter sind nicht veroeffentlicht und daher nicht 1:1 abgebildet.

### Nicht geprueft

Testdruck, Mehrwerkzeug mit Stuetzen, BGCode mit Stuetzen, schwache Grafikkarte, Vorschau ueber 250 MB G-Code.

### Achtung bei Engine-Tests

PrusaSlicer.exe immer mit `--datadir <eigener Ordner>` starten, sonst schreibt es in den Prusa-Datenordner des Nutzers.

## Stand 0.10.1: eigene Stuetzen (22.11.2026)

Prinzip: Simpliy bestimmt nur den Ort, die unveraenderte Engine erzeugt die Stuetzen.

- Jeder Pfeiler wird als `SupportEnforcer` ueber den Hoehenbereich der Unterseite in seiner ganzen Flaeche uebergeben,
  nie als ModelPart. Beruehrende Pfeiler liegen in getrennten Enforcer-Koerpern.
- Je Objekt: `enforcers_only` (bei `everywhere` im Prozess bleibt die Automatik), Stil `snug` (waehlbar: wie Prozess),
  Schwelle 89 Grad (nur ohne Automatik, betrifft dann nur den seitlichen Kontaktbeschnitt),
  Kontaktlagen 2 statt 0. Alle uebrigen Stuetzwerte kommen aus dem Prozess.
- Verschieben nimmt die Stuetzen mit. Drehen, Skalieren, Spiegeln und Netzaenderung werden vor dem Slicen nachgezogen.
- `inspectSupports` prueft die echten Bahnen. Fehlende Stuetzen werden gemeldet, Speichern und Upload fragen dann nach.
  Fehlende dichte Kontaktlage ist kein Fehler, das macht Prusa im Rasterstil an Schraegen selbst so.

Geprueft mit PrusaSlicer 3.0.0-alpha14: 34 G-Code-Faelle (Puller mit 31 Stuetzen, acht Testformen, Schicht 0,1 bis 0,3,
Abstand 0,1 bis 0,3, Raft, zwei Modelle, 1599 Stuetzen). Keine fehlende Stuetze, keine gemessene Beruehrung. Organischer Stil: Aeste verlaufen nicht senkrecht, dort prueft Simpliy nur oben.
Gegenprobe mit 0,02 mm Abstand wird von der Messung erkannt. Echte App: Puller bis zum gespeicherten G-Code.

Nicht geprueft: Testdruck, Mehrwerkzeug mit eigenen Stuetzen, BGCode mit eigenen Stuetzen, Unterseiten steiler als
39 Grad zur Waagerechten in den Testformen. Geschnittene Modelle: keine Neuerzeugung von Stuetzen.
Kopfleiste und three.js-Warnung: behoben in 0.11.0.

## Eigene Stuetzen: erste Slicing-Anbindung (22.11.2026), ueberholt durch 0.10.1

Eigene Pfeiler werden fuer den eingeschraenkten Fall als internes ModelPart-Volumen mit einem Wandzug, 0 % Fuellung und je zwei Boden-/Deckschichten uebergeben. Ein SupportEnforcer veranlasst Prusa, den oberen Kontaktbereich aus den Prozesseinstellungen zu generieren. Das Objekt erhaelt hierfuer die Einstellungen nur Erzwinger, eng anliegend und Schliessradius 0; die exakte Pfeileransicht vor dem Slicing ist nicht die G-Code-Vorschau. Kontaktabstand im Werkzeug und im Prozess muss uebereinstimmen; Kontaktlagen muessen aktiviert sein. Nach dem Slicing prueft Simpliy fuer jeden Pfeiler, ob eine extrudierte Kontaktbahn im richtigen Bereich vorhanden ist, bevor es den Auftrag zum Export bereitstellt.

Freigegebener Versuchsbereich: ein aktives Modell je Platte, ein Werkzeug, ASCII-G-Code und Stuetzen vom Druckbett. Stale/unvollstaendige Stuetzen, Modellkollisionen, Stuetzen auf Modelloberflaechen, mehrere Modelle, Modifier, Bemalung fuer Stuetzen, variable Schichten und parallele vollautomatische Prusa-Stuetzen werden abgewiesen. Grosse Kollisionspruefungen werden begrenzt. Eine Kontaktbahnpruefung bestaetigt keine vollstaendige flaechige Abdeckung oder Druckbarkeit. Kein realer Testdruck.

Echter Engine-Test: Aus einem von buildJob erzeugten Auftrag hat der Rust-3MF-Writer die Datei geschrieben; PrusaSlicer 3.0.0-alpha14 slicte das Testmodell, und der Vorschauparser bestaetigte 42 Segmente der Kontaktflaeche fuer einen gesetzten Pfeiler. 3MF-Volumeneinstellungen, Kontaktabstand, Kollisionen und fehlende Kontaktbahnen haben zusaetzliche automatisierte Tests. Keine Veraenderung an PrusaSlicer.


## Stand 0.10.0 (22.11.2026)

Vorgaben des Nutzers: nur FFF. Kein allgemeiner S3D-Import; seine Druckereinstellungen liegen einmalig als
persönliches Testprofil unter `profiles/PRUSA-MK3S-Reprapt/` und werden nicht mit der EXE ausgeliefert.
Eigene Stützen kommen zuletzt.

### Neu

| Funktion | Dateien | Grenze |
|---|---|---|
| Mehrere Prozesse je Platte | `plate-plan.js` | 136 Werte je Modell. Der Rest gilt je Platte, Abweichungen werden vor dem Slicen gezeigt |
| Material je Werkzeug | `plate-plan.js`, `engine.rs` | braucht ein Basisprofil mit mehreren Werkzeugen. Start-Skript und Einzug gelten je Platte |
| Text prägen | `text-mesh.js`, `vendor/opentype` | eben, folgt keiner Rundung |
| Messen | `measure.js` | Punkte, Ebenen, Kreis aus drei Punkten. Kein Kantenfang |
| Netzreparatur | `repair.js` | löst keine Selbstdurchdringungen auf |
| Upload | `upload.rs` | nur http, startet nie einen Druck. Moonraker ersetzt gleichnamige Dateien |
| Platten und Projekte | `projects.rs`, `project-file.js` | eine Schichtvorschau gleichzeitig |

### Korrigiert gegenüber 0.9

- MMU: Das gewählte Material galt nur für T0, T1 bis T4 bekamen das Standardmaterial der Engine.
- Temporäre Namen waren bei gleichzeitigen Aufgaben nicht eindeutig.

### Persönliches Testprofil: bewusste Abweichungen von S3D

- Lüfter: Prusa kennt nur Aus + lineare Rampe + Endwert, Zwischenstufen einzelner Materialien weichen ab.
  Lüfter für Oberseiten (PETcF, CR3d Petg: 80 %) gibt es nicht.
- Schnellschicht-Lüfter greift ab mindestens 15 s, weil Prusa ihn an das Verlangsamen koppelt.
- Z-Hop gilt überall statt nur auf Oberseiten. Coasting und Wischweg 1 mm gibt es nicht.
- „Brim“ und „Skirt“ haben im Original useSkirt=0 und erzeugen darum auch hier nichts.
- Der Temperaturwechsel zu Schicht 2 steht im Schichtwechsel-Skript, weil das Start-Makro selbst heizt.
- Die Begrenzung X/Y/I/J für das Start-Makro ist die erste Schicht, nicht das ganze Bauteil.
- Prusa-Basis „Generic PLA“ dient nur als Unterlage; die Materialwerte kommen aus dem Profil.

### Geprüft

- Persönliches Profil: alle 34 Optionen einzeln gesliced.
- Echte EXE ferngesteuert, native Dialoge ersetzt: alle neuen Funktionen bis in den G-Code bzw. die Projektdatei,
  dazu die komplette Regression von 0.9.
- Upload: Protokolltests für Duet, Duet SBC, OctoPrint, Moonraker, PrusaLink; Duet zusätzlich aus der
  Oberfläche gegen einen simulierten Drucker.

### Nicht geprüft

- Kein Testdruck, kein echter Drucker, Makros auf dem Drucker unbekannt.
- Mehrwerkzeug in der Oberfläche nur mit MK3S MMU3.
- Native Dateidialoge nicht durchgeklickt.

### Umgebung

Auf diesem PC brechen lokale TCP-Verbindungen (127.0.0.1) sporadisch ab, auch mit reinem Python (79 von 300).
Upload-Protokolltests laufen deshalb ohne echtes TCP. Ob das LAN betroffen ist, wurde nicht geprüft.

### Offen

Eigene Stützen, Text auf Rundungen, Schnitt-Verbinder, Farbwechsel nach Höhe, Prozesse für Z-Bereiche eines Modells.

---

## Stand 0.9.0 (22.11.2026), überholt, wo 0.10 etwas anderes sagt

Simpliy ist ein reiner FFF-Slicer. SLA wird nicht benötigt (Vorgabe des Nutzers).
Reihenfolge laut Nutzer: Oberfläche, alle Druckparameter und Slicing zuerst, eigene Stützen zuletzt.

### Aufbau

| Datei | Aufgabe |
|---|---|
| `frontend/settings-layout.js` | Reiter, Liste links, Gruppen, Beschriftungen |
| `frontend/process-dialog.js` | kompakter Prozessdialog |
| `frontend/engine-config.js` | Werte in Engine-Konfiguration übersetzen und prüfen |
| `frontend/print-job.js` | Auftrag aus Modellen und Werten |
| `frontend/workbench.js` | Listen, Werkzeugfenster, Vorschauleiste |
| `frontend/viewport.js` | dauerhafte 3D-Ansicht |
| `frontend/paint-core.js` | Bemalung im Prusa-Format |
| `frontend/geometry.js` | Platzierung, Schnitt, Grundkörper |
| `frontend/model-actions.js` | Modellaktionen mit Rückgängig |
| `src-tauri/src/engine.rs` | Engine-Prozess, Import, Slicen, Abbruch |
| `src-tauri/src/project.rs` | 3MF-Projekt |
| `src-tauri/src/mesh.rs` | STL-Netz mit fester Dreiecksreihenfolge |
| `tools/generate-catalog.mjs` | Parameterkatalog bei neuer Engine-Version neu erzeugen |

`frontend/viewer.js` und `frontend/catalog.json` werden von der Oberfläche nicht mehr geladen.

### Weg ins Slicing

1. `--save` mit den vier Prusa-Profilen liefert die vollständige Basis.
2. Simpliy-Werte werden darübergelegt: Drucker/Filament (nur mit Haken), Profil, Auto-Konfigurationen, manuell.
3. `--load` + `--save` kontrolliert, dass jeder Wert angekommen ist.
4. 3MF mit Modellen, Bemalung, Zusatzkörpern und Bereichen wird gesliced, erst das fertige Ergebnis gespeichert.

### Eigenheiten von alpha14 (nachgemessen)

- `--version` schreibt nach stderr.
- Eingabefehler enden mit Rückgabecode 0 und ohne Datei.
- 3MF ohne `volume_settings` je Volumen lässt die Engine abstürzen.
- Ohne `--no-ensure-on-bed` druckt ein per Negativvolumen geschnittener oberer Teil in der Luft.
- Der Kommentar `; retract_length` im G-Code zeigt den Standardwert; gefahren wird der richtige Wert.
- Aufgemalte Stützen haben Vorrang vor Blocker-Körpern.
- Sehr lange Datenordner-Pfade (über 260 Zeichen) lassen das Kopieren der Systemprofile scheitern.
- Klipper und RepRapFirmware können `machine_limits_usage = time_estimate_only` benötigen.

### Geprüft

- 353 Engine-Parameter plus Düsendurchmesser geändert und verlustfrei durch die Engine (`--load`/`--save`).
  Das prüft die Übergabe, nicht die Druckwirkung jedes einzelnen Parameters.
- Echte EXE ferngesteuert (native Dateidialoge ersetzt): 46 Dialogseiten bei 990x640 und 1540x920,
  STL- und STEP-Import, Stützen/Naht/Fuzzy/Mehrfarbe malen, Modifikator, Werte pro Modell,
  variable Schichthöhe, Schneiden, Skalieren, Spiegeln, Drehen, Anordnen, Abbrechen, Neustart.
- 720.000 Dreiecke: Import 2,3 s, Pinselpunkt 47 ms.

### Nicht geprüft

- Kein Testdruck. Native Dateidialoge, Profil-Import/-Export und Drucker-Webfenster nicht durchgeklickt.
- OBJ und 3MF nur über die Engine-Umwandlung getestet, nicht über die Oberfläche.
- Ziehen mit der Maus zum Verschieben und „Auf Fläche legen“ nicht durchgeklickt (Winkelrechnung getestet).
- Exportiertes 3MF nicht in der PrusaSlicer-Oberfläche geöffnet.
- Mehrwerkzeug nur mit MK3S MMU3 getestet, XL und INDX nicht.

### Offen

- Eigene Stützen (erst nach Freigabe von Oberfläche und Slicing).
- S3D-Profil: Start-/End-Skripte, Lüfterpläne, Ergänzungs- und Prozess-Varianten fehlen noch. Das Original
  bleibt gesperrt, eine Kopie fragt vor dem ersten Slicen nach.
- Lüfter- und Temperatur-Sollwerte für beliebige Schichten: Prusa kennt nur Schicht 1 / ab 2 bzw. eine Rampe.
- Mehrere Prozesse gleichzeitig auf einer Platte: gesliced wird mit dem markierten Prozess.
- Unterschiedliches Material je Werkzeug auswählen, Text/SVG prägen, Schnitt-Verbinder, Mesh-Reparatur,
  Messen, Farbwechsel nach Höhe, Upload zum Drucker.
- Externe Nachbearbeitungsskripte sind absichtlich gesperrt.
- Lizenz vor Weitergabe klären, siehe `THIRD-PARTY.md`.

---

# Ältere Einträge (teilweise überholt)

# Simpliy Slicing - Entwicklungsstand

Die Basis wurde aus dem Vorbereitungsordner kopiert. PrusaSlicer bleibt extern.

## Start

Starten-Windows.cmd startet den Tauri-Entwicklungsbuild. Voraussetzungen: Rust MSVC, Microsoft C++ Build Tools und WebView2. Die npm-Abhaengigkeiten wurden installiert.

## Erster G-Code-Export

Unter Prusa-Pfad die Engine suchen oder den Pfad eintragen. G-Code erzeugen startet die Dateiauswahl: Modell, optional eine PrusaSlicer-3.0-JSON-Konfiguration (Abbrechen verwendet Standardwerte), danach Ausgabedatei. Die Engine arbeitet mit einem eigenen Datenordner. Simpliy-Prozesse, Drucker und Filamente werden noch nicht an die Engine uebertragen; Modellliste und Vorschau sind Platzhalter. G-Code vor Verwendung mit dem passenden Druckerprofil pruefen.

Ein 20-mm-Testwuerfel wurde mit der mitgelieferten Version 3.0.0-alpha14 direkt ueber die CLI erfolgreich gesliced. Die GUI-Anbindung und der native Build muessen noch abschliessend getestet werden. Eigene Stuetzerzeugung, 3D-Vorschau und Parametermapping sind noch nicht implementiert.

## Stand: Modellimport und erste Engine-Anbindung

Die native Modellauswahl speichert den echten Dateipfad. STL wird im drehbaren 3D-Viewer dargestellt; 3MF und OBJ koennen importiert und an die Engine uebergeben werden, ihre Vorschau ist noch nicht implementiert. Das ausgewaehlte Modell wird an den externen PrusaSlicer uebergeben. Prusa-Pfad suchen, Modell importieren und auswaehlen, dann G-Code erzeugen. Optional ist eine vollstaendige Prusa-3.0-JSON-Konfiguration waehlbar. Simpliy-Prozess-, Drucker- und Filamenteinstellungen werden noch nicht uebertragen; ohne Konfiguration verwendet Prusa Standardwerte. Bestehende Ausgabedateien werden nicht ueberschrieben. Fuer mehrere Modelle gibt es derzeit noch kein gemeinsames Slicing.

Windows: cargo check und Tauri-Entwicklungsbuild erfolgreich. Direkter CLI-Test des Testwuerfels erfolgreich. Der Import und Slicing-Ablauf im Fenster ist noch nicht automatisch end-to-end getestet, da die Computer-Use-Verbindung nicht erreichbar war.

Prusa arbeitet als Hintergrundprozess; unter Windows wird kein Konsolenfenster geoeffnet und die Daten bleiben im eigenen Prusa-CLI-Datenordner. Die Statuszeile zeigt die erkannten Engine-Schritte und das Ergebnis. Ein prozentualer Fortschritt ist noch nicht angebunden. cargo check und bestehende JS-Tests erfolgreich; ein verdeckter CLI-Test erzeugte G-Code. Die vollstaendige GUI-Pruefung der neuen Statusanzeige steht noch aus.

## Prusa-Profile und Stuetzeneinstellungen

Interne Support-Prozesse werden aus der Prozessliste ausgeblendet, gespeicherte Eintraege bleiben erhalten. Der Stuetzentab wurde mit dem exportierten FFF-Schema von PrusaSlicer 3.0.0-alpha14 ergaenzt. Ein Auswahlfenster fragt installierte Ein-Extruder-FFF-Drucker und dazu kompatible Druck-, Werkzeug- und Filamentprofile aus der Engine ab. Ein CLI-Test mit MK3S-, 0.05-mm- und Generic-PLA-Profil hat G-Code mit 0.05 mm Schichthoehe erzeugt. Mehrwerkzeug und SLA sind noch nicht angebunden. GUI-End-to-End-Test steht aus.

Wichtig: Ein direkter CLI-Test mit support_material=everywhere und support_material_style=grid ergab im G-Code enforcers_only bzw. snug. Deshalb wird Slicing bei zugewiesenen Prusa-Stuetzeneinstellungen derzeit blockiert. Eigene Stuetzen sind noch nicht implementiert. Die Ursache der abweichenden Parameterauswertung muss vor Aktivierung geklaert werden. Andere Simpliy-Prozesswerte werden bisher nicht uebertragen.

## Schichtvorschau

Nach einem erfolgreichen Export wird der erzeugte ASCII-FFF-G-Code gelesen und als Werkzeugwege angezeigt. Modell/Schichten wechselt zwischen Ansichten. Schichtregler, einzelne Schicht oder alle darunter, Werkzeugwegfilter und optionale Leerfahrten; Faerbung nach Werkzeugwegtyp, Sollgeschwindigkeit oder berechnetem Volumenfluss. Der Fluss basiert auf E-Weg, Filamentdurchmesser und Sollgeschwindigkeit und beruecksichtigt keine Firmware-Korrekturen. XY-Kreisboegen mit I/J werden approximiert; nicht erkannte Kreisboegen als Gerade angezeigt. Maximal 100 MB G-Code und 1 Mio. dargestellte Segmente; bei groesseren Ansichten einzelne Schichten auswaehlen. Vorschau ist noch nicht fuer binaeren G-Code, SLA oder alle Firmware-Befehle geeignet.

Test 21.11.2026: PrusaSlicer 3.0.0-alpha14 slicte einen 20-mm-Wuerfel mit MK3S-Profil, 0.05-mm-Druckprofil und Generic PLA. G-Code: 397 Schichten, 859258 Bytes; der Vorschauparser fand 397 Schichten und 15792 extrudierende Segmente. Rust-Windows-Build und neun Node-Tests bestanden. Das Tauri-Fenster startet; der komplette Dialog- und Darstellungstest in der GUI war wegen nicht erreichbarer Computer-Use-Schnittstelle nicht moeglich. Vereinfachte Simpliy-Prozessparameter und eigene Stuetzen bleiben nicht vollstaendig mit Prusa verbunden.

## Drucker- und Profilverwaltung

Die mitgelieferte Simpliy-Oberflaeche blendet das S3D-MK3S-Teilprofil beim Start als festes Entwurfsprofil ein, ohne vorhandene Profile zu ersetzen. Der Teilport darf noch nicht zum Slicing verwendet werden: die Werte sind nicht vollstaendig uebertragen und die RRF-Makros nicht geprueft.

Unter Prusa Standardprofile werden die in der Engine verfuegbaren Drucker abgefragt; Drucker und zu einem konkreten Druckprofil kompatible Filamente koennen gesucht und als Referenz zur lokalen Bibliothek hinzugefuegt werden. FFF mit einem Extruder kann ueber die bestehende Prusa-Preset-Auswahl gesliced werden; SLA und Mehrwerkzeug sind nur auflistbar. Die Auswahl eines freien lokalen Druckers bzw. Filaments ist noch nicht an die Engine gebunden.

Im Druckerdialog gibt es eine Liste der G-Code-Varianten aus dem Prusa-alpha14-Schema sowie ein optionales Feld fuer IP/URL. Die Adresse oeffnet eine externe Drucker-Webseite in einem Simpliy-Webview-Fenster. Das ist keine direkte Druckersteuerung und kein G-Code-Upload. Die G-Code-Auswahl im lokalen Datensatz aendert noch nicht die Engine-Konfiguration. Test: Prusa ignorierte im Test den CLI-Schalter --gcode-flavor=klipper und gab im geladenen Profil weiterhin marlin aus; daher wird kein automatisches Uebertragen behauptet.

Tests: Windows Rust-Build, URL-Validator-Test und 16 JS-Tests erfolgreich. Die Computer-Use-Schnittstelle war nicht erreichbar; das native Fenster und eine echte Drucker-Webseite wurden nicht durchgeklickt. Im direkten Prusa-Abfrageergebnis der mitgelieferten Installation waren 34 Profile (32 FFF, 2 SLA), nicht notwendigerweise alle Profile anderer Installationen oder Anbieter.

## Vorschau und Export 22.11.2026

Siehe VORSCHAU-ANLEITUNG.md. Slicing arbeitet zunaechst in einem temporaeren Cache, Export und Upload erfolgen separat. Die Vorschau hat Schichtbereich, Farblegende, hervorgehobene aktuelle Schicht und beleuchtete raeumliche Bahnen; Schatten wirken auf das Bauteil. Echtes Prusa-Slicing und bytegleicher Export wurden mit ASCII und BGCode getestet; keine Druckausfuehrung und kein visueller Fenster-End-to-End-Test. Bei mehr als 250000 Bahnsegmenten wird die Auswahl gekuerzt; die aktive Schicht wird bevorzugt angezeigt.


## Stützentool-Patch v0.2 – Integration (22.11.2026)

Der Patch wurde in die bestehende Oberfläche integriert. Er erzeugt gerade Säulen für ein einzelnes Modell, bietet manuelles Hinzufügen/Entfernen und einen STL-Export. Die Geometrie ist experimentell: Andere Modelle, komplexe Innenräume, Überlappungen und geschnittene Modelle sind nicht vollständig berücksichtigt. Ändern von Modell oder Stützparametern markiert vorhandene Stützen als veraltet.

Der Patch übergibt seine Stützen nicht an den Slicing-Auftrag und enthält keine separate Prusa-Kontaktflächenrolle. Slicing mit vorhandenen eigenen Stützen bleibt gesperrt. Ein tatsächlicher Einzeltest mit PrusaSlicer 3.0.0-alpha14 und 36 generierten Stützen als STL erzeugte G-Code; Prusa behandelte sie als gewöhnliches Modell mit Perimetern und Füllung. Das ist kein Nachweis für Stützmaterial oder eine Kontaktfläche und kein Testdruck. Die normale Prusa-Stützfunktion ist davon getrennt.

Automatisierte Tests decken einfachen Überhang, Auflage auf dem Bett, Kontaktabstand, Begrenzung sowie die Slicing-Sperre ab. Komplexe Geometrien und die Bedienung im laufenden Windows-Fenster wurden für diesen Patch nicht geprüft.

## Stützenansicht und Raster (22.11.2026)

Die Stützpfeiler verwenden eine quadratische, gerade Rasterform ohne kegelförmige Füße und Spitzen. Für mehrere Überhänge an derselben XY-Rasterposition werden nun getrennte Höhenbereiche ermittelt; ein Stützfuß kann auf einer tieferliegenden Modellfläche beginnen. Die Pfeilerbreite entspricht der Rasterauflösung. Automatisierte Tests prüfen diese Fälle an einfachen Körpern. Die Kollision der gesamten quadratischen Pfeilerfläche mit gekrümmten Flächen und anderen Modellen ist noch nicht vollständig gelöst; es gibt weiterhin keine Slicing-Übergabe der eigenen Stützen. Die Gruppenwerkzeuge sind deaktiviert.

## Nachtrag 5 (2026-11-25): Konfiguration exportieren / aus G-Code zurückholen
- Neues Format `SimpliyConfig` (.simpliyconfig.json): Prozess, Drucker, Material, Auto-Konfig-Offsets (jeder Teil optional). Prozessdialog: „Konfiguration exportieren…“ / „Konfiguration / G-Code laden…“; Druckerverwaltung: „Drucker exportieren“ / „Drucker laden…“.
- Jeder von Simpliy erzeugte G-Code enthält nach der Zusammenfassung die exakte Konfiguration (`; simpliy_config_begin … end`, Base64, Zeilen < 200 Zeichen). „Konfiguration / G-Code laden…“ liest sie zurück; fremder G-Code wird abgelehnt.
- Ältere Simpliy-G-Codes ohne Block: Wiederherstellung aus der Einstellungsübersicht (Text → Engine-Werte, Drucker/Material daraus abgeleitet).
- Grenzen: .bgcode nicht lesbar; bei mehreren Prozessen auf einer Platte steht der Hauptprozess im G-Code.
- Rust: `Job.restore`, `with_summary(.., config, ..)`. Tests: 82 JS-Tests, Rust-Test summary.

## Nachtrag 6 (2026-11-25): Konfiguration nur mit verwendeten Auto-Konfigurationen
- Export und G-Code-Block (Format `SimpliyConfig` Version 2) enthalten je Auto-Konfiguration nur die **gewählte Option** samt allen verbundenen Parametern (`auto: [{cat, catName, keys, option}]`), den Drucker ohne Schichthöhen-/Materiallisten und nur die aktiven Auto-Konfig-Offsets. Beispiel: 0,10 mm gewählt = nur 0,10 mm mit seinen 17 Parametern (Geschwindigkeiten usw.); G-Code-Block ca. 18 KB.
- Import: Die Auto-Konfigurationen des Prozesses werden auf die Optionen der Datei gestellt. Vorhandene Optionen werden **nie überschrieben oder gelöscht**: gleicher Name und gleiche Werte = vorhandene wählen; sonst neue Option (bei gleichem Namen „… (Import)“). Vorhandener Drucker: nur abweichende Druckerwerte, Schichthöhen/Materialien bleiben. Offsets: nur neue hinzufügen. Kategorien-Zuordnung nur für noch ungesteuerte Parameter.
- Ältere G-Codes (nur Textübersicht): Auto-Konfigurationen werden über ihre Namen gewählt, nichts überschrieben.
- Test: 0,20 gewählt → Import 0,10 wählt 0,10 (keine neue Option); veränderte 0,10-Datei legt „0,10 mm (Import)“ an, 0,10 und 0,20 behalten ihre Werte. 83 JS-Tests.

## Nachtrag 7 (2026-11-25): eigene Dialoge, Import nur als Entwurf
- Alle Browser-Fenster (`confirm`/`prompt`/`alert`, „tauri.localhost enthält“) sind durch eigene Dialoge ersetzt (`confirmRemove`/`askName` liefern jetzt Promises, 32 Aufrufstellen mit `await`; Esc = Abbrechen, Enter = OK; Test-Harness nutzt `window.__nativeDialogs`).
- „Prozessfenster Abbrechen“ fragt „Änderungen verwerfen?“ mit den Knöpfen „Verwerfen“ / „Weiter bearbeiten“.
- Einlesen (G-Code/Konfiguration) ändert nur den Prozess-Entwurf: neue Auto-Optionen und Offsets liegen in `proc.pending` (sichtbar im Dialog, wirksam beim Slicen) und werden erst mit „Prozess speichern“ angelegt (`commitPending`). Abbrechen verwirft sie. Druckerwerte aus der Datei kommen als Prozesswerte, der Drucker selbst bleibt unverändert. Fehlende Kategorien werden nicht angelegt.

## Nachtrag 8 (2026-11-25): Prozess zurücksetzen, Auto-Konfig Farbe
- „Prozess laden“ entfällt; „Prozess zurücksetzen“ setzt nur den Entwurf auf den gespeicherten Stand zurück (eigenes Bestätigungsfenster).
- Farben gehören zum Material (`material.colors`: Name, filament_colour, Offsets); der Prozess wählt höchstens eine (`color_id`, leer = Keine Farbe). Fenster „Auto-Konfig Farbe“ (`color-dialog.js`) im Look des Prozessfensters.
- Endwert = Grundwert + Auto-Offset + Farb-Offset (Prozentpunkte bei Lüftern, auf den Prusa-Bereich begrenzt). Nur der Farb-Offset wird in Filamentfarbe angezeigt.
- Farben-Änderungen liegen im Entwurf (`proc.pending.colors`) bis „Prozess speichern“. Neues oder dupliziertes Material startet ohne Farben.
- Tests: 88 grün; echte App geprüft.

## Nachtrag 9 (2026-11-25): Auto-Konfig-Offset-Editor, Farb-Offset-Anzeige, Vasenmodus
- Reiter „Auto-Konfig-Offset“: ein Unterreiter je vorhandener Auto-Konfiguration; Optionsliste (aktive Option vorausgewählt, andere Optionen frei bearbeitbar); Hauptschalter je Option; Checkbox, ein Zahlenfeld und Vorschau je Parameter; „+ Parameter hinzufügen“ (Suche im Katalog). Schichthöhen-Optionen zeigen immer erste Schicht / ab Schicht 2 (deaktiviert, 0).
- Datenmodell rückwärtskompatibel: `enabled` an Regel und Parameter (fehlt = aktiv), keine Migration nötig. Rechnung in `profiles.js` `withOffsets`: alle Offsets je Parameter addieren (Auto + Farbe), dann runden und auf den Prusa-Bereich begrenzen.
- Änderungen liegen im Entwurf (`proc.pending.offsetRules`) bis „Prozess speichern“; Abbrechen/Zurücksetzen verwirft sie.
- „Temperatur-Offsets vorschlagen“: nur aus Durchfluss (Schichthöhe × Breite × Geschwindigkeit) gegen die Materialgrenze, mit Bestätigung; ohne Daten kein Vorschlag.
- Farb-Fenster zeigt immer den aktuellen Wert (auch bei Offset 0). Vasenmodus von „Schicht“ zu „Wände“ verschoben.
- Tests: 91 JS grün; echte App geprüft (Reiter, Altregeln, Entwurf/Abbrechen/Speichern). Nicht geprüft: Rust-Tests neu, echter Slice mit PrusaSlicer, Vorschlagsassistent in der App, alle fünf Designs.

## Nachtrag 10 (2026-11-25): Offset-Standardwerte, Sammelschalter, Vorschlag in ganzen Grad
- Standard-Temperaturoffsets (immer deaktiviert) je Schichthöhen-Stufe: kleinste -2 °C, jede größere +2 °C (-2, 0, +2, +4 …); gleiche Höhen zählen als eine Stufe.
- Sammelschalter: Haken „Alle Offsets aller Optionen dieser Auto-Konfiguration“ (inkl. unbestimmter Zustand) und Haken im Tabellenkopf für alle Parameter der Option.
- „Temperatur-Offsets vorschlagen“ zurück: ganze Grad (ab 80 % der Materialgrenze +1 °C je 2 Prozentpunkte, max. +20 °C), nur mit Bestätigung, keine Werte ohne Datenbasis.
- 92 JS-Tests grün; echte App geprüft (Sammelschalter, Vorschlag-Meldung bei fehlender Materialgrenze). Nicht geprüft: Vorschlagswert mit vorhandener Materialgrenze, echter Slice.

## Nachtrag 11 (2026-11-25): Favoriten-Reiter, Benutzerdefinierte Zonen
- Reiter „Favoriten“ ganz rechts: Suche über alle Einstellungen, Klick fügt sie als normale Zeile hinzu, × entfernt. Liste in `state.favorites` (sofort im Arbeitsbereich). Im Konfig-Export (`bundle.favorites`) enthalten und beim Einlesen zusammengeführt; nicht im G-Code-Block.
- Benutzerdefinierte Zonen (Prozess-Fenster): „Drucken ab Z-Höhe“ / „Hör auf in Z-Höhe“ (`proc.zone`, im gespeicherten Prozess). Rust `zones.rs` entfernt nach dem Slicen die Schichten außerhalb des Bereichs (Start-/End-G-Code bleiben, bei absoluter Extruderachse `G92 E…`). Gilt für die ganze Platte über den Hauptprozess.
- Tests: 92 JS, 4 neue Rust-Tests (zones); echte App geprüft (Favoriten, Zonen-Fenster, Speichern). Nicht geprüft: echter Slice mit Zone auf dem Drucker/in der Vorschau, Zonen bei mehreren Prozessen je Platte.

## Nachtrag 12 (2026-11-25): Zonen-Prozesse wie bei Simplify (ersetzt das reine Löschen von Schichten)
- Entscheidung: Es wird nicht geschnitten und nicht gelöscht. Das ganze Bauteil wird je Zonen-Prozess einmal mit dessen Einstellungen gesliced, danach setzt Rust (`zones.rs` `merge`, `engine.rs` `slice_with_zones`) den G-Code schichtweise zusammen: im Z-Bereich gelten die Schichten der Zone, sonst die des Hauptprozesses. Ergebnis ist ein Objekt (gleiche Objektnamen, ein Start-/End-G-Code). Grund gegen Mesh-Schnitt: Schnittflächen bräuchten Deckel, jedes Teil hätte eigene erste Schicht/Boden-/Deckelschichten und Brim; die Teile müssten wieder angehoben und umbenannt werden.
- Beim Quellenwechsel werden Extruderzähler (`G92 E`), Düsen-/Betttemperatur und Lüfter der Quelle nachgeführt (`; Simpliy-Zone:`-Kommentare). Zonen-Anfang liegt direkt über der letzten Schicht ≤ „ab“; eine darüber folgende Schicht, die weniger als ihre halbe Höhe über der Zone liegt, entfällt. Grenzen am besten auf Vielfache der Schichthöhe legen.
- Bedienung: Prozess mit „Benutzerdefinierte Zonen“ (ab/bis) anlegen; unter „Modelle auswählen…“ den Hauptprozess je Modell wählen und den Zonen-Prozess zusätzlich ankreuzen (`model.zone_processes`).
- Grenzen: Der Hauptprozess der Platte gilt auch außerhalb; Zonen-Prozesse teilen sich die plattenweiten Werte, die sie vom Hauptprozess unterscheiden, wie bisher mit Rückfrage nicht (Zonen-Slices laufen ohne Rückfrage). Zeit = (1 + Zonen) Slices.
- Geprüft: 101 Rust-Tests (3 für Zonen), 92 JS-Tests, echter Slice in der App (Würfel, Zone 6–12 mm mit 60 % Füllung: 199 Schichten, zwei Quellenwechsel, Zonenbereich dichter). Nicht geprüft: Druck auf dem Drucker, mehrere Zonen je Modell, mehrere Modelle mit unterschiedlichen Zonen.

## Nachtrag 13 (2026-11-25): Zonen – Raster-Prüfung, Zustandsübergabe, Sperren, Anzeige
- Anzeige: Beim gewählten Modell erscheinen seine Zonen als halbtransparente blaue Quader über dem Z-Bereich (`viewport.setModels(..., zones)`).
- Rust-Module `src-tauri/src/zones/`: `layers.rs` (Schichtanalyse + Rasterprüfung, Toleranz 0,001 mm), `state.rs` (Druckerzustand, Übergangsbefehle), `mod.rs` (Zonenplanung, Zusammensetzer, Tests).
- Regel: Schicht gehört zur Zone bei `von < z ≤ bis` (halboffen). Grenzen exakt auf einer Schichtgrenze oder dazwischen ergeben genau eine Zuordnung; angrenzende Zonen ohne Lücke/Doppelung; überlappende Zonen = Fehler; Reihenfolge der Prozesse ohne Einfluss; Zone in der ersten Schicht = Fehler.
- Raster: erste Schicht, alle Z-Werte im Zonenbereich und die Schicht davor müssen aus dem tatsächlichen G-Code übereinstimmen, sonst Ablehnung mit Meldung (Hauptprozess/Zone, Schichthöhen). Vorab prüft das Frontend die Sollwerte und bietet „Zum Prozess wechseln“ an. Keine Extrusionsanpassung.
- Zustandsübergabe je Quellenwechsel: Extruderzähler (G92 E), Retraktionsangleich (E-Bewegung), Düse/Bett/Kammer/Lüfter, Beschleunigung/Ruck/Flussfaktor/Pressure Advance (M204/M205/M220/M221/M900/M572). Abgelehnt werden: G91, Mischung M82/M83, Werkzeugwechsel (T…), Firmware-Retraktion (G10/G11), Retraktionsunterschied > 5 mm. Kommentare `; Simpliy-Zone: Wechsel A -> B bei Z=…, Schicht n, Grund` im G-Code, Protokoll im Slicing-Log.
- Gesperrt (mit Meldung): mehrere Modelle auf der Platte mit Zonen, mehrere Werkzeuge/Reinigungsturm, Stützen (Simpliy-Stützen und Prusa-Stützen) in Haupt- oder Zonen-Prozess, Zone ab Schicht 1.
- Nicht umgesetzt (bewusst): variable Schichthöhen je Zone über 3MF-Schichtplan (nur Prüfung), sanfte Übergänge, Vorschau mit Quellenfärbung, Mehrmodell-Zonen.
- Geprüft: 14 Rust-Tests Zonen (112 Rust-Tests insgesamt grün, 8 ignoriert), 92 JS-Tests, echter Slice Test A (Würfel, 2 Prozesse, 199 Schichten, 2 Quellenwechsel mit Kommentaren) und Test D (andere Schichthöhe: kontrolliert gesperrt, Dialog). Nicht geprüft: Test B (3 Zonen) und C (2 Würfel) im echten Slice (C ist im Frontend gesperrt, B nur per Unit-Test), jeder Testdruck.

## Nachtrag 14 (2026-11-25): Wartbarkeit
- Neue reine Module (ohne Zugriff auf `state`, mit Tests `tests/zone-offset-modules.test.mjs`): `frontend/zone-plan.js` (Zonen lesen, Schichthöhen-Abgleich, Sperrgründe) und `frontend/offset-rules.js` (Offset-Regeln: Altformat, Aktivierung, Alle an/aus). `app.js` ruft sie nur noch auf (≈2495 statt 2517 Zeilen, Logik testbar).
- Toter Code entfernt (ungenutzte Variablen/`void`-Kniffe in `process-dialog.js`); Kommentare ohne Fremdprodukt-Namen.
- Neu: `docs/ENTWICKLER-LEITFADEN.md` (Module, Datenmodell, Entwurfsprinzip, Zonen-Ablauf, Tests, Bauen, Konventionen, nächste Aufräum-Schritte).
- Geprüft: 96 JS- und 112 Rust-Tests grün, echte App (Offset-Editor, Favoriten, Zonen-Fenster, Zonen-Slice) ohne Funktionsänderung. Keine Funktion verändert, keine Datenmigration.
- Offen (siehe Leitfaden): `app.js` weiter zerlegen (Konfig-Export/-Import, Farben, Zonen-Dialog), lange Einzeiler im Aktions-`switch`, `lib.rs` nach Themen teilen.

## Nachtrag 15 (2026-11-25): Aktions-Schalter in Module zerlegt
- Sicherung: `Sicherungen\2026-11-25_schalter` (alle Frontend-Dateien, Tests, vorherige EXE).
- `frontend/app.js` ruft Aktionen jetzt zuerst über `actionTable` auf (Name → Funktion); 16 Fälle und die zugehörigen Änderungs-/Eingabe-Ereignisse sind aus dem Schalter und den Änderungsblöcken in neue Module `frontend/actions/` gewandert: `offsets.js`, `colors.js`, `zones.js`, `model-assignment.js`, `favorites.js`, `process-reset.js`. Die bestehenden `zone-plan.js`/`offset-rules.js` werden weiterverwendet (keine Doppelimplementierung).
- Abhängigkeiten sind ausdrücklich: jedes Modul bekommt `env` (aus `actionEnv`), `state`/`catalogByKey` als Getter. Globale Variablen aus `app.js` entfernt: `zoneDraft`, `zoneSel`, `zoneMain`, `processModelSelection`, `favSearch`, `offsetView` – jedes Modul besitzt nur seinen eigenen Dialogentwurf. Funktionen aus `app.js` entfernt: `offsetDraft/offsetViewOf/offsetItem`, `suggestTemperatureOffsets`, `renderZoneDialog`, `zoneErr`, `withZoneProcess`, `renderProcessModels`, Farb-Helfer (jetzt in `colors.js`). `app.js`: 2495 → 2409 Zeilen.
- Verhalten, Oberfläche, gespeicherte Daten und das Entwurfsprinzip (Änderungen in `proc.pending`, Speichern nur über „Prozess speichern“) unverändert.
- Tests: Veraltete Offset-Prüfungen (Testskript) auf die deaktivierten Standardstufen umgestellt; neu `tests/action-modules.test.mjs` (7 Tests: Entwurf statt globale Regeln, Standardparameter, Alle an/aus, Farben, Zonenfenster, Zonen-Hauptprozess, Favoriten, Prozess zurücksetzen). 103 JS-Tests und 112 Rust-Tests grün, Release-Build ok.
- Echte App geprüft: Offset-Editor (Unterreiter, Altregeln, Entwurf/Abbrechen/Speichern), Alle-an/aus, Favoriten, Zonenfenster, Zonen-Slice (199 Schichten), Zonen-Sperre bei anderer Schichthöhe, Farbliste/Farbfenster/G-Code-Einlesen.
- Offen: restliche ~110 Fälle des Schalters (siehe Leitfaden „Nächste Aufräum-Schritte“); Prozess-Feldänderungen (`proc-material` …) liegen noch im zweiten Schalter.

## Nachtrag 16 (2026-11-25): Restlicher Aktions-Schalter und Feldänderungen ausgelagert
- Sicherung: `Sicherungen\2026-11-25_schalter2` (Frontend, Aktionsmodule, Tests).
- Beide große Schalter in `app.js` (Aktionen: 113 Fälle, Feldänderungen: 10 Fälle) sind weg. Alle Fälle liegen in thematischen Modulen `frontend/actions/`: `navigation`, `job`, `tool-lists`, `process-ops`, `config-files`, `auto-config`, `profile-editor`, `library`, `field-changes` (zusätzlich zu den früheren `offsets`, `colors`, `zones`, `model-assignment`, `favorites`, `process-reset`). `app.js` hat nur noch Dispatcher (`actionTable`, `fieldTable`, `earlyChange`/`lateChange`); 174 KB → 152 KB.
- Vorgehen: AST-genaue Extraktion (nicht per Textersetzung): jede Referenz auf Modulvariablen von `app.js` wurde zu `env.<name>`, Importe stehen im Modul selbst, `break` in Fällen wurde zu `return`. Prettier-formatierter Code; ESLint `no-undef` meldet keine unbekannten Bezeichner (Werkzeuge lagen nur im Scratch-Ordner, nicht im Projekt). `env` (`actionEnv`) macht die Abhängigkeiten ausdrücklich; Ansichts-Variablen sind als Getter/Setter angebunden.
- Verhalten unverändert; einzige Änderung: ein übrig gebliebenes natives `alert()` bei fehlgeschlagener Prusa-Profilabfrage ist jetzt `notify` (Konvention „keine nativen Dialoge“). Totcode entfernt (`gcodeFlavors`, ungenutzte Importe). Keine Änderung an Oberfläche, Daten, Profilstruktur oder dem Entwurfsprinzip.
- Tests: 103 JS (Testharness stellt `window`/`document` global bereit, weil Module außerhalb der Sandbox laufen) und 112 Rust grün; Release-Build ok. Echte App: Rauchtest über alle neuen Module (Navigation, Reiter, Temperatur-/Lüfterzeilen, Auto-Konfig-Menü/Zuweisung/neue Option, Material-/Qualitätswechsel, Export, Speichern, Prozessliste, Werkzeugleiste, Druckerverwaltung, Materialbibliothek) ohne JS-Fehler; Offset-Editor, Favoriten, Zonenfenster, Zonen-Slice (199 Schichten) und Zonen-Sperre erneut bestanden.
- Nicht einzeln durchgespielt: Profildialog (`profile-editor`), Import-Dateidialoge, `set-default-printer/filament`, Prusa-Preset-Speichern – sie laufen durch denselben, statisch geprüften Mechanismus, wurden aber nicht per Hand geklickt.

## Nachtrag 17 (2026-11-25): Offene Punkte der Wartbarkeit erledigt
- Sicherung: `Sicherungen\2026-11-25_schalter3` (Frontend, Module, Tests, `lib.rs`, vorherige EXE).
- Ansichts-Variablen verlegt (AST-genau): `printerEdit/filamentEdit` → `actions/library.js`, `editCat/editOpt/profilePanel` → `profile-editor.js`, `autoMenu/assignDraft/assignFilter` → `auto-config.js`, `activeExtruder/activeFan` → `tool-lists.js`; Zugriff von außen über `<modul>Actions.view` bzw. `env`. Modulobjekte in `app.js` eindeutig benannt (`libraryActions`, …).
- Alle Aktionen der generierten Module sind benannte Funktionen (`newPrinterAction`, `sliceNowAction`, …); die Aktionstabelle ist eine lesbare Name→Funktion-Liste.
- `lib.rs`: 1137 → 833 Zeilen. Neue Module `fonts.rs`, `printer_net.rs`, `dialogs.rs`, `thumbnails.rs`; Test-Module nach `src/tests/`. Keine Funktionsänderung (112 Rust-Tests wie vorher).
- Geprüft: 103 JS-, 112 Rust-Tests, ESLint (`no-undef`) ohne Fehler, Release-Build. Echte App zusätzlich: Auto-Konfig-Menü (hoch/runter/umbenennen/löschen, Kategorie anlegen/löschen), Drucker/Material „Standard setzen“, Prusa-Voreinstellungen, Rust-Befehle `list_fonts`/`read_font` (Pfadschutz)/`printer_view_hide`; Rauchtest aller Module, Offset-Editor, Favoriten, Zonen.
- Nicht per Hand geklickt: Datei-Import-Dialoge der Konfiguration (nativer Dialog), `printer_view_show` (echte Drucker-Weboberfläche), Prusa-Preset „zu meinen Druckern hinzufügen“.
- Offen: Render-Funktionen der Dialoge in die Module, gemeinsame Ansichts-Variablen (`previewMode`, `printerView`, `modal`), `lib.rs` Arbeitsbereich/Slicing-Befehle auslagern (siehe Leitfaden).

## Nachtrag 18 (2026-11-25): Engine alpha15 mit automatischer Aktualisierung, mehr Stützen-Parameter
- **Engine-Version:** `engine::VERSION` ist jetzt nur die zuletzt geprüfte Referenz (3.0.0-alpha15). Jede 3.x-Engine mit den benötigten Kommandozeilen-Optionen (`--load/--save/--output/--export-gcode/--dont-arrange/--no-ensure-on-bed`, `engine::probe`) wird akzeptiert. Neu: `engine_auto_update` (Rust) holt die neueste 3.x-Version von GitHub (Vorabversionen nur, wenn die aktuelle selbst eine ist), installiert sie in `%LOCALAPPDATA%\SimpliySlicing\engines\<Version>`, prüft sie und liefert den neuen Pfad; die alte Version bleibt installiert. Frontend `actions/engine-update.js`: Prüfung 4 s nach dem Start, höchstens alle 12 h, Schalter und „Jetzt suchen“ im Hilfe-Dialog (Slicing-Engine). `detect_engine` bevorzugt die neueste installierte Engine.
- **Alpha15 eingebaut:** Referenz auf alpha15 (Rust, README, Rechtstexte). Neue Prusa-Optionen `over_support_interface_speed` und `over_support_interface_acceleration` (bremsen Bahnen über Stützkontakt ohne Abstand) im Katalog und in den Reitern Geschwindigkeiten/Beschleunigung. Nicht übernommen (nicht Slicing-relevant bzw. eigener Aufwand): self-hosted Prusa Connect, bewegliche Fenster, Bett-Schätzungen, Spiegeln (Mirroring) – Letzteres wäre ein eigener Schritt im Modellwerkzeug.
- **Eigene Stützen, 13 neue Einstellungen** (Panel „Form“ › Reiter „Kontaktfläche“ und „Druck“; Vorgabe = Prozesswert, nichts ändert sich ohne Eingabe): Kontaktlagen, Dichte, Winkel, Muster (Linien/konzentrisch/Gitter), Kontaktschleifen, Tempo, Abstand oben (Z), Abstand seitlich; Tempo Stützkörper, Bahnbreite, Wände, Füllung und Füllmuster der Körper. Umsetzung `supports/overrides.rs` (siehe Leitfaden); geänderte Werte gehen auch als Objekt-Einstellung an die Engine, damit sie für Prusa-Pfeiler gelten.
- **Geprüft:** 119 Rust- und 105 JS-Tests (neue: Überschreibungen, Typen der Engine-Werte, Panel-Reiter, Versionserkennung). Echte App: Auto-Update von alpha14 → alpha15 inkl. Download (120 MB) in eine frische Testumgebung und Umschalten; Slice mit alpha15 (Würfel mit Zonen, 199 Schichten, `Slicing-Engine: 3.0.0-alpha15`); Stützen auf Tisch-Modell: Standard 1644 mm, mit Kontaktlagen 4/Dichte 100/Tempo 20 und Körper-Einstellungen 1703 mm Material. Ignorierte Engine-Tests (`neutral_base_config`, `engine_texts`) mit alpha15 bestanden.
- **Nicht geprüft:** Körper-Einstellungen (Wände/Füllung/Muster) im echten Slice mit Baum/Fächer (nur Unit-Test der Werte); Kontaktwinkel/-schleifen/-Z-Abstand im Druck; Engine-Wechsel bei Verlust des Netzes; Prusa Connect selbst gehostet.

## Nachtrag 19 (2026-11-26): Version 0.0.1-alpha.1, Update-Kanäle, Stützen nach Prusa-Werten
- **Version:** Simpliy ist jetzt `0.0.1-alpha.1` (Cargo.toml, tauri.conf.json, package.json, Komponentenliste). Titel/Hilfe/G-Code-Kopf zeigen sie automatisch.
- **Update-Kanäle alpha / beta / release:** Auswahl im Hilfe-Dialog (Updates), gilt für Simpliy-Updates und die Prusa-Engine. `updates.rs`: `Channel`, `stability`, `allows`; `check_app` filtert je Kanal und zeigt, was jeder Kanal anbietet; `auto_update_engine` nutzt den Kanal (statt der früheren Vorabversions-Regel). Geprüft gegen echte GitHub-Daten (Prusa-Repo als Testquelle): alpha → 3.0.0-alpha.15, beta/release → 2.9.7 (nur stabile); Einordnung per Unit-Test. Für Simpliy selbst ist noch kein GitHub-Repository eingetragen (Feld bleibt leer, bis eines existiert) – die Kanallogik ist identisch.
- **Stützen-Generator nach Prusa-Werten (`useProcess`, Vorgabe an):** Überhangwinkel, „nur Druckbett“, Kontaktabstand, Astwinkel, Spitzen- und Astdurchmesser kommen aus den Prusa-Stützeinstellungen des Prozesses; `bodyLikePrusa` (Vorgabe aus) leitet Füllmuster und -dichte der Stützkörper aus Prusas Stützmuster und -abstand ab. Im Panel sind die gesteuerten Felder gesperrt („aus Prozess“), Ausschalten gibt sie als eigene Werte frei. Die flexiblen eigenen Formen (Pfeiler, Mini, Baum, Fächer, Knotenblech) und die neuen Kontakt-/Druck-Überschreibungen bleiben.
- **Grenzen (ehrlich):** Es werden Parameter abgeglichen, nicht Prusas organischen Algorithmus nachgebaut; nicht übernommen wurden `dont_support_bridges`, `enforce_layers`, `closing_radius`, `first_layer_expansion/density`, `with_sheath`, `support_tree_top_rate` und `branch_distance` (andere Bedeutung oder Wirkung in Prusas Algorithmus). Der Überhangwinkel wird als gleiche Konvention wie Prusas Schwelle behandelt.
- **Tests:** 121 Rust-, 106 JS-Tests (neu: Kanäle, Prozess-Mapping, Panel-Sperre). Echte App: Panel (Schalter, gesperrter Astwinkel = Prozesswert 40, Ausschalten gibt frei), Stützen erzeugen + Slice, Kanal-Auswahl im Dialog, Versionsanzeige 0.0.1-alpha.1.
- **Nicht geprüft:** Slice mit geänderten Prusa-Werten (Winkel/Durchmesser) und Vergleich der Optik mit Prusa-Stützen; `bodyLikePrusa` im echten Druck.

## Nachtrag 20 (2026-11-26): SSC Cleaner geprüft, Flächenerkennung für Stützen
- Analyse und Entscheidungen: `docs/SSC-ANALYSE.md` (was passt, was nicht, nächste Kandidaten). Kurz: SSC baut CAD-Körper; für einen Slicer taugt nur die Netzanalyse. B-Rep/NURBS/STEP/Prüfungen/GPU/KI bleiben draußen.
- Neu: `supports/surface_kinds.rs` – Überhangflächen werden als Ebene / waagerechte Bohrung (Ø) / Zylinder / Freiform erkannt (Streuung der Normalen + Kreisanpassung). Option „Bohrungen nicht stützen bis Ø“ (`boreMax`, Vorgabe 0 = aus) im Stützen-Panel unter Platzierung › Regeln; nur beim automatischen Erzeugen (explizit gewählte Flächen bleiben gestützt).
- Geprüft: 124 Rust-Tests (neu: Bohrung/Ebene/Rolle/Kuppel/senkrechter Zylinder), 106 JS-Tests. Echte Netze (Tunnel Ø 6 und Ø 16): Ø 5,99 bzw. 15,97 erkannt; in der App 30 → 0 Stützen (Ø 6, Grenze 12) bzw. unverändert 43 (Ø 16). Ebenen an Bench-Modellen erkannt.
- Nicht geprüft: Netze echter Teile mit Bohrungen aus STEP-Export, sehr grobe Netze (wenige Facetten → Freiform, bleibt gestützt), Rundbögen mit anderem Profil.

## Nachtrag 21 (2026-11-26): Bohrungen, Fasen, druckbarer Überhang
- **Bohrungen** (`src-tauri/src/holes.rs`, Befehle `hole_scan`/`hole_adjust`; Frontend `hole-advice.js`, Reparatur-Werkzeug › „Bohrungen“): Glatte Flächenstücke (Kantenwinkel ≤ 35°) → Zylinderanpassung → nach innen, fast voller Umfang (Lücke ≤ 60°). Liste mit Ø, Lage (senkrecht/waagerecht/schräg), Länge und erwartetem Druckmaß. Untermaß ist ein vom Nutzer eingetragener Messwert (Vorgabe 0,2 mm, keine erfundene Physik); der Prozess-Ausgleich (`xy_size_compensation`: −x vergrößert Löcher um 2·|x|; `filament_shrinkage_compensation_xy` in %) wird eingerechnet. Warnung bei Ø < 3 mm und bei waagerechten Bohrungen. „Bohrungen um x mm vergrößern“ speichert eine Kopie (Originaldatei bleibt, „Original wiederherstellen“ geht), Wandpunkte radial um x/2 nach außen.
- **Fasen:** `chamfers` erkennt ebene Streifen, deren Neigung knapp unter der Schwelle liegt (Toleranz 5°, Breite ≤ 3 mm, Breite aus den echten Eckpunkten); sie werden nicht gestützt (Panel › Platzierung › Regeln: „Fasen nicht stützen bis Breite“, „Fase: so viel steiler als Schwelle“; Vorgabe an).
- **Druckbarer Überhang:** `Settings.effective_angle()` = Schwelle − „Zusätzlich druckbar“ (0–30°) − Prusa-Zusatzwinkel. Optional (`printableAuto`, Vorgabe aus) aus den Prozess-Parametern `enable_dynamic_overhang_speeds` (+5°), `overhangs` (+3°), Überhang-Lüfter 25/50/75 % je ≥ 80 % (+4°), höchstens 15°. Näherung, im Druck prüfen. Die Schwelle selbst bleibt an `support_material_threshold` gebunden (`useProcess`).
- **Geprüft:** 129 Rust- und 110 JS-Tests (neu: Bohrungen senkrecht/waagerecht/Bogenstück/Aufmaß, Fase schmal/breit/Toleranz, Zusatzwinkel inkl. Prusa-Ableitung, Hilfsrechnung und Panels). Echte App: Scheibe mit Ø-5-Loch → erkannt (4,99), erwartet 4,79, nach „vergrößern“ 5,19; Fase 43°: 8 → 0 Stützen mit Regel; Schrägfläche 39°: 20 → 0 Stützen mit 30° Zusatzwinkel, ebene Decken (Tisch) bleiben gestützt (47 → 47).
- **Nicht geprüft:** Druckergebnis (Passung der vergrößerten Bohrungen, Fasen/Überhänge im Druck), Netze echter STEP-Exporte mit gröberer Facettierung (Bohrungen mit wenigen Seiten werden als Freiform übersprungen), Bohrungen in bemalten Modellen (Bemalung wird nach Rückfrage gelöscht).

## Nachtrag 22 (2026-11-26): Bemalen auf Prusa-Niveau, Flächenerkennung
- **Werkzeuge** (Reiter Bemalen, `paint-core.js`, Auswahl `PAINT_MODES` in `workbench.js`, Option `paintMode`): Pinsel (Kugel mit Unterteilung wie bisher), **Dreieck** (ein Dreieck ganz, Zug malt mehrere), **Fläche** (erkannte Fläche), **Füllen** (bis Kante, bisher „Fläche füllen“), **Eimer** (alle verbundenen Dreiecke im selben Zustand, auch leere), **Höhenbereich** (von/bis in mm über dem tiefsten Punkt, Grenzdreiecke werden unterteilt, Rotation des Modells wird beachtet), **Lücken füllen** (kleine, ringsum bemalte freie Inseln bis x mm²). Radierer/Umschalt wirkt bei allen.
- **Flächenerkennung** (`PaintMesh.face`): Eine Ebene wird komplett erkannt (gleiche Normale und Ebene, Abweichung einstellbar, Vorgabe 2°/0,05 mm – auch bei Netzrauschen); sonst die glatt zusammenhängende Rundung bis zur scharfen Kante (Vorgabe 25° Kantenwinkel). Ebene, wenn sie ≥ 90 % der glatten Fläche ausmacht, sonst gekrümmt. Vorschau der Fläche in Gelb beim Überfahren (Fläche, Füllen, Eimer, Dreieck); Flächenwerkzeuge wirken einmal pro Klick.
- Das Speicherformat der Bemalung (Prusa-TriangleSelector-Code) bleibt unverändert, daher laden Projekte wie bisher.
- **Geprüft:** 116 JS-Tests (neu: Dreieck, Fläche eben/mit Rauschen/Stufe/Rundung, Eimer, Höhenbereich, Lücken). Echte App (Prisma mit 16 Dreiecken): Dreieck malt 1, Fläche 2 (ganze Seite), Eimer 16 (alles), Höhenbereich 2–8 mm 10 Dreiecke; keine JS-Fehler.
- **Noch nicht wie Prusa:** Kreis-Cursor (Bildschirmkreis), Ansichtsschnitt beim Malen, Nahtmarkierung/Fuzzy-Skin-Eigenheiten sind unverändert; Lücken-Füllung ist eine eigene Näherung (Fläche in mm², nicht Prusas „gap area“ exakt).
- Anmal-Werkzeuge sind Bilder statt Text (Pinsel, Dreieck, Fläche, Füllen, Eimer); Name und Hinweis stehen im Tooltip und unter der Leiste.
- Dreiecke sichtbar: Beim Bemalen werden die Dreiecke automatisch als feine Linien gezeigt; zusätzlich gibt es in der Ansichtsleiste (neben Einpassen) einen Knopf mit Dreiecks-Symbol (`toggle-triangles`, `state.ui.show_triangles`) für alle Ansichten. Umsetzung `Viewport.setTriangles` (WireframeGeometry je Netz, nicht anklickbar, ab 400.000 Dreiecken aus). Geprüft im Bemalen-Screenshot (Kugel), JS-Tests 116 grün.

## Nachtrag 23 – Dateigröße 1 GB, Stützen-Anzeige
- Modellimport bis 1 GB (`MAX_MODEL_BYTES`), Dreiecksgrenze in `mesh.rs` auf 21,5 Mio. (1 GB binäres STL).
- Stützen-Anzeige: mit 684 Stützen auf 240 000 Dreiecken Rust ≈ 0,2 s, keine JS-Longtasks – Verzögerung nicht reproduziert. Ursache beim Nutzer noch offen.
- Offen: Stützen näher am Bauteil (organischer/konturfolgender Stil) noch nicht umgesetzt.
- Nachtrag 23b (Stützen-Geschwindigkeit, Testdatei `Sstützen-teststl\Stützen.stl`, Stil „Gemischt“, Abstand 1 mm, 1527 Kontakte):
  Ursachen der Minuten-Wartezeit gefunden und behoben: (1) `plan.rs` `route()` suchte nach jedem Fehlschlag alle Wege neu (bis ~100 Runden) – jetzt höchstens `MAX_GIVE_UP_ROUNDS` = 1, Rest wird Pfeiler; (2) Stützköpfe, Baumwurzeln und Verbindungskandidaten laufen auf allen Kernen (`shapes.rs` `par_map`, Thread-lokaler Arbeitsspeicher in `field.rs`); (3) `contact_lines::split` war quadratisch je Spalte (Binärsuche statt Liste), unnötige `on_tip`-Berechnung entfernt, schnelle Hash-Tabellen, Spalten parallel, Zeilen zu Blöcken verbunden. Messung mit `SIMPLIY_PROFILE=<Datei>` (Zeitlog in `plan.rs`).
  Stützen-Grenze 2500 entfernt (`MAX_STORED` 10 Mio., Einstellung „maxSupports“ bis 10 Mio.). Dateigrenze 1 GB.
  Stand: Plan ≈ 13 s, Gesamtansicht ≈ 18 s für diesen Fall (vorher mehrere Minuten) – weiter zu optimieren: Polster/Körper-Netz (2,7 Mio. Ecken).
- Nachtrag 23c: Von Hand gelöschte automatische Stützen merkt sich `Data.erased` (x, y, Kontakthöhe); Neuberechnung durch Einstellungen setzt sie nicht wieder. "Automatische Stützen erzeugen" und "Auto löschen" setzen die Liste zurück. Manuelle Stützen bleiben neben den automatischen erhalten. Test: deleted_automatic_supports_stay_deleted_after_recalculation.
- Nachtrag 23d: Reiter Ändern/Löschen entfernt. Auto und Manuell haben jetzt "Einzeln löschen" und "Bereich wischen" (Op::Wipe: Strich mit gedrückter Maus, ein Neuplan beim Loslassen; Kontakte im Pinselkreis max(3 mm, 2,5 x Abstand) auf der Überhangfläche). E2E am Tisch-Modell: 76 → 67 Stützen (9 entfernt). Offen: Neuplan nach dem Löschen bei Baumstützen mit sehr vielen Kontakten dauert weiter einige Sekunden.
- Nachtrag 23e: Im Reiter Manuell ändert eine Form-/Stil-Einstellung (z. B. Knotenblech) die vorhandenen automatischen Stützen nicht mehr (Op::Setting.keep); nur im Reiter Auto werden sie neu erzeugt.
- Nachtrag 24 (Prüfbericht, alle 3 Punkte bestätigt und umgesetzt): (1) Speichern kopiert die alte workspace.json als .bak und ersetzt sie dann atomar (kein Zeitfenster ohne Datei mehr); fehlende oder beschädigte Datei wird aus der .bak wiederhergestellt, die kaputte bleibt als workspace.json.defekt-<Zeit>. (2) Engine-Neuinstallation: alte Version wird zu <Version>.alt umbenannt, bei Fehler zurückgeholt. (3) Vorschau-Dateien: beim Start alle gelöscht, bei jedem Vorschau-Slicing bleiben nur die neuesten zwei. Tests: workspace_recovery_tests.
- Nachtrag 25 (Funktionsliste aus dem Prüfbericht): **Kalibrierung (nur Flow)**: beide Varianten aus dem eigenen RepRap-Plugin (`Downloads\Reprap-Plugin\source\Kalibrierung`, v2.1.8) nach `frontend/flow-calibration.js` übernommen: Flow-Plättchen (M221-Stufen mit Zahl) und Flow-Test Einzelwand-Box mit Auswertung (neuer Flow = aktuell × Soll / gemessen). Dialog „Kalibrierung“ (`frontend/calibration.js`), G-Code wird per `calibration_save` abgelegt und über „Zum Drucker senden“ übertragen (Druck startet nie automatisch). Start-/Endcode wie im Plugin (Makros 0:/sys/print/start.g, end.g), editierbar. Keine weiteren Kalibrierungen. **Wiederholen** (Strg+Y / Strg+Umschalt+Z, Button) neben Rückgängig. **Beste Lage (automatisch)** (`frontend/orientation.js`): bewertet 6 Achsen und die 12 größten Ebenen nach Überhangfläche, Aufstandsfläche und Höhe; Näherung, keine Stützplanung. Tests: flow-calibration, redo, orientation.
  Noch offen aus der Liste: ausgebaute Prozesszonen, intelligente Plattenanordnung, vollständiger 3MF-Projektimport, Direktdruck (Netzwerk/USB starten), erweiterte Schneidefunktion.
- Nachtrag 26: (1) **Native Prozesszonen** aus `Simpliy_Native_Prozesszonen_Alpha15_Patch.zip` eingespielt (Trockenlauf ok, Sicherungen: `Sicherungen\vor-nativen-zonen` und `..\Simpliy-Slicing-Backups\native-zones-…`): Zonen laufen als native Höhenbereiche der Engine in einem Slice (mehrere Zonen je Modell, verschiedene Zonen je Modell, mehrere Werkzeuge/Stützen nicht mehr pauschal gesperrt). Neuer echter Engine-Test `native_zones_two_objects_real_engine`: Objekt A (Zone 5 Wände/90 %) 805 vs. B (1 Wand/5 %) 139 Extrusion in der Zone, darunter gleich (286 vs. 282). Offen aus ABNAHME.md: Fälle 6–8, 12–15, 17 nicht einzeln geprüft. (2) **Direktdruck als zweite Option**: „Hochladen und drucken …“ mit Bestätigungsdialog (Duet Board/SBC, OctoPrint, Moonraker, PrusaLink); „Zum Drucker senden“ lädt weiter nur hoch. Test `explicit_start_is_sent_only_when_asked`. USB-Direktdruck nicht umgesetzt (Streaming über die serielle Schnittstelle braucht ein eigenes Sicherheitskonzept). (3) **Erweiterter Schnitt**: Achse X/Y/Z, Neigung ±60°, `volume.orientation`, `keptPlanes` statt Z-Bereich (Lage, Viewport-Clipping). Slicen eines geneigten Schnitts mit der echten Engine noch nicht geprüft.
- Nachtrag 27: Prozesszonen Stufe 2: Temperatur, Bett, Lüfter, Leerfahrt-/Stütz-/Retract-Tempo je Zone per kontrollierter Nachbearbeitung (src-tauri/src/zonepost.rs, nach Bauteil/Schicht/Werkzeug/Bahntyp, Text-G-Code und BGCODE); Konflikte zwischen Bauteilen werden gemeldet. Engine-Tests: zone_post_real_engine, native_zones_support_across_boundary, native_zones_two_tools_real_engine, native_zones_raft_real_engine. Vollständige Tabelle je Parameter: docs/PROZESSZONEN-PARAMETER.md. Keine echten Drucktests.
- Nachtrag 28: Höhenbezug der Zonen festgelegt und gemessen (gedruckte Unterkante; Raft verschiebt um die Raft-Höhe), zonepost rechnet gleich; alle fünf eigenen Stützformen mit Zone gesliced (Konservativer Kontakt: 0,2 mm tiefer mit variabler Schichthöhe); BGCODE zurückgelesen; Geschwindigkeits-Grenzen (Maschine, Volumenstrom, Kühlzeit) in zonepost; Parameter-Einordnung in docs/PROZESSZONEN-PARAMETER.md. Offen: Zonenquader im Viewport mit Raft-Versatz, weitere Stützfälle, echte Drucktests.
- Nachtrag 29: Zonenquader mit echter Raft-Höhe aus dem G-Code (partBottom), Schätzung vor dem Slicen; Kontaktabstand eigener Stützen nach lokaler Schichthöhe (range_spans, local_layer/grid_uncertain in supports/plan.rs); Zonenwerte neu: Flow, Pressure Advance, Beschleunigung je Bahntyp (zonepost). Tests: zone_post_flow_real_engine, own_supports_with_zones_real_engine (fern/nah).
- Nachtrag 30: Stützen-Schnellansicht: Solange die genaue Planung läuft (support-client pending), zeichnet der Viewport alle Stützen aus den gespeicherten Positionen als Kopien einer Grundsäule (THREE.InstancedMesh, ein Draw-Call, frontend/support-plate.js quickSupports, viewport.setQuickSupports). Erzeugen, Löschen und Wischen sind damit sofort sichtbar; die genaue Ansicht (Äste, Kontaktflächen) ersetzt sie, sobald Rust fertig ist. Getestet mit Stützen.stl gedreht, Gemischt, Abstand 1 mm: 6181 Stützen sofort sichtbar.

## Transformationskorrektur (2026-11-27)
- X/Y/Z im Verschieben-Dialog sind jetzt absolute Druckbettkoordinaten wie bei Simplify3D. Z=0 entspricht der Bettoberfl�che; �ltere Projekte mit `sink` bleiben lesbar.
- Skalieren wirkt entlang der Bett-/Weltachsen statt entlang lokaler, bereits gedrehter Modellachsen. Dadurch behalten die X/Y/Z-Felder nach einer Drehung ihre Bedeutung.
- Neue JS-Pr�fung `transform Z is an absolute build-plate coordinate`; Geometrie-, Orientierungs- und Zonen-Tests bleiben gr�n.
- Vorschau-/Zonenpfad wurde erneut gepr�ft: 147 JS-Tests und 183 Rust-Tests (davon 22 bewusst markierte Engine-/Fixture-Tests ignoriert) laufen ohne Fehler. Eine echte GUI-Viewport-Pr�fung ist in dieser Umgebung nicht m�glich.
