//! Aktualisierungen ueber GitHub: Simpliy selbst (Quelle noch einzurichten) und die Slicing-Engine PrusaSlicer.
//! Die Engine wird nur in Simpliys eigenen Ordner installiert (%LOCALAPPDATA%\SimpliySlicing\engines\<Version>).
//! `engine::VERSION` ist die zuletzt geprueft Version; neuere 3.x-Versionen werden bei Bedarf automatisch installiert
//! und vor der Benutzung auf die benoetigten Funktionen geprueft (`engine::probe`).
use serde_json::{json, Value};
use std::{fs, io::Read, path::PathBuf};

/// GitHub-Repository von Simpliy ("besitzer/name"). Leer, solange noch nichts veroeffentlicht ist.
pub const APP_REPO: &str = "";
const ENGINE_REPO: &str = "prusa3d/PrusaSlicer";
const AGENT: &str = concat!("simpliy-slicing/", env!("CARGO_PKG_VERSION"));

fn get_json(url: &str) -> Result<Value, String> {
    let response = ureq::get(url)
        .set("User-Agent", AGENT)
        .set("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|e| format!("GitHub nicht erreichbar: {e}"))?;
    response.into_json().map_err(|e| format!("Antwort von GitHub ungültig: {e}"))
}

/// Update-Kanal: wie stabil eine Version sein muss. `Alpha` nimmt alles, `Beta` nur Beta/RC/Release, `Release` nur Release.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    Release,
    Beta,
    Alpha,
}

impl Channel {
    pub fn parse(text: Option<&str>) -> Channel {
        match text.map(|t| t.trim().to_ascii_lowercase()).as_deref() {
            Some("release") | Some("stable") => Channel::Release,
            Some("beta") => Channel::Beta,
            _ => Channel::Alpha,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Channel::Release => "release",
            Channel::Beta => "beta",
            Channel::Alpha => "alpha",
        }
    }
}

/// Stabilitaet einer Version aus ihrer Vorabkennung: keine = Release, beta/rc = Beta, sonst (alpha, dev, …) = Alpha.
pub fn stability(version: &semver::Version) -> Channel {
    if version.pre.is_empty() {
        return Channel::Release;
    }
    let pre = version.pre.as_str().to_ascii_lowercase();
    if pre.starts_with("beta") || pre.starts_with("rc") {
        Channel::Beta
    } else {
        Channel::Alpha
    }
}

/// Darf eine Version in diesem Kanal angeboten werden?
pub fn allows(channel: Channel, version: &semver::Version) -> bool {
    match channel {
        Channel::Alpha => true,
        Channel::Beta => stability(version) != Channel::Alpha,
        Channel::Release => stability(version) == Channel::Release,
    }
}

/// Version aus einem Tag ("version_3.0.0-alpha14", "v0.0.1-alpha.2").
pub fn version_of(tag: &str) -> Option<semver::Version> {
    let text = tag.trim_start_matches("version_").trim_start_matches('v');
    // Prusa schreibt "3.0.0-alpha14": als Text verglichen waere alpha14 aelter als alpha9.
    // Deshalb wie "3.0.0-alpha.14" behandeln.
    if let Some((core, pre)) = text.split_once('-') {
        if let Some(split) = pre.find(|c: char| c.is_ascii_digit()) {
            let (word, number) = pre.split_at(split);
            if !word.is_empty() && !word.ends_with('.') && number.chars().all(|c| c.is_ascii_digit()) {
                return semver::Version::parse(&format!("{core}-{word}.{number}")).ok();
            }
        }
    }
    semver::Version::parse(text).ok()
}

