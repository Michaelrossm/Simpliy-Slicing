SIMPLIY SLICING – SPRACHUPDATE 0.0.0-alpha.2
============================================

WAS IST ENTHALTEN?
- Eine Sprachwahl oben rechts: Automatisch (Windows-Sprache), Deutsch, Englisch.
- Wechsel der Sprache direkt im laufenden Programm ohne Neustart.
- Sprachwahl global im WebView2-Profil gespeichert; kein Eingriff in Druckprozesse.
- Mehr als 200 eigene UI-Übersetzungen, plus englische Originale der Engine-Einstellungen
  aus der separat installierten PrusaSlicer-.mo-Datei.
- Keine Prusa-Dateien oder Prusa-Profile werden verändert oder mitgeliefert.

WICHTIG: DIES IST EIN QUELLCODE-UPDATE, KEINE FERTIGE WINDOWS-EXE.
Die unveränderte bisherige EXE lässt sich nicht dadurch aktualisieren, dass man
Dateien neben sie kopiert. Zum Erzeugen einer neuen EXE ist ein Windows-Build nötig.

INSTALLATION
1. ZIP entpacken.
2. "Installieren-und-Bauen.cmd" starten.
3. Den Ordner mit dem AKTUELLEN Simpliy-Quellcode angeben. Dieser Ordner muss
   "frontend/app.js" und "src-tauri/src/lib.rs" enthalten.
4. Das Update sichert die Originaldateien im Quellcode unter "Sicherungen".
5. Bei installiertem Rust, Node.js und Tauri-Build-Setup startet der vorhandene
   "Build-Windows.cmd" den Windows-Build.
6. Das Build-Ergebnis liegt im Quellcode unter
   "src-tauri/target/release/bundle/".

Wer zuerst nur das Update einspielen will, nutzt "Installieren-ohne-Build.cmd".

GRENZEN
Die Sprachumschaltung deckt zentrale Oberfläche und viele Einstellungsbezeichnungen ab.
Einzelne dynamische Texte, Fehlerhinweise oder seltene Spezialdialoge können noch
Deutsch enthalten. Das ist ein aus dem GitHub-Stand vom 24.11.2026 abgeleiteter Patch;
keine fertige EXE und kein hier unter Windows erfolgreich validierter Build.

Das Update nicht auf das öffentliche GitHub-Repository anwenden, sondern nur auf den
lokalen Quellcode. Bestehende EXE und Prusa-Installation bleiben unangetastet.

Falls eine Meldung "Unpassender Quellcode" erscheint, wurde deine Datei seit dem
zugrunde gelegten Stand geändert. Der Installer bricht dann VOR den Änderungen ab.
