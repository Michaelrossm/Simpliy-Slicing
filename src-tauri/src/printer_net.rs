//! Drucker im Netzwerk: Verbindungstest, Upload und Weboberflaeche.
use super::*;

#[tauri::command]
pub async fn printer_test(target: upload::Target) -> Result<String, String> {
    blocking(move || upload::test(&target)).await
}

#[tauri::command]
pub async fn printer_upload(target: upload::Target, path: String, name: String, start: Option<bool>) -> Result<String, String> {
    blocking(move || {
        set_job_status("Upload beginnt");
        upload::send(&target, Path::new(&path), &name, start.unwrap_or(false), &|sent, total| {
            set_job_status(&format!("Upload {} %", sent * 100 / total.max(1)));
        })
    })
    .await
}

#[tauri::command]
pub async fn open_printer_web(app: tauri::AppHandle, address: String) -> Result<(), String> {
    let url = printer_url(&address)?;
    // This window has no matching Tauri capability: remote pages cannot call our commands.
    tauri::WebviewWindowBuilder::new(&app, uid("printer-web"), tauri::WebviewUrl::External(url))
        .title("Simpliy Slicing - Drucker Weboberflaeche").inner_size(1200.0, 800.0)
        .build().map_err(|e| format!("Druckerfenster konnte nicht geoeffnet werden: {e}"))?;
    Ok(())
}

/// Weboberflaeche des Druckers im Hauptfenster (eigene Webansicht ueber der Ansichtsflaeche, ohne Simpliy-Befehle).
const PRINTER_VIEW: &str = "printer-view";

#[tauri::command]
pub async fn printer_view_show(window: tauri::Window, address: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let url = printer_url(&address)?;
    let position = tauri::LogicalPosition::new(x, y);
    let size = tauri::LogicalSize::new(width.max(1.0), height.max(1.0));
    if let Some(view) = window.webviews().into_iter().find(|v| v.label() == PRINTER_VIEW) {
        if view.url().map(|u| u != url).unwrap_or(true) {
            view.navigate(url).map_err(|e| e.to_string())?;
        }
        view.set_position(position).map_err(|e| e.to_string())?;
        view.set_size(size).map_err(|e| e.to_string())?;
        view.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    window
        .add_child(tauri::webview::WebviewBuilder::new(PRINTER_VIEW, tauri::WebviewUrl::External(url)), position, size)
        .map_err(|e| format!("Weboberfläche konnte nicht geöffnet werden: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn printer_view_hide(window: tauri::Window) -> Result<(), String> {
    if let Some(view) = window.webviews().into_iter().find(|v| v.label() == PRINTER_VIEW) {
        view.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
