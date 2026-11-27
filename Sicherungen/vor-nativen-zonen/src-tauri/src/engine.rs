//! Anbindung der unveraenderten PrusaSlicer-Engine als Hintergrundprozess (argv, keine Shell).
use crate::{advance_progress, data_path, hidden_engine, mesh::Mesh, project, reset_progress, set_job_status, uid};
use serde_json::{json, Value};
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    fs,
    hash::{Hash, Hasher},
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

/// Zuletzt mit Simpliy geprueft. Neuere 3.x-Versionen nimmt Simpliy automatisch, wenn sie die benoetigten
/// Kommandozeilen-Funktionen haben (`probe`); aeltere Versionen und 2.x bleiben ausgeschlossen.
pub const VERSION: &str = "3.0.0-alpha15";
/// Kommandozeilen-Optionen, ohne die Simpliys Slicing-Ablauf nicht funktioniert.
const REQUIRED_FLAGS: [&str; 6] = ["--load", "--save", "--output", "--export-gcode", "--dont-arrange", "--no-ensure-on-bed"];

/// Versionszeile der Engine ("3.0.0-alpha15") aus der Ausgabe von `--version`.
pub fn version_line(output: &str) -> Option<String> {
    output.lines().map(str::trim).find(|l| crate::updates::version_of(l).is_some_and(|v| v.major >= 3)).map(str::to_owned)
}

/// Fragt die Version einer Engine ab (ohne sie fuer Slicing zu oeffnen).
pub fn version_of_exe(path: &str) -> Result<String, String> {
    let exe = PathBuf::from(path);
    if !exe.is_file() {
        return Err("PrusaSlicer nicht gefunden.".into());
    }
    let output = hidden_engine(&exe).arg("--version").output().map_err(|e| format!("PrusaSlicer startet nicht: {e}"))?;
    // alpha14/15 schreiben die Version nach stderr, nicht nach stdout.
    let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    version_line(&text).ok_or_else(|| format!("Keine PrusaSlicer-3.x-Engine. Gefunden: „{}“.", text.trim()))
}

/// Prueft, ob eine nicht ausdruecklich geprueft Engine die benoetigten Funktionen hat.
pub fn probe(exe: &Path) -> Result<(), String> {
    let output = hidden_engine(exe).arg("--help").output().map_err(|e| format!("PrusaSlicer startet nicht: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    let missing: Vec<&str> = REQUIRED_FLAGS.iter().copied().filter(|f| !text.contains(f)).collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!("Diese Engine-Version ist nicht kompatibel: es fehlen {}.", missing.join(", ")))
    }
}
const MODEL_TYPES: [&str; 6] = ["stl", "3mf", "obj", "step", "stp", "amf"];
const MAX_MODEL_BYTES: u64 = 1024 * 1024 * 1024;

static CANCEL: AtomicBool = AtomicBool::new(false);

pub fn cancel() {
    CANCEL.store(true, Ordering::Release);
}

pub fn reset_cancel() { CANCEL.store(false, Ordering::Release); }
pub fn cancelled() -> bool { CANCEL.load(Ordering::Acquire) }

/// Temporaerer Arbeitsordner, wird beim Verlassen entfernt.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Result<Self, String> {
        let dir = std::env::temp_dir().join(uid("simpliy-job"));
        fs::create_dir(&dir).map_err(|e| format!("Arbeitsordner: {e}"))?;
        Ok(Self(dir))
    }
    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub struct Engine {
    exe: PathBuf,
    data: PathBuf,
}

pub struct Sliced {
    pub output: PathBuf,
    pub log: String,
    /// Konfiguration, wie die Engine sie verstanden hat.
    pub effective: Value,
}

/// Neutrales Engine-Paket „Simpliy“ (ohne Druckermodell und Herstellerwerte) in Simpliys eigenem Engine-Datenordner.
/// Die Engine braucht eine gueltige Druckerkennung; alle Werte kommen beim Slicen aus Simpliy. Prusa-Ordner bleiben unberuehrt.
const NEUTRAL: [(&str, &str); 6] = [
    ("Simpliy.idx", include_str!("neutral/Simpliy.idx")),
    ("Simpliy/vendor.yaml", include_str!("neutral/vendor.yaml")),
    ("Simpliy/preset-printer-simpliy.yaml", include_str!("neutral/preset-printer-simpliy.yaml")),
    ("Simpliy/preset-print-simpliy.yaml", include_str!("neutral/preset-print-simpliy.yaml")),
    ("Simpliy/preset-tool-simpliy.yaml", include_str!("neutral/preset-tool-simpliy.yaml")),
    ("Simpliy/preset-filament-simpliy.yaml", include_str!("neutral/preset-filament-simpliy.yaml")),
];

