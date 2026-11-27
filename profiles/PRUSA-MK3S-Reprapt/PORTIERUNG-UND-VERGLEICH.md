# Portierung PRUSA-MK3S-Reprapt

Stand 21.11.2026. Quelle: Original.fff, S3D 5.1.2. Die Ablage enthaelt das unveraenderte Original, einen Simpliy-Teilport und einen Prusa-3.0-alpha14-Konfigurationsentwurf fuer PETcF / Medium. **Keine Druckfreigabe:** Makroinhalt, Firmware, 0,5-mm-Duese und 300-Grad-Faehigkeit des konkreten Umbaus sind nicht verifiziert.

## Was beim Test im G-Code nachgewiesen wurde

| Aus S3D | Ziel / Wirkung im Test | Bewertung |
|---|---|---|
| Duese 0,5 mm | nozzle_diameter = 0.5 | Uebernommen; die Ausgangsbasis war 0,4 und wurde geaendert. Prusa-3.0-Voreinstellungsmetadaten verweisen noch auf die 0,4-mm-Variante; deshalb Entwurf. |
| Schicht 0,10 mm, erste Schicht 140 % | layer_height = 0.1; erste Schicht 0,14 mm | Im erzeugten G-Code nachgewiesen. |
| 2 Perimeter, 3 oben/unten, 20 % | Prusa-Konfiguration | Felder gesetzt; Toolpath-Gleichheit noch nicht nachgewiesen. |
| PETcF 299 / 300 C, Bett 95 C | erste / weitere Schicht und M98 S95 H299 | Werte uebernommen, Maschinen- und Materialeignung nicht nachgewiesen. |
| Multiplikator 0,91 | extrusion_multiplier = 0.91 | Wert im G-Code dokumentiert. |
| Retract 1 mm, 2460 mm/min | 1 mm, 41 mm/s | Im G-Code sichtbar; Verhalten von Coasting/Wipe ist anders. |
| absolute Extrusion | M82 | Im G-Code sichtbar. |
| Startmakro | M98 P"0:/sys/print/start.g" S95 H299 X115 Y95 I135 J115 | Platzhalter fuer ersten Layer expandiert; Makroinhalt und Bedeutung der Boundingbox nicht geprueft. |
| Endmakro | M98 P"0:/sys/print/End.g" | Aufruf uebernommen; Existenz und Inhalt nicht geprueft. |
| Geschwindigkeit 5160 mm/min | 86 mm/s, pro Typ Faktoren teilweise berechnet | Ansatzwerte, Kuehlung / Beschleunigung und Engine koennen Ergebnisse veraendern. |

