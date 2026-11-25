//! Upload zum Drucker im lokalen Netz. Es wird nur uebertragen, nie ein Druck gestartet.
//! Zugangsdaten werden nicht gespeichert. Weiterleitungen werden nicht verfolgt.
use serde::Deserialize;
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::Path,
    time::Duration,
};

const CHUNK: usize = 64 * 1024;
const MAX_RESPONSE: u64 = 1024 * 1024;

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Duet,
    Octoprint,
    Moonraker,
    Prusalink,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub kind: Kind,
    pub address: String,
    #[serde(default)]
    pub secret: String,
}

struct Response {
    status: u16,
    body: Vec<u8>,
}

impl Response {
    fn success(&self) -> bool {
        (200..300).contains(&self.status)
    }

    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    fn failure(&self, what: &str) -> String {
        let hint = match self.status {
            401 | 403 => " Passwort oder API-Schlüssel prüfen.",
            404 => " Anschlussart prüfen.",
            409 => " Die Datei gibt es auf dem Drucker schon.",
            300..=399 => " Die Adresse leitet weiter; bitte die Zieladresse direkt eintragen.",
            _ => "",
        };
        format!("{what}: HTTP {}.{hint}", self.status)
    }
}

trait Wire: Read + Write {}
impl<T: Read + Write> Wire for T {}

struct Client {
    host: String,
    port: u16,
    prefix: String,
}

impl Client {
    fn new(address: &str) -> Result<Self, String> {
        let url = crate::printer_url(address)?;
        if url.scheme() != "http" {
            return Err("Der Upload unterstützt nur http:// im lokalen Netz, kein https.".into());
        }
        Ok(Self {
            host: url.host_str().ok_or("Adresse ohne Rechnername")?.to_owned(),
            port: url.port().unwrap_or(80),
            prefix: url.path().trim_end_matches('/').to_owned(),
        })
    }

    fn connect(&self, reply_timeout: Duration) -> Result<Box<dyn Wire>, String> {
        #[cfg(test)]
        if let Some(wire) = tests::next_wire() {
            return Ok(wire);
        }
        let name = self.host.trim_matches(|c| c == '[' || c == ']');
        let addresses = (name, self.port)
            .to_socket_addrs()
            .map_err(|e| format!("Adresse „{name}“ nicht gefunden: {e}"))?;
        for address in addresses {
            if let Ok(stream) = TcpStream::connect_timeout(&address, Duration::from_secs(5)) {
                let _ = stream.set_read_timeout(Some(reply_timeout));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(90)));
                return Ok(Box::new(stream));
            }
        }
        Err(format!("{name}:{} ist nicht erreichbar.", self.port))
    }

    fn request(
        &self,
        method: &str,
        path: &str,
        headers: &[(&str, &str)],
        body: &[&[u8]],
        progress: &dyn Fn(usize, usize),
    ) -> Result<Response, String> {
        let mut head = format!("{method} {}{path} HTTP/1.1\r\nHost: {}", self.prefix, self.host);
        if self.port != 80 {
            head.push_str(&format!(":{}", self.port));
        }
        head.push_str("\r\nUser-Agent: Simpliy-Slicing\r\nConnection: close\r\n");
        for (name, value) in headers {
            if value.contains(['\r', '\n']) {
                return Err("Zugangsdaten enthalten ungültige Zeichen.".into());
            }
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        let total: usize = body.iter().map(|part| part.len()).sum();
        head.push_str(&format!("Content-Length: {total}\r\n\r\n"));

        // Abfragen antworten sofort, das Ablegen einer grossen Datei auf der SD-Karte dauert.
        let mut stream = self.connect(Duration::from_secs(if total == 0 { 15 } else { 90 }))?;
        let mut sent = 0;
        let mut write_error = stream.write_all(head.as_bytes()).err();
        'send: for part in body {
            for chunk in part.chunks(CHUNK) {
                if write_error.is_some() {
                    break 'send;
                }
                write_error = stream.write_all(chunk).err();
                sent += chunk.len();
                progress(sent, total);
            }
        }
        // Ein Server darf vor dem Ende antworten (z. B. 401); diese Antwort ist aussagekraeftiger.
        let mut raw = Vec::new();
        let read = stream.take(MAX_RESPONSE).read_to_end(&mut raw);
        match parse_response(&raw) {
            Some(response) if write_error.is_none() || !response.success() => Ok(response),
            _ => {
                let reason = write_error
                    .or(read.err())
                    .map_or("unvollständige Antwort".to_owned(), |e| e.to_string());
                Err(format!("Verbindung zum Drucker abgebrochen: {reason}"))
            }
        }
    }

    fn get(&self, path: &str, headers: &[(&str, &str)]) -> Result<Response, String> {
        self.request("GET", path, headers, &[], &|_, _| {})
    }
}