/// Neueste Simpliy-Version auf GitHub im gewaehlten Kanal (alpha, beta, release); zeigt auch, was jeder Kanal anbietet.
pub fn check_app(repo: &str, channel: Channel) -> Result<Value, String> {
    let repo = if repo.trim().is_empty() { APP_REPO } else { repo.trim() };
    let current = env!("CARGO_PKG_VERSION");
    if repo.is_empty() {
        return Ok(json!({"configured": false, "current": current,
            "message": "Die Update-Quelle (GitHub-Repository) ist noch nicht eingerichtet."}));
    }
    if !repo.split('/').count().eq(&2) || repo.contains("..") {
        return Err("Repository bitte als besitzer/name angeben.".into());
    }
    let list = get_json(&format!("https://api.github.com/repos/{repo}/releases?per_page=20"))?;
    let all: Vec<(semver::Version, &Value)> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["draft"] != json!(true))
        .filter_map(|r| Some((version_of(r["tag_name"].as_str()?)?, r)))
        .collect();
    // Was bietet jeder Kanal an?
    let offer = |c: Channel| all.iter().filter(|(v, _)| allows(c, v)).map(|(v, _)| v).max().map(|v| v.to_string());
    let available = json!({"alpha": offer(Channel::Alpha), "beta": offer(Channel::Beta), "release": offer(Channel::Release)});
    let newest = all.iter().filter(|(v, _)| allows(channel, v)).max_by(|a, b| a.0.cmp(&b.0)).map(|(v, r)| (v.clone(), *r));
    let Some((version, release)) = newest else {
        return Ok(json!({"configured": true, "current": current, "channel": channel.name(), "available": available,
            "message": format!("Im Kanal „{}“ ist noch keine Version veröffentlicht.", channel.name())}));
    };
    let mine = semver::Version::parse(current).map_err(|e| e.to_string())?;
    let asset = release["assets"].as_array().into_iter().flatten().find(|a| {
        let name = a["name"].as_str().unwrap_or("").to_ascii_lowercase();
        name.ends_with(".zip") || name.ends_with(".exe") || name.ends_with(".msi")
    });
    Ok(json!({
        "configured": true, "current": current, "latest": version.to_string(), "newer": version > mine,
        "channel": channel.name(), "available": available, "latest_stability": stability(&version).name(),
        "current_stability": stability(&mine).name(),
        "notes": release["body"].as_str().unwrap_or("").chars().take(4000).collect::<String>(),
        "page": release["html_url"], "asset": asset.map(|a| json!({"name": a["name"], "url": a["browser_download_url"], "size": a["size"]})),
    }))
}

/// Erlaubte Download-Quellen: nur GitHub-Releases.
fn trusted(url: &str) -> bool {
    url.starts_with("https://github.com/") || url.starts_with("https://objects.githubusercontent.com/")
}

fn download(url: &str, target: &PathBuf, progress: &dyn Fn(u64, u64)) -> Result<(), String> {
    if !trusted(url) {
        return Err("Download nur von GitHub erlaubt.".into());
    }
    let response = ureq::get(url).set("User-Agent", AGENT).call().map_err(|e| format!("Download fehlgeschlagen: {e}"))?;
    let total: u64 = response.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
    let mut reader = response.into_reader();
    let partial = target.with_extension("part");
    let mut file = fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 1 << 16];
    let mut done = 0u64;
    loop {
        let n = reader.read(&mut buffer).map_err(|e| format!("Download abgebrochen: {e}"))?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buffer[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        progress(done, total);
    }
    drop(file);
    if total > 0 && done != total {
        let _ = fs::remove_file(&partial);
        return Err("Download unvollständig.".into());
    }
    fs::rename(&partial, target).map_err(|e| e.to_string())
}

/// Simpliy-Update in den Download-Ordner laden (wird nicht automatisch ausgefuehrt).
pub fn download_app(url: &str, name: &str, progress: &dyn Fn(u64, u64)) -> Result<String, String> {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || "._-".contains(*c)).collect();
    if safe.is_empty() {
        return Err("Dateiname ungültig.".into());
    }
    let folder = std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Downloads")).ok_or("Download-Ordner nicht gefunden")?;
    let mut target = folder.join(&safe);
    let mut n = 1;
    while target.exists() {
        target = folder.join(format!("{n}-{safe}"));
        n += 1;
    }
    download(url, &target, progress)?;
    Ok(target.to_string_lossy().into_owned())
}

/// Ordner der von Simpliy installierten Engines.
pub fn engines_dir() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA fehlt")?;
    Ok(PathBuf::from(base).join("SimpliySlicing").join("engines"))
}

/// PrusaSlicer-3.x-Versionen auf GitHub mit Windows-Paket, neueste zuerst; markiert die gepruefte und installierte.
pub fn engine_releases() -> Result<Value, String> {
    engine_releases_in(Channel::Alpha)
}