pub fn install_neutral(data: &Path) -> Result<(), String> {
    let root = data.join("presets").join("local").join("simpliy-fff");
    for (name, text) in NEUTRAL {
        let target = root.join(name);
        if fs::read_to_string(&target).ok().as_deref() == Some(text) {
            continue;
        }
        fs::create_dir_all(target.parent().ok_or("Pfad")?).map_err(|e| e.to_string())?;
        fs::write(&target, text).map_err(|e| format!("Neutrales Engine-Paket: {e}"))?;
    }
    Ok(())
}

/// G-Code-Kopf: Simpliy mit Versionsnummer, Datum und alle Einstellungen, wie sie in Simpliy eingestellt sind.
/// Die Kopfzeile der Engine wird ersetzt; die Engine wird nur noch als Slicing-Engine genannt.
pub fn with_summary(text: &str, summary: &[(String, String)], config: &[String], when: String) -> String {
    let mut head = format!("; G-Code generated by Simpliy Slicing Version {}\n; {when}\n", env!("CARGO_PKG_VERSION"));
    let (engine, rest) = match text.split_once('\n') {
        Some((line, rest)) if line.starts_with("; generated by PrusaSlicer") => {
            (line.trim_start_matches("; generated by ").split(" on ").next().unwrap_or("").to_owned(), rest)
        }
        _ => (String::new(), text),
    };
    if !engine.is_empty() {
        head.push_str(&format!("; Slicing-Engine: {engine}\n"));
    }
    if !summary.is_empty() {
        head.push_str("; Settings Summary\n");
        for (name, value) in summary {
            let value = value.replace('\r', "").replace('\n', "\\n");
            head.push_str(&format!(";   {name},{value}\n"));
        }
    }
    // Nur reine Kommentarzeilen: keine Zeilenumbrueche, kein Steuerzeichen, begrenzte Laenge.
    for line in config {
        let line: String = line.chars().filter(|c| !c.is_control()).take(400).collect();
        if line.starts_with(';') {
            head.push_str(&line);
            head.push_str("\n");
        }
    }
    head + rest
}

/// Datum und Uhrzeit (UTC) ohne zusaetzliche Bibliothek.
fn now_utc() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs()) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Tage seit 1970 in ein Kalenderdatum (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC", rem / 3600, rem % 3600 / 60, rem % 60)
}

/// Name der neutralen Druckergrundlage mit `tools` Werkzeugen (so meldet ihn die Engine).
pub fn neutral_printer(tools: usize) -> String {
    let tools = tools.clamp(1, 8);
    let names = vec!["Neutral"; tools].join(", ");
    if tools == 1 { format!("Simpliy {names}") } else { format!("Simpliy {tools}T {names}") }
}

impl Engine {
    pub fn open(path: &str) -> Result<Self, String> {
        let exe = PathBuf::from(path);
        if !exe.is_file() {
            return Err("PrusaSlicer nicht gefunden. Bitte den Pfad prüfen.".into());
        }
        let line = version_of_exe(path)?;
        // Geprueft ist VERSION; andere 3.x-Versionen muessen die benoetigten Funktionen mitbringen (probe).
        if line != VERSION {
            probe(&exe)?;
        }
        let data = data_path()?.parent().ok_or("Datenordner fehlt")?.join("prusa-cli");
        fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        install_neutral(&data)?;
        Ok(Self { exe, data })
    }

    fn command(&self) -> std::process::Command {
        let mut command = hidden_engine(&self.exe);
        command.arg("--no-single-instance").arg("--datadir").arg(&self.data);
        command
    }

    /// Vollstaendige Konfiguration aus einer Profilauswahl.
    pub fn base_config(&self, preset: &Value) -> Result<Value, String> {
        let primary = self.profile_config(preset)?;
        let count = primary["configuration"]["filament_settings"]["temperature"].as_array().map_or(1, |a| a.len());
        if count <= 1 {
            return Ok(primary);
        }
        let first = preset["filament"].as_str().unwrap_or("").to_owned();
        let mut known = HashMap::from([(first.clone(), primary.clone())]);
        let mut per_slot = Vec::with_capacity(count);
        for slot in 0..count {
            let name = preset["filaments"][slot].as_str().filter(|n| !n.is_empty()).unwrap_or(&first).to_owned();
            if !known.contains_key(&name) {
                let mut single = preset.clone();
                single["filament"] = json!(name);
                known.insert(name.clone(), self.profile_config(&single)?);
            }
            per_slot.push(known[&name].clone());
        }
        Ok(merge_materials(primary, &per_slot))
    }

