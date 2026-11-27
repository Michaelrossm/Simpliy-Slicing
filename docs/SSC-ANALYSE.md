# SSC Cleaner: Was passt in Simpliy Slicing?

Stand 2026-11-26. Grundlage: Struktur und Dokumentation von `F:\STEP-Surface-Cleaner` (Paket `surface_cleaner`: core, mesh,
recognition, native_step, brep, repair, validation, features, gpu, ai, gui, expert). Den Code habe ich nach Aufbau und
Zweck gesichtet, nicht Zeile für Zeile übernommen.

## Kurzfassung
SSC Cleaner baut aus Netzen **CAD-Körper (STEP)**: Flächenerkennung (Ebene, Zylinder, Kegel, Torus, Freiform), B-Rep mit
Nähten, strenge Prüfungen (BRepCheck, Boolesche Operationen, Toleranzen). Ein Slicer braucht davon nur die **Netzanalyse**,
nicht den CAD-Aufbau. Fast alles Fortgeschrittene (B-Rep, NURBS, STEP-Ein-/Ausgabe, Prüfungen, GPU/KI) ist für Simpliy
nicht sinnvoll: Es hängt an Python, OpenCascade (OCP), VTK und Qt (hunderte MB) und löst ein anderes Problem.

## Was Simpliy schon hat (kein Bedarf)
Netz verschweißen, Löcher schließen, Flächen umdrehen, Hüllen trennen (`repair.rs`); Überhangflächen als zusammenhängende
Gruppen, freie Unterkanten und tiefste Punkte (`supports/placement.rs`).

## Übernommen (neu, getestet)
**Flächenerkennung für Überhänge** (`supports/surface_kinds.rs`), nach dem Prinzip der Erkennung in SSC: Die Streuung der
Flächennormalen (Eigenwerte der Kovarianz) trennt Ebene / Zylinder / Freiform, eine Kreisanpassung (Kasa) misst den
Durchmesser. Eine waagerechte, nach innen zeigende Zylinderfläche ist die **Decke einer Bohrung**.
- Nutzen: Kleine Rundbögen und Bohrungen druckt man ohne Stütze; Stützen darin sind kaum entfernbar.
- Option im Stützen-Panel (Platzierung › Regeln): „Bohrungen nicht stützen bis Ø“ (0 = aus, Vorgabe aus).
- Messung an synthetischen Tunneln: Ø 6,0 mm → 5,99 mm, Ø 16,0 mm → 15,97 mm. In der echten App: Tunnel Ø 6 mm mit Grenze
  12 mm: 30 → 0 Stützen; Tunnel Ø 16 mm: bleibt bei 43. Ebenen (auch geneigte) werden an den Testmodellen als Ebene erkannt.

## Geprüft, aber nicht übernommen – mit Grund
| SSC-Funktion | Entscheidung |
|---|---|
| Kantenklassen (konvex/konkav/frei/nichtmanifold) | Für Stützen bringen sie nichts Neues: Die vorhandene Erkennung freier Unterkanten prüft Grat und Neigung direkt. Nützlich später für die Nahtposition (Naht in konkave Ecke) – eigener Schritt. |
| B-Rep, NURBS, STEP-Schreiben, BRepCheck/BOP | Kein Slicer-Thema. |
| GPU-/KI-Vorschläge (Michael3D-Modell) | Zusatzlaufzeit (Torch) unverhältnismäßig; Nutzen für Slicing unbelegt. |
| Freiform-Charts (B-Splines) | Für Stützen nicht nötig; die Facetten reichen. |
| Zylinder-/Kegelnähte, Toleranzbudgets | Nur beim CAD-Aufbau relevant. |

## Danach umgesetzt (2026-11-26)
1. **Bohrungen** (`src-tauri/src/holes.rs`): erkennt senkrechte/waagerechte/schräge Bohrungen (glatte Flächenstücke, Zylinderanpassung, voller Umfang), zeigt Ø, Lage, Länge und das **erwartete Druckmaß**, rechnet Prusa-Ausgleiche (`xy_size_compensation`, `filament_shrinkage_compensation_xy`) mit ein, warnt bei sehr kleinen Bohrungen und vergrößert auf Wunsch als Kopie (Reparatur-Werkzeug › Bohrungen).
2. **Fasen** (`chamfers` in `surface_kinds.rs`): schmale ebene Streifen knapp unter der Überhangschwelle (Vorgabe: bis 3 mm Breite, bis 5° steiler) werden nicht gestützt.
3. **Druckbarer Überhang einstellbar:** „Zusätzlich druckbar“ (0–30°) und optional aus den Prusa-Überhangparametern des Prozesses abgeleitet.

## Weitere Kandidaten (noch nicht gebaut)
3. **Nahtposition** an erkannten Kanten (Kantenklassen) – Prusa hat eigene Optionen; Mehrwert prüfen.
4. **Dünnwand-/Feinstrukturanalyse** (`scan_analysis`) als Warnung vor dem Slicen.

## Ehrliche Grenzen
- Die Zylindererkennung braucht genug Dreiecke (≥ 6) und eine annähernd kreisförmige Anpassung (Abweichung ≤ 8 % des Radius);
  grobe Netze mit wenigen Facetten werden als Freiform behandelt und weiter gestützt (sicherer Weg).
- Erkannt wird nur die Bohrungsdecke der **Überhangfläche** (Normalen zeigen nach unten). Senkrechte Bohrungen brauchen
  keine Stütze und werden nicht angefasst.
- Noch nicht an Netzen echter Teile (nur synthetische Tunnel und Testmodelle) geprüft.
