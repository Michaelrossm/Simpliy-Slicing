# Simpliy Slicing v0.8 – Architekturentscheidung

Der Wechsel zu Tkinter (v0.5–v0.7) war eine temporäre Abweichung. Die verbindliche Zielarchitektur ist jetzt:

```
[ Tauri-Nativfenster / Windows WebView2 ]
       │ HTML / CSS / JavaScript / WebGL später
       ▼
[ Profil- und Auto-Configure-Editor ]
       │ invoke (Tauri)
       ▼
[ Rust-Dienstlogik: lokale Profile, Import/Export, Prozesse ]
       │ später: vorgeprüfte CLI-Argumente / temporäre Dateien
       ▼
[ Extern installierter PrusaSlicer 3.0 – C++ – Headless Slicing ]
```

Prusa wird **nicht** in unsere EXE eingebettet oder über die GUI ferngesteuert. Native Prusa-Toolpanels werden später durch unsere kontextabhängigen Werkzeuge nachgebaut und an die vorhandenen Schnittstellen angepasst, nicht durch die ursprünglichen wxWidgets in eine WebView transplantiert. Dies ist viel Entwicklungsarbeit: Die CLI bildet nicht automatisch alle GUI-Aktionen ab.

Derzeit gibt es kein echtes Slicing und keine druckfähigen Support-Objekte. Alle UI-Felder sind zunächst geplanter Zustand. Verbindliche Prusa-Funktionsparität kann erst nach CLI-Verifikation und Ergebnistests behauptet werden.