fn parse_response(raw: &[u8]) -> Option<Response> {
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..split]).to_ascii_lowercase();
    let status = head.lines().next()?.split_whitespace().nth(1)?.parse().ok()?;
    let rest = &raw[split + 4..];
    let mut body = rest.to_vec();
    if head.contains("transfer-encoding: chunked") {
        body.clear();
        let mut at = 0;
        loop {
            let end = at + rest.get(at..)?.windows(2).position(|w| w == b"\r\n")?;
            let size = usize::from_str_radix(std::str::from_utf8(&rest[at..end]).ok()?.split(';').next()?.trim(), 16).ok()?;
            if size == 0 {
                break;
            }
            body.extend_from_slice(rest.get(end + 2..(end + 2).checked_add(size)?)?);
            at = end + 2 + size + 2;
        }
    } else if let Some(length) = head.lines().find_map(|l| l.strip_prefix("content-length:")) {
        let length: usize = length.trim().parse().ok()?;
        body = rest.get(..length)?.to_vec();
    }
    Some(Response { status, body })
}

fn encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn crc32(data: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (i, slot) in table.iter_mut().enumerate() {
        *slot = (0..8).fold(i as u32, |c, _| if c & 1 == 1 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 });
    }
    !data.iter().fold(!0u32, |crc, b| table[((crc ^ *b as u32) & 0xFF) as usize] ^ (crc >> 8))
}

/// Dateiname, den alle unterstuetzten Firmwares annehmen.
pub fn remote_name(name: &str) -> Result<String, String> {
    let clean: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .collect();
    let lower = clean.to_ascii_lowercase();
    if clean.starts_with('.') || clean.len() > 120 || !(lower.ends_with(".gcode") || lower.ends_with(".bgcode")) {
        return Err("Nur G-Code-Dateien mit höchstens 120 Zeichen im Namen können gesendet werden.".into());
    }
    Ok(clean)
}

enum Session {
    /// RepRapFirmware direkt auf dem Board.
    Board,
    /// RepRapFirmware mit Einplatinenrechner (DSF).
    Computer(String),
}

fn duet_session(client: &Client, secret: &str) -> Result<Session, String> {
    let password = encode(if secret.is_empty() { "reprap" } else { secret });
    let board = client.get(&format!("/rr_connect?password={password}"), &[])?;
    if board.success() {
        return match board.json()["err"].as_i64() {
            Some(0) => Ok(Session::Board),
            Some(1) => Err("Falsches Duet-Passwort.".into()),
            Some(2) => Err("Der Duet hat keine freie Verbindung. Bitte später erneut versuchen.".into()),
            _ => Err("Das ist keine Duet-Schnittstelle.".into()),
        };
    }
    let computer = client.get(&format!("/machine/connect?password={password}"), &[])?;
    if computer.success() {
        Ok(Session::Computer(computer.json()["sessionKey"].as_str().unwrap_or("").to_owned()))
    } else {
        Err(computer.failure("Duet-Verbindung"))
    }
}