    fn profile_config(&self, preset: &Value) -> Result<Value, String> {
        let scratch = Scratch::new()?;
        let saved = scratch.file("config.json");
        let mut command = self.command();
        for (key, flag) in [
            ("printer", "--printer-profile"),
            ("print", "--print-profile"),
            ("tool", "--tool-print-profile"),
            ("filament", "--material-profile"),
        ] {
            let value = preset[key]
                .as_str()
                .filter(|v| !v.is_empty() && v.len() < 500 && !v.starts_with('-'))
                .ok_or_else(|| format!("Basisprofil unvollständig: {key}"))?;
            command.arg(flag).arg(value);
        }
        let result = command.arg("--save").arg(&saved).output().map_err(|e| e.to_string())?;
        read_json(&saved).map_err(|_| explain(&String::from_utf8_lossy(&result.stderr)))
    }

    /// Netz eines Modells. Andere Formate als STL wandelt die Engine um.
    pub fn load_mesh(&self, path: &str) -> Result<Mesh, String> {
        let source = Path::new(path);
        let extension = source.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if !source.is_absolute() || !MODEL_TYPES.contains(&extension.as_str()) {
            return Err("Nicht unterstütztes Modellformat".into());
        }
        let meta = fs::metadata(source).map_err(|_| format!("Modelldatei nicht gefunden: {path}"))?;
        if meta.len() > MAX_MODEL_BYTES {
            return Err("Modelldatei größer als 1 GB".into());
        }
        let stl = if extension == "stl" { source.to_path_buf() } else { self.converted(source, &meta)? };
        Mesh::from_stl(&fs::read(stl).map_err(|e| e.to_string())?)
    }

    /// Beim Anzeigen geladenes Netz, solange die Datei gleich ist.
    pub fn cached_mesh(&self, path: &str) -> Result<std::sync::Arc<Mesh>, String> {
        match crate::meshes::fresh(path) {
            Some(mesh) => Ok(mesh),
            None => Ok(crate::meshes::keep(path, self.load_mesh(path)?)),
        }
    }

    fn converted(&self, source: &Path, meta: &fs::Metadata) -> Result<PathBuf, String> {
        let mut hasher = DefaultHasher::new();
        (source, meta.len(), meta.modified().ok()).hash(&mut hasher);
        let folder = self.data.with_file_name("mesh-cache");
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let target = folder.join(format!("{:016x}.stl", hasher.finish()));
        if target.is_file() {
            return Ok(target);
        }
        let scratch = Scratch::new()?;
        let temporary = scratch.file("converted.stl");
        let result = self
            .command()
            .arg("--export-stl")
            .arg("--output")
            .arg(&temporary)
            .arg(source)
            .output()
            .map_err(|e| e.to_string())?;
        if !temporary.is_file() {
            return Err(format!("Import fehlgeschlagen: {}", explain(&String::from_utf8_lossy(&result.stderr))));
        }
        fs::copy(&temporary, &target).map_err(|e| e.to_string())?;
        Ok(target)
    }

    fn write_project(&self, job: &project::Job, target: &Path) -> Result<(), String> {
        let meshes = job
            .models
            .iter()
            .map(|m| match &m.inline {
                Some(inline) => inline.mesh(),
                None => self.cached_mesh(&m.path).map(|mesh| (*mesh).clone()),
            })
            .collect::<Result<Vec<_>, _>>()?;
        let file = fs::File::create(target).map_err(|e| e.to_string())?;
        project::write(file, job, &meshes)
    }

    pub fn export_project(&self, job: &project::Job, output: &Path) -> Result<(), String> {
        require_new(output, &["3mf"])?;
        let scratch = Scratch::new()?;
        let temporary = scratch.file("project.3mf");
        self.write_project(job, &temporary)?;
        copy_new(&temporary, output)
    }

