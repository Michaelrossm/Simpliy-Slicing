//! Nur ein Simpliy je Arbeitsbereich.
//! 1. Sperrdatei, solange das Programm laeuft. Windows gibt sie auch nach einem Absturz frei.
//! 2. Aeltere Programmstaende kennen die Sperre nicht: Darum wird nie ueber fremde Aenderungen gespeichert.
use std::{
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    io::ErrorKind,
    path::Path,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

pub struct InstanceLock {
    _file: fs::File,
}

#[derive(Debug)]
pub enum Blocked {
    Running,
    Failed(String),
}

impl Blocked {
    pub fn message(&self) -> String {
        match self {
            Blocked::Running => "Simpliy Slicing läuft schon mit diesem Arbeitsbereich.\n\nBitte das geöffnete Fenster benutzen oder zuerst schließen.".into(),
            Blocked::Failed(error) => format!("Der Arbeitsbereich kann nicht gesperrt werden:\n{error}"),
        }
    }
}

impl InstanceLock {
    /// Wartet kurz: Beim Neubau im Entwicklungsbetrieb endet das alte Programm gerade erst.
    pub fn acquire(folder: &Path, patience: Duration) -> Result<InstanceLock, Blocked> {
        fs::create_dir_all(folder).map_err(|e| Blocked::Failed(e.to_string()))?;
        let path = folder.join("instance.lock");
        let since = Instant::now();
        loop {
            let mut options = fs::OpenOptions::new();
            options.read(true).write(true).create(true).truncate(false);
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                options.share_mode(0);
            }
            match options.open(&path) {
                Ok(file) => return Ok(InstanceLock { _file: file }),
                // 32 = wird von einem anderen Prozess benutzt, 33 = gesperrt
                Err(e) if matches!(e.raw_os_error(), Some(32 | 33)) || e.kind() == ErrorKind::WouldBlock => {
                    if since.elapsed() >= patience {
                        return Err(Blocked::Running);
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(Blocked::Failed(e.to_string())),
            }
        }
    }
}

/// Merkt sich, was dieses Programm zuletzt gelesen oder geschrieben hat.
pub struct Guard {
    seen: Mutex<Option<u64>>,
}

fn fingerprint(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

impl Guard {
    pub const fn new() -> Self {
        Guard { seen: Mutex::new(None) }
    }

    pub fn remember(&self, bytes: &[u8]) {
        if let Ok(mut seen) = self.seen.lock() {
            *seen = Some(fingerprint(bytes));
        }
    }

    pub fn check(&self, path: &Path) -> Result<(), String> {
        let Some(seen) = self.seen.lock().ok().and_then(|seen| *seen) else { return Ok(()) };
        match fs::read(path) {
            Ok(bytes) if fingerprint(&bytes) != seen => Err(
                "Nicht gespeichert: Ein anderes Programm (z. B. eine ältere Simpliy-Version) hat den Arbeitsbereich geändert. Bitte das andere Fenster schließen und Simpliy neu starten."
                    .into(),
            ),
            Err(e) if e.kind() != ErrorKind::NotFound => Err(format!("Arbeitsbereich nicht lesbar: {e}")),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(crate::uid(name));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    #[cfg(windows)]
    fn a_second_program_is_refused_until_the_first_ends() {
        let folder = folder("simpliy-lock");
        let first = InstanceLock::acquire(&folder, Duration::ZERO).unwrap();
        assert!(matches!(InstanceLock::acquire(&folder, Duration::from_millis(250)), Err(Blocked::Running)));
        drop(first);
        drop(InstanceLock::acquire(&folder, Duration::ZERO).unwrap());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn foreign_changes_are_never_overwritten() {
        let folder = folder("simpliy-guard");
        let file = folder.join("workspace.json");
        let guard = Guard::new();
        fs::write(&file, b"eins").unwrap();
        guard.remember(b"eins");
        assert!(guard.check(&file).is_ok());
        fs::write(&file, b"fremd").unwrap();
        assert!(guard.check(&file).is_err());
        fs::remove_dir_all(folder).unwrap();
    }
}
