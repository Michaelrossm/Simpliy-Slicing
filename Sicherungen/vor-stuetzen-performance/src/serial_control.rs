//! Simpliy USB/COM monitor: deliberately separate from the PrusaSlicer engine.
//! Alpha-2 foundation, NOT a host G-code print streamer. Read-only query allowlist.
//! No G28/G0/G1/M104/M109/M140/M190 or raw arbitrary G-code is accepted.
use serde::Serialize;
use std::{
    io::{Read, Write},
    sync::{mpsc, Arc, Mutex, OnceLock},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const MAX_LINES: usize = 60;
const MAX_LINE_BYTES: usize = 1536;
const READ_TIMEOUT: u64 = 140;
const POLL_INTERVAL: Duration = Duration::from_secs(4);
const ACK_TIMEOUT: Duration = Duration::from_secs(6);
const VALID_BAUD: [u32; 6] = [9600, 57600, 115200, 230400, 250000, 500000];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub name: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SerialSnapshot {
    pub connected: bool,
    pub port: String,
    pub baud: u32,
    pub nozzle: Option<f64>,
    pub nozzle_target: Option<f64>,
    pub bed: Option<f64>,
    pub bed_target: Option<f64>,
    pub sd_progress: Option<f64>,
    pub position: Option<String>,
    pub firmware: Option<String>,
    pub last_response: String,
    pub last_error: String,
    pub log: Vec<String>,
    pub updated_at_ms: u64,
    pub mode: String,
}

impl SerialSnapshot {
    fn new(port: String, baud: u32) -> Self {
        Self { connected: true, port, baud, mode: "monitor-only".into(), ..Self::default() }
    }
    fn note(&mut self, line: String) {
        if line.trim().is_empty() { return; }
        self.last_response = line.clone();
        self.updated_at_ms = SystemTime::now().duration_since(UNIX_EPOCH)
            .unwrap_or_default().as_millis().min(u128::from(u64::MAX)) as u64;
        self.log.push(line);
        let excess = self.log.len().saturating_sub(MAX_LINES);
        if excess > 0 { self.log.drain(..excess); }
    }
    fn receive(&mut self, line: &str) {
        self.note(line.to_owned());
        // Marlin usually reports: "ok T:210.0 /215.0 B:60.0 /60.0 ..."
        if let Some((now, target)) = parse_temperature(line, "T:")
            .or_else(|| parse_temperature(line, "T0:")) {
            self.nozzle = Some(now);
            if let Some(t) = target { self.nozzle_target = Some(t); }
        }
        if let Some((now, target)) = parse_temperature(line, "B:") {
            self.bed = Some(now);
            if let Some(t) = target { self.bed_target = Some(t); }
        }
        if line.contains("X:") && line.contains("Y:") && line.contains("Z:") {
            self.position = Some(line.chars().take(200).collect());
        }
        if let Some(ix) = line.find("FIRMWARE_NAME:") {
            self.firmware = Some(line[ix..].chars().take(200).collect());
        }
        if let Some(progress) = parse_sd_progress(line) { self.sd_progress = Some(progress); }
        if line.starts_with("Error:") || line.starts_with("!!") {
            self.last_error = line.chars().take(250).collect();
        }
    }
}

fn parse_temperature(line: &str, key: &str) -> Option<(f64, Option<f64>)> {
    // Ensure T: is a distinct token, not the tail of a field name.
    let start = line.match_indices(key).find(|(at, _)|
        *at == 0 || !line.as_bytes()[*at - 1].is_ascii_alphanumeric())?.0;
    let rest = line.get(start + key.len()..)?.trim_start();
    let current = rest.split_whitespace().next()?.trim_end_matches(',').parse::<f64>().ok()?;
    if !current.is_finite() { return None; }
    let first = rest.split_whitespace().next()?;
    let target = rest.get(first.len()..).unwrap_or("")
        .trim_start().strip_prefix('/')
        .and_then(|r| r.trim_start().split_whitespace().next())
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite());
    Some((current, target))
}

fn parse_sd_progress(line: &str) -> Option<f64> {
    let pos = line.find("SD printing byte ")?;
    let rest = &line[pos + "SD printing byte ".len()..];
    let (current, total) = rest.split_whitespace().next()?.split_once('/')?;
    let (current, total) = (current.parse::<f64>().ok()?, total.parse::<f64>().ok()?);
    if total <= 0.0 || !(0.0..=total).contains(&current) { return None; }
    Some((current * 100.0 / total).clamp(0.0, 100.0))
}

