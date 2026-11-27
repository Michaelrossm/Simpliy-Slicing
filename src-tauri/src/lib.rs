//! Native local profile bridge. No PrusaSlicer code, no browser server, no network APIs.
pub mod fans;
pub mod temps;
pub mod zones;
pub mod updates;
pub mod engine_texts;
mod engine;
mod gcode;
mod instance;
mod mesh;
mod meshes;
mod packet;
mod plates;
mod project;
mod projects;
mod prusa_import;
mod bgcode;
mod repair;
mod shading;
mod supports;
mod upload;
mod zonepost;
mod serial_control; // --simpliy-usb-monitor-alpha2
mod util;
mod fonts;
mod holes;
mod printer_net;
mod dialogs;
mod thumbnails;
#[cfg(test)]
#[path = "tests/printer_url_tests.rs"]
mod printer_url_tests;
#[cfg(test)]
#[path = "tests/prusa_import_engine_tests.rs"]
mod prusa_import_engine_tests;
#[cfg(test)]
#[path = "tests/preview_pipeline_tests.rs"]
mod preview_pipeline_tests;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Map, Value};
use std::{
    env, fs,
    io::{Cursor, Read, Write},
    sync::{Mutex, atomic::{AtomicBool, Ordering}},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub(crate) fn hidden_engine(path: &Path) -> std::process::Command {
    let mut command = std::process::Command::new(path);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}

use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_WORKSPACE: usize = 64 * 1024 * 1024;
const MAX_PROFILE: usize = 8 * 1024 * 1024;
static WORKSPACE: instance::Guard = instance::Guard::new();
const INITIAL: &str = include_str!("../../frontend/initial_state.json");

pub(crate) fn data_path() -> Result<PathBuf, String> {
    let base = env::var_os("APPDATA")
        .or_else(|| env::var_os("LOCALAPPDATA"))
        .or_else(|| env::var_os("HOME"))
        .ok_or("Kein Benutzerdatenverzeichnis gefunden")?;
    Ok(PathBuf::from(base).join("SimpliySlicing").join("workspace.json"))
}
pub(crate) fn uid(prefix: &str) -> String {
    // Die Windows-Uhr allein ist nicht eindeutig, wenn mehrere Aufgaben gleichzeitig laufen.
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    format!("{prefix}-{timestamp:x}-{:x}", NEXT.fetch_add(1, Ordering::Relaxed))
}
fn ensure_workspace(ws: &Value) -> Result<(), String> {
    let object = ws.as_object().ok_or("Arbeitsbereich ist kein JSON-Objekt")?;
    if object.get("schema").and_then(Value::as_i64) != Some(1) {
        return Err("Unbekannte Arbeitsbereich-Version".into());
    }
    let profiles = object.get("profiles").and_then(Value::as_array).ok_or("Profile fehlen")?;
    if profiles.is_empty() || profiles.len() > 500 { return Err("Ungültige Anzahl an Profilen".into()); }
    for bundle in profiles { validate_bundle(bundle)?; }
    // Neu seit 0.13: optional, aeltere Arbeitsbereiche haben sie nicht.
    for field in ["presets", "process_library"] {
        if object.get(field).is_some_and(|v| v.as_array().map_or(true, |a| a.len() > 2000)) {
            return Err(format!("Ungültige Liste: {field}"));
        }
    }
    for field in ["processes", "printers", "filaments", "models"] {
        if object.get(field).and_then(Value::as_array).map_or(true, |a|a.len()>2000) {
            return Err(format!("Ungültige Liste: {field}"));
        }
    }
    let len = serde_json::to_vec(ws).map_err(|e|e.to_string())?.len();
    if len > MAX_WORKSPACE { return Err("Arbeitsbereich zu groß".into()); }
    Ok(())
}
pub(crate) fn validate_bundle(bundle: &Value) -> Result<(), String> {
    let m = bundle.get("manifest").ok_or("Profil-Manifest fehlt")?;
    if m.get("format").and_then(Value::as_str) != Some("SimpliyProfile")
        || m.get("schema_version").and_then(Value::as_u64) != Some(1) {
        return Err("Kein kompatibles Simpliy-Profil".into());
    }
    let p = bundle.get("profile").ok_or("Profilinhalt fehlt")?;
    if !p.get("base_parameters").map_or(false, Value::is_object)
        || !p.get("categories").map_or(false, Value::is_array) {
        return Err("Profileinstellungen ungültig".into());
    }
    Ok(())
}
fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let folder = path.parent().ok_or("Zielverzeichnis fehlt")?;
    fs::create_dir_all(folder).map_err(|e|e.to_string())?;
    let tmp = folder.join(format!(".workspace-{}.tmp", uid("simpliy")));
    {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e|e.to_string())?;
        f.write_all(content).map_err(|e|e.to_string())?;
        f.sync_all().map_err(|e|e.to_string())?;
    }
    // Die alte Datei bleibt bis zum Ersetzen an ihrem Platz (Kopie als .bak, kein Verschieben):
    // Bricht das Programm ab, existiert immer eine vollstaendige workspace.json.
    let backup = path.with_extension("json.bak");
    if path.exists() {
        let _ = fs::copy(path, &backup);
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Speichern fehlgeschlagen: {e}"));
    }
    Ok(())
}
/// Arbeitsbereich aus der Sicherung holen. Eine beschaedigte Datei bleibt als .defekt-<Zeit> erhalten.
fn restore_backup(path: &Path) -> Option<Value> {
    let backup = path.with_extension("json.bak");
    let buf = fs::read(&backup).ok()?;
    if buf.len() > MAX_WORKSPACE { return None; }
    let ws: Value = serde_json::from_slice(&buf).ok()?;
    ensure_workspace(&ws).ok()?;
    if path.exists() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        let _ = fs::rename(path, path.with_extension(format!("json.defekt-{stamp}")));
    }
    atomic_write(path, &buf).ok()?;
    Some(ws)
}
fn read_or_create() -> Result<Value, String> {
    let path = data_path()?;
    if path.is_file() {
        let buf = fs::read(&path).map_err(|e|e.to_string())?;
        if buf.len()>MAX_WORKSPACE { return Err("Arbeitsbereich zu groß".into()); }
        match serde_json::from_slice::<Value>(&buf) {
            Ok(ws) => { ensure_workspace(&ws)?; return Ok(ws); }
            Err(e) => {
                if let Some(ws) = restore_backup(&path) { return Ok(ws); }
                return Err(format!("Arbeitsbereich beschädigt (nicht verändert, keine brauchbare Sicherung): {e}"));
            }
        }
    }
    // Datei fehlt (z. B. Absturz beim Speichern): zuerst die Sicherung versuchen, nie gleich neu anlegen.
    if let Some(ws) = restore_backup(&path) { return Ok(ws); }
    let ws: Value = serde_json::from_str(INITIAL).map_err(|e|e.to_string())?;
    ensure_workspace(&ws)?;
    let bytes = serde_json::to_vec_pretty(&ws).map_err(|e|e.to_string())?;
    atomic_write(&path, &bytes)?;
    WORKSPACE.remember(&bytes);
    Ok(ws)
}
fn write_state(ws: &Value) -> Result<(), String> {
    ensure_workspace(ws)?;
    let bytes = serde_json::to_vec_pretty(ws).map_err(|e|e.to_string())?;
    let path = data_path()?;
    WORKSPACE.check(&path)?;
    atomic_write(&path, &bytes)?;
    WORKSPACE.remember(&bytes);
    Ok(())
}
#[tauri::command]
fn get_workspace() -> Result<Value, String> {
    static STARTED: AtomicBool = AtomicBool::new(false);
    let mut workspace = read_or_create()?;
    // Nur was die Oberflaeche bekommt, darf sie spaeter ueberschreiben.
    WORKSPACE.remember(&fs::read(data_path()?).map_err(|e| e.to_string())?);
    // Neu nummeriert wird nur beim Programmstart, nicht bei jedem Lesen.
    if !STARTED.swap(true, Ordering::AcqRel) {
        clean_previews(true);
        plates::renumber(&mut workspace);
    }
    Ok(workspace)
}
#[tauri::command]
fn save_workspace(workspace: Value) -> Result<Value, String> {
    write_state(&workspace)?;
    Ok(json!({"ok":true, "active_profile_id":workspace["active_profile_id"]}))
}
fn zip_bundle(bytes: &[u8]) -> Result<Value, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e|e.to_string())?;
    if archive.len()>50 { return Err("Zu viele Dateien im Profilarchiv".into()); }
    let total: u64 = archive.file_names().count() as u64; // keep bound on entries too
    if total > 50 { return Err("Zu viele Profilteile".into()); }
    let mut data = Vec::new();
    for name in ["manifest.json", "profile.json"] {
        let mut file = archive.by_name(name).map_err(|_|format!("{name} fehlt"))?;
        if file.size() > MAX_PROFILE as u64 { return Err("Profilinhalt zu groß".into()); }
        let mut buf = Vec::new();
        file.by_ref().take(MAX_PROFILE as u64+1).read_to_end(&mut buf).map_err(|e|e.to_string())?;
        if buf.len()>MAX_PROFILE { return Err("Profilinhalt zu groß".into()); }
        data.push(serde_json::from_slice::<Value>(&buf).map_err(|e|e.to_string())?);
    }
    let mut bundle = json!({"manifest":data[0], "profile":data[1]});
    validate_bundle(&bundle)?;
    // Import creates a new local identity; never overwrite an existing profile.
    bundle["manifest"]["profile_id"] = json!(uid("profile"));
    Ok(bundle)
}
fn ini_bundle(bytes: &[u8], filename: &str) -> Result<Value, String> {
    let text = String::from_utf8_lossy(bytes);
    let mut base = Map::new();
    let mut sections: Vec<(String,Map<String,Value>)> = vec![("default".into(),Map::new())];
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') { continue; }
        if line.starts_with('[') && line.ends_with(']') {
            sections.push((line[1..line.len()-1].trim().to_string(), Map::new()));
        } else if let Some((key,value)) = line.split_once('=') {
            if !key.trim().is_empty() { sections.last_mut().unwrap().1.insert(key.trim().into(),json!(value.trim())); }
        }
    }
    let mut grouped: Vec<Value> = Vec::new();
    for (name, values) in sections {
        if values.is_empty() {continue;}
        let (kind, preset) = name.split_once(':').unwrap_or((name.as_str(),""));
        let catname = match kind.to_lowercase().as_str() {
            "filament" if !preset.is_empty() => Some("Material"),
            "print" if !preset.is_empty() => Some("Qualität"),
            "printer" if !preset.is_empty() => Some("Drucker"),
            _ => None,
        };
        if let Some(category) = catname {
            let pos = grouped.iter().position(|v|v["name"]==category);
            let index = match pos {Some(i)=>i,None=>{grouped.push(json!({"id":uid("cat"),"name":category,"selected":"","options":[]}));grouped.len()-1}};
            let opt_id = uid("opt");
            let opt = json!({"id":opt_id,"name":preset,"assignments":values});
            if grouped[index]["selected"].as_str()==Some("") {grouped[index]["selected"]=json!(opt_id);}
            grouped[index]["options"].as_array_mut().unwrap().push(opt);
        } else {base.extend(values);}
    }
    if base.is_empty() && grouped.is_empty(){return Err("Keine Einstellungen gefunden".into());}
    let order: Vec<Value> = grouped.iter().map(|v|v["id"].clone()).collect();
    let label = Path::new(filename).file_stem().and_then(|s|s.to_str()).unwrap_or("Prusa Import");
    let bundle = json!({
        "manifest":{"format":"SimpliyProfile","schema_version":1,"profile_id":uid("profile"),"engine_family":"PrusaSlicer","engine_target":"3.0.x","source":{"kind":"prusa-ini-import","filename":filename,"warning":"Rohwerte, nicht gegen Prusa 3.0 validiert"}},
        "profile":{"name":format!("Import – {}",label),"base_parameters":base,"categories":grouped,"category_order":order,"processes":[]}
    });
    validate_bundle(&bundle)?;
    Ok(bundle)
}
#[tauri::command]
fn import_profile(filename: String, data_base64: String) -> Result<Value, String> {
    if filename.len()>260 {return Err("Dateiname zu lang".into());}
    let data = STANDARD.decode(data_base64).map_err(|e|e.to_string())?;
    if data.len()>MAX_PROFILE { return Err("Datei zu groß (8 MiB)".into()); }
    let ext = Path::new(&filename).extension().and_then(|s|s.to_str()).unwrap_or("").to_lowercase();
    let bundle = match ext.as_str() {
        "simpliyprofile"|"zip" => zip_bundle(&data)?,
        "ini"|"cfg" => ini_bundle(&data,&filename)?,
        "json" => {let v:Value=serde_json::from_slice(&data).map_err(|e|e.to_string())?;validate_bundle(&v)?;v},
        _ => return Err("Erlaubt: .simpliyprofile, .zip, .ini, .cfg, .json".into()),
    };
    WORKSPACE.check(&data_path()?)?;
    let mut ws = read_or_create()?;
    let profile_id = bundle["manifest"]["profile_id"].as_str().unwrap_or("").to_string();
    // Replace colliding IDs (notably for JSON imports).
    let mut bundle = bundle;
    if ws["profiles"].as_array().unwrap().iter().any(|v|v["manifest"]["profile_id"].as_str()==Some(profile_id.as_str())) {
        bundle["manifest"]["profile_id"] = json!(uid("profile"));
    }
    let id = bundle["manifest"]["profile_id"].as_str().unwrap_or("").to_owned();
    ws["profiles"].as_array_mut().unwrap().push(bundle);
    ws["active_profile_id"] = json!(id);
    write_state(&ws)?;
    Ok(json!({"ok":true,"profile_id":id,"state":ws}))
}
#[tauri::command]
fn export_profile(profile_id: String) -> Result<String, String> {
    let ws = read_or_create()?;
    let profiles = ws["profiles"].as_array().ok_or("Keine Profile")?;
    let mut b = profiles.iter().find(|p|p["manifest"]["profile_id"].as_str()==Some(profile_id.as_str()))
        .ok_or("Profil nicht gefunden")?.clone();
    validate_bundle(&b)?;
    let variants: Vec<Value> = ws["processes"].as_array().unwrap().iter().filter(|p|p["profile_id"]==profile_id)
        .map(|p|json!({"name":p["name"],"role":p["role"],"selections":p["selections"],"overrides":p["overrides"],"enabled":p["enabled"]})).collect();
    b["profile"]["process_variants"] = json!(variants);
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for key in ["manifest", "profile"] {
        writer.start_file(format!("{key}.json"),options.clone()).map_err(|e|e.to_string())?;
        writer.write_all(&serde_json::to_vec_pretty(&b[key]).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    }
    let result = writer.finish().map_err(|e|e.to_string())?.into_inner();
    if result.len()>MAX_PROFILE {return Err("Export zu groß".into());}
    Ok(STANDARD.encode(result))
}
#[tauri::command]
fn detect_engine() -> Result<Value, String> {
    let ws = read_or_create()?;
    let configured = ws["engine_path"].as_str().unwrap_or("");
    let mut detected = Vec::<String>::new();
    let portable = Path::new(r"T:\Simply slicer\PrusaSlicer-3.0.0-alpha15\PrusaSlicer.exe");
    if Path::new(configured).is_file() {detected.push(configured.into());}
    if let Some(newest) = updates::newest_installed_engine() {
        let s = newest.to_string_lossy().into_owned();
        if !detected.contains(&s) { detected.push(s); }
    }
    if portable.is_file() && !detected.iter().any(|p| Path::new(p) == portable) { detected.push(portable.to_string_lossy().into_owned()); }
    for root in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Some(base)=env::var_os(root) {
            for rel in ["Prusa3D/PrusaSlicer/prusa-slicer-console.exe", "Prusa3D/PrusaSlicer/prusa-slicer.exe", "Prusa3D/PrusaSlicer/PrusaSlicer.exe"] {
                let path=PathBuf::from(&base).join(rel);
                if path.is_file() { let s=path.to_string_lossy().into_owned(); if !detected.contains(&s) {detected.push(s);} }
            }
        }
    }
    Ok(json!({"configured":configured,"detected":detected,"note":"Nur Pfaderkennung – PrusaSlicer wird noch nicht gestartet."}))
}