Die Prusa-Makros fuer erste Schicht und Material wurden anhand der [offiziellen Platzhalterliste](https://help.prusa3d.com/article/list-of-placeholders_205643) umgeschrieben. Die Bauteilgrenzen fuer die erste Druckschicht sind nicht zwingend identisch mit S3Ds Gesamt-Bauteilgrenzen. Prusa erzeugt zusaetzlich M73, M486 und M204; deren Eignung fuer die konkrete RRF-Konfiguration ist noch nicht bestaetigt. Ein ungefragt geerbtes M572 wurde im zweiten Test deaktiviert.

## Ausgewaehlte automatische Konfigurationen

Material PETcF, Qualitaet Medium, Ergaenzung Brim, Prozessaenderung Teil1. Achtung: Die gewaehlte S3D-Option Brim setzt gleichzeitig useSkirt=0 und useRaft=0; ein Brim darf daraus nicht automatisch abgeleitet werden. Der Prusa-Entwurf verwendet deshalb keinen Brim.

S3D bietet 18 Materialoptionen, 5 Qualitaetsoptionen, 5 Ergaenzungen und 6 Prozessoptionen. Der Simpliy-Teilport enthaelt die Materialnamen, Temperaturen, Bettwerte, Multiplikatoren und Retracts sowie die grundlegenden Qualitaetswerte. Er ist nur eine Bearbeitungs-/Importvorlage: Die Simpliy-Oberflaeche uebergibt ihre Profilparameter aktuell nicht vollstaendig an die Engine. Ergaenzungsoptionen, Makrovarianten, Fan-Zeitplaene und Prozessaenderungen sind darin noch nicht funktional uebernommen; Original und vollstaendige Liste bleiben erhalten.

| Material | Duese: Schicht:Temperatur | Bett: Schicht:Temperatur | Multiplikator | Retract mm |
|---|---|---|---|---|
| PLA | 1:216 | 1:55 | 0.89000 | 0.70000 |
| ABS | 1:255 | 1:100 | 0.89000 | 0.80000 |
| PET | 1:256 | 1:75 | 1.00000 | 0.80000 |
| Nylon | 1:220 | 1:80 | 0.89000 | 0.80000 |
| TPU 82A | 1:270 | 1:30 | 0.89000 | 0.80000 |
| Easy ABS-Sunlu | 1:260 | 1:55 | 0.93000 | 0.80000 |
| pet-amazon-grau | 1:260 | 1:75 | 0.98000 | 0.80000 |
| Fiberflex-cr20-cr | 1:285 | 1:65 | 0.89000 | 1.00000 |
| Prusa-PC-Blend_CF_Black | 1:299; 2:298 | 1:103 | 1.05000 | 0.90000 |
| petg-owl | 1:275 | 1:75 | 0.88000 | 0.80000 |
| PETG-schwarz jayo | 1:255 | 1:77 | 0.98000 | 0.80000 |
| CR-Pla-weiß | 1:220; 2:216 | 1:54 | 0.95000 | 0.70000 |
| Pla Overture-schwarz | 1:218; 2:214 | 1:54 | 0.93000 | 0.70000 |
| Pla-dual-esun | 1:216; 2:214 | 1:54 | 0.91000 | 0.70000 |
| CR3d Petg sonder | 1:285; 2:290 | 1:75 | 0.91000 | 0.80000 |
| TPu 85 CR3d natur | 1:230 | 1:50 | 1.02000 | 0.30000 |
| PETGx Flam-schwarz | 1:290 | 1:72 | 0.98000 | 0.80000 |
| PETcF (aktiv) | 1:299; 2:300 | 1:95 | 0.91000 | 1.00000 |

Doppelpunkte in den Temperaturspalten trennen Schichtnummer und Temperatur; mehrere Paare sind durch Semikolon getrennt. Die Rohinventur liegt in S3D-Autokonfigurationen.json.

## Was noch nicht gleichwertig portiert ist

- S3D-Coasting 0,1 mm: kein nachgewiesener gleichwertiger Prusa-3.0-Parameter; nicht stillschweigend durch Wipe ersetzen.
- Wipe 1 mm und waehrend Wipe retract: die beiden Engines definieren und planen dies unterschiedlich; noch nicht gleichgesetzt.
- Fan-Zeitplaene, variable Luefter fuer Bruecken/Top-Layer und Schnellschichten: nicht vollstaendig identisch uebernommen.
- S3D-Startcode ist pro Material teils unterschiedlich; einige Varianten referenzieren weitere Makros wie z_tilt.g, adaptive_mesh.g und Nozzel.g. Nicht durch den PETcF-Start ersetzen.
- S3D-Supportdichte, Abstand in Schichten, Dense Support und Support-Geometrie: keine sichere Eins-zu-eins-Umrechnung. Die Simpliy-Uebergabe fuer Supportwerte ist noch blockiert.
- Geschwindigkeiten werden in S3D in mm/min, in Prusa oft mm/s angegeben. Kuehl-, Beschleunigungs- und Limitlogik unterscheiden sich. Maximalflusswert 492 ist in der Quelle vorhanden, Einheit/Interpretation wurde nicht verifiziert; der uebrig gebliebene Prusa-PLA-Limitwert im Entwurf ist kein validierter PETcF-Wert.
- Alle restlichen Quelleinstellungen inklusive Raft, Brim, Skirt, duenne Waende, Naht, Maschinenlimits und individuelle Skripte muessen einzeln geprueft werden.

## Vergleich der Programme (Funktionsumfang, nicht Uebernahmegarantie)

| Thema | Simplify3D V6 | PrusaSlicer / Stand Simpliy |
|---|---|---|
| Stuetzerzeugung | V6 bewirbt unterschiedliche Stuetzentypen und direkte Bearbeitung. | Prusa bietet u. a. organische Stuetzen und Support-Painting; Simpliy hat eigene Stuetzerzeugung noch nicht implementiert. |
| Regionale Einstellungen | S3D-Prozesse und Parameterbereiche. | Prusa hat Objekt-/Volumenmodifikatoren; kein automatischer 1:1-Import des Prozesssystems. |
| Benutzerdefinierte Stuetze | S3D unterstuetzt individuelle Formgebung. | Prusa bietet Bemalung sowie Enforcer/Blocker; ein externes Modell als Enforcer ist keine Garantie fuer identische Stuetzekoerper. |
| Vorschau | Werkzeugwegfarben und Schichtvorschau. | Prusa hat Werkzeugwegvorschau; Simpliy zeigt aktuell Wegtyp, Geschwindigkeit und berechneten Volumenfluss, mit technischen Grenzen. |
| Scripting | S3D-Syntax und externe Maschinenmakros. | Prusa hat andere Platzhalter und bedingte Makros; Maschinenmakros und firmwareabhaengige Befehle sind separat zu pruefen. |
| Profile | XML-FFF mit mehreren Auto-Konfigurationskategorien. | Prusa 3 hat getrennte Drucker-, Druck-, Werkzeug- und Materialprofile; Simpliy hat einen unvollstaendigen Teilport. |

Herstellerquellen: [Simplify3D V6](https://www.simplify3d.com/simplify3d-launches-version-6-0-with-next-generation-support-structures-and-full-3d-machine-simulation/), [Simplify3D Features](https://www.simplify3d.com/products/simplify3d-software/features/), [Prusa Support](https://help.prusa3d.com/article/support-material_1698), [Paint-on supports](https://help.prusa3d.com/article/paint-on-supports_168584), [Prusa Makros](https://help.prusa3d.com/article/macros_1775). Ein vollstaendiger V6-zu-Prusa-3.0-Vergleich ist hier nicht behauptet.
