# Simpliy Slicing - Entwicklungsstand

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
