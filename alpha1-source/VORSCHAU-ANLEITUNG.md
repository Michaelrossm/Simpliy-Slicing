# Aktuelle Vorschau- und Exportbedienung (22.11.2026)

"Jetzt slicen" und "Alle Platten slicen" bereiten G-Code im temporaeren Arbeitsbereich vor, ohne einen Speicherort abzufragen. Nach dem Slicing oeffnet sich die Schichtvorschau. "G-Code speichern" exportiert das vorbereitete Ergebnis erst nach Auswahl eines Ziels; vorhandene Dateien werden nicht ueberschrieben. "Zum Drucker senden" ist ein gesonderter Upload und startet den Druck nicht automatisch. Beim Binary-Format wird zusaetzlich eine Textversion fuer die Vorschau erstellt; exportiert bzw. hochgeladen wird das ausgewaehlte Binaerformat.

Seit 0.11.0: keine Kuerzung, Abspielen, acht Farbansichten. Aeltere Grenzangaben unten gelten nicht mehr.

In der Vorschau: Modell / Schichten zum Wechseln, "Vorschaumodus verlassen" fuer die Bearbeitung, Regler fuer den Schichtbereich, Wegfilter, Leerfahrten, Farblegende und Farben nach Wegtyp, Geschwindigkeit, berechnetem Volumenfluss oder Schichthoehe. Die aktuelle Schicht ist heller, darunterliegende Schichten sind abgedunkelt. Beleuchtung und Schatten wirken auf die raeumlich dargestellten Bahnen und die Modelloberflaeche; das Bett empfaengt keinen Bauteilschatten. Grossansichten zeigen hoechstens 250000 Bahnen und priorisieren die aktive Schicht; zur genaueren Ansicht den Schichtbereich eingrenzen.

Validiert: echter Prusa-3.0.0-alpha14-Workflow mit temporaerem Slicing und gesondertem, bytegleichem Export fuer Text- und binaeren G-Code; vorhandene Dateien werden nicht ueberschrieben. JavaScript- und Rust-Tests pruefen u. a. Rueckweg zur Modellansicht, Plattenwechsel, Schichtbereich, Legende und hervorgehobene Geometrie. Visueller End-to-End-Test im Windows-Fenster war nicht moeglich, da Computer Use nicht erreichbar ist. Der offene Simpliy-Prozess hielt die normale EXE beim Build gesperrt; nach dem Schliessen und Neustart ueber Starten-Windows.cmd wird die aktuelle Version gebaut und geladen.

