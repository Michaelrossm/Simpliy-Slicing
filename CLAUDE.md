# Claude Code – Simpliy Slicing

- Name ausschließlich **Simpliy Slicing**.
- Technische Hauptbasis: Rust + Tauri 2 + WebView, **kein Tkinter**, kein separat laufender Python-HTTP-Server. Der Browser war UI-Prototyp, nicht die Ziel-Laufzeit.
- Slicing-Engine: externer installierter PrusaSlicer **3.0** (C++), kein Fork ohne nachgewiesenen Bedarf. Keine Behauptung vollständiger CLI-Integration vor realem Test.
- UI: S3D-ähnliche **Bedienung**, keine kopierten Markenassets. Links Modelle/Prozesse; mittig 3D; rechts außen Icon-Leiste; direkt links davon einblendbares Toolpanel; unten Schnellleiste.
- Tool- und 3D-Aktionen als ungeprüft/noch nicht umgesetzt kennzeichnen; keine Fake-G-Code-Erzeugung.
- Sämtliche Parameter in normalen Registerkarten. Auto-Configure ist eine Kategorie beliebiger Wertzuweisungen, nie ein separater Parametereditor. Beliebig viele Kategorien, Optionen und Doppelzuweisungen; deterministische Priorität.
- Eigene `.simpliyprofile`-Archive (ZIP), Prusa-INI nur Import. Niemals Prusa-Originalprofile überschreiben.
- Bestehende `%APPDATA%/SimpliySlicing/workspace.json` nicht unbemerkt migrieren/löschen. Backups vor Schemawechseln. Keine Secrets exportieren.
- Nach Änderungen: JavaScript-Tests; Rust cargo check auf einer installierten Toolchain, Windows-Build/CI prüfen. Tests ehrlich dokumentieren.
- SSC Cleaner ist **kein Teil dieses Projekts**. Nur falls später zwingend nötig und lizenzverträglich einzelne Quellcodeteile separat evaluieren.