    /// Zonen-Prozesse: Hauptprozess und jede Zone einzeln slicen, dann die Schichten zu einem G-Code zusammensetzen.
    fn slice_with_zones(&self, job: &project::Job, output: &Path) -> Result<Sliced, String> {
        let binary = job.config["configuration"]["printer_settings"]["binary_gcode"] == json!(true);
        require_new(output, &[if binary { "bgcode" } else { "gcode" }])?;
        let scratch = Scratch::new()?;
        let as_text = |j: &project::Job| {
            let mut copy = j.clone();
            copy.parts.clear();
            copy.config["configuration"]["printer_settings"]["binary_gcode"] = json!(false);
            copy
        };
        let read = |path: &Path| fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned()).map_err(|e| e.to_string());
        let main_out = scratch.file("main.gcode");
        set_job_status("Hauptprozess wird gesliced");
        let main = self.slice(&as_text(job), &main_out)?;
        let base = read(&main_out)?;
        let mut parts = Vec::new();
        for (i, part) in job.parts.iter().enumerate() {
            set_job_status(&format!("Zone {} von {} wird gesliced", i + 1, job.parts.len()));
            let out = scratch.file(&format!("zone{i}.gcode"));
            self.slice(&as_text(&part.job), &out)?;
            parts.push((part.zone.clone(), read(&out)?));
        }
        set_job_status("Zonen werden zusammengesetzt");
        let merged = crate::zones::merge(&base, &parts)?;
        let temporary = scratch.file("merged.out");
        if binary {
            fs::write(&temporary, crate::bgcode::from_ascii(&merged.text)).map_err(|e| e.to_string())?;
        } else {
            fs::write(&temporary, &merged.text).map_err(|e| e.to_string())?;
        }
        copy_new(&temporary, output)?;
        let log = format!("{}
Zonen-Protokoll:
{}", main.log, merged.log.join("
"));
        Ok(Sliced { output: output.to_path_buf(), log, effective: main.effective })
    }

    pub fn slice(&self, job: &project::Job, output: &Path) -> Result<Sliced, String> {
        if !job.parts.is_empty() {
            return self.slice_with_zones(job, output);
        }
        let binary = job.config["configuration"]["printer_settings"]["binary_gcode"] == json!(true);
        let extension = if binary { "bgcode" } else { "gcode" };
        require_new(output, &[extension])?;
        // Diese Option startet beim Export fremde Programme.
        if job.config["configuration"]["print_settings"]["post_process"].as_array().map_or(false, |a| !a.is_empty()) {
            return Err("Externe Nachbearbeitungsskripte sind gesperrt.".into());
        }

        let scratch = Scratch::new()?;
        reset_progress();
        advance_progress(2);
        set_job_status("Einstellungen werden geprüft");
        let sent = scratch.file("sent.json");
        let echoed = scratch.file("echo.json");
        fs::write(&sent, serde_json::to_vec(&job.config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let check = self.command().arg("--load").arg(&sent).arg("--save").arg(&echoed).output().map_err(|e| e.to_string())?;
        let effective = read_json(&echoed).map_err(|_| explain(&String::from_utf8_lossy(&check.stderr)))?;
        let lost = lost_values(&job.config, &effective, &job.applied);
        if !lost.is_empty() {
            return Err(format!("Die Engine hat diese Werte nicht übernommen: {}", lost.join(", ")));
        }

        advance_progress(9);
        set_job_status("Projekt wird vorbereitet");
        let project = scratch.file("project.3mf");
        self.write_project(job, &project)?;

        let temporary = scratch.file(&format!("result.{extension}"));
        let mut command = self.command();
        // Die Hoehe legt Simpliy fest. ensure-on-bed wuerde geschnittene Teile wieder anheben.
        command.arg("--dont-arrange").arg("--no-ensure-on-bed").arg("--export-gcode").arg("--output").arg(&temporary).arg(&project);
        advance_progress(13);
        set_job_status("Prusa-Engine startet");
        let mut child = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Slicing startet nicht: {e}"))?;
        let stdout = child.stdout.take().ok_or("Engine-Ausgabe fehlt")?;
        let stderr = child.stderr.take().ok_or("Engine-Fehlerausgabe fehlt")?;
        let out_reader = std::thread::spawn(move || collect_log(stdout));
        let err_reader = std::thread::spawn(move || collect_log(stderr));
        let status = loop {
            if CANCEL.load(Ordering::Acquire) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Slicing abgebrochen.".into());
            }
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
                break status;
            }
            // Waehrend des Schreibens waechst die Datei: echte Groesse statt stehender Anzeige.
            if let Some(bytes) = growing_output(&temporary) {
                set_job_status(&format!("G-Code wird geschrieben · {:.1} MB", bytes as f64 / 1_048_576.0));
            }
            std::thread::sleep(Duration::from_millis(80));
        };
        let out_log = out_reader.join().unwrap_or_default();
        let err_log = err_reader.join().unwrap_or_default();

        // Die Engine meldet Eingabefehler mit Rueckgabecode 0 und ohne Datei.
        let written = fs::metadata(&temporary).map_or(0, |m| m.len());
        if !status.success() || written == 0 {
            return Err(explain(if err_log.trim().is_empty() { &out_log } else { &err_log }));
        }
        advance_progress(98);
        // Die Engine schreibt auch fuer binaeren G-Code Text. Erst kennzeichnen, dann selbst in bgcode wandeln.
        let raw = fs::read(&temporary).map_err(|e| e.to_string())?;
        if !raw.starts_with(b"GCDE") {
            let mut text = String::from_utf8_lossy(&raw).into_owned();
            text = with_summary(&text, &job.summary, &job.restore, now_utc());
            text = crate::fans::apply(&text, &job.fans);
            text = crate::temps::apply(&text, &job.temps);
            if job.models.iter().any(|m| m.inline.is_some()) {
                set_job_status("Stützen werden gekennzeichnet");
                text = label_support_bodies(&text);
            }
            if binary {
                set_job_status("Binären G-Code schreiben");
                fs::write(&temporary, crate::bgcode::from_ascii(&text)).map_err(|e| e.to_string())?;
            } else {
                fs::write(&temporary, text).map_err(|e| e.to_string())?;
            }
        }
        copy_new(&temporary, output)?;
        advance_progress(100);
        Ok(Sliced { output: output.to_path_buf(), log: err_log, effective })
    }
}

