//! Projektdatei (.simpliyproject): ZIP mit project.json und allen Modelldateien.
use crate::uid;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub const EXTENSION: &str = "simpliyproject";
const MODEL_TYPES: [&str; 6] = ["stl", "3mf", "obj", "step", "stp", "amf"];
const MAX_DOCUMENT: u64 = 64 * 1024 * 1024;
const MAX_MODEL: u64 = 400 * 1024 * 1024;
const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024;

fn model_type(path: &str) -> Result<String, String> {
    let extension = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if MODEL_TYPES.contains(&extension.as_str()) {
        Ok(extension)
    } else {
        Err(format!("Keine Modelldatei: {path}"))
    }
}

pub fn validate(document: &Value) -> Result<(), String> {
    if document["format"] != "SimpliyProject" || document["version"] != 1 {
        return Err("Keine passende Simpliy-Projektdatei.".into());
    }
    let plates = document["plates"].as_array().filter(|p| !p.is_empty() && p.len() <= 100).ok_or("Platten fehlen")?;
    let models = document["models"].as_array().filter(|m| m.len() <= 2000).ok_or("Modelle fehlen")?;
    for field in ["processes", "profiles"] {
        if !document[field].as_array().map_or(false, |a| !a.is_empty() && a.len() <= 500) {
            return Err(format!("Projekt unvollständig: {field}"));
        }
    }
    // Kennungen landen in der Oberflaeche in Attributen.
    let plain = |value: &Value| {
        value.as_str().map_or(false, |s| {
            !s.is_empty() && s.len() < 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
    };
    if plates.iter().chain(models).any(|entry| !plain(&entry["id"])) {
        return Err("Projekt enthält ungültige Kennungen.".into());
    }
    if models.iter().any(|m| !plates.iter().any(|p| p["id"] == m["plate"])) {
        return Err("Ein Modell verweist auf eine fehlende Platte.".into());
    }
    for bundle in document["profiles"].as_array().unwrap() {
        crate::validate_bundle(bundle)?;
    }
    Ok(())
}

pub fn save(mut document: Value, target: &Path) -> Result<(), String> {
    if !target.extension().and_then(|e| e.to_str()).map_or(false, |e| e.eq_ignore_ascii_case(EXTENSION)) {
        return Err(format!("Projektdateien enden auf .{EXTENSION}"));
    }
    validate(&document)?;
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    let mut stored: HashMap<String, String> = HashMap::new();
    for model in document["models"].as_array_mut().unwrap() {
        let path = model["path"].as_str().ok_or("Ein Modell hat keine Datei.")?.to_owned();
        let entry = match stored.get(&path) {
            Some(entry) => entry.clone(),
            None => {
                let extension = model_type(&path)?;
                if !Path::new(&path).is_file() {
                    return Err(format!("Modelldatei fehlt: {path}"));
                }
                let entry = format!("models/{}.{extension}", entries.len());
                entries.push((entry.clone(), PathBuf::from(&path)));
                stored.insert(path, entry.clone());
                entry
            }
        };
        model["path"] = json!(entry);
    }
    let text = serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?;
    let temporary = target.with_file_name(format!(".{}.tmp", uid("simpliy-project")));
    let written = (|| -> Result<(), String> {
        let file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zip.start_file("project.json", options).map_err(|e| e.to_string())?;
        zip.write_all(&text).map_err(|e| e.to_string())?;
        for (name, path) in &entries {
            zip.start_file(name.as_str(), options.large_file(true)).map_err(|e| e.to_string())?;
            std::io::copy(&mut fs::File::open(path).map_err(|e| e.to_string())?, &mut zip).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?.sync_all().map_err(|e| e.to_string())?;
        // Erst die vollstaendige Datei ersetzt den vorherigen Stand.
        fs::rename(&temporary, target).map_err(|e| e.to_string())
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written.map_err(|e| format!("Projekt nicht gespeichert: {e}"))
}

pub fn open(source: &Path, storage: &Path) -> Result<Value, String> {
    let file = fs::File::open(source).map_err(|e| format!("Projekt nicht lesbar: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|_| "Die Projektdatei ist beschädigt.".to_owned())?;
    let mut text = Vec::new();
    archive
        .by_name("project.json")
        .map_err(|_| "project.json fehlt".to_owned())?
        .take(MAX_DOCUMENT + 1)
        .read_to_end(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > MAX_DOCUMENT {
        return Err("Projekt zu groß.".into());
    }
    let mut document: Value = serde_json::from_slice(&text).map_err(|e| e.to_string())?;
    validate(&document)?;

    let folder = storage.join(uid("project"));
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut extracted: HashMap<String, String> = HashMap::new();
        let mut total = 0;
        for model in document["models"].as_array_mut().unwrap() {
            let entry = model["path"].as_str().unwrap_or("").to_owned();
            if !extracted.contains_key(&entry) {
                if !entry.starts_with("models/") || entry.contains("..") || entry.contains('\\') {
                    return Err("Ungültiger Dateipfad im Projekt.".into());
                }
                // Der Zielname kommt nie aus dem Archiv.
                let path = folder.join(format!("model-{}.{}", extracted.len(), model_type(&entry)?));
                let packed = archive.by_name(&entry).map_err(|_| format!("Im Projekt fehlt {entry}"))?;
                let mut output = fs::File::create(&path).map_err(|e| e.to_string())?;
                let size = std::io::copy(&mut packed.take(MAX_MODEL + 1), &mut output).map_err(|e| e.to_string())?;
                total += size;
                if size > MAX_MODEL || total > MAX_TOTAL {
                    return Err("Modelle im Projekt sind zu groß.".into());
                }
                extracted.insert(entry.clone(), path.to_string_lossy().into_owned());
            }
            model["path"] = json!(extracted[&entry]);
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&folder);
        return Err(error);
    }
    Ok(document)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(path: &str) -> Value {
        json!({
            "format": "SimpliyProject", "version": 1,
            "plates": [{"id": "a", "name": "Platte 1"}, {"id": "b", "name": "Platte 2"}],
            "models": [{"id": "m1", "plate": "a", "path": path}, {"id": "m2", "plate": "b", "path": path}],
            "processes": [{"id": "p"}],
            "profiles": [{"manifest": {"format": "SimpliyProfile", "schema_version": 1}, "profile": {"base_parameters": {}, "categories": []}}],
        })
    }

    fn workspace() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let at = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("{}-{at}", uid("project-test")));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn several_plates_survive_without_the_original_files() {
        let dir = workspace();
        let model = dir.join("teil.stl");
        fs::write(&model, b"solid test").unwrap();
        let file = dir.join("p.simpliyproject");
        save(document(&model.to_string_lossy()), &file).unwrap();
        save(document(&model.to_string_lossy()), &file).unwrap(); // erneut speichern
        fs::remove_file(&model).unwrap();
        let opened = open(&file, &dir.join("store")).unwrap();
        assert_eq!(opened["plates"].as_array().unwrap().len(), 2);
        assert_eq!(opened["models"][0]["path"], opened["models"][1]["path"]);
        assert_eq!(fs::read(opened["models"][0]["path"].as_str().unwrap()).unwrap(), b"solid test");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn archive_paths_cannot_escape() {
        let dir = workspace();
        for evil in ["models/../../evil.stl", "C:/Windows/evil.stl", "models/..\\evil.stl"] {
            let file = dir.join("evil.simpliyproject");
            let mut zip = ZipWriter::new(fs::File::create(&file).unwrap());
            zip.start_file("project.json", SimpleFileOptions::default()).unwrap();
            zip.write_all(document(evil).to_string().as_bytes()).unwrap();
            zip.finish().unwrap();
            assert!(open(&file, &dir.join("store")).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn ids_cannot_inject_markup() {
        let mut bad = document("a.stl");
        bad["plates"][0]["id"] = json!("\"><img>");
        assert!(validate(&bad).is_err());
    }
}
