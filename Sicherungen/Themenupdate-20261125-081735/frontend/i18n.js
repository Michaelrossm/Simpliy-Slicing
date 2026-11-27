/** Simpliy UI localization – affects only presentation, never print settings or G-code. */
const STORAGE_KEY = 'simpliy.language.preference';
let preference = null;
const en = {
  'Neu':'New','Öffnen':'Open','Speichern':'Save','Speichern unter':'Save as',
  'Modell importieren':'Import model','Prozess':'Process','Rückgängig':'Undo',
  '3MF speichern':'Save 3MF','G-Code speichern':'Save G-code',
  'G-Code speichern ...':'Save G-code ...','Zum Drucker senden':'Send to printer',
  'Zum Drucker hochladen ...':'Upload to printer ...',
  'Prusa-Pfad':'Prusa path','Arbeitsbereich sichern':'Back up workspace','Hilfe':'Help',
  'Sprache':'Language','Automatisch':'Automatic','Deutsch':'German','Englisch':'English',
  'Modell':'Model','Modelle':'Models','G-Code':'G-code','Drucker':'Printer',
  'Drucker verwalten':'Manage printers','Drucker auswählen':'Select printer',
  'Drucker hinzufügen':'Add printer','Drucker gespeichert.':'Printer saved.',
  'Als aktiven Drucker verwenden':'Use as active printer',
  'Material':'Material','Materialien':'Materials','Materialbibliothek':'Material library',
  'Qualität':'Quality','Schichthöhe':'Layer height','Ergänzungen':'Additions',
  'Prozessänderung':'Process changes','Auto-Konfiguration':'Auto configuration',
  'Auto-Konfigurationen':'Auto configurations','Auto-Konfig-Offset':'Auto-config offset',
  'Einstellungen zuweisen':'Assign settings','Wirksame Werte prüfen':'Inspect effective values',
  'Einstellungen':'Settings','Prozesseinstellungen bearbeiten':'Edit process settings',
  'Prozess speichern':'Save process','Als neuen Prozess speichern':'Save as new process',
  'Gespeicherte Prozesse':'Saved processes','Prozess laden':'Load process',
  'Prozess hinzufügen':'Add process','Prozess entfernen':'Remove process',
  'Prozess löschen':'Delete process','Modelle auswählen':'Select models',
  'Modelle auswaehlen...':'Select models...','Abbrechen':'Cancel','Schließen':'Close',
  'OK':'OK','Übernehmen':'Apply','Hinzufügen':'Add','Entfernen':'Remove',
  'Bearbeiten':'Edit','Löschen':'Delete','Duplizieren':'Duplicate',
  'Umbenennen':'Rename','Zurücksetzen':'Reset','Zurück':'Back','Weiter':'Next',
  'Bestätigen':'Confirm','Nein':'No','Ja':'Yes','Aktiv':'Active','Inaktiv':'Inactive',
  'Aktivieren':'Enable','Deaktivieren':'Disable','Haupt-Extruder':'Main extruder',
  'Extruder':'Extruder','Extruder Liste':'Extruder list',
  'Extruder hinzufügen':'Add extruder','Extruder entfernen':'Remove extruder',
  'Allgemein':'General','Überblick':'Overview','Düsendurchmesser':'Nozzle diameter',
  'Filamentdurchmesser':'Filament diameter','Extrusionsmultiplikator':'Extrusion multiplier',
  'Extrusionsbreite':'Extrusion width','Extrusionsbreiten':'Extrusion widths',
  'Breite automatisch berechnen':'Calculate width automatically',
  'Einzug (Retraction)':'Retraction','Einzugslänge':'Retraction length',
  'Zusätzliche Wiederanlauflänge':'Extra length on restart',
  'Einzugsgeschwindigkeit':'Retraction speed','Wiedereinzugsgeschwindigkeit':'Deretraction speed',
  'Vertikales Anheben (Z-Hop)':'Vertical lift (Z-hop)',
  'Einzug ab Bewegung von':'Retract on travels longer than',
  'Einzug bei Schichtwechsel':'Retract on layer change',
  'Nur beim Queren von Wänden':'Only when crossing perimeters',
  'Firmware-Einzug':'Firmware retraction','Düse beim Einzug abwischen':'Wipe while retracting',
  'Einzug vor dem Abwischen':'Retract before wiping','Abwischen':'Wipe',
  'Z-Hop und Rampe':'Z-hop and ramp','Anheben begrenzen':'Limit lift',
  'Nur oberhalb von Z':'Only above Z','Nur unterhalb von Z':'Only below Z',
  'Rampe':'Ramp','Rampe statt senkrecht anheben':'Ramp instead of vertical lift',
  'Maximale Anhebung':'Maximum lift','Steigungswinkel':'Slope angle',
  'Steiler vor Hindernissen':'Steeper before obstacles',
  'Kalibrierung':'Calibration','Pressure Advance':'Pressure advance',
  'Schicht':'Layer','Schichten':'Layers','Wände':'Walls','Füllung':'Infill',
  'Stützen':'Supports','Temperatur':'Temperature','Temperaturen':'Temperatures',
  'Kühlung':'Cooling','Geschwindigkeiten':'Speeds','Beschleunigung':'Acceleration',
  'Multimaterial':'Multi-material','Filamentwechsel':'Filament change',
  'Skripte':'Scripts','Fortgeschritten':'Advanced','Ausgabe':'Output',
  'Start':'Start','Schichtwechsel':'Layer change','Werkzeugwechsel':'Tool change',
  'Objektwechsel':'Object change','Pause / Farbwechsel':'Pause / color change',
  'Ende':'End','Nachbearbeitung':'Post-processing',
  'Start-Skript':'Start script','End-Skript':'End script',
  'Schichtwechsel-Skript':'Layer-change script','Werkzeugwechsel-Skript':'Tool-change script',
  'Objektwechsel-Skript':'Object-change script',
  'Netzwerk':'Network','Weboberfläche':'Web interface','Bauraum':'Chamber',
  'Druckbett':'Print bed','Bauteillüfter':'Part cooling fan',
  'Lüfter hinzufügen':'Add fan','Lüfter entfernen':'Remove fan','Lüfter':'Fan',
  'Leerlauftemperatur':'Standby temperature','Sollwerte':'Setpoints','Sollwert':'Setpoint',
  'Befehle automatisch ausgeben':'Emit commands automatically','Schichtnummer':'Layer number',
  'Temperaturnummer':'Temperature number','Von':'From','Bis':'To','Wert':'Value',
  'Typ':'Type','Status':'Status','Quelle':'Source','Bereich':'Section',
  'Option':'Option','Parameter':'Parameter','Offset':'Offset','Regel hinzufügen':'Add rule',
  'Regel entfernen':'Remove rule','Wirksamer Wert':'Effective value',
  'Manuell':'Manual','Prusa':'Prusa','Profil':'Profile',
  'Nur dieser Prozess':'This process only','Basiswerte des Profils':'Profile base values',
  'Automatisch (aktuelle Quelle)':'Automatic (current source)',
  'Änderungen speichern in':'Save changes to','Slicing':'Slicing',
  'vollständig':'fully','teilweise':'partially','nur native Prusa-Stützen':'native Prusa supports only',
  'Gültigkeit für eigene Simpliy-Stützen:':'Applicability to Simpliy supports:',
  'Benutzerdefinierte Zonen (in Entwicklung)':'Custom regions (in development)',
  'Drucker/Filament':'Printer/filament','Projekt nicht gespeichert':'Project not saved',
  'Arbeitsbereich gespeichert':'Workspace saved',
  'Arbeitsbereich wird gespeichert ...':'Saving workspace ...',
  'Bereit':'Ready','Import fehlgeschlagen':'Import failed','Fehler':'Error',
  'Warnung':'Warning','Hinweis':'Note','Vorschau':'Preview',
  'Vorschaumodus verlassen':'Exit preview mode','Build-Zusammenfassung':'Build summary',
  'Bauzeit':'Build time','Materiallänge':'Material length',
  'Materialgewicht':'Material weight','Materialvolumen':'Material volume',
  'Schichtzahl':'Layer count','Vorschau ist veraltet. Bitte neu slicen.':'Preview is outdated. Slice again.',
  'Hochladen startet keinen Druck.':'Uploading does not start a print.',
  'Keine Werte':'No values','Kein Drucker':'No printer',
  'Kein Basisprofil':'No base profile','Keine Einstellung gefunden':'Setting not found',
  'Nicht an die Engine übergeben':'Not passed to engine',
  'Prusa-Engine im Hintergrund':'Prusa engine in background',
  'Pfad zur installierten PrusaSlicer-3.0-Anwendung':'Path to installed PrusaSlicer 3.0',
  'Automatisch suchen':'Find automatically','Updates':'Updates',
  'Slicing-Engine':'Slicing engine','Lizenzen':'Licenses','Über':'About',
  'Version':'Version','Download':'Download','Installieren':'Install',
  'Nach Updates suchen':'Check for updates','Aktualisieren':'Update',
  'Prozess öffnen':'Open process',
  'Für diesen Drucker ist keine Weboberfläche eingetragen.':'No web interface configured for this printer.',
  'Linke Spalte ein-/ausblenden':'Toggle left panel',
  'Weboberfläche des Druckers in diesem Fenster':'Printer web interface in this window',
  'Iso':'Iso','Oben':'Top','Unten':'Bottom','Vorne':'Front','Rechts':'Right',
  'Links':'Left','Einpassen':'Fit','Breite je Werkzeugweg':'Width by toolpath',
  'Erste Schicht':'First layer','Innenwände':'Inner walls','Außenwand':'Outer wall',
  'Massive Füllung':'Solid infill','Oberseite':'Top surface',
  'Freie Parameter':'Custom parameters','Notizen':'Notes','Werkzeug':'Tool',
  'Werkzeuge':'Tools','Überhänge':'Overhangs','Stützen erzeugen':'Generate supports',
  'Baum':'Tree','Pfeiler':'Pillar','Fächer':'Fan','Knotenblech':'Gusset',
  'Einstellung suchen':'Search settings','Suchen':'Search','Suche':'Search',
  'Keine':'None','Alle':'All','Aus':'Off','Ein':'On',
  'Name':'Name','Anzahl':'Count','Dichte':'Density','Abstand':'Spacing',
  'Geschwindigkeit':'Speed','Winkel':'Angle','Höhe':'Height','Länge':'Length',
  'Breite':'Width','Durchmesser':'Diameter','Abstand XY':'XY distance',
  'Aktuelle Schicht':'Current layer','Werkzeugwege':'Toolpaths','Bett':'Bed',
  'Datei':'File','Dateiname':'Filename','Objekt':'Object',
  'Änderungen verwerfen?':'Discard changes?',
  'Anzahl Werkzeuge':'Number of tools','Filament':'Filament',
  'Modellansicht':'Model view','Prozesse':'Processes',
  'Schnell':'Fast','Langsam':'Slow','Wählen':'Select','Auswählen':'Select',
  'Schrift':'Font','Text':'Text','Drehen':'Rotate','Skalieren':'Scale',
  'Verschieben':'Move','Ablegen':'Place on bed','Messen':'Measure',
  'Reparieren':'Repair','Schnitt':'Cut','Querschnitt':'Cross-section',
  'Farbe':'Color','Bemalen':'Paint','Druckplatte':'Build plate','Platte':'Plate',
  'Druckplatten':'Build plates','Verschieben nach':'Move to',
  'Sichtbar':'Visible','Versteckt':'Hidden','Fertig':'Done',
  'Druckzeit':'Print time','Verbrauch':'Consumption',
};

