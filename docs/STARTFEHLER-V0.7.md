# Diagnose zum Fehler `No module named desktop`

Diese Meldung betrifft **nur** den alten Tkinter-Prototyp v0.7.

`python -m desktop.app` findet `desktop` nicht im Python-Suchpfad. Häufige Gründe: ZIP nicht vollständig entpackt, `Starten.cmd` in einem anderen Ordner, `desktop`-Verzeichnis fehlt.

Der korrigierte v0.7.1-Launcher setzt `%~dp0` und `PYTHONPATH` explizit und prüft, ob `desktop/app.py` überhaupt vorhanden ist. Die Meldung bedeutet nicht automatisch, dass Tkinter fehlt oder Python 3.14 inkompatibel ist.

Die künftige v0.8-Architektur verwendet **kein Python**: Ein Tauri-Programm kann nicht durch die alte `Starten.vbs` gestartet werden.
