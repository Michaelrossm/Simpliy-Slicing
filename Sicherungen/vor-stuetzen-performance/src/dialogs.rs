//! Native Dateidialoge.
use super::*;

#[tauri::command]
pub async fn choose_models() -> Result<Vec<Value>, String> {
    blocking(|| {
        let files = rfd::FileDialog::new()
            .set_title("Modelle importieren")
            .add_filter("3D-Modell", &["stl", "3mf", "obj", "step", "stp", "amf"])
            .pick_files()
            .unwrap_or_default();
        Ok(files
            .into_iter()
            .map(|p| json!({"path": p.to_string_lossy(), "name": p.file_name().unwrap_or_default().to_string_lossy()}))
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn choose_output(name: String, extension: String) -> Result<Option<String>, String> {
    if !["gcode", "bgcode", "3mf"].contains(&extension.as_str()) {
        return Err("Unbekannter Dateityp".into());
    }
    blocking(move || {
        Ok(rfd::FileDialog::new()
            .set_title("Speichern")
            .set_file_name(format!("{name}.{extension}"))
            .add_filter(extension.to_uppercase(), &[extension.as_str()])
            .save_file()
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn choose_project(save: bool, name: String) -> Result<Option<String>, String> {
    blocking(move || {
        let dialog = rfd::FileDialog::new().add_filter("Simpliy-Projekt", &[projects::EXTENSION]);
        let chosen = if save {
            dialog.set_title("Projekt speichern").set_file_name(format!("{name}.{}", projects::EXTENSION)).save_file()
        } else {
            dialog.set_title("Projekt öffnen").pick_file()
        };
        Ok(chosen.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn choose_folder() -> Result<Option<String>, String> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title("Ordner für den G-Code aller Platten")
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn choose_gcode() -> Result<Option<String>, String> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .set_title("G-Code zum Senden")
            .add_filter("G-Code", &["gcode", "bgcode"])
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned()))
    })
    .await
}