export function getLanguagePreference() {
  if (preference !== null) return preference;
  try { preference = globalThis.localStorage?.getItem(STORAGE_KEY) || 'auto'; }
  catch { preference = 'auto'; }
  if (!['auto', 'de', 'en'].includes(preference)) preference = 'auto';
  return preference;
}
export function getLanguage() {
  const chosen = getLanguagePreference();
  if (chosen !== 'auto') return chosen;
  return /^de(?:[-_]|$)/i.test(globalThis.navigator?.language || 'en') ? 'de' : 'en';
}
export function setLanguagePreference(value) {
  if (!['auto', 'de', 'en'].includes(value)) throw Error('Unknown language preference');
  preference = value;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, value); } catch { /* session only */ }
}
export function translate(text) {
  const raw = String(text);
  if (getLanguage() !== 'en') return raw;
  const trimmed = raw.trim();
  const converted = en[trimmed];
  if (!converted) return raw;
  const start = raw.indexOf(trimmed);
  return raw.slice(0, start) + converted + raw.slice(start + trimmed.length);
}
/** Translate exact UI messages only. Do not translate editable values or user input. */
export function translateDOM(root) {
  if (!root) return;
  const lang = getLanguage();
  if (globalThis.document?.documentElement) document.documentElement.lang = lang;
  if (lang !== 'en') return;
  const walker = (root.ownerDocument || document).createTreeWalker(root, 4);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,textarea,pre,code,[contenteditable="true"],[data-i18n-skip]')) continue;
    const changed = translate(node.nodeValue);
    if (changed !== node.nodeValue) node.nodeValue = changed;
  }
  for (const el of root.querySelectorAll('[title],[placeholder],[aria-label]')) {
    if (el.closest('[data-i18n-skip]')) continue;
    for (const attr of ['title','placeholder','aria-label']) {
      if (!el.hasAttribute(attr)) continue;
      const before = el.getAttribute(attr);
      const after = translate(before);
      if (after !== before) el.setAttribute(attr, after);
    }
  }
}
/** Handle asynchronously inserted dialogs and labels without touching the renderer. */
export function watchTranslations(root) {
  if (!root || !globalThis.MutationObserver) return;
  const observer = new MutationObserver(records => {
    if (getLanguage() !== 'en') return;
    const affected = new Set();
    for (const r of records) {
      if (r.type === 'characterData') affected.add(r.target.parentElement);
      else if (r.type === 'attributes') affected.add(r.target);
      else for (const n of r.addedNodes) affected.add(n.nodeType === 3 ? n.parentElement : n);
    }
    for (const node of affected) {
      if (!node || node.nodeType !== 1) continue;
      translateDOM(node);
    }
  });
  observer.observe(root, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label']});
  return observer;
}