/// Die CLI setzt bei MMU nur Platz 0 auf das gewaehlte Material, die uebrigen bleiben auf dem
/// Standardmaterial. Darum wird jeder Platz aus Platz 0 seiner eigenen Abfrage gefuellt.
fn merge_materials(mut target: Value, per_slot: &[Value]) -> Value {
    let mut keys: Vec<String> = Vec::new();
    for config in per_slot {
        if let Some(settings) = config["configuration"]["filament_settings"].as_object() {
            for key in settings.keys() {
                if !keys.contains(key) {
                    keys.push(key.clone());
                }
            }
        }
    }
    for key in keys {
        let values: Vec<Value> = per_slot
            .iter()
            .map(|config| config["configuration"]["filament_settings"][&key][0].clone())
            .collect();
        target["configuration"]["filament_settings"][&key] = Value::Array(values);
    }
    if let Some(materials) = target["preset"]["materials"].as_array_mut() {
        for (slot, material) in materials.iter_mut().enumerate() {
            if let Some(chosen) = per_slot.get(slot).map(|c| &c["preset"]["materials"][0]).filter(|m| m.is_object()) {
                *material = chosen.clone();
            }
        }
    }
    target
}

fn read_json(path: &Path) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn require_new(output: &Path, extensions: &[&str]) -> Result<(), String> {
    let extension = output.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !extensions.contains(&extension.as_str()) {
        return Err(format!("Die Ausgabedatei muss auf .{} enden.", extensions.join("/.")));
    }
    if output.exists() {
        return Err("Die Ausgabedatei existiert bereits. Bitte einen neuen Namen wählen.".into());
    }
    Ok(())
}

/// Veroeffentlicht erst das fertige Ergebnis und ueberschreibt nie.
pub(crate) fn copy_new(from: &Path, to: &Path) -> Result<(), String> {
    let mut source = fs::File::open(from).map_err(|e| e.to_string())?;
    let mut target = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|e| format!("Speichern fehlgeschlagen: {e}"))?;
    if let Err(e) = std::io::copy(&mut source, &mut target).and_then(|_| target.sync_all()) {
        drop(target);
        let _ = fs::remove_file(to); // selbst angelegt, unvollstaendig
        return Err(format!("Speichern fehlgeschlagen: {e}"));
    }
    Ok(())
}

fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap_or(0.0), y.as_f64().unwrap_or(0.0));
            (x - y).abs() <= 1e-5 * x.abs().max(1.0)
        }
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y)),
        (Value::Object(x), Value::Object(y)) => x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).map_or(false, |w| same(v, w))),
        _ => a == b,
    }
}