pub fn test(target: &Target) -> Result<String, String> {
    let client = Client::new(&target.address)?;
    let key = [("X-Api-Key", target.secret.as_str())];
    let headers: &[(&str, &str)] = if target.secret.is_empty() { &[] } else { &key };
    let (path, name) = match target.kind {
        Kind::Duet => {
            return Ok(match duet_session(&client, &target.secret)? {
                Session::Board => {
                    let _ = client.get("/rr_disconnect", &[]);
                    "Duet / RepRapFirmware erreichbar".into()
                }
                Session::Computer(_) => "Duet mit SBC erreichbar".into(),
            });
        }
        Kind::Octoprint => ("/api/version", "OctoPrint"),
        Kind::Moonraker => ("/server/info", "Moonraker"),
        Kind::Prusalink => ("/api/v1/status", "PrusaLink"),
    };
    let response = client.get(path, headers)?;
    if response.success() {
        Ok(format!("{name} erreichbar"))
    } else {
        Err(response.failure(name))
    }
}

pub fn send(target: &Target, file: &Path, name: &str, progress: &dyn Fn(usize, usize)) -> Result<String, String> {
    let name = remote_name(name)?;
    let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["gcode", "bgcode"].contains(&extension.as_str()) {
        return Err("Nur G-Code kann gesendet werden.".into());
    }
    let data = std::fs::read(file).map_err(|e| format!("G-Code nicht lesbar: {e}"))?;
    let client = Client::new(&target.address)?;
    let binary = ("Content-Type", "application/octet-stream");

    let response = match target.kind {
        Kind::Duet => match duet_session(&client, &target.secret)? {
            Session::Board => {
                let path = format!("/rr_upload?name={}&crc32={:08x}", encode(&format!("0:/gcodes/{name}")), crc32(&data));
                let result = client.request("POST", &path, &[binary], &[&data], progress);
                let _ = client.get("/rr_disconnect", &[]);
                let response = result?;
                if response.success() && response.json()["err"].as_i64() != Some(0) {
                    return Err("Der Duet hat die Datei nicht angenommen (Speicher oder Prüfsumme).".into());
                }
                response
            }
            Session::Computer(key) => {
                let path = format!("/machine/file/gcodes/{}", encode(&name));
                client.request("PUT", &path, &[binary, ("X-Session-Key", key.as_str())], &[&data], progress)?
            }
        },
        Kind::Prusalink => {
            let path = format!("/api/v1/files/usb/{}", encode(&name));
            let headers = [binary, ("X-Api-Key", target.secret.as_str()), ("Print-After-Upload", "?0"), ("Overwrite", "?0")];
            client.request("PUT", &path, &headers, &[&data], progress)?
        }
        Kind::Octoprint | Kind::Moonraker => {
            let boundary = format!("simpliy{:08x}{}", crc32(&data), crate::uid("part"));
            let field = |key: &str, value: &str| {
                format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n{value}\r\n")
            };
            let (path, mut head) = if target.kind == Kind::Octoprint {
                ("/api/files/local", field("select", "false") + &field("print", "false"))
            } else {
                ("/server/files/upload", field("root", "gcodes") + &field("print", "false"))
            };
            head.push_str(&format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            ));
            let tail = format!("\r\n--{boundary}--\r\n");
            let content = format!("multipart/form-data; boundary={boundary}");
            let mut headers = vec![("Content-Type", content.as_str())];
            if !target.secret.is_empty() {
                headers.push(("X-Api-Key", target.secret.as_str()));
            }
            client.request("POST", path, &headers, &[head.as_bytes(), &data, tail.as_bytes()], progress)?
        }
    };
    if response.success() {
        Ok(name)
    } else {
        Err(response.failure("Upload"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::VecDeque, io::Cursor, rc::Rc};

    type Sent = Rc<RefCell<Vec<u8>>>;

    /// Eine Verbindung im Speicher: merkt sich die Anfrage, liefert die vorbereitete Antwort.
    struct Fake {
        sent: Sent,
        answer: Cursor<Vec<u8>>,
    }

    impl Read for Fake {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.answer.read(buffer)
        }
    }

    impl Write for Fake {
        fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
            self.sent.borrow_mut().extend_from_slice(data);
            Ok(data.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    thread_local! {
        static PLANNED: RefCell<VecDeque<Fake>> = RefCell::new(VecDeque::new());
    }

    pub(super) fn next_wire() -> Option<Box<dyn Wire>> {
        PLANNED.with(|planned| planned.borrow_mut().pop_front()).map(|fake| Box::new(fake) as Box<dyn Wire>)
    }

    fn server(answers: Vec<&'static str>) -> (String, Vec<Sent>) {
        let mut requests = Vec::new();
        PLANNED.with(|planned| {
            for answer in answers {
                let sent = Sent::default();
                planned.borrow_mut().push_back(Fake { sent: sent.clone(), answer: Cursor::new(answer.as_bytes().to_vec()) });
                requests.push(sent);
            }
        });
        // TEST-NET-1 ist nicht vergeben: ein vergessener Fake erreicht nie ein echtes Geraet.
        ("192.0.2.1".into(), requests)
    }

    fn gcode() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("{}.gcode", crate::uid("upload-test")));
        std::fs::write(&path, b"G1 X1 Y2\n").unwrap();
        path
    }

    const OK: &str = "HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\n{\"err\":0}";
    const CREATED: &str = "HTTP/1.1 201 Created\r\nContent-Length: 2\r\n\r\n{}";
    const MISSING: &str = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
    const DENIED: &str = "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n";

    fn upload(kind: Kind, answers: Vec<&'static str>) -> (Result<String, String>, Vec<String>) {
        let (address, requests) = server(answers);
        let path = gcode();
        let result = send(&Target { kind, address, secret: "geheim".into() }, &path, "Teil 1.gcode", &|_, _| {});
        let _ = std::fs::remove_file(path);
        (result, requests.iter().map(|r| String::from_utf8_lossy(&r.borrow()).into_owned()).collect())
    }

    #[test]
    fn duet_board_upload_never_starts_a_print() {
        let (result, seen) = upload(Kind::Duet, vec![OK, OK, OK]);
        assert_eq!(result.unwrap(), "Teil_1.gcode");
        assert!(seen[1].starts_with("POST /rr_upload?name=0%3A%2Fgcodes%2FTeil_1.gcode&crc32="));
        assert!(seen[1].ends_with("G1 X1 Y2\n"));
        assert!(seen.iter().all(|r| !r.contains("M32") && !r.contains("rr_gcode")));
    }

    #[test]
    fn duet_sbc_is_detected() {
        let (result, seen) = upload(Kind::Duet, vec![MISSING, "HTTP/1.1 200 OK\r\n\r\n{\"sessionKey\":\"abc\"}", CREATED]);
        assert!(result.is_ok());
        assert!(seen[2].starts_with("PUT /machine/file/gcodes/Teil_1.gcode"));
        assert!(seen[2].contains("X-Session-Key: abc"));
    }

    #[test]
    fn form_uploads_disable_printing() {
        for kind in [Kind::Octoprint, Kind::Moonraker] {
            let (result, seen) = upload(kind, vec![CREATED]);
            assert!(result.is_ok());
            assert!(seen[0].contains("name=\"print\"\r\n\r\nfalse"));
            assert!(seen[0].contains("X-Api-Key: geheim"));
        }
    }

    #[test]
    fn prusalink_and_errors() {
        let (result, seen) = upload(Kind::Prusalink, vec![CREATED]);
        assert!(result.is_ok());
        assert!(seen[0].contains("Print-After-Upload: ?0") && seen[0].contains("Overwrite: ?0"));
        assert!(upload(Kind::Octoprint, vec![DENIED]).0.unwrap_err().contains("API-Schlüssel"));
    }

    #[test]
    fn helpers() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert!(remote_name("x.exe").is_err());
        assert_eq!(remote_name("../../x.gcode").ok(), None);
        let chunked = parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n").unwrap();
        assert_eq!(chunked.body, b"abc");
    }
}