/// Wie `engine_releases`, aber nur Versionen, die der Kanal anbietet.
pub fn engine_releases_in(channel: Channel) -> Result<Value, String> {
    let list = get_json(&format!("https://api.github.com/repos/{ENGINE_REPO}/releases?per_page=40"))?;
    let installed = engines_dir().ok();
    let mut out: Vec<(semver::Version, Value)> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| r["draft"] != json!(true))
        .filter_map(|r| {
            let tag = r["tag_name"].as_str()?;
            let version = version_of(tag)?;
            if version.major < 3 || !allows(channel, &version) {
                return None; // 2.x kennt das 3.0-Auftragsformat nicht
            }
            let plain = tag.trim_start_matches("version_");
            let asset = r["assets"].as_array()?.iter().find(|a| a["name"].as_str() == Some(&format!("PrusaSlicer-{plain}.zip")))?;
            let exe = installed.as_ref().map(|d| d.join(plain).join("PrusaSlicer.exe"));
            let stable = stability(&version).name();
            Some((version, json!({
                "version": plain, "tested": plain == crate::engine::VERSION, "prerelease": r["prerelease"], "channel": stable,
                "published": r["published_at"], "url": asset["browser_download_url"], "size": asset["size"], "page": r["html_url"],
                "installed": exe.as_ref().is_some_and(|p| p.is_file()), "path": exe.map(|p| p.to_string_lossy().into_owned()),
            })))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(json!({"tested": crate::engine::VERSION, "releases": out.into_iter().map(|(_, v)| v).collect::<Vec<_>>()}))
}

/// Neueste 3.x-Engine ermitteln und bei Bedarf installieren. `None`, wenn nichts Neueres existiert.
/// Vorabversionen (alpha/beta) werden nur uebernommen, wenn die aktuelle Engine selbst eine Vorabversion ist.
/// Die bisherige Version bleibt installiert; die neue wird vor der Rueckgabe auf Verträglichkeit geprueft.
pub fn auto_update_engine(current_exe: &str, channel: Channel, progress: &dyn Fn(u64, u64)) -> Result<Option<Value>, String> {
    let current_line = crate::engine::version_of_exe(current_exe)?;
    let current = version_of(&current_line).ok_or("Aktuelle Engine-Version nicht lesbar.")?;
    let releases = engine_releases_in(channel)?;
    let Some(next) = releases["releases"].as_array().into_iter().flatten().find(|r| {
        r["version"].as_str().and_then(|v| version_of(v)).is_some_and(|v| v > current)
    }) else {
        return Ok(None);
    };
    let version = next["version"].as_str().ok_or("Version fehlt")?.to_owned();
    let path = if next["installed"] == json!(true) {
        next["path"].as_str().ok_or("Pfad fehlt")?.to_owned()
    } else {
        install_engine(&version, next["url"].as_str().ok_or("Download-Adresse fehlt")?, true, progress)?
    };
    // Nur uebernehmen, wenn die neue Engine die benoetigten Funktionen hat; sonst bleibt die bisherige aktiv.
    crate::engine::Engine::open(&path).map_err(|e| format!("Neue Engine {version} nicht übernommen: {e}"))?;
    Ok(Some(json!({"version": version, "path": path, "previous": current_line})))
}

/// Neueste installierte Engine im Simpliy-Ordner (hoechste Version), falls vorhanden.
pub fn newest_installed_engine() -> Option<PathBuf> {
    let mut found: Vec<(semver::Version, PathBuf)> = fs::read_dir(engines_dir().ok()?)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let exe = e.path().join("PrusaSlicer.exe");
            exe.is_file().then(|| version_of(&e.file_name().to_string_lossy()).map(|v| (v, exe))).flatten()
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().next().map(|(_, p)| p)
}

/// Engine herunterladen und nach engines\<Version> entpacken. Nicht gepruefte Versionen nur mit `confirmed`.
pub fn install_engine(version: &str, url: &str, confirmed: bool, progress: &dyn Fn(u64, u64)) -> Result<String, String> {
    if !version.chars().all(|c| c.is_ascii_alphanumeric() || ".-".contains(c)) || version.is_empty() {
        return Err("Version ungültig.".into());
    }
    if version != crate::engine::VERSION && !confirmed {
        return Err(format!("PrusaSlicer {version} ist mit Simpliy nicht geprüft. Bitte die Installation ausdrücklich bestätigen."));
    }
    let root = engines_dir()?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let archive = root.join(format!("PrusaSlicer-{version}.zip"));
    download(url, &archive, progress)?;
    let target = root.join(version);
    let staging = root.join(format!("{version}.neu"));
    let _ = fs::remove_dir_all(&staging);
    let file = fs::File::open(&archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("Archiv ungültig: {e}"))?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name() else { continue };
        // Oberster Ordner im Archiv ("PrusaSlicer-<Version>/") entfaellt.
        let inner: PathBuf = name.components().skip(1).collect();
        if inner.as_os_str().is_empty() {
            continue;
        }
        let out = staging.join(inner);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(out.parent().ok_or("Pfad")?).map_err(|e| e.to_string())?;
            let mut file = fs::File::create(&out).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
        }
    }
    let exe = staging.join("PrusaSlicer.exe");
    if !exe.is_file() {
        let _ = fs::remove_dir_all(&staging);
        return Err("Im Archiv fehlt PrusaSlicer.exe.".into());
    }
    // Alte Installation erst beiseite legen und bei einem Fehler zurueckholen, nie vorher loeschen.
    let old = root.join(format!("{version}.alt"));
    let _ = fs::remove_dir_all(&old);
    let had_old = target.exists();
    if had_old {
        fs::rename(&target, &old).map_err(|e| format!("Bisherige Installation nicht ersetzbar (laeuft die Engine noch?): {e}"))?;
    }
    if let Err(e) = fs::rename(&staging, &target) {
        if had_old {
            let _ = fs::rename(&old, &target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Installation fehlgeschlagen, bisherige Version bleibt erhalten: {e}"));
    }
    let _ = fs::remove_dir_all(&old);
    let _ = fs::remove_file(&archive);
    if version != crate::engine::VERSION {
        allow_engine(version)?;
    }
    Ok(target.join("PrusaSlicer.exe").to_string_lossy().into_owned())
}

fn allowed_file() -> Result<PathBuf, String> {
    Ok(engines_dir()?.join("freigegeben.json"))
}

/// Vom Nutzer trotz fehlender Pruefung freigegebene Engine-Versionen.
pub fn allowed_engines() -> Vec<String> {
    allowed_file().ok().and_then(|p| fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn allow_engine(version: &str) -> Result<(), String> {
    let mut list = allowed_engines();
    if !list.iter().any(|v| v == version) {
        list.push(version.to_owned());
    }
    let path = allowed_file()?;
    fs::create_dir_all(path.parent().ok_or("Pfad")?).map_err(|e| e.to_string())?;
    fs::write(path, serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_like_releases() {
        let a15 = version_of("version_3.0.0-alpha15").unwrap();
        assert!(a15 > version_of("version_3.0.0-alpha14").unwrap() && a15 < version_of("version_3.0.0").unwrap());
        let a14 = version_of("version_3.0.0-alpha14").unwrap();
        let a9 = version_of("version_3.0.0-alpha9").unwrap();
        assert!(a14 > a9, "alpha14 nach alpha9");
        assert!(version_of("version_3.0.0").unwrap() > a14);
        assert!(version_of("v0.0.1-alpha.2").unwrap() > version_of("0.0.0-alpha.1").unwrap());
        assert!(version_of("version_2.9.7").unwrap().major == 2);
        assert!(!trusted("https://example.com/x.zip"));
        assert!(trusted("https://github.com/prusa3d/PrusaSlicer/releases/download/version_3.0.0-alpha14/PrusaSlicer-3.0.0-alpha14.zip"));
    }

    #[test]
    fn app_without_repository_is_not_configured() {
        let answer = check_app("", Channel::Alpha).unwrap();
        assert_eq!(answer["configured"], false);
    }

    #[test]
    fn channels_filter_by_stability() {
        let v = |t: &str| version_of(t).unwrap();
        let (a, b, rc, r) = (v("v0.0.1-alpha.1"), v("v0.0.1-beta.2"), v("v0.0.1-rc.1"), v("v0.0.1"));
        assert_eq!([stability(&a), stability(&b), stability(&rc), stability(&r)], [Channel::Alpha, Channel::Beta, Channel::Beta, Channel::Release]);
        assert!([&a, &b, &rc, &r].iter().all(|x| allows(Channel::Alpha, x)));
        assert!(!allows(Channel::Beta, &a) && allows(Channel::Beta, &b) && allows(Channel::Beta, &rc) && allows(Channel::Beta, &r));
        assert!(!allows(Channel::Release, &a) && !allows(Channel::Release, &b) && allows(Channel::Release, &r));
        // Reihenfolge der Versionen: alpha < beta < rc < release
        assert!(a < b && b < rc && rc < r);
        // Prusa-Tags
        assert_eq!(stability(&v("version_3.0.0-alpha15")), Channel::Alpha);
        assert_eq!(stability(&v("version_3.0.0")), Channel::Release);
        assert_eq!(Channel::parse(Some("Beta")), Channel::Beta);
        assert_eq!(Channel::parse(Some("release")), Channel::Release);
        assert_eq!(Channel::parse(None), Channel::Alpha);
    }
}