fn lost_values(sent: &Value, received: &Value, keys: &[String]) -> Vec<String> {
    const BOXES: [&str; 3] = ["print_settings", "printer_settings", "filament_settings"];
    keys.iter()
        .filter(|key| {
            BOXES.iter().any(|name| match sent["configuration"][name].get(key.as_str()) {
                Some(value) => !same(value, &received["configuration"][name][key.as_str()]),
                None => false,
            })
        })
        .cloned()
        .collect()
}

fn without_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Lesbare Meldung aus der Engine-Ausgabe, ohne Infozeilen und Stacktrace.
fn explain(log: &str) -> String {
    let clean = without_ansi(log);
    let mut lines: Vec<&str> = Vec::new();
    for line in clean.lines().map(str::trim) {
        let noise = line.is_empty()
            || line.contains("[info]")
            || line.contains("bed model")
            || line.contains("stl_open_count_facets")
            || line.contains("Physical Printer Configurations")
            || line.starts_with('#')
            || line.starts_with("at :");
        if !noise && !lines.contains(&line) {
            lines.push(line);
        }
    }
    lines.truncate(14);
    if lines.is_empty() {
        "PrusaSlicer hat kein Ergebnis geliefert (keine Fehlermeldung der Engine).".into()
    } else {
        let mut message = String::new();
        for (needle, hint) in HINTS {
            if lines.iter().any(|line| line.contains(needle)) {
                message.push_str(hint);
                message.push('\n');
            }
        }
        message.push_str("PrusaSlicer meldet:\n");
        message.push_str(&lines.join("\n"));
        message
    }
}

/// Haeufige Regeln der Engine, die in der Oberflaeche nicht offensichtlich sind.
const HINTS: [(&str, &str); 5] = [
    ("only supported with the relative extruder addressing", "Reinigungsturm braucht relative Extrusion: Ausgabe > G-Code, oder den Turm unter Ergänzungen ausschalten."),
    ("only supported for multiple objects if they", "Mit Reinigungsturm müssen alle Modelle gleiche Schichthöhen haben: Turm ausschalten oder Platten trennen."),
    ("Machine limits cannot be emitted", "Für diese Firmware unter Geschwindigkeiten > Maschinengrenzen „nur Zeitschätzung“ wählen."),
    ("too low to be printable at current layer height", "Die Schichthöhe ist für diese Extrusionsbreite zu groß."),
    ("outside of the print volume", "Das Teil liegt außerhalb des Bauraums."),
];

const SUPPORT_OBJECT: &str = "Simpliy-Stuetze";

/// Stuetzkoerper sind fuer die Engine Objekte. Nur ihre Typ-Kommentare werden umbenannt, kein Fahrbefehl.
fn label_support_bodies(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 4096);
    let mut ids = std::collections::HashSet::<String>::new();
    let mut inside = false;
    let mut role = String::new();
    for raw in text.split_inclusive('\n') {
        let line = raw.trim_end();
        if let Some(name) = line.strip_prefix("; printing object ") {
            let now = name.starts_with(SUPPORT_OBJECT);
            out.push_str(raw);
            // Die Rolle gilt weiter, bis die Engine eine neue schreibt. Beim Wechsel daher wiederholen.
            if now != inside && !role.is_empty() {
                out.push_str(&format!(";TYPE:{}\n", if now { support_role(&role) } else { role.as_str() }));
            }
            inside = now;
            continue;
        }
        if let Some(rest) = line.strip_prefix("M486 ") {
            // RepRapFirmware: M486 S2 A"Name", danach nur noch M486 S2
            if let Some(id) = rest.strip_prefix('S').and_then(|s| s.split_whitespace().next()) {
                if rest.contains(SUPPORT_OBJECT) {
                    ids.insert(id.to_owned());
                }
                let now = ids.contains(id);
                out.push_str(raw);
                if now != inside && !role.is_empty() {
                    out.push_str(&format!(";TYPE:{}\n", if now { support_role(&role) } else { role.as_str() }));
                }
                inside = now;
                continue;
            }
        }
        if line.starts_with("; stop printing object ") {
            out.push_str(raw);
            if inside && !role.is_empty() {
                out.push_str(&format!(";TYPE:{role}\n"));
            }
            inside = false;
            continue;
        }
        if let Some(found) = line.strip_prefix(";TYPE:") {
            role = found.to_owned();
            if inside {
                out.push_str(&format!(";TYPE:{}\n", support_role(found)));
                continue;
            }
        }
        out.push_str(raw);
    }
    out
}