fn startup_blocked(message: &str) {
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Warning)
        .set_title("Simpliy Slicing")
        .set_description(message)
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

fn expand_supports(engine: &engine::Engine, job: &mut project::Job) -> Result<supports::job::Prepared, String> {
    let made = supports::job::expand(job, &|path: &str| engine.cached_mesh(path))?;
    if made.problems.is_empty() {
        Ok(made)
    } else {
        Err(made.problems.join("\n"))
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn engine_base_config(engine_path: String, preset: Value) -> Result<Value, String> {
    blocking(move || engine::Engine::open(&engine_path)?.base_config(&preset)).await
}

#[tauri::command]
async fn load_mesh(engine_path: String, path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = blocking(move || {
        let mesh = engine::Engine::open(&engine_path)?.load_mesh(&path)?;
        Ok(meshes::keep(&path, mesh).to_bytes())
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn support_schema() -> Value {
    supports::schema()
}

#[tauri::command]
async fn support_plate(plate: supports::Plate, known_pillars: Option<std::collections::HashMap<String, u64>>, known_bodies: Option<std::collections::HashMap<String, u64>>, optimize: Option<bool>) -> Result<tauri::ipc::Response, String> {
    blocking(move || supports::view(plate, known_pillars.unwrap_or_default(), known_bodies.unwrap_or_default(), optimize.unwrap_or(false), &|path: &str| meshes::loaded(path))).await.map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn support_edit(request: supports::EditRequest) -> Result<Value, String> {
    blocking(move || supports::apply_edit(request, &|path: &str| meshes::loaded(path))).await
}

#[tauri::command]
async fn support_hover(request: supports::HoverRequest) -> Result<tauri::ipc::Response, String> {
    blocking(move || supports::hover(request, &|path: &str| meshes::loaded(path))).await.map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn support_stl(plate: supports::Plate, id: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || supports::export_stl(plate, &id, &|path: &str| meshes::loaded(path))).await.map(tauri::ipc::Response::new)
}

/// Was beim Slicen gemeldet wuerde, vor den Rueckfragen.
#[tauri::command]
async fn support_prepare(engine_path: String, job: project::Job) -> Result<Value, String> {
    blocking(move || {
        let mut job = job;
        let engine = engine::Engine::open(&engine_path)?;
        let made = supports::job::expand(&mut job, &|path: &str| engine.cached_mesh(path))?;
        Ok(json!({"notes": made.notes, "problems": made.problems}))
    })
    .await
}

#[tauri::command]
async fn check_mesh(engine_path: String, path: String) -> Result<Value, String> {
    blocking(move || {
        let mesh = engine::Engine::open(&engine_path)?.cached_mesh(&path)?;
        serde_json::to_value(repair::analyse(&mesh)).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
async fn repair_mesh(engine_path: String, path: String, tolerance: f64, save: bool) -> Result<Value, String> {
    blocking(move || {
        let mesh = engine::Engine::open(&engine_path)?.cached_mesh(&path)?;
        let report = repair::repair(&mesh, tolerance)?;
        // Ist nichts zu tun, entsteht auch keine Datei.
        let unchanged = report.removed == 0 && report.holes == 0 && report.flipped == 0;
        let mut saved = None;
        if report.mesh.triangles.is_empty() {
            return Err("Nach dem Verschweißen bliebe kein Dreieck übrig. Toleranz verkleinern.".into());
        }
        if save && !unchanged {
            let data = repair::to_stl(&report.mesh);
            mesh::Mesh::from_stl(&data)?;
            let folder = data_path()?.with_file_name("repaired");
            fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let target = folder.join(format!("{}.stl", uid("mesh")));
            fs::write(&target, data).map_err(|e| e.to_string())?;
            saved = Some(target.to_string_lossy().into_owned());
        }
        Ok(json!({"report": report, "path": saved, "changed": !unchanged}))
    })
    .await
}

#[tauri::command]
async fn read_preview(path: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || gcode::load(&path, |part| advance_progress(95 + (part * 5.0) as u32))?.packet())
        .await
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn query_prusa_profiles(engine_path: String, printer: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || query_profiles(&engine_path, printer)).await.map_err(|e|e.to_string())?
}

fn query_profiles(engine_path: &str, printer: Option<String>) -> Result<Value, String> {
    {
        let engine=PathBuf::from(engine_path);
        if !engine.is_file() { return Err("Prusa-Engine nicht gefunden".into()); }
        engine::Engine::open(&engine.to_string_lossy())?;
        let dir=data_path()?.parent().ok_or("Datenordner fehlt")?.join("prusa-cli");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
        let output=env::temp_dir().join(format!("{}.json",uid("simpliy-prusa-query")));
        let mut cmd=hidden_engine(&engine);cmd.arg("--no-single-instance").arg("--datadir").arg(dir);
        if let Some(p)=printer {cmd.arg("--query-print-tool-filament-profiles").arg("--printer-profile").arg(p);}else{cmd.arg("--query-printer-models");}
        let result=cmd.arg("--output").arg(&output).output().map_err(|e|e.to_string())?;
        if !result.status.success(){let _=fs::remove_file(&output);return Err(format!("Profilabfrage fehlgeschlagen: {}",String::from_utf8_lossy(&result.stderr)));}
        let bytes=fs::read(&output).map_err(|e|e.to_string())?;let _=fs::remove_file(output);
        let mut answer: Value = serde_json::from_slice(&bytes).map_err(|e|format!("Prusa-Profilantwort ungueltig: {e}"))?;
        // Simpliy ist ein reiner FFF-Slicer.
        if let Some(models) = answer.get_mut("printer_models").and_then(Value::as_array_mut) {
            models.retain(|m| m["technology"] == "FFF");
        }
        Ok(answer)
    }
}




/// Prusa-Datei lesen und Eltern aus den Systemprofilen der Engine aufloesen.
/// `skeleton`: Drucker, Druck-, Werkzeug- und Filamentprofil, auf denen fehlende Teile aufsetzen.
#[tauri::command]
async fn prusa_import(engine_path: String, filename: String, data_base64: String, skeleton: Value) -> Result<Value, String> {
    blocking(move || {
        let data = STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
        import_prusa_file(&engine_path, &filename, &data, &skeleton)
    }).await
}

/// Nur lesen: Die Datei und die Prusa-Profile bleiben unveraendert, die Engine laeuft mit Simpliys eigenem Datenordner.
fn import_prusa_file(engine_path: &str, filename: &str, data: &[u8], skeleton: &Value) -> Result<Value, String> {
    {
        if filename.len() > 260 { return Err("Dateiname zu lang".into()); }
        if data.len() > 64 << 20 { return Err("Datei zu groß (64 MiB)".into()); }
        let (source, mut notes) = prusa_import::read(filename, data)?;
        let presets = match source {
            prusa_import::Source::Config(config) => return Ok(json!({"config": config, "notes": notes})),
            prusa_import::Source::Presets(list) => list,
        };
        let mut out = Vec::new();
        for preset in presets {
            let mut entry = json!({"kind": preset.kind, "name": preset.name, "values": preset.values, "inherits": preset.inherits});
            if let Some(parent) = preset.inherits.first() {
                match resolve_parent(engine_path, &preset.kind, parent, skeleton) {
                    Ok((config, used)) => { entry["base"] = config; entry["skeleton"] = used; }
                    Err(e) => notes.push(format!("„{}“: Elternprofil „{parent}“ nicht aufgelöst ({e}). Nur die eigenen Werte werden übernommen.", preset.name)),
                }
            }
            out.push(entry);
        }
        Ok(json!({"presets": out, "notes": notes}))
    }
}

fn resolve_parent(engine_path: &str, kind: &str, parent: &str, skeleton: &Value) -> Result<(Value, Value), String> {
    let mut preset = skeleton.clone();
    if !preset.is_object() { preset = json!({}); }
    match kind {
        "printer" => {
            let answer = query_profiles(engine_path, Some(parent.to_owned()))?;
            let print = answer["print_profiles"].as_array().and_then(|l| l.first()).ok_or("kein Druckprofil für diesen Drucker")?;
            let first = |key: &str| print[key].as_array().and_then(|l| l.first()).and_then(Value::as_str).unwrap_or("").to_owned();
            preset = json!({"printer": parent, "print": print["name"], "tool": first("tool_print_profiles"), "filament": first("filament_profiles")});
        }
        "print" | "filament" => preset[kind] = json!(parent),
        _ => return Err("unbekannte Profilart".into()),
    }
    let config = engine::Engine::open(engine_path)?.base_config(&preset)?;
    Ok((config, preset))
}
static SLICING: AtomicBool = AtomicBool::new(false);
static UNSAVED: AtomicBool = AtomicBool::new(false);
static CLOSING: AtomicBool = AtomicBool::new(false);
/// Die Oberflaeche meldet ungespeicherte Prozesse. Nur dann haelt das Fenster das Schliessen fuer eine Rueckfrage an.
#[tauri::command]
fn set_unsaved(value: bool) { UNSAVED.store(value, Ordering::Relaxed); }
#[tauri::command]
fn close_app(window: tauri::Window) -> Result<(), String> {
    CLOSING.store(true, Ordering::Relaxed);
    window.destroy().map_err(|e| e.to_string())
}
static PROGRESS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
pub(crate) fn reset_progress() {
    PROGRESS.store(0, Ordering::Release);
}
/// Laeuft nur vorwaerts: Bei mehreren Objekten meldet die Engine dieselbe Stufe mehrfach.
pub(crate) fn advance_progress(percent: u32) {
    PROGRESS.fetch_max(percent.min(100), Ordering::AcqRel);
}
static JOB_STATUS: Mutex<String> = Mutex::new(String::new());
pub(crate) fn set_job_status(message: &str) {
    if let Ok(mut status) = JOB_STATUS.lock() { *status = message.to_string(); }
}
#[tauri::command]
fn slicing_progress() -> u32 {
    PROGRESS.load(Ordering::Acquire)
}
#[tauri::command]
fn slicing_status() -> String {
    JOB_STATUS.lock().map(|s| s.clone()).unwrap_or_default()
}
struct SlicingGuard;
impl Drop for SlicingGuard { fn drop(&mut self) { SLICING.store(false, Ordering::Release); } }
#[tauri::command]
async fn slice_project(engine_path: String, job: project::Job, output: String) -> Result<Value, String> {
    blocking(move || {
        if SLICING.swap(true, Ordering::Acquire) {
            return Err("Ein Slicing-Vorgang läuft bereits.".into());
        }
        let _guard = SlicingGuard;
        engine::reset_cancel();
        let engine = engine::Engine::open(&engine_path)?;
        let mut job = job;
        let prepared=expand_supports(&engine, &mut job)?;
        // Direct output has no opportunity to validate mixed support toolpaths.
        prepared.use_safe_fallback(&mut job);
        let sliced = engine.slice(&job, Path::new(&output))?;
        Ok(json!({"output": sliced.output.to_string_lossy(), "log": sliced.log, "effective": sliced.effective, "partBottom": sliced.part_bottom}))
    })
    .await
}

/// Alte Vorschau-Dateien loeschen: beim Start alle, sonst alles ausser den neuesten zwei.
fn clean_previews(all: bool) {
    let Ok(dir) = preview_directory() else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| (e.metadata().and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH), e.path()))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let keep = if all { 0 } else { 2 };
    for (_, path) in files.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
}
/// Kalibrier-G-Code (Flow-Tests) in eine Datei schreiben, damit er wie jeder G-Code zum Drucker gesendet werden kann.
#[tauri::command]
fn calibration_save(name: String, content: String) -> Result<String, String> {
    if content.len() > 5_000_000 { return Err("Kalibrierdatei zu groß".into()); }
    let clean = upload::remote_name(&name)?;
    let dir = env::temp_dir().join("SimpliySlicing").join("calibration");
    fs::create_dir_all(&dir).map_err(|e| format!("Ordner nicht verfuegbar: {e}"))?;
    let path = dir.join(clean);
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
fn preview_directory() -> Result<PathBuf, String> {
    let dir = env::temp_dir().join("SimpliySlicing").join("preview");
    fs::create_dir_all(&dir).map_err(|e| format!("Vorschauordner nicht verfuegbar: {e}"))?;
    Ok(dir)
}
#[tauri::command]
async fn slice_preview(engine_path: String, job: project::Job) -> Result<Value, String> {
    blocking(move || {
        if SLICING.swap(true, Ordering::Acquire) { return Err("Ein Slicing-Vorgang laeuft bereits.".into()); }
        let _guard = SlicingGuard;
        engine::reset_cancel();
        let binary = job.config["configuration"]["printer_settings"]["binary_gcode"] == json!(true);
        clean_previews(false);
        let mut path=preview_directory()?.join(format!("{}.{}",uid("preview"),if binary {"bgcode"} else {"gcode"}));
        let engine = engine::Engine::open(&engine_path)?;
        let mut job = job;
        let original = (!binary && !job.disable_weak_retry).then(|| job.clone());
        let mut prepared = expand_supports(&engine, &mut job)?;
        if binary && prepared.has_automatic_trial() {
            return Err("Automatische und eigene Stuetzen zusammen benoetigen vorerst Text-G-Code zur Kollisionspruefung. Bitte binaeren G-Code ausschalten.".into());
        }
        let mut sliced = engine.slice(&job, &path)?;
        let mut fallback_note = None::<String>;
        if prepared.has_automatic_trial() {
            set_job_status("Automatische und eigene Stuetzen werden auf Kollisionen geprueft");
            let reason = match gcode::load(&path.to_string_lossy(), |_| {}) {
                Ok(preview) => {
                    let report = supports::inspect::inspect(&preview, &prepared.checks);
                    if preview.arcs > 0 { Some("nicht auswertbare G-Code-Boegen".to_owned()) }
                    else if !report.floating.is_empty() { Some(format!("{} schwebende Stellen",report.floating.len())) }
                    else if !report.missing.is_empty() || !report.broken.is_empty() { Some("fehlende oder unterbrochene Stuetzen".to_owned()) }
                    else { match supports::inspect::mixed_support_overlap(&preview) {
                        Ok(Some([x,y,z])) => Some(format!("ueberlappende Bahnen bei X {x:.1} Y {y:.1} Z {z:.1}")),
                        Ok(None) => None,
                        Err(error) => Some(error),
                    }}
                }
                Err(error) => Some(format!("G-Code konnte nicht geprueft werden: {error}")),
            };
            if engine::cancelled() { return Err("Slicing abgebrochen.".into()); }
            if let Some(reason)=reason {
                prepared.use_safe_fallback(&mut job);
                fs::remove_file(&path).map_err(|e|format!("Vorlaeufige Vorschau konnte nicht entfernt werden: {e}"))?;
                path=preview_directory()?.join(format!("{}.gcode",uid("preview")));
                set_job_status("Kollisionsfreie Stuetzeinstellungen werden erneut gesliced");
                sliced=engine.slice(&job,&path)?;
                fallback_note=Some(format!("Automatische Prusa-Stuetzen wurden fuer dieses Modell ausgeschaltet: {reason}. Eigene Stuetzen bleiben erhalten."));
            }
        }
        let mut repaired = 0usize;
        if let Some(mut original) = original {
            if let Ok(first) = gcode::load(&path.to_string_lossy(), |_| {}) {
                let before = supports::inspect::inspect(&first, &prepared.checks);
                if !before.weak.is_empty() && before.weak.len() <= 8 {
                    let changed = supports::job::retry_weak_as_native(&mut original, &before.weak);
                    if changed > 0 {
                        set_job_status("Schwache Kontakte werden mit Prusa erneut versucht");
                        if let Ok(candidate_prepared) = expand_supports(&engine, &mut original) {
                            let candidate_path=preview_directory()?.join(format!("{}.gcode",uid("preview")));
                            if engine::cancelled() { return Err("Slicing abgebrochen.".into()); }
                            if let Ok(candidate) = engine.slice(&original, &candidate_path) {
                                let improved=std::cell::Cell::new(0usize);
                                let accepted = gcode::load(&candidate_path.to_string_lossy(), |_| {}).ok().is_some_and(|after| {
                                    let result=supports::inspect::inspect(&after, &candidate_prepared.checks);
                                    improved.set(before.weak.len().saturating_sub(result.weak.len()));
                                    let contained=|after:&[[f64;3]],before:&[[f64;3]],tolerance:f64| after.iter().all(|p|before.iter().any(|q|
                                        (p[0]-q[0]).abs()<tolerance && (p[1]-q[1]).abs()<tolerance && (p[2]-q[2]).abs()<tolerance));
                                    let no_new_weak=contained(&result.weak,&before.weak,0.05);
                                    let no_new_faults=contained(&result.missing,&before.missing,0.05)
                                        && contained(&result.broken,&before.broken,0.05)
                                        && contained(&result.floating,&before.floating,0.5);
                                    let needs_mixed_check=original.models.iter().any(|m|m.name.starts_with("Simpliy-Stuetze"));
                                    let collision_free=!needs_mixed_check || matches!(supports::inspect::mixed_support_overlap(&after),Ok(None));
                                    supports::plan::profile(&format!("Kontakt-Nachversuch: schwach {} -> {}, fehlend {} -> {}, gebrochen {} -> {}, schwebend {} -> {}, neue schwache {}, Kollision frei {}, nicht dekodierte Boegen {}", before.weak.len(), result.weak.len(), before.missing.len(), result.missing.len(), before.broken.len(), result.broken.len(), before.floating.len(), result.floating.len(), !no_new_weak, collision_free, after.arcs));
                                    after.arcs==0 && collision_free && no_new_weak && no_new_faults && result.weak.len()<before.weak.len()
                                        && result.missing.len()<=before.missing.len() && result.broken.len()<=before.broken.len()
                                        && result.floating.len()<=before.floating.len()
                                });
                                if accepted {
                                    let _=fs::remove_file(&path);
                                    path=candidate_path.clone();sliced=candidate;prepared=candidate_prepared;
                                    repaired=improved.get();
                                    if prepared.has_automatic_trial() {fallback_note=None;}
                                } else {let _=fs::remove_file(&candidate_path);}
                            } else {
                                let _=fs::remove_file(&candidate_path);
                                if engine::cancelled() { return Err("Slicing abgebrochen.".into()); }
                            }
                        }
                    }
                }
            }
        }
        if engine::cancelled() { return Err("Slicing abgebrochen.".into()); }
        let mut support_info = Value::Null;
        if !prepared.checks.is_empty() && !binary {
            set_job_status("St?tzen werden gepr?ft");
            support_info = match gcode::load(&path.to_string_lossy(), |_| {}) {
                Ok(preview) => {
                    let report = supports::inspect::inspect(&preview, &prepared.checks);
                    let mut warning=report.warning();
                    if let Some(note)=&fallback_note { if !warning.is_empty(){warning.push('\n');} warning.push_str(note); }
                    let mut text=report.summary();
                    if prepared.has_automatic_trial() && fallback_note.is_none() {text.push_str(", automatische Prusa-Stuetzen ausserhalb der Schutzbereiche geprueft");}
                    if repaired>0 {text.push_str(&format!(", {repaired} schwache Kontakte mit Prusa verbessert"));}
                    json!({"text": text, "warning": warning})
                }
                Err(error) => json!({"text": "St?tzen nicht gepr?ft", "warning": format!("St?tzen konnten nicht gepr?ft werden: {error}")}),
            };
        }
        Ok(json!({"output": sliced.output.to_string_lossy(), "log": sliced.log, "effective": sliced.effective, "supportInfo": support_info, "partBottom": sliced.part_bottom}))
    }).await
}
#[tauri::command]
async fn export_preview(source: String, output: String) -> Result<(), String> {
    blocking(move || {
        let root=fs::canonicalize(preview_directory()?).map_err(|e|e.to_string())?;
        let src=fs::canonicalize(&source).map_err(|e|format!("Vorschau nicht gefunden: {e}"))?;
        if src.parent()!=Some(root.as_path()) {return Err("Nur vorbereiteter G-Code kann exportiert werden.".into());}
        let extension=src.extension().and_then(|x|x.to_str()).ok_or("Dateityp fehlt")?;
        if !["gcode","bgcode"].contains(&extension) || Path::new(&output).extension().and_then(|x|x.to_str()).map(|s|s.to_ascii_lowercase()).as_deref()!=Some(extension) {return Err("Ausgabe-Dateityp passt nicht zur Vorschau.".into());}
        engine::copy_new(&src, Path::new(&output))
    }).await
}
#[tauri::command]
async fn export_project(engine_path: String, job: project::Job, output: String) -> Result<(), String> {
    blocking(move || {
        let engine = engine::Engine::open(&engine_path)?;
        let mut job = job;
        let prepared=expand_supports(&engine, &mut job)?;
        prepared.use_safe_fallback(&mut job);
        engine.export_project(&job, Path::new(&output))
    })
    .await
}

#[tauri::command]
fn cancel_slicing() {
    engine::cancel();
}

pub(crate) fn printer_url(address: &str) -> Result<tauri::Url, String> {
    let trimmed = address.trim();
    if trimmed.is_empty() || trimmed.len() > 2048 { return Err("Bitte eine Druckeradresse eingeben.".into()); }
    let full = if trimmed.contains("://") { trimmed.to_owned() } else { format!("http://{trimmed}") };
    let url = tauri::Url::parse(&full).map_err(|e| format!("Ungueltige Druckeradresse: {e}"))?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() { return Err("Nur HTTP(S)-Adressen ohne Zugangsdaten sind erlaubt.".into()); }
    Ok(url)
}



#[tauri::command]
async fn save_project(document: Value, path: String) -> Result<(), String> {
    blocking(move || projects::save(document, Path::new(&path))).await
}

#[tauri::command]
async fn open_project(path: String) -> Result<Value, String> {
    blocking(move || projects::open(Path::new(&path), &data_path()?.with_file_name("projects"))).await
}

/// Vor dem Oeffnen eines Projekts: der bisherige Arbeitsbereich bleibt erhalten.
#[tauri::command]
fn backup_workspace() -> Result<(), String> {
    let source = data_path()?;
    if !source.is_file() {
        return Ok(());
    }
    let folder = source.with_file_name("backups");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    fs::copy(&source, folder.join(format!("{}.json", uid("workspace")))).map_err(|e| e.to_string())?;
    Ok(())
}








// ---- Aktualisierungen, Engine-Installation, Lizenzen, Programmsymbol ----
static DOWNLOAD: std::sync::Mutex<(u64, u64)> = std::sync::Mutex::new((0, 0));
fn download_step(done: u64, total: u64) {
    if let Ok(mut d) = DOWNLOAD.lock() { *d = (done, total); }
}
#[tauri::command]
fn download_progress() -> (u64, u64) { DOWNLOAD.lock().map(|d| *d).unwrap_or((0, 0)) }
#[tauri::command]
async fn check_app_update(repo: String, channel: Option<String>) -> Result<Value, String> {
    let channel = updates::Channel::parse(channel.as_deref());
    tauri::async_runtime::spawn_blocking(move || updates::check_app(&repo, channel)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn download_app_update(url: String, name: String) -> Result<String, String> {
    download_step(0, 0);
    tauri::async_runtime::spawn_blocking(move || updates::download_app(&url, &name, &download_step)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn engine_releases() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(updates::engine_releases).await.map_err(|e| e.to_string())?
}
/// Neueste PrusaSlicer-3.x-Engine holen (nur wenn neuer als `current`); `null`, wenn die aktuelle schon die neueste ist.
#[tauri::command]
async fn engine_auto_update(current: String, channel: Option<String>) -> Result<Option<Value>, String> {
    download_step(0, 0);
    let channel = updates::Channel::parse(channel.as_deref());
    tauri::async_runtime::spawn_blocking(move || updates::auto_update_engine(&current, channel, &download_step)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn install_engine(version: String, url: String, confirmed: bool) -> Result<String, String> {
    download_step(0, 0);
    tauri::async_runtime::spawn_blocking(move || updates::install_engine(&version, &url, confirmed, &download_step)).await.map_err(|e| e.to_string())?
}
/// Texte der Einstellungen aus der installierten Engine (Pruefsumme -> Text). Simpliy liefert sie nicht aus.
#[tauri::command]
async fn engine_texts(engine_path: String, language: Option<String>) -> Result<std::collections::HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || engine_texts::texts_for_language(&engine_path, language.as_deref().unwrap_or("de"))).await.map_err(|e| e.to_string())?
}
// --simpliy-usb-monitor-alpha2
#[tauri::command]
fn serial_ports() -> Result<Vec<serial_control::PortInfo>, String> { serial_control::available_ports() }
#[tauri::command]
fn serial_connect(port: String, baud: u32) -> Result<serial_control::SerialSnapshot, String> { serial_control::connect(port, baud) }
#[tauri::command]
fn serial_disconnect() -> Result<serial_control::SerialSnapshot, String> { serial_control::disconnect() }
#[tauri::command]
fn serial_snapshot() -> Result<serial_control::SerialSnapshot, String> { serial_control::snapshot() }
#[tauri::command]
fn serial_query(command: String) -> Result<(), String> { serial_control::send_query(command) }

#[tauri::command]
fn legal_texts() -> Value {
    json!({
        "license": include_str!("../../legal/LIZENZ.md"),
        "notices": include_str!("../../legal/THIRD-PARTY-NOTICES.md"),
        "inventory": include_str!("../../legal/KOMPONENTEN.md"),
        "version": env!("CARGO_PKG_VERSION"),
    })
}
/// Eigenes Programmsymbol (PNG/ICO als Base64) oder Standard (leer).
#[tauri::command]
fn set_app_icon(window: tauri::WebviewWindow, png_base64: String) -> Result<(), String> {
    use base64::Engine as _;
    let bytes = if png_base64.is_empty() {
        include_bytes!("../icons/icon.png").to_vec()
    } else {
        base64::engine::general_purpose::STANDARD.decode(png_base64.trim()).map_err(|e| e.to_string())?
    };
    let image = tauri::image::Image::from_bytes(&bytes).map_err(|e| format!("Bild ungültig: {e}"))?;
    window.set_icon(image).map_err(|e| e.to_string())
}

pub fn run() {
    let folder = data_path().and_then(|path| path.parent().map(Path::to_path_buf).ok_or_else(|| "Kein Datenordner".to_owned()));
    let lock = folder
        .map_err(instance::Blocked::Failed)
        .and_then(|folder| instance::InstanceLock::acquire(&folder, std::time::Duration::from_secs(3)));
    // Die Sperre gilt, bis das Programm endet.
    let _lock = match lock {
        Ok(lock) => lock,
        Err(blocked) => {
            eprintln!("{}", blocked.message());
            startup_blocked(&blocked.message());
            return;
        }
    };
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            // Version im Titel, damit zwei offene Programmstaende unterscheidbar sind.
            for (_, window) in app.webview_windows() {
                let _ = window.set_title(concat!("Simpliy Slicing ", env!("CARGO_PKG_VERSION")));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if UNSAVED.load(Ordering::Relaxed) && !CLOSING.load(Ordering::Relaxed) {
                    use tauri::Emitter;
                    api.prevent_close();
                    let _ = window.emit("simpliy-close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![serial_ports,serial_connect,serial_disconnect,serial_snapshot,serial_query,get_workspace,save_workspace,import_profile,export_profile,detect_engine,dialogs::choose_models,dialogs::choose_output,load_mesh,read_preview,query_prusa_profiles,prusa_import,thumbnails::add_thumbnails,set_unsaved,close_app,printer_net::printer_view_show,printer_net::printer_view_hide,engine_base_config,slicing_status,slicing_progress,slice_project,slice_preview,export_preview,export_project,cancel_slicing,printer_net::open_printer_web,dialogs::choose_project,dialogs::choose_folder,dialogs::choose_gcode,save_project,open_project,backup_workspace,fonts::list_fonts,holes::hole_scan,holes::hole_adjust,fonts::read_font,check_mesh,repair_mesh,calibration_save,support_schema,support_plate,support_edit,support_hover,support_stl,support_prepare,printer_net::printer_test,printer_net::printer_upload,download_progress,check_app_update,download_app_update,engine_releases,engine_auto_update,install_engine,legal_texts,set_app_icon,engine_texts])
        .run(tauri::generate_context!())
        .expect("Simpliy Slicing: nativer Tauri-Start fehlgeschlagen");
}

#[cfg(test)]
mod workspace_recovery_tests {
    use super::*;

    fn folder() -> PathBuf {
        let dir = env::temp_dir().join(uid("ws-test"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn saving_keeps_a_complete_file_and_a_backup() {
        let dir = folder();
        let path = dir.join("workspace.json");
        atomic_write(&path, b"{\"a\":1}").unwrap();
        atomic_write(&path, b"{\"a\":2}").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"{\"a\":2}");
        assert_eq!(fs::read(path.with_extension("json.bak")).unwrap(), b"{\"a\":1}");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_or_broken_file_is_restored_from_the_backup() {
        let dir = folder();
        let path = dir.join("workspace.json");
        let good = INITIAL.as_bytes();
        fs::write(path.with_extension("json.bak"), good).unwrap();
        assert!(restore_backup(&path).is_some(), "fehlende Datei");
        assert!(path.is_file());
        fs::write(&path, b"{kaputt").unwrap();
        assert!(restore_backup(&path).is_some(), "beschaedigte Datei");
        assert!(serde_json::from_slice::<Value>(&fs::read(&path).unwrap()).is_ok());
        assert!(fs::read_dir(&dir).unwrap().flatten().any(|e| e.file_name().to_string_lossy().contains("defekt")));
        let _ = fs::remove_dir_all(dir);
    }
}
