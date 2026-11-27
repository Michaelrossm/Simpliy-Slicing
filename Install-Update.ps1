param([Parameter(Mandatory=$true)][string]$ProjectRoot)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot.Trim('"'))
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Read-File([string]$path) { return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8).Replace("`r`n", "`n") }
function Put-File([string]$path, [string]$content) { [System.IO.File]::WriteAllText($path, $content, $utf8) }
function Replace-Exactly([string]$value,[string]$old,[string]$new,[string]$label) {
  $matches = [regex]::Matches($value, [regex]::Escape($old)).Count
  if ($matches -ne 1) { throw "Unpassender Quellcode bei $label (Fundstellen: $matches). Keine Dateien werden geaendert." }
  return $value.Replace($old, $new)
}
function Requirement([string]$relative) {
  $path=Join-Path $ProjectRoot $relative
  if (-not (Test-Path $path -PathType Leaf)) { throw "Nicht gefunden: $path. Bitte den Ordner mit frontend und src-tauri angeben." }
  return $path
}
try {
  $appPath = Requirement 'frontend/app.js'
  $optionPath = Requirement 'frontend/option-labels.js'
  $rustTextsPath = Requirement 'src-tauri/src/engine_texts.rs'
  $rustLibPath = Requirement 'src-tauri/src/lib.rs'
  $pkgPath = Requirement 'package.json'
  $cargoPath = Requirement 'src-tauri/Cargo.toml'
  $confPath = Requirement 'src-tauri/tauri.conf.json'

  $app = Read-File $appPath
  $opt = Read-File $optionPath
  $rust = Read-File $rustTextsPath
  $lib = Read-File $rustLibPath

  if ($app.Contains("from './i18n.js'")) { throw 'Dieses Sprachupdate wurde anscheinend bereits installiert.' }
  $app = Replace-Exactly $app "import {applyEngineTexts} from './option-labels.js';" @'
import {applyEngineTexts} from './option-labels.js';
import {getLanguagePreference, getLanguage, setLanguagePreference, translateDOM, watchTranslations} from './i18n.js';
'@ 'frontend/app.js: import'

  $app = Replace-Exactly $app '<button data-action="help">Hilfe</button>' @'
<label class="simpliy-language-select" title="Sprache / Language" style="display:inline-flex;align-items:center;gap:5px;font-size:12px">🌐
  <select id="simpliy-language" aria-label="Sprache / Language" style="max-width:145px;background:#262b33;color:#f3f3f3;border:1px solid #6a707a;border-radius:4px;padding:5px">
    <option value="auto" ${getLanguagePreference()==='auto'?'selected':''}>Automatisch</option>
    <option value="de" ${getLanguagePreference()==='de'?'selected':''}>Deutsch</option>
    <option value="en" ${getLanguagePreference()==='en'?'selected':''}>English</option>
  </select>
</label>
<button data-action="help">Hilfe</button>
'@ 'frontend/app.js: Sprache in der Toolbar'

  $oldBoot = @'
    // Beschreibungen kommen aus der installierten Engine (Simpliy liefert keine Engine-Texte aus).
    const texts=window.__TAURI__&&state.engine_path?await invoke('engine_texts',{enginePath:state.engine_path}).catch(()=>({})):{};
    catalog=applyEngineTexts(await rc.json(),texts).map(c=>({...c,label:PLACE.get(c.key)?.label||c.label}));
    catalogByKey=new Map(catalog.map(c=>[c.key,c]));
'@
  $newBoot = @'
    // Unveraenderte Vorlage halten, damit Sprachwechsel keine Uebersetzungen mischen.
    rawLanguageCatalog=await rc.json();
    await refreshLanguageCatalog();
'@
  $app = Replace-Exactly $app $oldBoot $newBoot 'frontend/app.js: Katalog laden'
  $app = Replace-Exactly $app @'
  </div>${modal?renderModal():''}`;
'@ @'
  </div>${modal?renderModal():''}`;
  translateDOM(app);
'@ 'frontend/app.js: Render-Uebersetzung'
  $app = Replace-Exactly $app @'
    applyBranding();
    render();
'@ @'
    applyBranding();
    watchTranslations(app);
    render();
'@ 'frontend/app.js: DOM beobachten'

  $languageLogic = @'
// Anwendungsweite Sprache; bewusst NICHT im Arbeitsbereich oder Projekt gespeichert.
let rawLanguageCatalog=null;
async function refreshLanguageCatalog() {
  if (!rawLanguageCatalog) return;
  const lang=getLanguage();
  const texts=window.__TAURI__&&state.engine_path
    ? await invoke('engine_texts',{enginePath:state.engine_path,language:lang}).catch(()=>({})) : {};
  const original=rawLanguageCatalog.map(c=>({...c,options:(c.options||[]).map(o=>({...o}))}));
  catalog=applyEngineTexts(original,texts,lang)
    .map(c=>({...c,label:lang==='de'?(PLACE.get(c.key)?.label||c.label):c.label}));
  catalogByKey=new Map(catalog.map(c=>[c.key,c]));
}
document.addEventListener('change',async event=>{
  if (event.target?.id!=='simpliy-language') return;
  event.stopImmediatePropagation(); // Sonstige Prozess-Events duerfen die Sprachwahl nicht als Druckwert speichern.
  setLanguagePreference(event.target.value);
  try { await refreshLanguageCatalog(); render(); }
  catch (error) { console.error('Sprache:', error); render(); }
},true);
'@
  $app = Replace-Exactly $app 'async function boot(){' ($languageLogic + "`nasync function boot(){") 'frontend/app.js: Sprachfunktion'

  $opt = Replace-Exactly $opt 'export function applyEngineTexts(catalog, texts = {}) {' "export function applyEngineTexts(catalog, texts = {}, language = 'de') {" 'option-labels.js: Sprache'
  $opt = Replace-Exactly $opt 'if (c.labelHash && texts[c.labelHash]) c.label = texts[c.labelHash];' "if (c.labelHash) c.label = texts[c.labelHash] || (language === 'en' ? c.key : c.label);" 'option-labels.js: Beschriftung'
  $opt = Replace-Exactly $opt 'for (const o of c.options || []) o.label = OPTION_LABELS[c.key]?.[o.value] || (o.labelHash && texts[o.labelHash]) || o.value;' "for (const o of c.options || []) o.label = (language === 'de' ? OPTION_LABELS[c.key]?.[o.value] : null) || (o.labelHash && texts[o.labelHash]) || o.value;" 'option-labels.js: Optionen'

  $rust = Replace-Exactly $rust 'pub fn texts(engine_path: &str) -> Result<HashMap<String, String>, String> {' @'
pub fn texts(engine_path: &str) -> Result<HashMap<String, String>, String> {
    texts_for_language(engine_path, "de")
}

/// Fuer en: englische Originale aus der .mo-Datei der separat installierten Engine.
/// Fuer de: deutsche Uebersetzungen aus derselben Datei. Keine Engine-Texte im Simpliy-Paket.
pub fn texts_for_language(engine_path: &str, language: &str) -> Result<HashMap<String, String>, String> {
'@ 'engine_texts.rs: Sprachfunktion'
  $rust = Replace-Exactly $rust '.map(|(o, t)| (fnv(&o), if t.is_empty() { o } else { t }))' @'
.map(|(o, t)| {
            let value = if language.eq_ignore_ascii_case("en") || t.is_empty() { o.clone() } else { t };
            (fnv(&o), value)
        })
'@ 'engine_texts.rs: englische Texte'

  $lib = Replace-Exactly $lib @'
async fn engine_texts(engine_path: String) -> Result<std::collections::HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || engine_texts::texts(&engine_path)).await.map_err(|e| e.to_string())?
}
'@ @'
async fn engine_texts(engine_path: String, language: Option<String>) -> Result<std::collections::HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || engine_texts::texts_for_language(&engine_path, language.as_deref().unwrap_or("de"))).await.map_err(|e| e.to_string())?
}
'@ 'lib.rs: Engine-Texte'

  # Ab hier erst schreiben: Alle Anker wurden zuvor erfolgreich geprueft.
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  $backup=Join-Path $ProjectRoot "Sicherungen\Sprachupdate-$stamp"
  New-Item -ItemType Directory -Force -Path $backup | Out-Null
  $pairs=@(
    @($appPath,$app),@($optionPath,$opt),@($rustTextsPath,$rust),@($rustLibPath,$lib)
  )
  foreach ($pair in $pairs) {
    $rel=$pair[0].Substring($ProjectRoot.TrimEnd('\').Length).TrimStart('\')
    $backupFile=Join-Path $backup $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupFile) | Out-Null
    Copy-Item -LiteralPath $pair[0] -Destination $backupFile
  }
  foreach($rel in @('package.json','package-lock.json','src-tauri/Cargo.toml','src-tauri/tauri.conf.json','src-tauri/Cargo.lock','frontend/i18n.js')){
    $p=Join-Path $ProjectRoot $rel
    if(Test-Path $p -PathType Leaf){$dst=Join-Path $backup $rel;New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent)|Out-Null;Copy-Item $p $dst}
  }
  foreach ($pair in $pairs) { Put-File $pair[0] $pair[1] }
  Copy-Item -LiteralPath (Join-Path $source 'frontend/i18n.js') -Destination (Join-Path $ProjectRoot 'frontend/i18n.js') -Force
  foreach($p in @($pkgPath,$cargoPath,$confPath,(Join-Path $ProjectRoot 'package-lock.json'),(Join-Path $ProjectRoot 'src-tauri/Cargo.lock'))){
    if(Test-Path $p -PathType Leaf){$s=Read-File $p;Put-File $p $s.Replace('0.0.0-alpha.1','0.0.0-alpha.2')}
  }
  Write-Host ''
  Write-Host 'Sprachupdate 0.0.0-alpha.2 erfolgreich in den QUELLCODE eingespielt.' -ForegroundColor Green
  Write-Host 'Deutsch und Englisch: Umschalten oben rechts im Programm, ohne Neustart.'
  Write-Host "Sicherungen: $backup"
  Write-Host 'Die laufende EXE wird dadurch NICHT aktualisiert. Danach Windows-Build ausfuehren.'
  exit 0
} catch {
  Write-Host ("Sprachupdate NICHT installiert: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