fn support_role(role: &str) -> &str {
    match role {
        "Top solid infill" | "Solid infill" | "Internal infill" => "Support material interface",
        "Custom" | "Wipe tower" | "Skirt/Brim" | "Skirt" => role,
        _ => "Support material",
    }
}

fn growing_output(target: &Path) -> Option<u64> {
    let mut partial = target.as_os_str().to_owned();
    partial.push(".tmp");
    fs::metadata(&partial).or_else(|_| fs::metadata(target)).ok().map(|m| m.len()).filter(|bytes| *bytes > 0)
}

/// Engine-Meldung -> (Prozent, Anzeige). Das Spezifischere steht vor dem Allgemeinen.
const STAGES: [(&str, u32, &str); 18] = [
    ("exporting g-code", 82, "G-Code wird geschrieben"),
    ("slicing process finished", 80, "Schichten sind fertig"),
    ("support generator - generating tool paths", 76, "Stützbahnen werden berechnet"),
    ("support generator - creating interfaces", 74, "Kontaktlagen werden berechnet"),
    ("support generator - creating base layers", 71, "Stützkörper werden berechnet"),
    ("support generator - creating bottom contacts", 68, "Auflagen werden berechnet"),
    ("support generator - start", 64, "Stützen werden berechnet"),
    ("filling layers", 60, "Füllung wird berechnet"),
    ("bridge over infill - end", 57, "Brücken sind berechnet"),
    ("bridge over infill - directions", 54, "Brückenrichtungen werden berechnet"),
    ("bridge over infill", 50, "Brücken werden berechnet"),
    ("processing external surfaces", 47, "Außenflächen werden berechnet"),
    ("discovering vertical shells", 44, "Schalen werden berechnet"),
    ("preparing fill surfaces", 41, "Füllflächen werden berechnet"),
    ("detecting solid surfaces", 38, "Deckflächen werden berechnet"),
    ("generating perimeters", 27, "Wände werden berechnet"),
    ("slicing volumes", 20, "Schichten werden berechnet"),
    ("starting the slicing process", 18, "Slicing gestartet"),
];

fn stage_of(line: &str) -> Option<(u32, &'static str)> {
    let lower = line.to_lowercase();
    STAGES.iter().find(|(needle, _, _)| lower.contains(needle)).map(|(_, p, text)| (*p, *text))
}

fn collect_log<R: Read>(reader: R) -> String {
    let mut log = String::new();
    for line in BufReader::new(reader).split(b'\n') {
        let Ok(raw) = line else { break };
        let line = String::from_utf8_lossy(&raw);
        if let Some((percent, text)) = stage_of(&line) {
            advance_progress(percent);
            set_job_status(text);
        }
        if log.len() < 32_000 {
            log.extend(line.chars().take(2000));
            log.push('\n');
        }
    }
    log
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_bodies_get_support_roles_and_no_move_changes() {
        let source = ";TYPE:External perimeter\n; printing object Simpliy-Stuetze m id:1 copy 0\nG1 X1 E1\n;TYPE:Top solid infill\nG1 X2 E2\n; stop printing object Simpliy-Stuetze m id:1 copy 0\nG1 X3 E3\n";
        let out = label_support_bodies(source);
        assert!(out.contains(";TYPE:Support material\nG1 X1"));
        assert!(out.contains(";TYPE:Support material interface\nG1 X2"));
        assert!(out.contains(";TYPE:Top solid infill\nG1 X3"));
        let moves = |t: &str| t.lines().filter(|l| l.starts_with('G')).map(str::to_owned).collect::<Vec<_>>();
        assert_eq!(moves(source), moves(&out));
    }

    #[test]
    fn progress_stages_follow_the_engine_log_order() {
        let log = ["Starting the slicing process.", "Slicing volumes...", "Generating perimeters...", "Detecting solid surfaces...",
            "Preparing fill surfaces...", "Discovering vertical shells...", "Processing external surfaces...", "Bridge over infill - Start",
            "Bridge over infill - End", "Support generator - Start", "Support generator - Creating interfaces", "Slicing process finished.",
            "Exporting G-code..."];
        let seen: Vec<u32> = log.iter().map(|line| stage_of(line).expect(line).0).collect();
        assert!(seen.windows(2).all(|pair| pair[0] < pair[1]), "{seen:?}");
        assert!(stage_of("Loading preset bundle").is_none());
    }

    #[test]
    fn detects_values_the_engine_dropped() {
        let sent = json!({"configuration": {"print_settings": {"perimeters": 5, "layer_height": 0.2}}});
        let got = json!({"configuration": {"print_settings": {"perimeters": 2, "layer_height": 0.200_000_01}}});
        let keys = vec!["perimeters".to_owned(), "layer_height".to_owned()];
        assert_eq!(lost_values(&sent, &got, &keys), vec!["perimeters".to_owned()]);
    }

    #[test]
    fn every_slot_gets_the_material_chosen_for_it() {
        let config = |t: i32, name: &str| {
            json!({"configuration": {"filament_settings": {"temperature": [t, 205, 205]}},
                   "preset": {"materials": [{"name": name}, {"name": "PLA"}, {"name": "PLA"}]}})
        };
        let merged = merge_materials(config(230, "PETG"), &[config(230, "PETG"), config(260, "ASA"), config(230, "PETG")]);
        assert_eq!(merged["configuration"]["filament_settings"]["temperature"], json!([230, 260, 230]));
        assert_eq!(merged["preset"]["materials"][1]["name"], "ASA");
    }

    #[test]
    fn explains_without_noise() {
        assert_eq!(explain("[x] [info] hi\n\u{1b}[31mBad width\u{1b}[0m\nBad width\n"), "PrusaSlicer meldet:\nBad width");
    }
}