enum WorkerMessage { Query(&'static str), Close }

struct Session {
    sender: mpsc::Sender<WorkerMessage>,
    handle: JoinHandle<()>,
    status: Arc<Mutex<SerialSnapshot>>,
}
#[derive(Default)]
struct Manager { session: Option<Session>, last: SerialSnapshot }
static MANAGER: OnceLock<Mutex<Manager>> = OnceLock::new();
fn manager() -> &'static Mutex<Manager> { MANAGER.get_or_init(|| Mutex::new(Manager::default())) }
fn locked() -> Result<std::sync::MutexGuard<'static, Manager>, String> {
    manager().lock().map_err(|_| "USB-Verbindungsverwaltung nicht verfügbar".into())
}

pub fn available_ports() -> Result<Vec<PortInfo>, String> {
    let mut ports = serialport::available_ports().map_err(|e| format!("COM-Port-Liste nicht verfügbar: {e}"))?
        .into_iter().map(|p| {
            let description = match p.port_type {
                serialport::SerialPortType::UsbPort(u) => format!("USB {} {}", u.manufacturer.unwrap_or_default(), u.product.unwrap_or_default()).trim().to_owned(),
                serialport::SerialPortType::BluetoothPort => "Bluetooth".into(),
                serialport::SerialPortType::PciPort => "PCI".into(),
                serialport::SerialPortType::Unknown => "Serielle Schnittstelle".into(),
            };
            PortInfo { name: p.port_name, description }
        }).collect::<Vec<_>>();
    ports.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(ports)
}

pub fn connect(port: String, baud: u32) -> Result<SerialSnapshot, String> {
    if !VALID_BAUD.contains(&baud) { return Err("Nicht unterstützte Baudrate".into()); }
    if port.is_empty() || port.len() > 160 || port.chars().any(char::is_control) {
        return Err("Ungültiger COM-Port".into());
    }
    if !available_ports()?.iter().any(|p| p.name == port) {
        return Err("COM-Port ist nicht in der Geräteliste. Bitte aktualisieren.".into());
    }
    let mut state = locked()?;
    if state.session.as_ref().is_some_and(|s| s.status.lock().map(|v| !v.connected).unwrap_or(true)) {
        // A disconnected worker must not permanently block reconnect after a USB unplug.
        if let Some(old) = state.session.take() {
            let _ = old.sender.send(WorkerMessage::Close);
            let _ = old.handle.join();
            let previous = old.status.lock().ok().map(|v| v.clone());
            if let Some(last) = previous { state.last = last; }
        }
    }
    if state.session.is_some() { return Err("Es ist bereits eine USB-Verbindung vorhanden. Erst trennen.".into()); }
    // Opening a serial port may reset some controller boards by toggling DTR.
    let device = serialport::new(port.as_str(), baud).timeout(Duration::from_millis(READ_TIMEOUT))
        .open().map_err(|e| format!("USB/COM-Verbindung fehlgeschlagen: {e}"))?;
    let status = Arc::new(Mutex::new(SerialSnapshot::new(port, baud)));
    let (sender, receiver) = mpsc::channel();
    let output = Arc::clone(&status);
    let handle = thread::Builder::new().name("simpliy-usb-monitor".into())
        .spawn(move || worker(device, receiver, output))
        .map_err(|e| format!("USB-Überwachung konnte nicht starten: {e}"))?;
    let initial = status.lock().map_err(|e| e.to_string())?.clone();
    state.session = Some(Session { sender, handle, status });
    Ok(initial)
}

pub fn disconnect() -> Result<SerialSnapshot, String> {
    let session = { locked()?.session.take() };
    if let Some(session) = session {
        let _ = session.sender.send(WorkerMessage::Close);
        let _ = session.handle.join();
        let mut current = session.status.lock().map_err(|e| e.to_string())?.clone();
        current.connected = false;
        let mut guard = locked()?;
        guard.last = current.clone();
        Ok(current)
    } else {
        Ok(locked()?.last.clone())
    }
}

pub fn snapshot() -> Result<SerialSnapshot, String> {
    let guard = locked()?;
    match &guard.session {
        Some(s) => s.status.lock().map(|v| v.clone()).map_err(|e| e.to_string()),
        None => Ok(guard.last.clone()),
    }
}

pub fn send_query(command: String) -> Result<(), String> {
    let query = match command.trim() {
        "M105" => "M105", // temperature
        "M114" => "M114", // coordinates
        "M115" => "M115", // firmware
        "M27" => "M27",   // SD print progress, where supported
        _ => return Err("Alpha 2 erlaubt nur M105, M114, M115 und M27. Keine Bewegungs-, Heiz- oder Druckbefehle.".into()),
    };
    let guard = locked()?;
    let session = guard.session.as_ref().ok_or("Kein USB-Drucker verbunden")?;
    if !session.status.lock().map_err(|e| e.to_string())?.connected { return Err("USB-Verbindung wurde unterbrochen".into()); }
    session.sender.send(WorkerMessage::Query(query)).map_err(|_| "USB-Überwachung wurde beendet".into())
}

fn worker(mut device: Box<dyn serialport::SerialPort>, receiver: mpsc::Receiver<WorkerMessage>, status: Arc<Mutex<SerialSnapshot>>) {
    let mut current = Vec::<u8>::with_capacity(200);
    let mut queued = std::collections::VecDeque::<&'static str>::new();
    let mut waiting: Option<Instant> = None;
    let mut last_poll = Instant::now();
    let ready_at = Instant::now() + Duration::from_secs(3);
    let mut disconnected = false;
    let mut input = [0u8; 256];
    loop {
        while let Ok(message) = receiver.try_recv() {
            match message {
                WorkerMessage::Close => { disconnected = true; break; }
                WorkerMessage::Query(s) => {
                    if queued.len() < 8 { queued.push_back(s); }
                }
            }
        }
        if disconnected { break; }
        if let Some(at) = waiting {
            if at.elapsed() > ACK_TIMEOUT {
                waiting = None;
                if let Ok(mut s) = status.lock() { s.note("Warnung: Zeitüberschreitung bei Firmware-Antwort".into()); }
            }
        }
        if Instant::now() >= ready_at && last_poll.elapsed() >= POLL_INTERVAL {
            if !queued.contains(&"M105") { queued.push_back("M105"); }
            last_poll = Instant::now();
        }
        if waiting.is_none() && Instant::now() >= ready_at {
            if let Some(cmd) = queued.pop_front() {
                if let Err(e) = device.write_all(format!("{cmd}\n").as_bytes()) {
                    if let Ok(mut s) = status.lock() { s.last_error = format!("COM-Schreibfehler: {e}"); }
                    break;
                }
                waiting = Some(Instant::now());
                if let Ok(mut s) = status.lock() { s.note(format!("> {cmd}")); }
            }
        }
        match device.read(&mut input) {
            Ok(count) if count > 0 => {
                for &b in &input[..count] {
                    if b == b'\n' || b == b'\r' {
                        if current.is_empty() { continue; }
                        let line = String::from_utf8_lossy(&current).trim().to_owned();
                        current.clear();
                        if line.is_empty() { continue; }
                        if is_ack(&line) { waiting = None; }
                        if let Ok(mut s) = status.lock() { s.receive(&line); }
                    } else if current.len() < MAX_LINE_BYTES { current.push(b); }
                    else { current.clear(); }
                }
            }
            Ok(_) => {},
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => {},
            Err(e) => {
                if let Ok(mut s) = status.lock() { s.last_error = format!("COM-Lesefehler: {e}"); }
                break;
            }
        }
    }
    if let Ok(mut s) = status.lock() { s.connected = false; }
    // Dropping device closes the port; no G-code print file is ever streamed.
}
fn is_ack(line: &str) -> bool {
    let t = line.trim_start();
    t == "ok" || t.starts_with("ok ") || t.starts_with("ok:") || t.starts_with("Error:") || t.starts_with("Resend:")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_marlin_temperature_with_target() {
        let mut s = SerialSnapshot::default();
        s.receive("ok T:210.5 /215.0 B:59.8 /60.0 @:12 B@:0");
        assert_eq!(s.nozzle, Some(210.5));
        assert_eq!(s.nozzle_target, Some(215.0));
        assert_eq!(s.bed, Some(59.8));
        assert_eq!(s.bed_target, Some(60.0));
    }
    #[test]
    fn parses_progress_only_for_sd_report() {
        assert_eq!(parse_sd_progress("SD printing byte 50/200"), Some(25.0));
        assert_eq!(parse_sd_progress("Not SD printing"), None);
        assert_eq!(parse_sd_progress("SD printing byte 0/0"), None);
    }
    #[test]
    fn no_raw_commands_without_explicit_allowlist() {
        for dangerous in ["G28", "G1 X100", "M104 S220", "M112", "M105\nG28"] {
            assert!(send_query(dangerous.to_owned()).is_err());
        }
    }
}
