# Simpliy Slicing Alpha 2 – Serielle USB/COM-Steuerung: Grundgerüst

**Enthalten:** eigene Rust-Seriell-Komponente und eine native Simpliy-Bedienoberfläche. **Nicht enthalten:** unbeaufsichtigtes Drucken über USB.

## Bereits vorbereitet

- COM-Ports und USB-Geräte unter Windows erkennen; manueller COM-Port und Baudrate.
- Verbindung öffnen/schließen; je ein aktiver Port; Fehlerstatus und Ringpuffer für die letzten 60 Empfangszeilen.
- Sichere Abfragen nach Marlin-Konvention: `M105` (Temperatur), `M114` (Position), `M115` (Firmware), `M27` (SD-Druckfortschritt).
- Automatische Abfrage von `M105` im Abstand von circa vier Sekunden, sobald der Controller nach dem Verbindungsaufbau bereit sein sollte.
- Im Gerätetreiber eingestellter Lese-Timeout, geregelter Worker-Thread, Zeilenlängenbegrenzung, Antwort-Timeout, kein paralleles Schreiben.
- Sichtbarer USB/COM-Monitor in Simpliy, ohne Änderungen an PrusaSlicer oder dem Drucker-/Prozessprofil.
- Code-Aufteilung: `src-tauri/src/serial_control.rs`, `frontend/serial-panel.js`, `frontend/serial-panel.css`.
- Rust-Einheitstests für Temperaturparser, SD-Fortschritt und Abfrage-Allowlist.

## Bewusst noch gesperrt

- Keine Bewegungs-/Home-/Extruder-/Heizbefehle, keine beliebige G-Code-Konsole.
- Kein Streamen einer fertigen G-Code-Datei, daher kein Druckfortschritt des Host-G-Code-Streams.
- Keine Pause/Fortsetzung, keine Wiederaufnahme nach Verbindungsabbruch, keine Host-Job-Warteschlange.

Diese Funktionen benötigen ein protokolltreues Drucker-Backend: Marlin-`ok`-Flusskontrolle, `Resend` mit nummerierten Befehlen und Checksummen, Bufferlimits, Druckzustände, Temperatur-/E- und Homing-Sicherheitsregeln, reguliertes Disconnect-Verhalten und Testfälle mit realer Hardware. Firmwareabhängige Varianten müssen als explizite Adapter implementiert werden, nicht mit ungesicherten Pauschalkommandos.

## Nach dem Einspielen

1. Vollständigen Windows-Build erstellen. Das neue Rust-Paket `serialport` muss bei der ersten Erstellung geladen werden; `Cargo.lock` wird gegebenenfalls aktualisiert.
2. Drucker per USB verbinden. Achtung: Schon das Öffnen eines COM-Ports kann über DTR einen Firmware-Neustart auslösen.
3. In Simpliy oben `USB / COM` wählen, `Ports suchen`, COM-Port und Baudrate auswählen, dann `Verbinden`.
4. Firmware und Temperaturen nur an einem beaufsichtigten Drucker prüfen. Bei Klipper/RepRapFirmware können Antworten abweichen; für Duet ist die vorhandene Netzwerk-Steuerung vorzuziehen.
5. Besonders `M27` ist **SD-Karten-Fortschritt**, kein Fortschritt eines Host-USB-Druckauftrags.

**Tests:** `node --check frontend/app.js`, `node --check frontend/serial-panel.js`, `cargo test --manifest-path src-tauri/Cargo.toml serial_control` und normaler Windows-Build. Ein echter USB-Drucktest ist nicht Bestandteil dieses Patches.

**Sicherheit:** Bei Kommunikationsfehlern nicht automatisch fortsetzen; der Benutzer muss den aktuellen Maschinenzustand prüfen. PrusaSlicer bleibt die separate Slicing-Engine.