#[cfg(test)]
mod version_tests {
    use super::*;

    #[test]
    fn engine_version_is_read_from_the_output_and_only_3x_counts() {
        assert_eq!(version_line("3.0.0-alpha15
").as_deref(), Some("3.0.0-alpha15"));
        assert_eq!(version_line("PrusaSlicer-3.1.0 based on Slic3r
3.1.0
").as_deref(), Some("3.1.0"));
        assert_eq!(version_line("2.9.7
"), None);
        assert_eq!(version_line("irgendwas
"), None);
    }

    #[test]
    fn reference_version_is_the_newest_known() {
        assert!(crate::updates::version_of(VERSION).unwrap() >= crate::updates::version_of("3.0.0-alpha15").unwrap());
    }
}

#[cfg(test)]
mod neutral_tests {
    use super::*;

    #[test]
    fn summary_replaces_the_engine_header() {
        let text = "; generated by PrusaSlicer 3.0.0-alpha14 on 2026-11-23 at 21:19:23 UTC\nG1 X1\n";
        let summary = [("processName".to_owned(), "Process 1".to_owned()), ("start_gcode".to_owned(), "G28\nG1".to_owned())];
        let config = ["; simpliy_config_begin 1".to_owned(), "G28 ; kein Kommentar".to_owned(), "; simpliy_config_end".to_owned()];
        let out = with_summary(text, &summary, &config, "2026-11-23 22:00:00 UTC".into());
        let expected = format!(
            "; G-Code generated by Simpliy Slicing Version {}\n; 2026-11-23 22:00:00 UTC\n; Slicing-Engine: PrusaSlicer 3.0.0-alpha14\n; Settings Summary\n;   processName,Process 1\n;   start_gcode,G28\\nG1\n; simpliy_config_begin 1\n; simpliy_config_end\nG1 X1\n",
            env!("CARGO_PKG_VERSION")
        );
        assert_eq!(out, expected);
        assert_eq!(now_utc().len(), 23);
    }

    #[test]
    fn neutral_names_follow_the_engine() {
        assert_eq!(neutral_printer(1), "Simpliy Neutral");
        assert_eq!(neutral_printer(2), "Simpliy 2T Neutral, Neutral");
        assert_eq!(neutral_printer(0), "Simpliy Neutral");
    }

    /// Mit der echten Engine: neutrale Grundlage fuer 1 und 3 Werkzeuge, ohne Prusa-Druckermodell.
    #[test]
    #[ignore]
    fn neutral_base_config_with_real_engine() {
        let engine = Engine::open(&std::env::var("SIMPLIY_TEST_ENGINE").unwrap()).unwrap();
        for tools in [1usize, 3] {
            let preset = json!({"printer": neutral_printer(tools), "print": "Simpliy", "tool": "Simpliy", "filament": "Simpliy"});
            let config = engine.base_config(&preset).unwrap_or_else(|e| panic!("{tools}: {e}"));
            let c = &config["configuration"];
            assert_eq!(c["printer_settings"]["printer_model"], "SIMPLIY");
            assert_eq!(c["filament_settings"]["temperature"].as_array().unwrap().len(), tools);
            assert_eq!(config["preset"]["hw_config"]["vendor_id"], "Simpliy");
        }
    }
}
