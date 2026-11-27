//! Schriftdateien des Systems fuer den Text-Werkzeug-Dialog.
use super::*;

fn font_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(root) = env::var_os("WINDIR") {
        folders.push(PathBuf::from(root).join("Fonts"));
    }
    if let Some(root) = env::var_os("LOCALAPPDATA") {
        folders.push(PathBuf::from(root).join("Microsoft").join("Windows").join("Fonts"));
    }
    folders
}

#[tauri::command]
pub fn list_fonts() -> Vec<String> {
    let mut names: Vec<String> = font_folders()
        .iter()
        .filter_map(|folder| fs::read_dir(folder).ok())
        .flatten()
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| [".ttf", ".otf"].iter().any(|ext| name.to_lowercase().ends_with(ext)))
        .collect();
    names.sort_by_key(|name| name.to_lowercase());
    names.dedup();
    names
}

#[tauri::command]
pub fn read_font(name: String) -> Result<tauri::ipc::Response, String> {
    let lower = name.to_lowercase();
    if name.contains(['/', '\\', ':']) || name.contains("..") || !(lower.ends_with(".ttf") || lower.ends_with(".otf")) {
        return Err("Ungültige Schriftdatei".into());
    }
    let path = font_folders().into_iter().map(|f| f.join(&name)).find(|p| p.is_file()).ok_or("Schrift nicht gefunden")?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 40 * 1024 * 1024 {
        return Err("Schriftdatei zu groß".into());
    }
    Ok(tauri::ipc::Response::new(fs::read(path).map_err(|e| e.to_string())?))
}
