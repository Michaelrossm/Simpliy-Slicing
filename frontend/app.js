import {sectionRange, clampSectionPosition} from './section.js';
import {visibleProcesses} from './process-utils.js';
import {Viewport} from './viewport.js';
import {readPacket, readMesh} from './native.js';
import {readPreview} from './preview-data.js';
import {PLACE} from './settings-layout.js';
import {applyEngineTexts} from './option-labels.js';
import {getLanguagePreference, getLanguage, setLanguagePreference, translateDOM, watchTranslations} from './i18n.js';
import {createSerialPanel} from './serial-panel.js'; // --simpliy-usb-monitor-alpha2
import {getThemePreference,setThemePreference,applyTheme,watchSystemTheme} from './themes.js';
import {baseValues, compileConfig, display, convert} from './engine-config.js';
import {renderColorDialog} from './color-dialog.js';
import {esc, renderProcessDialog, renderSearchResults} from './process-dialog.js';
import {renderDock, renderRail, renderQuickbar, renderSidebar, renderPreviewControls, paintStates, PREVIEW_METRICS} from './workbench.js';
import {createModelActions} from './model-actions.js';
import {libraryValues, effectiveBed, buildJob} from './print-job.js';
import {placement} from './geometry.js';
import {SUPPORT_MODES} from './support-panel.js';
import {supportCount, quickSupports} from './support-plate.js';
let quickCache=null;
import {createSupportClient} from './support-client.js';
import {PaintMesh} from './paint-core.js';
import {ensurePlates,plateModels,plateProcesses,planPlate} from './plate-plan.js';
import {createFeatures} from './features.js';
import {renderPlateBar,renderAssignment,renderMaterials} from './feature-panels.js';
import * as P from './profiles.js';
import {createColorActions} from './actions/colors.js';
import {createOffsetActions} from './actions/offsets.js';
import {createZoneActions} from './actions/zones.js';
import {createAssignmentActions} from './actions/model-assignment.js';
import {createFavoriteActions} from './actions/favorites.js';
import {createProcessResetActions} from './actions/process-reset.js';
import {createNavigationActions} from './actions/navigation.js';
import {createJobActions} from './actions/job.js';
import {createToolListsActions} from './actions/tool-lists.js';
import {createProcessOpsActions} from './actions/process-ops.js';
import {createConfigFilesActions} from './actions/config-files.js';
import {createAutoConfigActions} from './actions/auto-config.js';
import {createProfileEditorActions} from './actions/profile-editor.js';
import {createLibraryActions} from './actions/library.js';
import {createFieldChangeActions} from './actions/field-changes.js';
import {createEngineUpdateActions} from './actions/engine-update.js';
import * as Z from './zone-plan.js';
import {planNativeZones, applyNativeZones, canUseLegacyZoneFallback, zonePostFor} from './native-zone-plan.js';
const {zoneOf,zoneActive}=Z;
import {renderPrinterManager,renderMaterialLibrary,renderAssign} from './profile-ui.js';

const $=(s,root=document)=>root.querySelector(s);
const id=(p='id')=>`${p}-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(10)),x=>x.toString(16).padStart(2,'0')).join('')}`;
const clone=(o)=>structuredClone(o);
const invoke=(name,args)=>window.__TAURI__.core.invoke(name,args);
const serialPanel=createSerialPanel({invoke,rerender:()=>render(),visible:()=>modal==='serial'});
const DRAFT_ID='s3d-mk3s-reprapt-entwurf';

// Arbeitsbereich
let state=null,catalog=[],catalogByKey=new Map();
let saveTimer=null,lastSynced='',saveChain=Promise.resolve(),toastTimer=null;
// Dialoge
let modal='',modalReturn='',dialogSnapshot=null;
let settingEditTarget='smart',activeSettingTab='Extruder',settingsPage={},settingSearch='',highlightKey='';
let netMessage=null,printerFilter='',materialFilter='';

// Auto-Konfigurationen: Liste der Optionen je Kategorie und die zugewiesenen Einstellungen.
const autoKeys=()=>[...PLACE.keys()];
const controls=cat=>P.controlled(cat,autoKeys(),catalogByKey,state);
// Eingelesene, noch nicht gespeicherte Optionen (proc.pending) erscheinen im Entwurf und werden erst mit „Prozess speichern“ angelegt.
const pendingOf=(proc,cat)=>proc?.pending?.[cat]||[];
const offsetsOf=proc=>proc?.pending?.offsetRules??[...(state.auto_offsets||[]),...pendingOf(proc,'offsets')];
// ---- Aktionen in thematischen Modulen (frontend/actions). Abhaengigkeiten werden ausdruecklich uebergeben;
// Funktionen werden erst beim Aufruf aufgeloest, `state` und `catalogByKey` als Getter (sie werden neu gesetzt).
const actionEnv={
  get state(){return state},get catalogByKey(){return catalogByKey},get autoField(){return autoField},
  autoList:(...a)=>autoList(...a),printerOf:(...a)=>printerOf(...a),
  notify:(...a)=>notify(...a),confirmRemove:(...a)=>confirmRemove(...a),
  render:()=>render(),update:()=>update(),
  openModal:name=>openModal(name),closeModal:()=>closeModal(),getModal:()=>modal,
  shell:(...a)=>shell(...a),activeProcess:()=>activeProcess(),visibleProcesses:list=>visibleProcesses(list),
  invalidateBase:()=>{baseKey=''},byId:id=>document.getElementById(id),
  setJobStatus:v=>setJobStatus(v),resetEngine:()=>{baseKey='';prusaPrinters=[];prusaProfiles=[]},resetUpdateInfo:()=>{updateInfo=null},
  // --- fuer die Aktions-Module (vormals im grossen Schalter)
  $:(...a)=>$(...a),
  absorbOverrides:(...a)=>absorbOverrides(...a),
  get activeExtruder(){return toolListsActions.view.activeExtruder},set activeExtruder(v){toolListsActions.view.activeExtruder=v},
  get activeFan(){return toolListsActions.view.activeFan},set activeFan(v){toolListsActions.view.activeFan=v},
  get activeSettingTab(){return activeSettingTab},set activeSettingTab(v){activeSettingTab=v},
  addCategory:(...a)=>addCategory(...a),
  applyAuto:(...a)=>applyAuto(...a),
  askName:(...a)=>askName(...a),
  get assignDraft(){return autoConfigActions.view.assignDraft},set assignDraft(v){autoConfigActions.view.assignDraft=v},
  get assignFilter(){return autoConfigActions.view.assignFilter},set assignFilter(v){autoConfigActions.view.assignFilter=v},
  autoKeys:(...a)=>autoKeys(...a),
  get autoMenu(){return autoConfigActions.view.autoMenu},set autoMenu(v){autoConfigActions.view.autoMenu=v},
  autoPickPrusa:(...a)=>autoPickPrusa(...a),
  get baseFlat(){return baseFlat},
  get baseKey(){return baseKey},set baseKey(v){baseKey=v},
  category:(...a)=>category(...a),
  catName:(...a)=>catName(...a),
  changeToolCount:(...a)=>changeToolCount(...a),
  clone:(...a)=>clone(...a),
  closeProcess:(...a)=>closeProcess(...a),
  commitPending:(...a)=>commitPending(...a),
  controls:(...a)=>controls(...a),
  download:(...a)=>download(...a),
  get DRAFT_ID(){return DRAFT_ID},
  draftPresets:(...a)=>draftPresets(...a),
  duplicateProfile:(...a)=>duplicateProfile(...a),
  get editCat(){return profileEditorActions.view.editCat},set editCat(v){profileEditorActions.view.editCat=v},
  editFans:(...a)=>editFans(...a),
  get editOpt(){return profileEditorActions.view.editOpt},set editOpt(v){profileEditorActions.view.editOpt=v},
  editTemps:(...a)=>editTemps(...a),
  enginePreset:(...a)=>enginePreset(...a),
  exportConfig:(...a)=>exportConfig(...a),
  exportCurrent:(...a)=>exportCurrent(...a),
  exportGcode:(...a)=>exportGcode(...a),
  exportProject:(...a)=>exportProject(...a),
  get features(){return features},
  get filamentEdit(){return libraryActions.view.filamentEdit},set filamentEdit(v){libraryActions.view.filamentEdit=v},
  handleAction:(...a)=>handleAction(...a),
  get helpTab(){return helpTab},set helpTab(v){helpTab=v},
  get highlightKey(){return highlightKey},set highlightKey(v){highlightKey=v},
  id:(...a)=>id(...a),
  importConfigFile:(...a)=>importConfigFile(...a),
  importModels:(...a)=>importModels(...a),
  importPrusa:(...a)=>importPrusa(...a),
  invoke:(...a)=>invoke(...a),
  get legal(){return legal},set legal(v){legal=v},
  loadEnginePrinters:(...a)=>loadEnginePrinters(...a),
  loadPreview:(...a)=>loadPreview(...a),
  mainProcess:(...a)=>mainProcess(...a),
  makeProfile:(...a)=>makeProfile(...a),
  markSave:(...a)=>markSave(...a),
  get meshErrors(){return meshErrors},
  get modal(){return modal},set modal(v){modal=v},
  get netMessage(){return netMessage},set netMessage(v){netMessage=v},
  newAutoOption:(...a)=>newAutoOption(...a),
  onlyTool:(...a)=>onlyTool(...a),
  openProcess:(...a)=>openProcess(...a),
  option:(...a)=>option(...a),
  parseValue:(...a)=>parseValue(...a),
  pickFile:(...a)=>pickFile(...a),
  get preview(){return preview},
  get previewMode(){return previewMode},set previewMode(v){previewMode=v},
  get printerEdit(){return libraryActions.view.printerEdit},set printerEdit(v){libraryActions.view.printerEdit=v},
  get printerView(){return printerView},set printerView(v){printerView=v},
  processProfile:(...a)=>processProfile(...a),
  get profilePanel(){return profileEditorActions.view.profilePanel},set profilePanel(v){profileEditorActions.view.profilePanel=v},
  get prusaPrinters(){return prusaPrinters},set prusaPrinters(v){prusaPrinters=v},
  get prusaProfiles(){return prusaProfiles},set prusaProfiles(v){prusaProfiles=v},
  get QUALITY_KEYS(){return QUALITY_KEYS},
  get saveTimer(){return saveTimer},
  get sectionState(){return sectionState},
  selectDefaultOption:(...a)=>selectDefaultOption(...a),
  setJobStatus:(...a)=>setJobStatus(...a),
  get settingEditTarget(){return settingEditTarget},set settingEditTarget(v){settingEditTarget=v},
  get settingSearch(){return settingSearch},set settingSearch(v){settingSearch=v},
  get settingsPage(){return settingsPage},
  sliceAllPlates:(...a)=>sliceAllPlates(...a),
  sliceNow:(...a)=>sliceNow(...a),
  storeAuto:(...a)=>storeAuto(...a),
  get supportMode(){return supportMode},set supportMode(v){supportMode=v},
  get supportMoving(){return supportMoving},set supportMoving(v){supportMoving=v},
  switchAutoOption:(...a)=>switchAutoOption(...a),
  sync:(...a)=>sync(...a),
  syncPrusaPrinter:(...a)=>syncPrusaPrinter(...a),
  get toolOptions(){return toolOptions},
};
const colors=createColorActions(actionEnv);
const {materialOf,colorsOf,activeColorOf,editColors,colorOptions}=colors;
const offsets=createOffsetActions(actionEnv);
const zones=createZoneActions(actionEnv);
const assignment=createAssignmentActions(actionEnv);
const favorites=createFavoriteActions(actionEnv);
const processReset=createProcessResetActions(actionEnv);
const navigationActions=createNavigationActions(actionEnv);
const jobActions=createJobActions(actionEnv);
const toolListsActions=createToolListsActions(actionEnv);
const processOpsActions=createProcessOpsActions(actionEnv);
const configFilesActions=createConfigFilesActions(actionEnv);
const autoConfigActions=createAutoConfigActions(actionEnv);
const profileEditorActions=createProfileEditorActions(actionEnv);
const libraryActions=createLibraryActions(actionEnv);
const fieldChanges=createFieldChangeActions(actionEnv);
const engineUpdate=createEngineUpdateActions(actionEnv);
/** Aktionsname -> Funktion({proc, el}). Was hier steht, steht nicht mehr im grossen Schalter von handleAction. */
const actionTable={...offsets.actions,...colors.actions,...zones.actions,...assignment.actions,...favorites.actions,...processReset.actions,...engineUpdate.actions,...navigationActions.actions,...jobActions.actions,...toolListsActions.actions,...processOpsActions.actions,...configFilesActions.actions,...autoConfigActions.actions,...profileEditorActions.actions,...libraryActions.actions};
/** Feldname (data-field) -> Funktion({el, proc, bundle}); true = Ereignis erledigt, sonst folgt update(). */
const fieldTable={...fieldChanges.actions,...engineUpdate.fields};
/** Aenderungs-Ereignisse der Module (liefern true, wenn sie das Ereignis behandelt haben). */
const earlyChange=[assignment.change];
const lateChange=[colors.change,zones.change,offsets.change];
function autoList(cat,proc){
  if(cat==='material')return [...state.filaments,...pendingOf(proc,'material')];
  if(cat==='quality')return [...(printerOf(proc)?.qualities||[]),...pendingOf(proc,'quality')];
  return [...(state.presets??=[]).filter(p=>p.kind===cat),...pendingOf(proc,cat)];
}
/** Beim Speichern des Prozesses: eingelesene Optionen und Offsets wirklich anlegen. */
function commitPending(proc){
  const pend=proc.pending;if(!pend)return [];
  const made=[],printer=printerOf(proc);
  for(const [cat,list] of Object.entries(pend)){
    if(cat==='colors')continue;
    if(cat==='offsetRules')continue;
    if(cat==='offsets'){state.auto_offsets=[...(state.auto_offsets||[]),...list];made.push(`${list.length} Offset(s)`);continue}
    const target=cat==='material'?state.filaments:cat==='quality'?(printer.qualities??=[]):(state.presets??=[]);
    for(const o of list){if(!target.some(x=>x.id===o.id)){target.push(o);made.push(`${catName(cat)} „${o.name}“`)}}
    if(cat==='material'&&printer.materials?.length)for(const o of list)if(!printer.materials.includes(o.id))printer.materials.push(o.id);
  }
  if(pend.offsetRules){state.auto_offsets=pend.offsetRules;made.push('Auto-Konfig-Offsets')}
  for(const [id,list] of Object.entries(pend.colors||{})){const m=state.filaments.find(x=>x.id===id);if(m){m.colors=list;made.push(`Farben von „${m.name}“`)}}
  delete proc.pending;
  return made;
}
const autoField=new Proxy({},{get:(_,cat)=>`${String(cat)}_id`});
const catName=cat=>P.autoCategories(state).find(c=>c.id===cat)?.name||P.AUTO[cat]||cat;
const autoValues=(cat,option)=>cat==='material'?(option.settings??={}):(option.values??={});
function applyAuto(proc,cat,option){
  const keys=P.applyControlled(proc,autoValues(cat,option),controls(cat),`${catName(cat)}: ${option.name}`);
  proc[autoField[cat]]=option.id;
  if(cat==='material'&&proc.color_id&&!(option.colors||[]).some(x=>x.id===proc.color_id))proc.color_id='';
  return keys;
}
function storeAuto(proc,cat,option){
  Object.assign(autoValues(cat,option),P.valuesFrom(proc,controls(cat)));
  return controls(cat).size;
}
function newAutoOption(proc,cat,name){
  const own=P.valuesFrom(proc,controls(cat));
  let option;
  if(cat==='material'){option=P.makeMaterial({name,values:proc.values,byKey:catalogByKey,taken:state.filaments.map(x=>x.id)});Object.assign(option.settings,own);state.filaments.push(option)}
  else if(cat==='quality'){const pr=printerOf(proc);option={id:`quality-${Date.now().toString(36)}`,name,values:own};pr.qualities.push(option)}
  else{option={id:`preset-${Date.now().toString(36)}`,kind:cat,name,values:own};state.presets.push(option)}
  proc[autoField[cat]]=option.id;
  if(cat==='material')proc.color_id='';
  return option;
}

// Engine
let jobStatus='Bereit',jobRunning=false,prusaPrinters=[],prusaProfiles=[];
let baseConfig=null,baseFlat=null,baseKey='',baseError='',baseLoading=null;
// Modelle und Ansicht
let viewport=null,viewWarnings=[],modelsKey='',preview=null,previewMode=false,previewPath='',previewStamp='';
const previews=new Map();
const previewView={layer:0,minLayer:0,metric:'type',move:null,playing:false,rate:4,single:false,travel:false,role:'all'};
const meshes=new Map(),meshErrors=new Map(),meshLoading=new Set();
const sectionState={enabled:false,orientation:'+Z',position:0,showPlane:true,showGizmo:true,pickPoint:false,initialized:false};
const toolOptions={kind:'support',state:1,radius:3,paintMode:'brush',fillAngle:30,planeAngle:2,smoothAngle:25,heightFrom:0,heightTo:5,gapArea:4,angle:45,front:true,uniform:true,cutHeight:null,cutAxis:2,cutTilt:0};
let strokeActive=false,strokeApplied=false;
let supportMode='none',supportMoving=null;
const supportTabs={place:'surfaces',shape:'body',make:'auto'};
let jobPolling=false,cancelAll=false;
// Gesamtfortschritt: Engine 0-84, Pruefung 84-90, Vorschau 90-100. Bei mehreren Platten anteilig.
const progress={value:0,shown:false,from:0,span:100};
function progressHtml(){
  return `<div class="job-progress" id="job-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.value)}" ${progress.shown?'':'hidden'}><i style="width:${progress.value}%"></i><b>${Math.round(progress.value)} %</b></div>`;
}
function beginProgress(index=0,count=1){
  if(!index)progress.value=0;
  Object.assign(progress,{shown:true,from:100*index/count,span:100/count});
  setProgress(0);
}
function setProgress(percent){
  progress.value=Math.max(progress.value,progress.from+progress.span*Math.max(0,Math.min(100,percent))/100);
  const bar=$('#job-progress');if(!bar||!bar.querySelector)return;
  bar.hidden=!progress.shown;
  bar.setAttribute('aria-valuenow',String(Math.round(progress.value)));
  bar.querySelector('i').style.width=`${progress.value}%`;
  bar.querySelector('b').textContent=`${Math.round(progress.value)} %`;
}
function endProgress(){progress.shown=false;const bar=$('#job-progress');if(bar)bar.hidden=true}
// Zeichnen
let renderQueued=false,pointerDown=false,searchTimer=null;

const app=$('#app');
function setJobStatus(value){jobStatus=value;const el=$('#job-status');if(el)el.textContent=value}

const currentProfile=()=>state?.profiles.find(p=>p.manifest.profile_id===state.active_profile_id)||state.profiles[0];
const activeProcess=()=>visibleProcesses(state?.processes||[]).find(p=>p.id===state.active_process_id)||visibleProcesses(state?.processes||[])[0];
const processProfile=(proc=activeProcess())=>state.profiles.find(p=>p.manifest.profile_id===proc?.profile_id)||currentProfile();
const orderedCats=(bundle)=>bundle.profile.category_order.map(key=>bundle.profile.categories.find(c=>c.id===key)).filter(Boolean);
const selectedOption=(cat,proc)=>cat.options.find(o=>o.id===(proc?.selections?.[cat.id]||cat.selected))||cat.options[0];
const selectedModel=()=>plateModels(state).find(m=>m.id===state.ui.selected_model_id);

/** Reihenfolge: Drucker/Filament, Profil, Auto-Konfigurationen, manuell. */
// Neues Profilsystem: Drucker <- eigener Prozess. Alte Profile nur bis zur Umstellung.
const printerOf=proc=>state.printers.find(p=>p.id===proc?.printer_id)||state.printers.find(p=>p.id===state.active_printer_id)||state.printers[0];
function mainProcess(plate=state.ui.active_plate){return plateProcesses(plateModels(state,plate),visibleProcesses(state.processes),activeProcess())[0]}
// Werte, die eine Qualitaet beim Speichern aus dem Prozess uebernimmt.
const QUALITY_KEYS=['layer_height','first_layer_height','perimeters','top_solid_layers','bottom_solid_layers','fill_density','fill_pattern','perimeter_speed','external_perimeter_speed','infill_speed','solid_infill_speed','top_solid_infill_speed','travel_speed','first_layer_speed','small_perimeter_speed','gap_fill_speed','bridge_speed'];
// ---- Eigene Dialoge statt der Browser-Fenster (confirm/prompt) -------------------------------------------------
let appDialog=null;
function openAppDialog(spec){
  return new Promise(resolve=>{
    if(appDialog)appDialog.resolve(appDialog.kind==='prompt'?'':false);
    appDialog={...spec,resolve};
    render();
  });
}
function closeAppDialog(result){
  const d=appDialog;if(!d)return;
  appDialog=null;render();d.resolve(result);
}
function okAppDialog(){if(appDialog)closeAppDialog(appDialog.kind==='prompt'?(appDialog.value||''):true)}
function cancelAppDialog(){if(appDialog)closeAppDialog(appDialog.kind==='prompt'?'':false)}
function renderAppDialog(){
  const d=appDialog;
  return `<div class="overlay app-dialog-layer"><section class="dialog app-dialog" role="alertdialog" aria-modal="true" aria-label="${esc(d.title)}">
    <div class="dialog-head"><div><h2>${esc(d.title)}</h2></div></div>
    <div class="dialog-body app-dialog-body">${d.message?`<div class="dlg-text">${esc(d.message)}</div>`:''}${d.kind==='prompt'?`<input id="dlg-input" class="dlg-input" type="text" value="${esc(d.value||'')}" autocomplete="off" spellcheck="false">`:''}</div>
    <div class="dialog-foot"><span class="grow"></span><button data-action="dlg-cancel">${esc(d.cancel||'Abbrechen')}</button><button class="primary" data-action="dlg-ok">${esc(d.ok||'OK')}</button></div>
  </section></div>`;
}
function focusAppDialog(){
  if(!appDialog||appDialog.focused)return;
  const el=document.getElementById('dlg-input')||app.querySelector?.('[data-action=dlg-ok]');
  if(!el)return;
  appDialog.focused=true;el.focus?.({preventScroll:true});el.select?.();
}
/** Ja/Nein-Frage. `opts`: title, ok, cancel (Beschriftung der Knoepfe). */
function confirmRemove(message,opts={}){
  if(window.__nativeDialogs)return window.confirm(message);
  return openAppDialog({kind:'confirm',title:opts.title||'Bitte bestätigen',message,ok:opts.ok,cancel:opts.cancel});
}
/** Name abfragen; leer = abgebrochen. */
function askName(question,proposal){
  if(window.__nativeDialogs){const answer=window.prompt(question,proposal||'');return Promise.resolve(answer?answer.trim():'')}
  return openAppDialog({kind:'prompt',title:question,message:'',value:proposal||''}).then(v=>String(v||'').trim());
}
function resolve(bundle=processProfile(),proc=activeProcess()){
  if(proc?.values)return {...P.effective(proc,printerOf(proc)),history:{}};
  return resolveLegacy(bundle,proc);
}
function resolveLegacy(bundle,proc){
  const values={},sources={},history={};
  const put=(key,value,origin)=>{(history[key]??=[]).push({origin,value});values[key]=value;sources[key]=origin};
  const library=libraryValues(
    state.printers.find(x=>x.id===state.active_printer_id),
    state.filaments.find(x=>x.id===state.active_filament_id),
  );
  for(const [key,value] of Object.entries(library.values))put(key,value,library.sources[key]);
  for(const [key,value] of Object.entries(bundle.profile.base_parameters||{}))put(key,value,'Basisprofil');
  for(const cat of orderedCats(bundle)){
    const opt=selectedOption(cat,proc);
    for(const [key,value] of Object.entries(opt?.assignments||{}))put(key,value,`${cat.name} → ${opt.name}`);
  }
  for(const [key,value] of Object.entries(proc?.overrides||{}))put(key,value,'Manuell (Prozess)');
  return {values,sources,history};
}

// A single parameter editor: every field is edited in the normal settings tab.
// Auto-Configure options are sparse patches, not independent parameter copies.
function selectedTargetForKey(bundle,proc,key){
 if(settingEditTarget!=='smart')return settingEditTarget;
 if(Object.hasOwn(proc?.overrides||{},key))return 'process';
 for(const cat of orderedCats(bundle).slice().reverse()){
   if(Object.hasOwn(selectedOption(cat,proc)?.assignments||{},key))return `cat:${cat.id}`;
 }
 return 'base';
}
function writeSetting(key,value,proc=activeProcess(),bundle=processProfile(proc)){
 if(proc?.values){P.setValue(proc,key,value);update();return}
 const target=selectedTargetForKey(bundle,proc,key);
 if(target==='process'){
   proc.overrides[key]=value;
 }else if(target==='base'){
   bundle.profile.base_parameters[key]=value;
   delete proc.overrides[key];
   // Explicitly moving a parameter to Base detaches it from active option patches.
   if(settingEditTarget==='base')for(const cat of orderedCats(bundle)){
     const opt=selectedOption(cat,proc);if(opt)delete opt.assignments[key];
   }
 }else if(target.startsWith('cat:')){
   const cat=orderedCats(bundle).find(c=>c.id===target.slice(4));
   const opt=cat&&selectedOption(cat,proc);
   if(!opt)return notify('Diese Auto-Konfiguration enthält noch keine Option.',true);
   opt.assignments[key]=value;
   delete proc.overrides[key];
 }else return notify('Ungültiges Bearbeitungsziel.',true);
 update();
}
function switchAutoOption(proc,bundle,catId,optId){
 const cat=orderedCats(bundle).find(c=>c.id===catId);
 if(!cat||!cat.options.some(o=>o.id===optId))return;
 const old=selectedOption(cat,proc);
 const next=cat.options.find(o=>o.id===optId);
 const controlled=new Set([...Object.keys(old?.assignments||{}),...Object.keys(next.assignments||{})]);
 const removed=Object.keys(proc.overrides||{}).filter(key=>controlled.has(key));
 // Manual overrides must not make an Auto-Configure selection seem ineffective.
 for(const key of removed)delete proc.overrides[key];
 proc.selections[catId]=optId;
 settingEditTarget='smart';
 update();
 if(removed.length)notify(`${cat.name} → ${next.name}: ${removed.length} manuelle Prozess-Überschreibung(en) freigegeben; Automatik ist wieder sichtbar.`);
}
function vtext(value){return value!==null&&typeof value==='object'?display(value):String(value??'')}

function parseValue(value,expected){
  if(expected==='bool')return value==='true'||value===true;
  if(expected==='script'||typeof value!=='string')return value;
  const text=value.trim();
  if(text==='true')return true;
  if(text==='false')return false;
  return /^[-+]?\d+(?:[.,]\d+)?$/.test(text)?Number(text.replace(',','.')):value;
}

function notify(message,error=false){
  let el=$('#toast');
  if(!el){el=document.createElement('div');el.id='toast';document.body.append(el)}
  el.className=`toast ${error?'error':''}`;
  el.textContent=message;
  el.hidden=false;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>{el.hidden=true},error?9000:4500);
}

function markSave(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(sync,430);
  const status=$('#save-label');
  if(status)status.textContent='Arbeitsbereich wird gespeichert ...';
}

// Speichervorgaenge laufen nacheinander, sonst ueberholt ein alter Stand den neuen.
function sync(){
  if(!state)return saveChain;
  clearTimeout(saveTimer);
  saveTimer=null;
  saveChain=saveChain.then(async()=>{
    const snapshot=JSON.stringify(state);
    const status=$('#save-label');
    if(snapshot!==lastSynced){
      try{
        const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot});
        const body=await r.json();
        if(!r.ok)throw Error(body.error||'Speichern fehlgeschlagen');
        lastSynced=snapshot;
      }catch(e){
        notify(`Speichern fehlgeschlagen: ${e.message}`,true);
        if(status)status.textContent='Speicherfehler';
        return;
      }
    }
    if(status)status.textContent='Arbeitsbereich gespeichert';
  });
  return saveChain;
}

// Nicht zwischen Maustaste unten und oben zeichnen, sonst geht der Klick verloren.
function scheduleRender(){
  renderQueued=true;
  setTimeout(()=>{
    if(!renderQueued||pointerDown)return;
    renderQueued=false;
    render();
  },0);
}
function update(){markSave();scheduleRender();reportUnsaved()}
// Rust haelt das Schliessen nur an, wenn hier ungespeicherte Prozesse gemeldet sind.
let unsavedTimer=null,unsavedSent=null;
function unsavedProcesses(){
  const library=state?.process_library||[];
  return (state?.processes||[]).filter(p=>p.values&&p.library_id&&P.unsaved(p,library));
}
function reportUnsaved(){
  if(!window.__TAURI__)return;
  clearTimeout(unsavedTimer);
  unsavedTimer=setTimeout(()=>{const now=unsavedProcesses().length>0;if(now!==unsavedSent){unsavedSent=now;invoke('set_unsaved',{value:now}).catch(()=>{})}},300);
}
async function closeRequested(){
  const open=unsavedProcesses();
  if(open.length&&!await confirmRemove(`${open.length===1?`Der Prozess „${open[0].name}“ hat`:`${open.length} Prozesse haben`} ungespeicherte Änderungen gegenüber dem gespeicherten Prozess.\n\nTrotzdem schließen? (Abbrechen = offen lassen und mit „Prozess speichern“ sichern)`))return;
  try{if(saveTimer)await sync()}catch{}
  await invoke('close_app');
}

const currentBed=()=>effectiveBed(baseFlat,plateValues(),catalogByKey);

// Engine-Geruest: nur Struktur (Werkzeuge, Hardware). Alle Werte kommen aus Drucker und Prozess.
function enginePreset(){
  const complete=p=>p?.printer&&p.print&&p.tool&&p.filament;
  // Simpliy besitzt den Drucker: die Engine bekommt nur die neutrale Grundlage mit der Werkzeuganzahl des Druckers.
  if(state.profile_schema>=P.SCHEMA)return P.neutralSkeleton(P.toolsOf(printerOf(mainProcess())?.engine));
  if(complete(state.ui.prusa_preset))return state.ui.prusa_preset;
  // Erststart ohne gewaehlte Grundlage: neutrale Simpliy-Grundlage verwenden, dann ist alles sofort einsatzbereit.
  if(!state.ui.prusa_preset?.printer)return {...P.neutralSkeleton(1),technology:'FFF',extruders:1};
  return null;
}
function presetReady(){return !!enginePreset()}
function syncPrusaPrinter(){
  if(!(state.profile_schema>=P.SCHEMA))return;
  const p=state.ui.prusa_preset;
  if(!(p?.printer&&p.print&&p.tool&&p.filament))return;
  let pr=state.printers.find(x=>x.prusa_profile===p.printer&&x.settings);
  if(!pr){
    pr={...P.makePrinter({name:p.printer,base:{},byKey:catalogByKey,skeleton:p,taken:state.printers.map(x=>x.id)}),manufacturer:'Prusa-Profil (übernommen)',prusa_profile:p.printer,needs_settings:true};
    state.printers.push(pr);
  }
  pr.engine=clone(p);
  // Eine Platte, ein Drucker: alle Prozesse der Platte wechseln mit.
  for(const l of layersOf(state.ui.active_plate))if(l.process.values)l.process.printer_id=pr.id;
  const proc=activeProcess();if(proc.values)proc.printer_id=pr.id;
}

// Hat das Druckprofil nur ein Werkzeugprofil (bei Einzelwerkzeug-Druckern „no tool“), gibt es nichts zu waehlen.
// Gibt es nur eine Möglichkeit (z. B. beim neutralen Simpliy-Drucker), wird sie gleich gewählt.
function onlyFilament(print){
  const list=[...new Set(prusaProfiles.find(p=>p.name===print)?.filament_profiles||[])];
  return list.length===1?list[0]:'';
}
function autoPickPrusa(){
  const sel=state.ui.prusa_preset;if(!sel)return;
  if(!sel.print&&prusaProfiles.length===1)sel.print=prusaProfiles[0].name;
  if(sel.print&&!sel.tool)sel.tool=onlyTool(sel.print);
  if(sel.print&&!sel.filament)sel.filament=onlyFilament(sel.print);
  if(sel.tool&&sel.filament)syncPrusaPrinter();
}
function onlyTool(print){
  const tools=prusaProfiles.find(p=>p.name===print)?.tool_print_profiles||[];
  return tools.length===1?tools[0]:'';
}

let toolAsked='';
async function fillTool(){
  const p=state.ui.prusa_preset;
  if(!p?.printer||!p.print||p.tool||!window.__TAURI__||!state.engine_path)return;
  toolAsked=JSON.stringify([p.printer,p.print]);
  try{
    if(!prusaProfiles.some(x=>x.name===p.print)){
      const answer=await invoke('query_prusa_profiles',{enginePath:state.engine_path,printer:p.printer});
      if(state.ui.prusa_preset!==p)return;
      prusaProfiles=answer.print_profiles||[];
    }
    const tool=onlyTool(p.print);
    if(tool&&!p.tool){p.tool=tool;update()}
  }catch{}
}

function baseName(){
  const p=enginePreset();
  if(!presetReady())return 'Nicht gewählt. Zum Slicen wird ein Drucker- und Materialprofil benötigt.';
  if(baseError)return `Fehler: ${baseError}`;
  if(!baseConfig)return 'Wird geladen …';
  return `${p.printer}  /  ${p.print}  /  ${p.filament}`;
}

let migrating=false;
async function maybeMigrate(){
  if(migrating||!state||state.profile_schema>=P.SCHEMA||!baseFlat)return;
  migrating=true;
  try{
    // Vorher sichern: Die Umstellung ergaenzt den Arbeitsbereich, alte Felder bleiben.
    if(window.__TAURI__)await invoke('backup_workspace').catch(()=>{});
    const notes=P.migrate(state,{byKey:catalogByKey,base:baseFlat,skeleton:enginePreset(),
      resolveOld:proc=>{const b=state.profiles.find(x=>x.manifest.profile_id===proc.profile_id);return b?resolveLegacy(b,proc).values:{}}});
    if(notes.length){update();notify(`Profilverwaltung umgestellt (Sicherung angelegt): ${notes.length} Einträge übernommen.`)}
  }finally{migrating=false}
}

// Einmalig: Auto-Konfiguration Qualitaet heisst Schichthoehe, die frueher erzeugten Standard-Qualitaeten werden durch
// eigene Schichthoehen-Optionen ersetzt. Importierte Qualitaeten bleiben. Prozesswerte bleiben unveraendert.
async function upgradeLayerHeights(){
  if(!(state.profile_schema>=P.SCHEMA)||state.layer_scheme>=1)return;
  if(window.__TAURI__)await invoke('backup_workspace').catch(()=>{});
  const map={Entwurf:'layer-30',Schnell:'layer-25',Standard:'layer-20',Fein:'layer-15','Hochpräzision':'layer-10'};
  let replaced=0;
  for(const pr of state.printers||[]){
    const old=(pr.qualities||[]).filter(q=>/^quality-\d$/.test(q.id)&&q.name in map);
    const fresh=P.defaultQualities({...baseFlat,...(pr.settings||{})});
    const moved=Object.fromEntries(old.map(q=>[q.id,fresh.some(f=>f.id===map[q.name])?map[q.name]:'layer-20']));
    // Bereits erzeugte Schichthoehen (z. B. aus der Migration) nicht doppelt anlegen.
    pr.qualities=[...fresh,...(pr.qualities||[]).filter(q=>!old.includes(q)&&!q.generated&&!/^layer-\d+$/.test(q.id))];
    if(!pr.qualities.some(q=>q.id===pr.default_quality))pr.default_quality=moved[pr.default_quality]||'layer-20';
    for(const proc of state.processes||[]){
      if(proc.printer_id!==pr.id)continue;
      if(moved[proc.quality_id])proc.quality_id=moved[proc.quality_id];
      // Zeigt der Prozess auf eine Qualitaet, die dieser Drucker nicht hat: die Schichthoehe, die seinem Wert entspricht.
      if(!pr.qualities.some(q=>q.id===proc.quality_id)){
        const layer=Number(proc.values?.layer_height);
        const match=pr.qualities.find(q=>q.generated&&Math.abs(Number(q.values.layer_height)-layer)<1e-6);
        if(match)proc.quality_id=match.id;
      }
    }
    replaced+=old.length;
  }
  for(const c of state.auto_categories||[])if(c.id==='quality'&&(!c.name||c.name==='Qualität'))c.name='Schichthöhe';
  if(state.auto_labels?.quality==='Qualität')state.auto_labels.quality='Schichthöhe';
  state.layer_scheme=1;
  update();
  notify(`Auto-Konfiguration „Schichthöhe“ eingerichtet (Sicherung angelegt): ${replaced} alte Standard-Qualitäten ersetzt, eingestellte Prozesswerte unverändert.`);
}

function loadBase(){
  const preset=enginePreset();
  const key=state.engine_path&&preset?JSON.stringify([state.engine_path,preset]):'';
  if(key===baseKey)return baseLoading;
  baseKey=key;
  baseConfig=baseFlat=null;
  baseError='';
  if(!key||!window.__TAURI__)return (baseLoading=null);
  baseLoading=(async()=>{
    try{
      const config=await invoke('engine_base_config',{enginePath:state.engine_path,preset});
      if(key!==baseKey)return;
      baseConfig=config;
      baseFlat=baseValues(config);
      await maybeMigrate();
      await upgradeLayerHeights();
      // Neu uebernommener Prusa-Drucker: alle Druckerwerte jetzt aus dem Geruest, danach gehoeren sie Simpliy.
      const fresh=state.profile_schema>=P.SCHEMA&&printerOf(mainProcess());
      if(fresh?.needs_settings){fresh.settings=P.pick(baseFlat,catalogByKey,['printer']);fresh.qualities=P.defaultQualities(baseFlat);delete fresh.needs_settings;update()}
    }catch(e){
      if(key!==baseKey)return;
      baseError=String(e);
      notify(baseError,true);
    }
    scheduleRender();
  })();
  return baseLoading;
}

async function loadMesh(path){
  if(!path||meshes.has(path)||meshLoading.has(path)||!window.__TAURI__||!state.engine_path)return;
  meshLoading.add(path);
  try{
    const data=await invoke('load_mesh',{enginePath:state.engine_path,path});
    const mesh=readMesh(data,PaintMesh);
    meshes.set(path,mesh);
    meshErrors.delete(path);
  }catch(e){
    meshErrors.set(path,String(e));
  }
  meshLoading.delete(path);
  scheduleRender();
}

const models=createModelActions({
  state:()=>state,
  selected:()=>{const m=selectedModel();return m&&meshes.has(m.path)?m:null},
  mesh:model=>meshes.get(model.path),
  meshes:()=>meshes,
  bed:currentBed,
  id,
  notify,
});

const toolCount=()=>baseFlat?.temperature?.length||1;

const features=createFeatures({
  state:()=>state,
  processValues:()=>plateValues(),
  invoke,id,notify,
  confirm:(message,opts)=>confirmRemove(message,opts),
  update:()=>update(),
  render:()=>scheduleRender(),
  sync:()=>sync(),
  setStatus:text=>setJobStatus(text),
  openModal:name=>openModal(name),
  history:models,
  meshes:()=>meshes,
  loadMesh:path=>loadMesh(path),
  selected:()=>selectedModel(),
  tools:toolCount,
  stamp:plate=>stampPlate(plate),
  busy:()=>jobRunning,
  overlay:data=>viewport?.setOverlay(data),
  resetView(){const saved=previews.get(state.ui.active_plate),out=features.outputs.get(state.ui.active_plate);preview=saved&&(out?.previewPath||out?.path)===saved.path?saved.data:null;previewPath=preview?(out.savedPath?'Export: '+out.savedPath:(out.name||'Druck')+' - nur Vorschau, noch nicht exportiert'):'';previewStamp=preview?saved.stamp:'';if(preview){previewView.layer=Math.min(previewView.layer,preview.layers.length-1);previewView.minLayer=Math.min(previewView.minLayer||0,previewView.layer);previewView.role='all'}previewMode=false;toolOptions.cutHeight=null},
});

function sectionCenter(orientation){
 const bed=currentBed(),extent=viewport?.sectionExtent(orientation),range=extent&&extent.every(Number.isFinite)?extent:sectionRange(bed,orientation);
 return clampSectionPosition((range[0]+range[1])/2,bed,orientation);
}

const supports=createSupportClient({
  invoke,
  meshes:()=>meshes,
  resolve(plate){
    const layers=layersOf(plate),fallback=activeProcess();
    return model=>{
      const id=model.process||fallback?.id,layer=layers.find(l=>l.process.id===id)||layers[0];
      return {...baseFlat,...layer?.values,...model.settings};
    };
  },
  changed:()=>scheduleRender(),
  failed:text=>notify(text,true),
});

function supportContext(model){
  if(!model)return {model:null,mode:supportMode};
  const view=supports.views().get(model.id),stored=model.straightSupports;
  return {
    model,settings:supports.settings(model),schema:supports.schema(),mode:supportMode,tabs:supportTabs,
    automatic:stored?.automatic||[],manual:stored?.manual||[],count:supportCount(model),
    ready:meshes.has(model.path)&&model.enabled!==false,
    stale:!!view?.stale,fallback:view?.fallback||0,substituted:view?.substituted||0,skipped:view?.skipped||0,
  };
}
function supportSource({allowCut=false}={}){
  const model=selectedModel(),mesh=model&&meshes.get(model.path);
  if(!model||!mesh||model.enabled===false){notify('Zuerst ein geladenes, aktives Modell auswählen.',true);return null;}
  if(!allowCut&&(model.volumes||[]).some(v=>v.cut)){
    notify('Bei geschnittenen Modellen ist die eigene Stützenerzeugung noch nicht verfügbar.',true);return null;
  }
  return {model,mesh,bed:currentBed()};
}
function setSupportMode(mode){
  if(mode!=='none'&&!SUPPORT_MODES[mode])return;
  supportMode=supportMode===mode?'none':mode;
  supportMoving=null;
  state.ui.tool='supports';
  state.ui.dock_open=true;
  update();
}
function supportScope(model){
  const plate=state.ui.active_plate;
  return {model,plate,models:()=>plateModels(state,plate),bed:currentBed};
}
async function supportPreview(point){
  const model=selectedModel();
  if(!model||!meshes.has(model.path)||model.id!==point.modelId||(model.volumes||[]).some(v=>v.cut))return null;
  try{return await supports.hover(supportScope(model),supportMode,!!supportMoving,{kind:point.kind,xyz:point.xyz})}
  catch{return null}
}
/** @returns Antwort aus Rust oder null */
async function editSupports(model,op,failure='Stützen'){
  try{
    return await supports.edit(supportScope(model),op,answer=>{
      if(answer.data){models.remember();model.straightSupports=answer.data;update()}
      if(answer.notice)notify(answer.notice,!!answer.error);
    });
  }catch(error){
    notify(`${failure}: ${error.message||error}`,true);
    scheduleRender();
    return null;
  }
}
const editStamp=()=>Date.now().toString(36);
async function onSupportPick(point){
  if(!SUPPORT_MODES[supportMode])return;
  const source=supportSource();if(!source)return;
  const {model}=source,mode=supportMode,moving=supportMoving;
  if(point.modelId!==model.id){notify('Bitte zuerst das zugehörige Modell auswählen.',true);return;}
  const at={kind:point.kind,xyz:point.xyz},stamp=editStamp(),area=mode.endsWith('area');
  const op=mode==='add'?{op:'add',point:at,id:`manual-${id('pillar')}`}
    :mode==='fill'?{op:'fill',point:at,id:`manual-${id('area')}`}
    :mode==='move'?(moving?{op:'move',support:moving.id,point:at,stamp}:{op:'select',point:at})
    :mode==='take'?{op:'take',point:at}
    :mode.startsWith('remove')?{op:'remove',point:at,area}
    :{op:'edit',point:at,area,stamp};
  const answer=await editSupports(model,op);
  if(!answer||answer.error||supportMode!==mode||selectedModel()!==model)return;
  if(mode==='move')supportMoving=answer.selected||null;
  else if(mode==='take')supportMode='none';
  else return;
  update();
}
async function onSupportWipe(points){
  const source=supportSource();if(!source||supportMode!=='wipe')return;
  const {model}=source;
  const own=points.filter(p=>p.modelId===model.id).map(p=>({kind:p.kind,xyz:p.xyz}));
  if(!own.length){notify('Bitte zuerst das zugehörige Modell auswählen.',true);return;}
  await editSupports(model,{op:'wipe',points:own});
}
async function changeSupportSetting(key,value){
  const source=supportSource();if(!source)return;
  await editSupports(source.model,{op:'setting',key,value,stamp:editStamp(),keep:supportTabs.make==='manual'},'Ungültige Stützeneinstellung');
}
/** @returns true, wenn die Aktion hierher gehoert */
function supportAction(action){
  if(action==='support-add'){setSupportMode('add');return true;}
  if(action==='support-remove'){setSupportMode('remove');return true;}
  if(action==='support-edit-all'||action==='support-generate'){
    const source=supportSource();
    if(source)editSupports(source.model,{op:action.slice('support-'.length),stamp:editStamp()});
    return true;
  }
  // Alte/geblockte Stützen lassen sich auch ohne geladenes Netz entfernen.
  if(action==='support-clear-auto'||action==='support-clear-all'){
    const model=selectedModel(),stored=model?.straightSupports,all=action==='support-clear-all';
    if(!stored||!(all?supportCount(model):stored.automatic?.length))return true;
    models.remember();
    model.straightSupports={...stored,automatic:[],manual:all?[]:stored.manual||[],erased:[],incomplete:false};
    if(all)supportMode='none';
    update();return true;
  }
  if(action==='support-export'){exportSupports();return true;}
  if(action==='support-optimize'){
    if(jobRunning)return true;
    const source=supportSource();
    if(source){
      const scope=supportScope(source.model);
      supportOptimizationRevision.set(scope.plate,(supportOptimizationRevision.get(scope.plate)||0)+1);
      supports.optimize({models:scope.models(),plate:scope.plate,bed:source.bed,
        marks:supports.settings(source.model).detectMinima?source.model.id:null});
      scheduleRender();
    }
    return true;
  }
  return false;
}
async function exportSupports(){
  const source=supportSource({allowCut:true});if(!source)return;
  const {model,bed}=source,plate=state.ui.active_plate;
  try{
    await supports.settled();
    const data=await invoke('support_stl',{plate:supports.request(plateModels(state,plate),plate,bed),id:model.id});
    download(new Blob([data instanceof ArrayBuffer?data:new Uint8Array(data)],{type:'model/stl'}),`${model.name.replace(/\.[^.]+$/,'')}-stuetzen.stl`);
    notify(`${supportCount(model)} Stützen als STL exportiert.`);
  }catch(error){notify(`Stützen: ${error.message||error}`,true)}
}

function dockContext(values){
  const model=selectedModel();
  const bed=effectiveBed(baseFlat,values,catalogByKey);
  const ctx={
    model,
    byKey:catalogByKey,
    paint:toolOptions,
    support:supportContext(model),
    section:sectionState,sectionRange:sectionRange(bed,sectionState.orientation),
    tools:toolCount(),
    featurePanel:['text','measure','repair'].includes(state.ui.tool)?features.panel(state.ui.tool):undefined,
    uniform:toolOptions.uniform,
    meshError:model&&(meshErrors.get(model.path)||(!model.path?'Datei bitte neu importieren.':!state.engine_path?'Prusa-Pfad fehlt.':'')),
    printer:state.ui.prusa_preset?.printer||state.printers.find(x=>x.id===state.active_printer_id)?.name||'Keiner',
    bedText:`${bed.maxX-bed.minX} × ${bed.maxY-bed.minY} × ${bed.height} mm`,
  };
  const mesh=model&&meshes.get(model.path);
  if(mesh){
    const box=placement(model,mesh,bed);
    const axis=toolOptions.cutAxis,lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<mesh.vertices.length;i++){lo[i%3]=Math.min(lo[i%3],mesh.vertices[i]);hi[i%3]=Math.max(hi[i%3],mesh.vertices[i])}
    let height=0;
    for(let i=2;i<mesh.vertices.length;i+=3)height=Math.max(height,mesh.vertices[i]);
    const extent=axis===2?height:hi[axis]-lo[axis];
    Object.assign(ctx,{size:box.size,position:[box.offset[0],box.offset[1],Number.isFinite(Number(model.bedZ))?Number(model.bedZ):-(Number(model.sink)||0)],meshHeight:extent,cutHeight:Math.min(toolOptions.cutHeight??extent/2,extent),cutAxis:axis,cutTilt:toolOptions.cutTilt});
  }
  return ctx;
}

// Druckeransicht: Weboberflaeche als eigene Webansicht ueber der Ansichtsflaeche (kein zweites Fenster).
let printerView=false,printerShown=false;
function printerHost(){
  const pr=printerOf(mainProcess());
  if(!pr?.web_url)return `<div class="printer-host" id="printer-host"><div class="printer-empty"><h3>${esc(pr?.name||'Kein Drucker')}</h3>
    <p>Für diesen Drucker ist keine Weboberfläche eingetragen.</p><p>Im Prozess unter Reiter „Drucker“ › Netzwerk die IP-Adresse eintragen.</p>
    <button data-action="open-process">Prozess öffnen</button></div></div>`;
  return `<div class="printer-host" id="printer-host"><div class="printer-empty"><p>Weboberfläche von ${esc(pr.name)} wird geladen…</p><p class="meta">${esc(pr.web_url)}</p></div></div>`;
}
async function syncPrinterView(){
  if(!window.__TAURI__)return;
  const pr=printerView&&!modal?printerOf(mainProcess()):null;
  const host=document.getElementById('printer-host');
  if(pr?.web_url&&host){
    const r=host.getBoundingClientRect();
    try{await invoke('printer_view_show',{address:pr.web_url,x:r.left,y:r.top,width:r.width,height:r.height});printerShown=true}
    catch(e){printerShown=false;const box=host.querySelector('.printer-empty');if(box)box.innerHTML=`<p class="error">${esc(String(e))}</p>`}
  }else if(printerShown){printerShown=false;await invoke('printer_view_hide').catch(()=>{})}
}
globalThis.addEventListener?.('resize',()=>{if(printerView)syncPrinterView()});

function render(){
  Promise.resolve().then(syncPrinterView);
  if(!state||features.isRenaming())return;
  ensurePlates(state);
  // Aeltere Arbeitsbereiche haben kein Werkzeugprofil gespeichert: einmal je Auswahl nachtragen.
  const p=state.ui.prusa_preset;
  if(p?.printer&&p.print&&!p.tool&&toolAsked!==JSON.stringify([p.printer,p.print]))fillTool();
  loadBase();
  for(const model of state.models)if(!meshErrors.has(model.path))loadMesh(model.path);

  const focused=document.activeElement;
  const focusId=focused?.id&&app.contains?.(focused)?focused.id:'';
  let caret=null;
  if(focusId&&typeof focused.selectionStart==='number')caret=[focused.selectionStart,focused.selectionEnd];
  const scroll=new Map();
  app.querySelectorAll?.('[data-keep-scroll]').forEach(el=>scroll.set(el.dataset.keepScroll,el.scrollTop));
  viewport?.element.remove();

  const proc=activeProcess(),profile=processProfile(proc);
  const onPlate=plateModels(state),allProcesses=visibleProcesses(state.processes);
  const values=plateValues();
  const counts=new Map(),usage=new Map();
  for(const m of state.models)counts.set(m.plate,(counts.get(m.plate)||0)+1);
  for(const m of onPlate){
    if(m.enabled===false)continue;
    const key=(allProcesses.find(p=>p.id===m.process)||proc).id;
    usage.set(key,(usage.get(key)||0)+1);
  }
  const open=!!state.ui.dock_open;
  const enabled=onPlate.filter(m=>m.enabled!==false).length;
  app.innerHTML=`<div class="app-shell">
    <header class="toolbar">
      <div class="brand"><span class="brand-mark"></span>Simpliy Slicing</div>
      <button data-action="project-new">Neu</button>
      <button data-action="project-open">Öffnen</button>
      <button data-action="project-save" title="Strg+S">Speichern</button>
      <button data-action="project-save-as">Speichern unter</button>
      <div class="sep"></div>
      <button data-action="model-upload">Modell importieren</button>
      <button data-action="open-process" title="Prozess, Drucker, Material und Qualität einstellen">Prozess</button>
      <div class="sep"></div>
      <button data-action="undo" title="Strg+Z">Rückgängig</button>
      <button data-action="redo" title="Strg+Y oder Strg+Umschalt+Z">Wiederholen</button>
      <button data-action="export-project">3MF speichern</button>
      <button data-action="export-gcode" ${features.outputs.has(state.ui.active_plate)?'':'disabled'}>G-Code speichern</button><button data-action="open-upload">Zum Drucker senden</button><button data-action="open-calibration" title="Flow-Test drucken und auswerten">Kalibrierung</button>
      <span class="grow"></span>
      <button data-action="open-engine">Prusa-Pfad</button>
      <button data-action="backup-workspace">Arbeitsbereich sichern</button>
      <label class="simpliy-theme-picker" title="Design">
  🎨 <select id="simpliy-theme" aria-label="Design" title="Design">
    <option value="system" ${getThemePreference()==='system'?'selected':''}>System</option>
    <option value="dark" ${getThemePreference()==='dark'?'selected':''}>Dunkel</option>
    <option value="light" ${getThemePreference()==='light'?'selected':''}>Hell</option>
    <option value="orange" ${getThemePreference()==='orange'?'selected':''}>Orange</option>
    <option value="midnight" ${getThemePreference()==='midnight'?'selected':''}>Nachtblau</option>
  </select>
</label>
<button data-action="serial-open" title="USB/COM-Druckermonitor (Alpha 2)">USB / COM</button>
      <label class="simpliy-language-select" title="Sprache / Language" style="display:inline-flex;align-items:center;gap:5px;font-size:12px">🌐
  <select id="simpliy-language" aria-label="Sprache / Language" style="max-width:145px">
    <option value="auto" ${getLanguagePreference()==='auto'?'selected':''}>Automatisch</option>
    <option value="de" ${getLanguagePreference()==='de'?'selected':''}>Deutsch</option>
    <option value="en" ${getLanguagePreference()==='en'?'selected':''}>English</option>
  </select>
</label>
<button data-action="help">Hilfe</button>
    </header>
    <div class="workspace">
      ${previewMode&&preview?renderPreviewSidebar(preview,{collapsed:state.ui.left_open===false,modelCount:enabled,stale:previewStamp!==stampPlate()}):renderSidebar({models:onPlate,usage,assignment:renderAssignment({model:selectedModel(),processes:allProcesses,plates:state.plates}),selected:state.ui.selected_model_id,meshErrors,processes:visibleProcesses(state.processes),activeProcess:proc.id,slicing:jobRunning,collapsed:state.ui.left_open===false})}
      <main class="viewport">
        <div class="viewport-header">
          <button class="flat-btn" data-action="toggle-left" title="Linke Spalte ein-/ausblenden">☰</button>
          <button class="view-tab ${previewMode||printerView?'':'active'}" data-action="model-view">Modell</button>
          <button class="view-tab ${previewMode&&!printerView?'active':''}" data-action="preview-view" ${preview||features.outputs.has(state.ui.active_plate)?'':'disabled'}>G-Code</button>
          <button class="view-tab ${printerView?'active':''}" data-action="printer-view" title="Weboberfläche des Druckers in diesem Fenster">Drucker</button>
          <span class="grow"></span>
          ${printerView?'':[['iso','Iso'],['top','Oben'],['bottom','Unten'],['front','Vorne'],['back','Hinten'],['right','Rechts'],['fit','Einpassen']].map(([key,label])=>`<button class="flat-btn" data-action="camera" data-view="${key}">${label}</button>`).join('')}${printerView?'':`<button class="flat-btn icon-btn ${state.ui.show_triangles?'active':''}" data-action="toggle-triangles" title="Dreiecke anzeigen" aria-label="Dreiecke anzeigen" aria-pressed="${!!state.ui.show_triangles}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 20L12 4l9 16z M7.500 12h9 M12 4v16 M3 20l9-8 9 8" fill="none" stroke="currentColor" stroke-width="1.600" stroke-linejoin="round"/></svg></button>`}
        </div>
        ${renderPlateBar(state.plates,state.ui.active_plate,counts)}
        <div class="stage" id="model-view">${printerView?printerHost():''}<div class="stage-note" id="stage-note"></div>${previewMode&&preview&&previewView.metric!=='type'?`<div class="preview-scale"><strong>${metricTitle()}</strong><div class="preview-scale-body"><i></i><span id="preview-scale-ticks"></span></div></div>`:''}</div>
        ${previewMode&&preview?renderPreviewControls(preview,previewView,{path:previewPath,stale:previewStamp!==stampPlate()}):''}
        ${renderQuickbar(state.ui.tool,open,previewMode,supportMode)}
      </main>
      <aside class="dock-panel ${open?'open':''}">${open?renderDock(state.ui.tool,dockContext(values)):''}</aside>
      <nav class="tool-rail" data-keep-scroll="rail">${renderRail(state.ui.tool,open)}</nav>
    </div>
    <footer class="footer">
      ${progressHtml()}<strong id="job-status" class="${jobRunning?'running':''}" title="${esc(jobStatus)}">${esc(jobStatus)}</strong>
      <span class="grow"></span>
      <span class="truncate">${esc(proc.name)} · ${esc(profile.profile.name)}</span>
      <span class="truncate base-label ${baseConfig?'':'missing'}" title="${esc(baseName())}">${esc(state.profile_schema>=P.SCHEMA?(printerOf(mainProcess())?.name||'Kein Drucker'):(state.ui.prusa_preset?.printer||'Kein Basisprofil'))}</span>
      <span class="truncate" id="project-name" title="${esc(state.ui.project_path||'')}">${esc(features.projectName()||'Projekt nicht gespeichert')}</span>
      <span>${enabled} Modell${enabled===1?'':'e'}</span>
      <span id="save-label">${saveTimer?'Arbeitsbereich wird gespeichert ...':'Arbeitsbereich gespeichert'}</span>
    </footer>
  </div>${modal?renderModal():''}${appDialog?renderAppDialog():''}`;
  app.querySelectorAll?.('input[data-state=some]').forEach(x=>{x.indeterminate=true});
  translateDOM(app);
  if(appDialog)Promise.resolve().then(focusAppDialog);

  showScene(values);

  app.querySelectorAll?.('[data-keep-scroll]').forEach(el=>{
    if(scroll.has(el.dataset.keepScroll))el.scrollTop=scroll.get(el.dataset.keepScroll);
  });
  if(focusId){
    const el=document.getElementById(focusId);
    el?.focus({preventScroll:true});
    if(caret&&el?.setSelectionRange)try{el.setSelectionRange(...caret)}catch{/* Feldtyp ohne Textauswahl */}
  }
  if(highlightKey)app.querySelector?.('.s-row.found')?.scrollIntoView({block:'center'});
}

function renderPreviewSidebar(data,{collapsed,modelCount,stale}){
  const meta=data.summary||{};
  const row=(label,value)=>`<div class="preview-summary-row"><span>${label}</span><b>${esc(value||'--')}</b></div>`;
  return `<aside class="sidebar preview-sidebar ${collapsed?'collapsed':''}"><div class="left-group"><div class="left-title">Build-Zusammenfassung</div><div class="preview-summary">${row('Bauzeit',meta.time)}${row('Materiall\u00e4nge',meta.length)}${row('Materialvolumen',meta.volume)}${row('Materialgewicht',meta.weight)}${row('Schichtzahl',String(data.layers.length))}${row('Modelle',String(modelCount))}${stale?'<p class="bad">Vorschau ist veraltet. Bitte neu slicen.</p>':''}</div><button class="full" data-action="export-gcode" ${stale?'disabled':''}>G-Code speichern ...</button><button class="full" data-action="open-upload" ${stale?'disabled':''}>Zum Drucker hochladen ...</button><button class="full primary" data-action="model-view">Vorschaumodus verlassen</button><p class="muted">Hochladen startet keinen Druck.</p></div></aside>`;
}
function metricTitle(){const [,name,unit]=PREVIEW_METRICS.find(m=>m[0]===previewView.metric)||['','',''];return unit?`${name} (${unit})`:name}
function metricUnit(){return (PREVIEW_METRICS.find(m=>m[0]===previewView.metric)||['','',''])[2]}
let playTimer=null;
function stopPlayback(){
  if(playTimer)clearInterval(playTimer);
  playTimer=null;previewView.playing=false;
  const button=$('#preview-play');if(button)button.textContent='▶';
}
function showMoves(){
  if(!preview)return;
  const total=preview.moveCounts[previewView.layer]??0,at=Math.min(total,previewView.move??total);
  const slider=$('#preview-move');if(slider){slider.max=total;slider.value=at}
  const label=$('#preview-move-label');if(label)label.textContent=`${Math.floor(at)} / ${total}`;
}
function togglePlayback(){
  if(previewView.playing){stopPlayback();return}
  if(!preview||!previewMode)return;
  const last=preview.layers.length-1,count=()=>preview.moveCounts[previewView.layer]??0;
  if(previewView.move===null||previewView.move>=count()){
    if(previewView.layer<last)previewView.layer++;
    else previewView.layer=previewView.minLayer||0;
    previewView.move=0;
  }
  previewView.playing=true;
  const button=$('#preview-play');if(button)button.textContent='❚❚';
  playTimer=setInterval(()=>{
    if(!previewMode||!preview){stopPlayback();return}
    let move=(previewView.move??0)+Math.max(1,Number(previewView.rate)||4)*2;
    while(move>=count()){
      if(previewView.layer>=last){previewView.move=null;stopPlayback();move=null;break}
      move-=count();previewView.layer++;
    }
    if(move!==null)previewView.move=move;
    const layer=$('#preview-layer');if(layer)layer.value=previewView.layer;
    const label=$('#preview-layer-label');if(label)label.textContent=`${previewView.layer+1} / ${preview.layers.length}`;
    const height=$('#preview-layer-height');if(height)height.textContent=preview.layers[previewView.layer].z?.toFixed(2)||'--';
    showMoves();
    viewport?.setToolpath(preview,{...previewView});
  },33);
}
function showScene(values){
  const host=$('#model-view');
  if(!host?.prepend||!viewport)return;
  viewport.mount(host);
  const bed=effectiveBed(baseFlat,values,catalogByKey);
  viewport.setBed(bed);
  const onPlate=plateModels(state);
  const zoneBoxes=zonesOfSelected(onPlate);
  const key=JSON.stringify([bed,state.ui.active_plate,state.ui.selected_model_id,onPlate,onPlate.map(m=>meshes.has(m.path)),zoneBoxes]);
  if(key!==modelsKey){
    modelsKey=key;
    viewWarnings=viewport.setModels(onPlate,meshes,state.ui.selected_model_id,zoneBoxes);
  }
  const analysed=state.ui.dock_open&&!previewMode&&state.ui.tool==='supports'?selectedModel():null;
  const shape=analysed?supports.settings(analysed):null;
  if(!previewMode){
    supports.refresh({models:onPlate,plate:state.ui.active_plate,bed,marks:shape?.detectMinima?analysed.id:null});
    viewport.setSupports(supports.views());
    // Bis die genaue Planung fertig ist: sofort die Stützen aus den gespeicherten Positionen zeigen.
    if(supports.pending()){
      const qkey=onPlate.map(m=>m.straightSupports);
      if(!quickCache||quickCache.key.length!==qkey.length||quickCache.key.some((v,i)=>v!==qkey[i]))quickCache={key:qkey,list:quickSupports({models:onPlate,meshes,bed})};
      viewport.setQuickSupports(quickCache.list);
    }else viewport.setQuickSupports(null);
  }
  if(previewMode)viewport.setQuickSupports(null);
  viewport.setAnalysis?.(analysed?.id,shape,analysed&&supports.views().get(analysed.id)?.minima);
  viewport.setTriangles(!!state.ui.show_triangles||(state.ui.dock_open&&state.ui.tool==='paint'&&!previewMode));
  viewport.setTool({...toolOptions,name:state.ui.dock_open&&!previewMode?state.ui.tool:'select',mode:supportMode,moving:!!supportMoving,modelId:state.ui.selected_model_id});
  const info=viewport.setToolpath(previewMode?preview:null,{...previewView});
  sectionState.position=clampSectionPosition(sectionState.position,bed,sectionState.orientation);
  viewport.setSection(sectionState);
  const note=$('#stage-note');
  if(info){
    note.textContent=`${info.shown} Werkzeugwege${info.total>info.shown?' (gekürzt, einzelne Schicht wählen)':''}`;
    const range=$('#preview-range');
    if(range)range.textContent=info.min===null?'Keine Werte':`${info.min.toFixed(2)} - ${info.max.toFixed(2)} ${metricUnit()}`;
    const ticks=$('#preview-scale-ticks');if(ticks)ticks.innerHTML=info.min===null?'':Array.from({length:6},(_,i)=>`<span>${(info.max-(info.max-info.min)*i/5).toFixed(2)}</span>`).join('');

  }else{
    note.textContent=viewWarnings.join(' · ');
  }
  note.classList.toggle('bad',!info&&viewWarnings.length>0);
}


// Wirksame Offsets des Prozesses je Parameter (Summe aller aktiven Regeln).
function offsetMap(proc){const m=new Map();for(const o of P.activeOffsets(proc,offsetsOf(proc)))for(const it of P.offsetItems(o))m.set(it.key,(m.get(it.key)||0)+Number(it.delta));return m}
// Weitere Temperatur-Sollwerte pro Schicht (eigener Simpliy-Wert): {t0:[[Schicht,Temp]],…,bed:[…],chamber:[…]}.
const tempsOf=proc=>structuredClone(proc?.values?.['simpliy.temps']&&typeof proc.values['simpliy.temps']==='object'?proc.values['simpliy.temps']:{});
function editTemps(change){
  const proc=activeProcess();
  if(!proc?.values)return notify('Weitere Sollwerte gibt es nur bei Prozessen der neuen Profilverwaltung.',true);
  const t=tempsOf(proc);change(t);
  writeSetting('simpliy.temps',t,proc,processProfile(proc));
}
// Zusaetzliche Luefter des Prozesses (eigener Simpliy-Wert, geht nicht an die Engine).
const fansOf=proc=>structuredClone(Array.isArray(proc?.values?.['simpliy.fans'])?proc.values['simpliy.fans']:[]);
function editFans(change){
  const proc=activeProcess();
  if(!proc?.values)return notify('Zusätzliche Lüfter gibt es nur bei Prozessen der neuen Profilverwaltung.',true);
  const fans=fansOf(proc);change(fans);
  writeSetting('simpliy.fans',fans,proc,processProfile(proc));
}
// Werkzeuganzahl kommt aus der Engine-Grundlage des Druckers: eine Grundlage mit einem Werkzeug mehr/weniger waehlen.
// Die Druckerwerte bleiben die eigenen (wie beim Wechsel im Drucker-Dialog).
async function changeToolCount(step){
  const pr=printerOf(activeProcess());
  if(!pr)return notify('Dem Prozess ist kein Drucker zugeordnet.',true);
  const want=Math.min(8,toolCount()+step);
  if(want<1||want===toolCount())return;
  pr.engine=P.neutralSkeleton(want);baseKey='';
  toolListsActions.view.activeExtruder=Math.min(toolListsActions.view.activeExtruder,want-1);
  update();notify(`${want} Extruder. Druckerwerte bleiben unverändert.`);
}

// G-Code-Kopf: Prozess, Auto-Konfigurationen, Modelle, Drucker und jeder Wert, wie er in Simpliy eingestellt ist.
function settingsSummary(layers,models,values){
  const main=layers[0].process,printer=printerOf(main),out=[];
  for(const l of layers)out.push(['processName',l.process.name]);
  if(main.values)for(const c of P.autoCategories(state)){
    const chosen=autoList(c.id,main).find(x=>x.id===main[autoField[c.id]]);
    out.push([`autoConfigure${c.name.replace(/\s+/g,'')}`,chosen?.name||'–']);
  }
  out.push(['targetModels',models.filter(m=>m.enabled!==false).map(m=>m.name).join(', ')]);
  out.push(['printerName',printer?.name||''],['printerManufacturer',printer?.manufacturer||''],['toolCount',String(toolCount())]);
  for(const key of Object.keys(values).sort())out.push([key,key.startsWith('simpliy.')?JSON.stringify(values[key]):display(values[key],catalogByKey.get(key)||{})]);
  return out;
}

function draftPresets(proc){
  const own=state.presets||[],pend=Object.entries(proc?.pending||{}).filter(([c])=>!['material','quality','offsets'].includes(c)).flatMap(([,l])=>l);
  return pend.length?[...own,...pend]:own;
}
/** Drucker mit den eingelesenen, noch nicht gespeicherten Schichthöhen/Materialien. */
function draftPrinter(proc,printer){
  if(!printer||!proc?.pending)return printer;
  const q=pendingOf(proc,'quality'),m=pendingOf(proc,'material');
  if(!q.length&&!m.length)return printer;
  return {...printer,qualities:[...(printer.qualities||[]),...q],materials:printer.materials?.length?[...printer.materials,...m.map(x=>x.id)]:printer.materials};
}
function processContext(){
  const proc=activeProcess(),bundle=processProfile(proc),{values,sources}=resolve(bundle,proc);
  const printer=printerOf(proc),library=state.process_library||[];
  const errors=baseConfig?compileConfig(baseConfig,values,catalogByKey).errors:[];
  return {
    proc,bundle,values,sources,errors,
    tools:toolCount(),
    profiles:state.profiles,
    categories:orderedCats(bundle).map(category=>({category,selected:selectedOption(category,proc)})),
    byKey:catalogByKey,
    base:baseFlat,
    baseName:baseName(),
    tab:activeSettingTab,
    page:settingsPage[activeSettingTab]||0,
    extruder:toolListsActions.view.activeExtruder,fans:fansOf(proc),fan:toolListsActions.view.activeFan,temps:tempsOf(proc),
    favs:state.favorites||[],favSearch:favorites.search(),zoneOn:!!(proc.zone&&(proc.zone.fromOn||proc.zone.toOn)),offsets:offsetsOf(proc),offsetView:offsets.viewOf(proc),offsetDefault:(cat,option,key)=>P.defaultOffset(cat,autoList(cat,proc),option,key),lang:getLanguage(),offsetOf:offsetMap(proc),colorOf:P.colorOffsetMap(activeColorOf(proc)),colorHex:activeColorOf(proc)?.colour||'',colorName:activeColorOf(proc)?.name||'',colors:colorsOf(proc),shift:P.shift,shiftClamped:P.shiftClamped,colorStyle:P.colorTextStyle,offsetCats:P.autoCategories(state).map(c=>({...c,options:autoList(c.id,proc)})),
    search:settingSearch,
    highlight:highlightKey,
    target:settingEditTarget,
    autoMenu:autoConfigActions.view.autoMenu,labels:state.auto_labels||{},autoCats:P.autoCategories(state),
    modern:!!proc.values,printers:state.printers,printer:draftPrinter(proc,printer),materials:autoList('material',proc),presets:draftPresets(proc),library,
    dirty:!!proc.values&&P.unsaved(proc,library),
    resettable:proc.values?new Set(Object.keys(proc.values).filter(k=>Object.hasOwn(printer?.settings||{},k))):null,
    network:{printer,secret:features.printerSecret(printer?.id),message:netMessage},
    slots:proc.values?renderMaterials({tools:toolCount(),preset:enginePreset()||{},filaments:prusaProfiles.find(x=>x.name===enginePreset()?.print)?.filament_profiles||[],bundle,assigned:state.tool_materials,library:state.filaments}):'',
  };
}

/** Z-Bereiche der Zonen-Prozesse des gewaehlten Modells (fuer die blauen Quader in der Ansicht). */
/** Raft-Höhe für die Zonenanzeige: nach dem Slicen die tatsächliche der Engine, vorher eine Schätzung (1,5 × Schichthöhe je Raft-Schicht, gemessen mit PrusaSlicer 3.0.0-alpha15). */
function zoneBase(){
  const out=features.outputs.get(state.ui.active_plate);
  if(out&&out.stamp===stampPlate(state.ui.active_plate))return {base:out.partBottom||0,estimated:false};
  const values=plateValues(),layers=Number(Array.isArray(values.raft_layers)?values.raft_layers[0]:values.raft_layers)||0;
  const height=Z.millimetres(values.layer_height)||0.2;
  return {base:layers>0?Math.round(layers*1.5*height*100)/100:0,estimated:layers>0};
}
function zonesOfSelected(models){
  const m=models.find(x=>x.id===state.ui.selected_model_id);
  if(!m)return [];
  const {base,estimated}=zoneBase();
  const processes=visibleProcesses(state.processes);
  const assigned=Z.zonesOfModel(m,processes);
  const main=processes.find(p=>p.id===m.process);
  if(main && Z.zoneActive(main)) assigned.unshift(Z.zoneOf(main));
  // Show the currently edited process as a preview even before it has been
  // assigned. This does not silently change the slicing assignment.
  const active=activeProcess();
  const preview=active && Z.zoneActive(active) && active.id!==m.process && !(m.zone_processes||[]).includes(active.id)
    ? [{...Z.zoneOf(active),unassigned:true}] : [];
  return [...assigned,...preview].map(z=>({...z,base,estimated}));
}
/**
 * Vorab-Sperren fuer Zonen-Prozesse: nur Faelle, die sicher zusammengesetzt werden koennen. Der G-Code selbst wird
 * zusaetzlich in Rust gegen das tatsaechliche Schichtraster geprueft.
 */
async function checkZoneSafety(list,wanted,main,job){
  const valuesOf=p=>p.values?P.withOffsets(resolve(processProfile(p),p).values,p,offsetsOf(p),colorOptions(p)):resolve(processProfile(p),p).values;
  const reason=Z.zoneBlockReason({models:list.filter(m=>m.enabled!==false).length,tools:toolCount(),hasSupportPlate:!!job.supportPlate,mainValues:main.values,zoneValues:wanted.map(valuesOf)});
  if(reason){notify(reason,true);setJobStatus('Zonen gesperrt');return true}
  for(const zp of wanted){
    const bad=Z.heightMismatch(main.values,valuesOf(zp));
    if(!bad)continue;
    setJobStatus('Zonen gesperrt');
    const ask=Z.heightMessage(main.process.name,zp.name,bad)+String.fromCharCode(10,10)+`Zum Zonen-Prozess „${zp.name}“ wechseln?`;
    if(await confirmRemove(ask,{title:'Zonen: Schichthöhen passen nicht',ok:'Zum Prozess',cancel:'Schließen'})){state.active_process_id=zp.id;activeSettingTab='Schicht';openProcess()}
    return true;
  }
  return false;
}
function renderModal(){
  switch(modal){
    case'process':return renderProcessDialog(processContext());
    case'zones':return zones.renderDialog();
    case'colors':{const ctx=processContext(),pr=ctx.proc;return renderColorDialog({...ctx,colors:colorsOf(pr),color:activeColorOf(pr),materialName:materialOf(pr)?.name||''})}
    case'auto-assign':return `<div class="assign-dialog">${shell('Einstellungen zuweisen','Welche Auto-Konfiguration steuert welche Einstellung',
      renderAssign({rows:[...PLACE].map(([key,p])=>({key,label:p.label,tab:p.tab})),draft:autoConfigActions.view.assignDraft||{},filter:autoConfigActions.view.assignFilter,categories:P.autoCategories(state)}),
      '<button data-action="assign-cancel">Abbrechen</button><button class="primary" data-action="assign-apply">OK</button>',false)}</div>`;
    case'process-models':return assignment.renderDialog();
    case'prusa-presets':return renderPrusaPresets();
    case'profile':return renderProfileDialog();
    case'printers':return renderPrinterDialog();
    case'filaments':return renderFilamentDialog();
    case'engine':return renderEngineDialog();
    case'serial':return shell('USB/COM – Maschinenmonitor','Unabhängig von der Prusa-Slicing-Engine',serialPanel.render());
    case'calibration':return shell('Kalibrierung','Flow-Test für RepRapFirmware (Plugin „Kalibrierung“)',features.calibrationDialog());
    case'upload':return shell('Zum Drucker senden','G-Code im eigenen Netz übertragen',features.uploadDialog());
    default:return renderHelpDialog();
  }
}

function openModal(name){
  if(modal==='process'&&name!=='process')modalReturn='process';
  modal=name;
}
function closeModal(){
  modal=modalReturn;
  modalReturn='';
  render();
}

function processAssignments(){return Object.fromEntries(state.models.map(m=>[m.id,m.process??null]))}
function openProcess(){
  if(modal!=='process'&&modalReturn!=='process'){
    dialogSnapshot=JSON.stringify({profiles:state.profiles,processes:state.processes,active_profile_id:state.active_profile_id,active_process_id:state.active_process_id,model_assignments:processAssignments()});
    settingEditTarget='smart';
    settingSearch='';
    highlightKey='';
  }
  modal='process';
  modalReturn='';
  render();
}

async function closeProcess(keep){
  if(!keep&&dialogSnapshot){
    const before=JSON.parse(dialogSnapshot);
    const now={profiles:state.profiles,processes:state.processes,active_profile_id:state.active_profile_id,active_process_id:state.active_process_id,model_assignments:processAssignments()};
    if(JSON.stringify(now)!==dialogSnapshot){
      if(!await confirmRemove('Alle Änderungen an den Prozesseinstellungen seit dem Öffnen gehen verloren, auch eingelesene Konfigurationen, die noch nicht mit „Prozess speichern“ gesichert wurden.',{title:'Änderungen verwerfen?',ok:'Verwerfen',cancel:'Weiter bearbeiten'}))return;
      const assignments=before.model_assignments;delete before.model_assignments;Object.assign(state,before);for(const model of state.models){if(assignments[model.id]==null)delete model.process;else model.process=assignments[model.id]}
    }
  }
  dialogSnapshot=null;
  settingEditTarget='smart';
  modal=modalReturn='';
  update();
}

function shell(title,subtitle,body,foot='',close=true){
  return `<div class="overlay" data-action="click-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="dialog-head"><div><h2>${title}</h2><div class="subtitle">${subtitle}</div></div><button class="x" data-action="close-modal" title="Schließen">×</button></div>
    <div class="dialog-body" data-keep-scroll="dialog:${esc(title)}">${body}</div>
    <div class="dialog-foot"><span class="grow"></span>${foot}${close?'<button class="primary" data-action="close-modal">Schließen</button>':''}</div>
  </section></div>`;
}
function renderPrusaPresets(){
 const sel=state.ui.prusa_preset||{};const print=prusaProfiles.find(p=>p.name===sel.print);const options=(items,val)=>[...new Set(items)].map(x=>`<option value="${esc(x)}" ${x===val?'selected':''}>${esc(x)}</option>`).join('');
 return shell('Prusa Standardprofile','Kompatible Profile direkt aus der Prusa-Engine',`<div class="hint">Wähle Drucker, Druckprofil, Werkzeugprofil und Filament. Die Liste zeigt alle von der installierten Engine gelieferten Drucker. Diese Auswahl ist die Grundlage; deine Profil- und Prozesswerte werden darüber gelegt.</div><div class="form-grid" style="margin-top:16px"><div class="form-field"><label>Drucker suchen</label><input type="search" data-filter-select="prusa-printer" placeholder="Hersteller oder Modell eingeben"><select data-field="prusa-printer"><option value="">Drucker auswählen</option>${prusaPrinters.map(p=>`<option value="${esc(p.name)}" ${p.name===sel.printer?'selected':''}>${esc(p.name)} (${esc(p.extruders_cnt||1)} Tool)</option>`).join('')}</select></div><div class="form-field"><label>Druckprofil</label><select data-field="prusa-print"><option value="">Druckprofil auswählen</option>${options(prusaProfiles.map(p=>p.name),sel.print)}</select></div><div class="form-field"><label>Werkzeugprofil</label><select data-field="prusa-tool"><option value="">Auswählen</option>${options(print?.tool_print_profiles||[],sel.tool)}</select></div><div class="form-field"><label>Filament suchen</label><input type="search" data-filter-select="prusa-filament" placeholder="Material, Hersteller oder Name"><select data-field="prusa-filament"><option value="">Auswählen</option>${options(print?.filament_profiles||[],sel.filament)}</select></div></div><div class="row wrap"><button data-action="prusa-save-printer">Drucker zu meinen Druckern hinzufügen</button><button data-action="prusa-save-filament">Filament zu meiner Bibliothek hinzufügen</button></div>${renderMaterials({tools:toolCount(),preset:sel,filaments:print?.filament_profiles||[],bundle:layersOf(state.ui.active_plate)[0].bundle,assigned:state.tool_materials,library:state.filaments})}<p>Die Auswahl wird beim Slicing verwendet, sobald alle vier Profile ausgewählt sind. Es werden nur installierte und mit dem Drucker kompatible Prusa-Profile angezeigt.</p>`);
}
function renderProfileDialog(){const bundle=currentProfile(),p=bundle.profile,cats=orderedCats(bundle),cat=cats.find(c=>c.id===profileEditorActions.view.editCat)||cats[0];profileEditorActions.view.editCat=cat?.id||'';const opt=cat?.options.find(o=>o.id===profileEditorActions.view.editOpt)||cat?.options[0];profileEditorActions.view.editOpt=opt?.id||'';
 const header=`<div class="row wrap"><div class="grow" style="min-width:250px"><label>Aktives Simpliy-Profil</label><select data-field="active-profile">${state.profiles.map(p=>`<option value="${esc(p.manifest.profile_id)}" ${p.manifest.profile_id===bundle.manifest.profile_id?'selected':''}>${esc(p.profile.name)}</option>`).join('')}</select></div><button data-action="open-prusa-presets">Prusa Standardprofile</button><button data-action="select-mk3s-builtin">MK3S-Teilprofil</button><button data-action="new-profile">+ Neues Profil</button><button data-action="clone-profile">Duplizieren</button><button data-action="remove-profile" class="danger">Löschen</button><button data-action="import-profile">Prusa-/Simpliy-Profil importieren</button><button class="primary" data-action="export-profile">.simpliyprofile speichern</button></div><div class="row" style="margin:10px 0 14px"><div class="grow"><label>Profilname</label><input data-field="profile-name" value="${esc(p.name)}"></div><span class="pill">Engine-Ziel: ${esc(bundle.manifest.engine_target||'3.0.x')}</span></div>
 <div class="tab-row">${[['auto','Auto-Configure'],['basis','Basisparameter'],['effektiv','Effektive Werte'],['vergleich','Profilvergleich']].map(([id,label])=>`<button class="${profileEditorActions.view.profilePanel===id?'active':''}" data-action="profile-panel" data-panel="${id}">${label}</button>`).join('')}</div>`;
 let body='';if(profileEditorActions.view.profilePanel==='auto')body=renderAutoEditor(cats,cat,opt);if(profileEditorActions.view.profilePanel==='basis')body=renderBaseEditor(p);if(profileEditorActions.view.profilePanel==='effektiv')body=renderEffective();if(profileEditorActions.view.profilePanel==='vergleich')body=renderComparison();
 return shell('Profile und Auto-Konfiguration',`Beliebig viele Kategorien, Optionen und Mehrfachzuweisungen · eigenes Simpliy-Format`,`${header}<div style="margin-top:13px">${body}</div>`,`<button data-action="open-process">Prozessdialog</button>`)}
function renderAutoEditor(cats,cat,opt){const assigns=opt?.assignments||{};const shownCatalog=catalog;return `<div class="editor-grid">
 <div class="editor-col"><h3>Kategorien (${cats.length})</h3><div class="muted tiny">Von oben nach unten steigt die Priorität.</div><div class="edit-list">${cats.map(c=>`<button class="edit-entry ${c.id===profileEditorActions.view.editCat?'active':''}" data-action="choose-cat" data-id="${esc(c.id)}"><b>${esc(c.name)}</b><div class="meta">${c.options.length} Optionen</div></button>`).join('')}</div><div class="editor-tools"><button data-action="add-category">+ Hinzufügen</button><button data-action="duplicate-category">Kopieren</button><button data-action="delete-category" class="danger">Löschen</button><button data-action="move-category" data-dir="-1">↑</button><button data-action="move-category" data-dir="1">↓</button></div>${cat?`<div class="form-field"><label>Kategorie umbenennen</label><input data-field="category-name" value="${esc(cat.name)}"></div>`:''}</div>
 <div class="editor-col"><h3>Optionen (${cat?.options.length||0})</h3><div class="edit-list">${(cat?.options||[]).map(o=>`<button class="edit-entry ${o.id===profileEditorActions.view.editOpt?'active':''}" data-action="choose-opt" data-id="${esc(o.id)}">${esc(o.name)}<div class="meta">${Object.keys(o.assignments||{}).length} Parameter</div></button>`).join('')}</div><div class="editor-tools"><button data-action="add-option" ${!cat?'disabled':''}>+ Option</button><button data-action="duplicate-option" ${!opt?'disabled':''}>Kopieren</button><button data-action="delete-option" class="danger" ${!opt?'disabled':''}>Löschen</button><button data-action="move-option" data-dir="-1" ${!opt?'disabled':''}>↑</button><button data-action="move-option" data-dir="1" ${!opt?'disabled':''}>↓</button></div>${opt?`<div class="form-field"><label>Optionsname</label><input data-field="option-name" value="${esc(opt.name)}"></div><button class="small" data-action="select-default-option">Als Standard auswählen</button>`:''}</div>
 <div class="editor-col"><h3>${esc(cat?.name||'Kategorie auswählen')} ${opt?`→ ${esc(opt.name)}`:''}</h3><div class="hint" style="margin-bottom:13px">Auto-Configure ist eine Sammlung von Parameter-Abweichungen. <b>Alle Werte bearbeitest du auch direkt in den normalen Prozess-Registern</b>: oben „Änderungen speichern in“ auf diese Kategorie stellen. Bereits zugewiesene Werte können hier zusätzlich geprüft oder entfernt werden.</div>${opt?`<button class="primary" data-action="edit-option-in-tabs" style="margin-bottom:12px">Diese Option in den Einstellungs-Registern bearbeiten</button>`:''}
 ${opt?`<table class="assign-table"><thead><tr><th>Parameter</th><th>Wert</th><th></th></tr></thead><tbody>${Object.entries(assigns).map(([key,value])=>`<tr><td title="${esc(key)}">${esc(catalogByKey.get(key)?.label||key)}<div class="muted tiny">${esc(key)}</div></td><td><input data-assignment-key="${esc(key)}" value="${esc(vtext(value))}"></td><td><button class="danger" data-action="delete-assignment" data-key="${esc(key)}">×</button></td></tr>`).join('')}</tbody></table><div class="divider"></div><label>Parameter hinzufügen</label><div class="row"><input id="new-param-key" list="keys-list" placeholder="Schlüssel: z. B. layer_height"><datalist id="keys-list">${shownCatalog.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</datalist><input id="new-param-value" placeholder="Wert" style="max-width:100px"><button class="primary" data-action="add-assignment">+</button></div>`:`<div class="hint">Bitte eine Kategorie und eine Option anlegen oder auswählen.</div>`}
 <div class="divider"></div><div class="helper">Eigene Schlüssel unter <code>simpliy.*</code> werden nicht an die Engine übergeben. Alle anderen Werte prüft Simpliy vor dem Slicen.</div></div>
 </div>`}
function renderBaseEditor(profile){const base=profile.base_parameters;return `<div class="row space"><div><h3 class="section-title">Basiswerte (${Object.keys(base).length})</h3><p class="muted tiny">Importierte Prusa-Werte bleiben als Rohwerte erhalten. Hier lassen sie sich ändern.</p></div><button data-action="show-effective">Wirksame Werte prüfen</button></div><div style="max-height:430px;overflow:auto">${Object.entries(base).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`<div class="base-row"><div class="truncate" title="${esc(k)}">${esc(catalogByKey.get(k)?.label||k)}<div class="muted tiny">${esc(k)}</div></div><input data-base-key="${esc(k)}" value="${esc(vtext(v))}"><button class="small danger" data-action="delete-base" data-key="${esc(k)}">×</button></div>`).join('')}</div><div class="divider"></div><label>Basisparameter hinzufügen</label><div class="row"><input id="new-base-key" list="base-keys" placeholder="Prusa-Schlüssel"><datalist id="base-keys">${catalog.map(c=>`<option value="${esc(c.key)}">${esc(c.label)}</option>`).join('')}</datalist><input id="new-base-value" placeholder="Wert"><button data-action="add-base" class="primary">Hinzufügen</button></div>`}
function renderEffective(){const eff=resolve();const rows=Object.entries(eff.values).sort(([a],[b])=>a.localeCompare(b));return `<h3 class="section-title">Wirksame Werte für ${esc(activeProcess().name)} (${rows.length})</h3><p class="muted small-text">Bei mehrfacher Zuweisung gewinnt die letzte Kategorie, danach der manuelle Prozess-Override.</p><div style="max-height:470px;overflow:auto"><table class="effective-table"><thead><tr><th>Prusa-Schlüssel</th><th>Wert</th><th>Quelle / Konflikte</th></tr></thead><tbody>${rows.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(vtext(v))}</td><td>${esc(eff.sources[k]||'')} ${eff.history[k].length>1?`<span class="warn-inline">(${eff.history[k].length} Zuweisungen)</span>`:''}<div class="muted tiny">${eff.history[k].length>1?esc(eff.history[k].map(x=>`${x.origin}: ${vtext(x.value)}`).join(' · ')):''}</div></td></tr>`).join('')}</tbody></table></div>`}
function renderComparison(){const current=currentProfile(),other=state.profiles.find(p=>p.manifest.profile_id!==current.manifest.profile_id);if(!other)return `<div class="hint">Lege ein weiteres Profil an, um Unterschiede zu vergleichen.</div>`;const a=current.profile.base_parameters,b=other.profile.base_parameters,keys=[...new Set([...Object.keys(a),...Object.keys(b)])].sort();return `<h3 class="section-title">Basisparameter-Vergleich: ${esc(current.profile.name)} ↔ ${esc(other.profile.name)}</h3><div style="max-height:450px;overflow:auto"><table class="effective-table"><thead><tr><th>Parameter</th><th>Aktiv</th><th>Vergleichsprofil</th></tr></thead><tbody>${keys.filter(k=>vtext(a[k])!==vtext(b[k])).map(k=>`<tr><td>${esc(k)}</td><td>${esc(vtext(a[k]??'–'))}</td><td>${esc(vtext(b[k]??'–'))}</td></tr>`).join('')}</tbody></table></div>`}
function renderPrinterDialog(){
 const p=state.printers.find(x=>x.id===(libraryActions.view.printerEdit||state.active_printer_id))||state.printers[0];libraryActions.view.printerEdit=p?.id||'';
 if(p&&!p.settings)return shell('Drucker verwalten','Wird vorbereitet','<p>Die Druckerwerte werden angelegt, sobald die Engine bereit ist.</p>');
 const e=p?.engine||{};
 return shell('Drucker verwalten','Eigene Drucker mit allen Druckereinstellungen, Qualitäten und Materialfreigaben',
  renderPrinterManager({printers:state.printers,printer:p,materials:state.filaments,byKey:catalogByKey,filter:printerFilter,tools:P.toolsOf(e)}),
  `<button data-action="set-default-printer">Als aktiven Drucker verwenden</button><button data-action="save-printers">Speichern</button>`);
}
function renderFilamentDialog(){
 const f=state.filaments.find(x=>x.id===(libraryActions.view.filamentEdit||state.active_filament_id))||state.filaments[0];libraryActions.view.filamentEdit=f?.id||'';
 return shell('Materialbibliothek','Zentrale Materialien mit allen Filamentparametern, für jeden Drucker und Prozess',
  renderMaterialLibrary({materials:state.filaments,material:f?.settings?f:null,byKey:catalogByKey,filter:materialFilter}));
}
function renderEngineDialog(){return shell('PrusaSlicer 3.0 – Engine-Konfiguration','Prusa-Engine im Hintergrund',`<div class="form-field"><label>Pfad zur installierten PrusaSlicer-3.0-Anwendung</label><div class="row"><input data-field="engine-path" placeholder="z. B. C:\\Program Files\\Prusa3D\\...\\prusa-slicer-console.exe" value="${esc(state.engine_path||'')}"><button data-action="detect-engine">Automatisch suchen</button></div></div><div class="hint">PrusaSlicer berechnet den G-Code im Hintergrund ohne eigenes Fenster. Geprueft ist Version 3.0.0-alpha14. Deine Prusa-Profile werden nicht veraendert.</div><div id="engine-results" class="muted small-text" style="margin-top:15px"></div>`)}
// ---- Hilfe: Ueber Simpliy, Lizenzen, Aktualisierungen, Slicing-Engine, Programmsymbol ----
let legal=null,updateInfo=null,engineList=null,helpTab='about',busy='';
const fmtMB=b=>`${(Number(b||0)/1048576).toFixed(0)} MB`;
function renderHelpDialog(){
  const tabs=[['about','Über'],['updates','Updates'],['engine','Slicing-Engine'],['licenses','Lizenzen']]
    .map(([id,l])=>`<button class="${helpTab===id?'active':''}" data-action="help-tab" data-tab="${id}">${l}</button>`).join('');
  let body='';
  if(helpTab==='about'){
    body=`<div class="about"><img class="about-logo" src="${esc(state.ui.app_logo||'assets/logo.png')}" alt="Logo">
      <div><h3>Simpliy Slicing</h3><p>Version ${esc(legal?.version||'')}</p><p>© 2026 Michael Roßmann</p>
      <p class="meta">Simpliy ist ein eigenständiges Programm und kein Fork von PrusaSlicer. Als externer Slicing-Kern startet es das unveränderte, separat installierte PrusaSlicer (AGPLv3, Prusa Research und Mitwirkende). Simpliy ist kein offizielles Prusa-Produkt.</p>
      <div class="row wrap"><button data-action="choose-app-icon">Programmsymbol ändern…</button><button data-action="choose-app-logo">Logo ändern…</button><button data-action="reset-branding">Standard wiederherstellen</button></div>
      <p class="meta">Eigenes Symbol: PNG oder ICO (quadratisch, bis 1 MB). Eigenes Logo: PNG/JPG/WebP bis 2 MB.</p></div></div>
      <div class="help-text">
      <h3>Ablauf</h3><p>Modell importieren, im Prozess Drucker, Material und Schichthöhe wählen, „Jetzt slicen“.</p>
      <h3>Ansicht</h3><p>Linke Taste dreht, rechte verschiebt, Mausrad zoomt.</p>
      <h3>Vorrang der Werte</h3><p>Drucker, Auto-Konfigurationen, manuelle Änderung im Prozess; Auto-Konfig-Offsets beim Slicen.</p>
      <h3>Upload</h3><p>Sendet nur die Datei. Der Druck wird immer am Drucker gestartet.</p></div>`;
  }else if(helpTab==='updates'){
    const u=updateInfo;
    const channel=state.ui.update_channel||'alpha';
    const channelSelect=`<div class="form-field"><label>Update-Kanal (gilt für Simpliy und die Prusa-Engine)</label>
      <select data-field="update-channel"><option value="alpha" ${channel==='alpha'?'selected':''}>Alpha – alle Versionen, auch Vorabtests</option><option value="beta" ${channel==='beta'?'selected':''}>Beta – Beta, Release-Kandidaten und Releases</option><option value="release" ${channel==='release'?'selected':''}>Release – nur stabile Versionen</option></select></div>`;
    body=`${channelSelect}<div class="form-field"><label>GitHub-Repository für Simpliy-Updates (besitzer/name)</label>
      <input data-field="update-repo" value="${esc(state.ui.update_repo||'')}" placeholder="noch nicht eingerichtet"></div>
      <div class="row"><button data-action="check-update" ${busy?'disabled':''}>Nach Updates suchen</button></div>
      ${u?.error?`<p class="bad">${esc(u.error)}</p>`:''}
      ${u&&!u.error&&u.available?`<p class="meta">Angeboten: Alpha <b>${esc(u.available.alpha||'–')}</b> · Beta <b>${esc(u.available.beta||'–')}</b> · Release <b>${esc(u.available.release||'–')}</b></p>`:''}
      ${u&&!u.error?(!u.configured?`<p>${esc(u.message)}</p>`:u.latest?`<p>Installiert: <b>${esc(u.current)}</b> · Neueste im Kanal „${esc(u.channel)}“: <b>${esc(u.latest)}</b> ${u.newer?'– <b>neue Version verfügbar</b>':'– aktuell'}</p>
        ${u.newer&&u.asset?`<div class="row"><button class="primary" data-action="download-update" ${busy?'disabled':''}>${esc(u.asset.name)} herunterladen (${fmtMB(u.asset.size)})</button></div>`:''}
        ${u.notes?`<pre class="notes">${esc(u.notes)}</pre>`:''}`:`<p>${esc(u.message||'')}</p>`):''}
      ${busy==='app'?`<p id="download-state">Download läuft…</p>`:''}
      <p class="meta">Das Update wird in den Download-Ordner geladen und nicht automatisch ausgeführt.</p>`;
  }else if(helpTab==='engine'){
    const l=engineList;
    const rows=(l?.releases||[]).map(r=>{
      const active=state.engine_path&&r.path&&state.engine_path.toLowerCase()===r.path.toLowerCase();
      return `<tr class="${r.tested?'tested':''}"><td><b>${esc(r.version)}</b>${r.tested?' <span class="tag ok">geprüft</span>':' <span class="tag warn">nicht geprüft</span>'}</td>
        <td>${esc(String(r.published||'').slice(0,10))}</td><td>${fmtMB(r.size)}</td>
        <td>${active?'<b>aktiv</b>':r.installed?`<button data-action="use-engine" data-path="${esc(r.path)}">Verwenden</button>`:''}</td>
        <td><button data-action="install-engine" data-version="${esc(r.version)}" data-url="${esc(r.url)}" data-tested="${r.tested?1:0}" ${busy?'disabled':''}>${r.installed?'Neu installieren':'Installieren'}</button></td></tr>`}).join('');
    body=`<p>Aktive Engine: <code>${esc(state.engine_path||'keine')}</code></p>
      <p>Zuletzt geprüft: <b>PrusaSlicer ${esc(l?.tested||'3.0.0-alpha15')}</b>. Neuere 3.x-Versionen holt Simpliy automatisch und übernimmt sie nur, wenn sie die benötigten Funktionen haben; die bisherige Version bleibt installiert.</p>
      <div class="row"><label class="check"><input type="checkbox" data-field="engine-auto-update" ${state.ui.engine_auto_update===false?'':'checked'}> Prusa-Engine automatisch aktuell halten</label><button data-action="engine-check-now" ${busy?'disabled':''}>Jetzt nach neuer Version suchen</button></div>
      <div class="row"><button data-action="list-engines" ${busy?'disabled':''}>Versionen von GitHub laden</button></div>
      ${l?.error?`<p class="bad">${esc(l.error)}</p>`:''}
      ${rows?`<table class="engines"><thead><tr><th>Version</th><th>Veröffentlicht</th><th>Größe</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`:''}
      ${busy==='engine'?`<p id="download-state">Download läuft…</p>`:''}
      <p class="meta">Installiert wird nur in Simpliys eigenen Ordner (%LOCALAPPDATA%\\SimpliySlicing\\engines). Bestehende PrusaSlicer-Installationen und Prusa-Einstellungen bleiben unberührt. Quelle: github.com/prusa3d/PrusaSlicer (AGPLv3).</p>`;
  }else{
    const which=state.ui.legal_tab||'license';
    body=`<div class="row"><button class="${which==='license'?'active':''}" data-action="legal-tab" data-tab="license">Lizenz</button>
      <button class="${which==='notices'?'active':''}" data-action="legal-tab" data-tab="notices">Drittanbieter</button>
      <button class="${which==='inventory'?'active':''}" data-action="legal-tab" data-tab="inventory">Komponenten</button></div>
      <pre class="legal">${esc(legal?.[which]||'Wird geladen…')}</pre>`;
  }
  return shell('Hilfe','Simpliy Slicing',`<nav class="pd-subtabs help-tabs">${tabs}</nav>${body}`);
}
function applyBranding(){
  document.documentElement.style.setProperty('--brand-icon',`url("${state.ui.app_icon?`data:image/png;base64,${state.ui.app_icon}`:'assets/icon-64.png'}")`);
  if(window.__TAURI__&&state.ui.app_icon)invoke('set_app_icon',{pngBase64:state.ui.app_icon}).catch(e=>notify(String(e),true));
}
async function pollDownload(){
  while(busy){
    const [done,total]=await invoke('download_progress').catch(()=>[0,0]);
    const el=document.getElementById('download-state');
    if(el)el.textContent=total?`Download: ${fmtMB(done)} von ${fmtMB(total)} (${Math.round(100*done/total)} %)`:`Download: ${fmtMB(done)}`;
    await new Promise(r=>setTimeout(r,400));
  }
}
async function helpAction(action,el){
  switch(action){
    case'help-tab':helpTab=el.dataset.tab;render();if(helpTab==='licenses'&&!legal)legal=await invoke('legal_texts');render();return true;
    case'legal-tab':state.ui.legal_tab=el.dataset.tab;render();return true;
    case'check-update':busy='check';render();try{updateInfo=await invoke('check_app_update',{repo:state.ui.update_repo||'',channel:state.ui.update_channel||'alpha'})}catch(e){updateInfo={error:String(e)}}busy='';render();return true;
    case'download-update':{const a=updateInfo?.asset;if(!a)return true;busy='app';render();pollDownload();
      try{const path=await invoke('download_app_update',{url:a.url,name:a.name});notify(`Update gespeichert: ${path}`)}catch(e){notify(String(e),true)}busy='';render();return true}
    case'list-engines':busy='list';render();try{engineList=await invoke('engine_releases')}catch(e){engineList={error:String(e)}}busy='';render();return true;
    case'install-engine':{
      const v=el.dataset.version,tested=el.dataset.tested==='1';
      if(!tested&&!await confirmRemove(`PrusaSlicer ${v} ist mit Simpliy NICHT geprüft.\n\nEs können Probleme auftreten: abweichende Einstellungen, Fehler beim Slicen, falscher G-Code oder Abstürze. Bitte jeden G-Code vor dem Druck in der Vorschau prüfen.\n\nTrotzdem installieren und verwenden?`))return true;
      busy='engine';render();pollDownload();
      try{const path=await invoke('install_engine',{version:v,url:el.dataset.url,confirmed:!tested});state.engine_path=path;baseKey='';prusaPrinters=[];prusaProfiles=[];update();notify(`PrusaSlicer ${v} installiert und aktiv.`);engineList=await invoke('engine_releases').catch(()=>engineList)}
      catch(e){notify(String(e),true)}busy='';render();return true}
    case'use-engine':state.engine_path=el.dataset.path;baseKey='';prusaPrinters=[];prusaProfiles=[];update();notify('Slicing-Engine gewechselt.');return true;
    case'choose-app-icon':pickFile('.png,.ico',async f=>{if(f.size>1048576)return notify('Symbol größer als 1 MB.',true);state.ui.app_icon=await fileBase64(f);applyBranding();update()});return true;
    case'choose-app-logo':pickFile('.png,.jpg,.jpeg,.webp',async f=>{if(f.size>2097152)return notify('Logo größer als 2 MB.',true);state.ui.app_logo=`data:${f.type||'image/png'};base64,${await fileBase64(f)}`;update()});return true;
    case'reset-branding':delete state.ui.app_icon;delete state.ui.app_logo;applyBranding();if(window.__TAURI__)invoke('set_app_icon',{pngBase64:''}).catch(()=>{});update();return true;
  }
  return false;
}
function category(){return currentProfile().profile.categories.find(c=>c.id===profileEditorActions.view.editCat)}
function option(){return category()?.options.find(o=>o.id===profileEditorActions.view.editOpt)}
function makeProfile(){return {manifest:{format:'SimpliyProfile',schema_version:1,profile_id:id('profile'),engine_family:'PrusaSlicer',engine_target:'3.0.x',source:{kind:'created-in-simpliy'}},profile:{name:'Neues Profil',base_parameters:{},category_order:[],categories:[],processes:[]}}}
function addCategory(){const b=currentProfile().profile,c={id:id('cat'),name:`Kategorie ${b.categories.length+1}`,selection_mode:'single',selected:'',options:[]};b.categories.push(c);b.category_order.push(c.id);profileEditorActions.view.editCat=c.id;profileEditorActions.view.editOpt='';profileEditorActions.view.profilePanel='auto';if(modal!=='profile')openModal('profile');update()}
function selectDefaultOption(){const c=category(),o=option();if(c&&o)c.selected=o.id;update()}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
async function importFile(file){if(!file)return;try{await sync();const r=await fetch('/api/import',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name)},body:await file.arrayBuffer()});const obj=await r.json();if(!r.ok)throw Error(obj.error);state=obj.state;lastSynced=JSON.stringify(state);profileEditorActions.view.editCat='';profileEditorActions.view.editOpt='';modal='profile';profileEditorActions.view.profilePanel='auto';render();notify(`Profil importiert: ${currentProfile().profile.name}`)}catch(e){notify(`Import fehlgeschlagen: ${e.message}`,true)}}
async function exportCurrent(){try{await sync();const p=currentProfile();const r=await fetch(`/api/export/${encodeURIComponent(p.manifest.profile_id)}`);if(!r.ok){const j=await r.json();throw Error(j.error)}const blob=await r.blob();download(blob,`${p.profile.name.replace(/[\\/:*?"<>|]/g,'_')}.simpliyprofile`);notify('Simpliy-Profil als ZIP-Container exportiert.')}catch(e){notify(e.message,true)}}
function pickFile(accept,then){
  const input=document.createElement('input');input.type='file';input.accept=accept;input.hidden=true;
  input.addEventListener('change',()=>{const f=input.files[0];input.remove();if(f)then(f)});
  document.body.append(input);input.click();
}
async function fileBase64(file){
  const bytes=new Uint8Array(await file.arrayBuffer());let text='';
  for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(text);
}
// Geruest fuer einen importierten Prusa-Drucker: Struktur aus den Systemprofilen, Werte bleiben die importierten.
/** Druckerliste der Engine fuer die Auswahl der Engine-Grundlage (nur lesen). */
async function loadEnginePrinters(){
  if(prusaPrinters.length||!window.__TAURI__||!state.engine_path)return;
  try{
    const data=await invoke('query_prusa_profiles',{enginePath:state.engine_path,printer:null});
    prusaPrinters=data.printer_models.flatMap(m=>[...(m.printer_profiles||[]),...(m.variants||[]).flatMap(v=>v.printer_profiles||[])].map(p=>({...p,technology:m.technology,vendor_name:m.vendor_name}))).sort((a,b)=>(/^Simpliy/.test(b.name)-/^Simpliy/.test(a.name))||a.name.localeCompare(b.name));
    render();
  }catch{}
}
async function skeletonFor(printerName){
  try{
    const answer=await invoke('query_prusa_profiles',{enginePath:state.engine_path,printer:printerName});
    const print=answer.print_profiles?.[0];
    if(print)return {printer:printerName,print:print.name,tool:print.tool_print_profiles?.[0]||'',filament:print.filament_profiles?.[0]||''};
  }catch{}
  return {...(enginePreset()||P.DEFAULT_SKELETON)};
}
async function addImportedPrinter(src){
  const existing=state.printers.find(p=>p.name===src.name&&p.settings);
  if(existing&&await confirmRemove(`Den Drucker „${src.name}“ gibt es schon. Seine Druckerwerte mit dem Import aktualisieren?\n(Abbrechen = als neuen Drucker anlegen)`)){
    Object.assign(existing.settings,src.settings);if(src.skeleton)existing.engine=P.neutralSkeleton(P.toolsOf(src.skeleton));return existing;
  }
  const skeleton=src.skeleton||await skeletonFor(src.name);
  const pr=P.makePrinter({name:existing?`${src.name} (Import)`:src.name,base:{...baseFlat,...src.settings},byKey:catalogByKey,skeleton,taken:state.printers.map(x=>x.id)});
  pr.settings={...pr.settings,...src.settings};pr.manufacturer='Prusa-Import';
  state.printers.push(pr);return pr;
}
function addImportedMaterial(src){
  const m=P.makeMaterial({name:src.name,values:{...baseFlat,...src.values},byKey:catalogByKey,taken:state.filaments.map(x=>x.id)});
  if(state.filaments.some(x=>x.name===m.name))m.name=`${m.name} (Import)`;
  state.filaments.push(m);return m;
}
// ---- Konfiguration: Export, Import und Wiederherstellung aus Simpliy-G-Code ----------------------------------------
const safeFileName=n=>String(n||'Konfiguration').replace(/[\\/:*?"<>|]+/g,'_').trim()||'Konfiguration';
const appVersion=()=>legal?.version||'';

/** Verwendete Auto-Konfigurationen: je Kategorie nur die gewählte Option samt ihren verbundenen Parametern. */
function usedAuto(proc){
  const out=[];
  for(const c of P.autoCategories(state)){
    const option=autoList(c.id,proc).find(x=>x.id===proc[autoField[c.id]]);
    if(option){const o=clone(option);if(c.id==='material')delete o.colors;out.push({cat:c.id,catName:c.name,keys:[...controls(c.id)],option:o})}
  }
  return out;
}

/** Prozess, sein Drucker (ohne die Listen anderer Schichthöhen/Materialien), nur die verwendeten Auto-Konfigurationen und aktive Offsets. */
function processBundle(proc,withOrigins=true){
  const printer=clone(printerOf(proc));
  if(printer){printer.qualities=[];printer.default_quality='';printer.materials=[];printer.default_material=''}
  return P.configBundle({proc,printer,auto:usedAuto(proc),offsets:P.activeOffsets(proc,offsetsOf(proc)),color:(c=>c?{materialName:materialOf(proc)?.name||'',...clone(c)}:null)(activeColorOf(proc)),app:appVersion(),withOrigins});
}

function exportConfig(kind){
  const proc=activeProcess();
  if(!proc?.values&&kind!=='printer')return notify('Dieser Prozess wird gerade umgestellt. Bitte kurz warten.',true);
  const printer=kind==='printer'?(state.printers.find(x=>x.id===libraryActions.view.printerEdit)||printerOf(proc)):printerOf(proc);
  if(!printer)return notify('Es ist kein Drucker vorhanden.',true);
  const bundle=kind==='printer'?P.configBundle({printer,app:appVersion()}):processBundle(proc);
  // Favoriten gehoeren zur Datei, nicht in den G-Code.
  if(kind!=='printer'&&(state.favorites||[]).length)bundle.favorites=[...state.favorites];
  const name=kind==='printer'?printer.name:proc.name;
  download(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}),`${safeFileName(name)}.simpliyconfig.json`);
  const used=(bundle.auto||[]).map(a=>`${a.catName}: ${a.option.name}`).join(', ');
  notify(kind==='printer'?`Drucker „${printer.name}“ exportiert.`:`Konfiguration „${proc.name}“ exportiert. Auto-Konfigurationen: ${used||'keine'}.`);
}

function freshId(list,make){return make({name:'x',base:{},values:{},byKey:catalogByKey,taken:list.map(x=>x.id)}).id}

/**
 * Drucker aus einer Simpliy-Konfiguration. Gibt es ihn schon, werden nur abweichende Druckerwerte übernommen;
 * Schichthöhen, Materialien und alles andere bleiben unverändert.
 */
async function addSimpliyPrinter(src){
  const rec=clone(src);
  const existing=state.printers.find(p=>p.name===rec.name);
  if(existing){
    const changed=Object.keys(rec.settings||{}).filter(k=>!P.sameValues(rec.settings[k],existing.settings?.[k]));
    if(!changed.length)return existing;
    if(await confirmRemove(`Der Drucker „${rec.name}“ existiert schon. ${changed.length} abweichende Druckerwerte übernehmen (${changed.slice(0,5).join(', ')}${changed.length>5?' …':''})?\nSchichthöhen, Materialien und alle anderen Werte bleiben unverändert.\n(Abbrechen = als neuen Drucker anlegen)`)){
      for(const k of changed)(existing.settings??={})[k]=rec.settings[k];
      return existing;
    }
    rec.name=`${rec.name} (Import)`;
  }
  rec.id=freshId(state.printers,P.makePrinter);
  rec.materials=[];rec.default_material='';
  if(!rec.qualities?.length)rec.qualities=P.defaultQualities({...(baseFlat||{}),...(rec.settings||{})});
  if(!rec.qualities.some(q=>q.id===rec.default_quality))rec.default_quality=rec.qualities.find(q=>q.id==='layer-20')?.id||rec.qualities[0]?.id||'';
  state.printers.push(rec);return rec;
}

/**
 * Eine verwendete Auto-Konfiguration in den Entwurf übernehmen: vorhandene Optionen bleiben unverändert, es wird nur
 * gewählt. Neue Optionen liegen im Prozess (proc.pending) und werden erst mit „Prozess speichern“ angelegt.
 */
function adoptAuto(entry,proc,report){
  const cat=entry.cat;
  if(!P.autoCategories(state).some(c=>c.id===cat)){
    report.push(`${entry.catName||cat}: „${entry.option.name}“ – diese Auto-Konfiguration gibt es hier nicht (Werte stehen trotzdem im Prozess)`);
    return;
  }
  const valuesOf=o=>cat==='material'?(o.settings||{}):(o.values||{});
  const option={...entry.option};
  if(cat!=='material'&&cat!=='quality')option.kind=cat;
  const r=P.adoptOption(autoList(cat,proc),option,valuesOf);
  if(r.added)((proc.pending??={})[cat]??=[]).push(r.added);
  proc[autoField[cat]]=r.option.id;
  report.push(`${catName(cat)}: ${r.option.name} – ${r.status==='same'?'vorhandene Option gewählt':r.status==='new'?'neue Option im Entwurf':'Kopie im Entwurf, Original unverändert'}`);
}

/** Farbe samt Farb-Offsets aus der Datei: gleiche vorhandene Farbe waehlen, sonst im Entwurf anlegen (Vorhandenes bleibt unveraendert). */
function adoptColor(src,proc,report){
  if(!materialOf(proc)){report.push(`Farbe „${src.name}“: kein Material gewählt (Farb-Offsets nicht übernommen)`);return}
  const strip=({name,colour,offsets})=>({name,colour,offsets:offsets||{}});
  const list=colorsOf(proc);
  const same=list.find(x=>P.sameValues(strip(x),strip(src)));
  if(same){proc.color_id=same.id;report.push(`Farbe: ${same.name} – vorhandene Farbe gewählt`);return}
  let name=src.name;if(list.some(x=>x.name===name))name=`${src.name} (Import)`;
  const col={...clone(src),id:P.makeColor({taken:list.map(x=>x.id)}).id,name};delete col.materialName;
  editColors(proc,l=>l.push(col));proc.color_id=col.id;
  report.push(`Farbe: ${name} – ${name===src.name?'neue Farbe':'Kopie'} im Entwurf mit ${Object.keys(col.offsets||{}).length} Farb-Offset(s)`);
}

/** Druckerwerte aus der Datei: abweichende Werte kommen als Werte in den Prozess, der Drucker selbst bleibt unverändert. */
function adoptPrinterValues(src,proc,report){
  const byName=state.printers.find(p=>p.name===src.name);
  const target=byName||printerOf(proc);
  if(byName&&byName.id!==proc.printer_id)proc.printer_id=byName.id;
  const diff=Object.keys(src.settings||{}).filter(k=>!P.sameValues(src.settings[k],(target?.settings||{})[k])&&!(k in proc.values));
  for(const k of diff)proc.values[k]=clone(src.settings[k]);
  report.push(byName
    ?`Drucker „${target.name}“ gewählt, ${diff.length} abweichende Druckerwerte im Prozess`
    :`Drucker „${src.name}“ gibt es hier nicht: ${diff.length} abweichende Druckerwerte im Prozess, Drucker „${target?.name}“ bleibt`);
}

/** Konfiguration (aus Datei oder G-Code) in den Prozess-Entwurf einlesen. Gespeichert wird erst mit „Prozess speichern“. `only:'printer'` = nur den Drucker (Druckerverwaltung). */
async function applyConfig(bundle,label,{only=''}={}){
  const proc=activeProcess();
  if(only==='printer'){
    if(!bundle.printer)return notify('Die Datei enthält keinen Drucker.',true);
    if(!await confirmRemove(`Drucker „${bundle.printer.name}“ aus „${label}“ übernehmen?\nEinen vorhandenen Drucker mit gleichem Namen ändert das nur bei abweichenden Druckerwerten und nach Rückfrage.`,{title:'Drucker laden',ok:'Übernehmen'}))return;
    const pr=await addSimpliyPrinter(bundle.printer);libraryActions.view.printerEdit=pr.id;update();
    return notify(`Drucker „${pr.name}“ übernommen. Mit „Speichern“ im Druckerfenster sichern.`);
  }
  const doProcess=!!bundle.process,doPrinter=!!bundle.printer;
  const autos=[...(bundle.auto||[])];
  // Ältere Dateien: Material als eigener Eintrag.
  if(bundle.material&&!autos.some(a=>a.cat==='material'))autos.push({cat:'material',catName:'Material',keys:[],option:bundle.material});
  const picks=bundle.auto_select||[];
  const offsets=bundle.auto_offsets||[];
  if((doProcess||doPrinter||autos.length||picks.length||offsets.length)&&!proc?.values)return notify('Dieser Prozess wird gerade umgestellt. Bitte kurz warten.',true);
  const wants=[];
  if(doProcess)wants.push(`Prozesswerte „${bundle.process.name}“ ersetzen die Werte von „${proc.name}“`);
  if(doPrinter&&doProcess)wants.push(`Drucker „${bundle.printer.name}“: abweichende Druckerwerte kommen in den Prozess`);
  for(const a of autos)wants.push(`Auto-Konfiguration ${a.catName||a.cat}: ${a.option.name}`);
  for(const s of picks)wants.push(`Auto-Konfiguration ${s.catName}: ${s.name} wählen`);
  if(offsets.length)wants.push(`${offsets.length} Auto-Konfig-Offset(s)`);
  if((bundle.favorites||[]).length)wants.push(`${bundle.favorites.length} Favorit(en) zur Favoritenliste hinzufügen`);
  if(bundle.color&&doProcess)wants.push(`Farbe „${bundle.color.name}“ mit ${Object.keys(bundle.color.offsets||{}).length} Farb-Offset(s)`);
  if(!wants.length)return notify('Die Datei enthält nichts, was hier übernommen werden kann.',true);
  if(!await confirmRemove(`Aus „${label}“ einlesen:\n\n• ${wants.join('\n• ')}\n\nDas Einlesen ändert nur den Entwurf dieses Prozesses. Vorhandene Auto-Konfigurationen (z. B. andere Schichthöhen) werden nicht verändert. Gespeichert wird erst mit „Prozess speichern“; mit „Abbrechen“ im Prozessfenster ist alles wieder weg.`,{title:'Konfiguration einlesen',ok:'Einlesen'}))return;
  const report=[];
  if(doProcess){
    const data=clone(bundle.process.data||{});
    // Genau die Werte der Datei; Verweise (Ids) auf Optionen der Quelle werden unten neu gesetzt.
    proc.values=data.values||{};
    proc.origins=Object.fromEntries(Object.keys(proc.values).map(k=>[k,`Import: ${label}`]));
    if(data.tool!==undefined)proc.tool=data.tool;
    delete proc.library_id;delete proc.pending;proc.color_id='';
    report.push(`${Object.keys(proc.values).length} Prozesswerte`);
  }
  if(doPrinter&&doProcess)adoptPrinterValues(bundle.printer,proc,report);
  for(const a of autos)adoptAuto(a,proc,report);
  if(bundle.color&&doProcess)adoptColor(bundle.color,proc,report);
  if((bundle.favorites||[]).length){const have=new Set(state.favorites||[]),add=bundle.favorites.filter(k=>PLACE.has(k)&&!have.has(k));if(add.length){(state.favorites??=[]).push(...add);report.push(`${add.length} Favorit(en) hinzugefügt`)}}
  for(const s of picks){
    const option=autoList(s.cat,proc).find(o=>o.name===s.name);
    if(option){proc[autoField[s.cat]]=option.id;report.push(`${s.catName}: ${option.name} gewählt`)}
    else report.push(`${s.catName}: „${s.name}“ gibt es hier nicht (Auswahl unverändert)`);
  }
  if(offsets.length){
    const have=new Set(offsetsOf(proc).map(o=>JSON.stringify(o)));
    const add=offsets.filter(o=>!have.has(JSON.stringify(o)));
    if(add.length)((proc.pending??={}).offsets??=[]).push(...clone(add));
    report.push(`${add.length} neue Offset(s) im Entwurf`);
  }
  update();
  notify(`Eingelesen (noch nicht gespeichert):\n${report.join('\n')}\nMit „Prozess speichern“ sichern.`);
}

/** Simpliy-G-Code lesen. Nur G-Code, den Simpliy Slicing erzeugt hat. */
async function importGcodeConfig(file){
  try{
    const head=await file.slice(0,3*1024*1024).text();
    const r=P.readGcodeConfig(head);
    if(!r)return notify('Das ist kein G-Code von Simpliy Slicing. Nur Dateien, die Simpliy erzeugt hat, enthalten die Konfiguration.',true);
    if(r.kind==='exact')return await applyConfig(r.bundle,file.name);
    // Ältere Datei: nur die Einstellungsübersicht (Text). Werte werden zurück in Engine-Werte gewandelt,
    // die Auto-Konfigurationen werden über ihre Namen gewählt (nichts wird überschrieben).
    if(!baseFlat){await loadBase();if(!baseFlat)return notify('Die Engine ist noch nicht bereit.',true)}
    const proc=activeProcess();
    const values={},skipped=[],names={};
    for(const [key,text] of r.entries){
      if(['processName','printerName'].includes(key)&&!names[key])names[key]=text;
      if(key.startsWith('autoConfigure'))names[key]=text;
      if(key.startsWith('simpliy.')){try{values[key]=JSON.parse(text)}catch{skipped.push(key)}continue}
      const spec=catalogByKey.get(key);if(!spec)continue;
      try{values[key]=convert(text,spec,proc?.values?.[key]??baseFlat[key])}catch{skipped.push(key)}
    }
    const printer=P.makePrinter({name:names.printerName||'Drucker aus G-Code',base:values,byKey:catalogByKey,taken:[]});
    const picks=P.autoCategories(state).map(c=>({cat:c.id,catName:c.name,name:names[`autoConfigure${c.name.replace(/\s+/g,'')}`]})).filter(s=>s.name&&s.name!=='–');
    const bundle={format:P.CONFIG_FORMAT,version:2,process:{name:names.processName||'Prozess aus G-Code',data:{values:P.pick(values,catalogByKey,['print'])}},printer,auto:[],auto_select:picks,auto_offsets:[]};
    await applyConfig(bundle,`${file.name} (Zusammenfassung, Version ${r.info.app||'?'})`);
    if(skipped.length)notify(`${skipped.length} Werte konnten nicht gelesen werden: ${skipped.slice(0,6).join(', ')}${skipped.length>6?' …':''}`,true);
  }catch(e){notify(`G-Code lesen fehlgeschlagen: ${e.message||e}`,true)}
}

/** Eine Datei mit Konfiguration: Simpliy-G-Code, Simpliy-Konfiguration (.json) oder wie bisher Prusa-Dateien. */
async function importConfigFile(file,{only=''}={}){
  if(/\.(gcode|gco|g)$/i.test(file.name))return importGcodeConfig(file);
  if(/\.bgcode$/i.test(file.name))return notify('Binärer G-Code (.bgcode) kann nicht gelesen werden. Bitte als normalen G-Code (.gcode) erzeugen.',true);
  if(/\.json$/i.test(file.name)){
    let parsed;try{parsed=JSON.parse(await file.text())}catch{parsed=null}
    if(parsed?.format===P.CONFIG_FORMAT){try{return await applyConfig(P.readConfig(parsed),file.name,{only})}catch(e){return notify(e.message,true)}}
    if(parsed?.format==='SimpliyMaterial')return importPrusa(file,'material');
  }
  return importPrusa(file,only==='printer'?'printer':'process');
}

/** Prusa-Datei lesend uebernehmen. Nichts wird als Prozess gespeichert; Drucker und Material nur nach Rueckfrage. */
async function importPrusa(file,target){
  try{
    if(target==='material'&&/\.json$/i.test(file.name)){
      const parsed=JSON.parse(await file.text());
      if(parsed?.format==='SimpliyMaterial'){
        const m={...parsed.material,id:P.makeMaterial({name:'x',values:{},byKey:catalogByKey,taken:state.filaments.map(x=>x.id)}).id};
        if(state.filaments.some(x=>x.name===m.name))m.name=`${m.name} (Import)`;
        state.filaments.push(m);libraryActions.view.filamentEdit=m.id;update();return notify(`Material „${m.name}“ importiert.`);
      }
    }
    if(!await ensureEngine())return;
    if(!baseFlat){await loadBase();if(!baseFlat)return notify('Die Engine ist noch nicht bereit.',true)}
    setJobStatus('Prusa-Datei wird gelesen');
    const answer=await invoke('prusa_import',{enginePath:state.engine_path,filename:file.name,dataBase64:await fileBase64(file),skeleton:enginePreset()||P.DEFAULT_SKELETON});
    const r=P.translateImport(answer,catalogByKey,baseValues);
    const notes=[...r.notes];
    if(r.unknown.length)notes.push(`${r.unknown.length} Werte kennt PrusaSlicer 3.0 nicht; sie bleiben unter Fortgeschritten › Freie Parameter erhalten: ${r.unknown.slice(0,8).join(', ')}${r.unknown.length>8?' …':''}`);
    let summary='';
    if(target==='process'){
      const proc=activeProcess();
      if(!proc.values)return notify('Dieser Prozess wird gerade umgestellt. Bitte kurz warten.',true);
      Object.assign(proc.values,clone(r.process));
      proc.origins??={};for(const k of Object.keys(r.process))proc.origins[k]=`Import: ${file.name}`;
      summary=`${Object.keys(r.process).length} Werte in „${proc.name}“ geladen (nicht gespeichert)`;
      if(r.printer&&Object.keys(r.printer.settings).length&&await confirmRemove(`Die Datei enthält den Drucker „${r.printer.name}“ (${Object.keys(r.printer.settings).length} Werte). Als eigenen Drucker übernehmen und für diesen Prozess verwenden?`)){
        const pr=await addImportedPrinter(r.printer);proc.printer_id=pr.id;summary+=`, Drucker „${pr.name}“`;
      }
      if(r.material&&await confirmRemove(`Material „${r.material.name}“ zusätzlich in die zentrale Materialbibliothek aufnehmen?`)){
        const m=addImportedMaterial(r.material);proc.material_id=m.id;summary+=`, Material „${m.name}“ in der Bibliothek`;
      }
    }else if(target==='printer'){
      if(!r.printer||!Object.keys(r.printer.settings).length)return notify('Die Datei enthält keine Druckereinstellungen.',true);
      const pr=await addImportedPrinter(r.printer);libraryActions.view.printerEdit=pr.id;summary=`Drucker „${pr.name}“ mit ${Object.keys(r.printer.settings).length} Werten übernommen`;
    }else{
      if(!r.material||!Object.keys(r.material.values).length)return notify('Die Datei enthält keine Materialeinstellungen.',true);
      const m=addImportedMaterial(r.material);libraryActions.view.filamentEdit=m.id;summary=`Material „${m.name}“ mit ${Object.keys(m.settings).length} Werten übernommen`;
    }
    setJobStatus('Bereit');update();
    notify([summary,...notes].join('\n'),notes.length>0&&!summary);
  }catch(e){setJobStatus('Bereit');notify(`Import fehlgeschlagen: ${e.message||e}`,true)}
}
function isDraft(bundle){
  // Auch eine Kopie aus einer Projektdatei bleibt gesperrt.
  return bundle.manifest.profile_id===DRAFT_ID||bundle.manifest.source?.kind==='s3d-fff-partial-port';
}
function needsReview(bundle){
  const source=bundle.manifest.source||{};
  return !!(source.kind==='s3d-fff-partial-port'||source.from_draft||source.requires_review)&&!source.reviewed;
}

/** Manuelle Aenderungen dorthin schreiben, woher der Wert sonst kommt. */
function absorbOverrides(bundle,proc){
  for(const [key,value] of Object.entries(proc.overrides||{})){
    const owner=orderedCats(bundle).reverse().map(c=>selectedOption(c,proc)).find(o=>Object.hasOwn(o?.assignments||{},key));
    if(owner)owner.assignments[key]=value;
    else bundle.profile.base_parameters[key]=value;
  }
  proc.overrides={};
}

function duplicateProfile(source){
  const copy=clone(source);
  copy.manifest.profile_id=id('profile');
  copy.manifest.source={kind:'duplicated-in-simpliy',...(needsReview(source)?{from_draft:true}:{})};
  copy.profile.name+=' – Kopie';
  return copy;
}

async function ensureEngine(){
  if(state.engine_path)return true;
  const found=await fetch('/api/engine').then(r=>r.json()).catch(()=>({}));
  if(found.detected?.length){
    state.engine_path=found.detected[0];
    markSave();
    return true;
  }
  openModal('engine');
  render();
  notify('Bitte zuerst den PrusaSlicer-Pfad wählen.',true);
  return false;
}

async function importModels(){
  try{
    if(!await ensureEngine())return;
    const chosen=await invoke('choose_models');
    if(!chosen.length)return;
    models.remember();
    setJobStatus('Modelle werden geladen');
    const failed=[];
    for(const file of chosen){
      meshes.delete(file.path);
      meshErrors.delete(file.path);
      await loadMesh(file.path);
      const mesh=meshes.get(file.path);
      if(!mesh){failed.push(`${file.name}: ${meshErrors.get(file.path)}`);continue}
      const model={...file,id:id('model'),plate:state.ui.active_plate};
      models.placeFree(model);
      state.models.push(model);
      state.ui.selected_model_id=model.id;
    }
    setJobStatus('Bereit');
    previewMode=false;
    update();
    if(failed.length)notify(failed.join('\n'),true);
  }catch(e){
    setJobStatus('Import fehlgeschlagen');
    notify(String(e),true);
  }
}

function layersOf(plate){
  const procs=plateProcesses(plateModels(state,plate),visibleProcesses(state.processes),activeProcess());
  // Auto-Konfig-Offsets gelten beim Slicen; der eingestellte Wert bleibt unveraendert.
  const main=zones.mainId();if(main)procs.sort((a,b)=>(b.id===main)-(a.id===main));
  return procs.map(process=>({process,bundle:processProfile(process),values:process.values?P.withOffsets(resolve(processProfile(process),process).values,process,offsetsOf(process),colorOptions(process)):resolve(processProfile(process),process).values}));
}
function plateValues(plate=state.ui.active_plate){return layersOf(plate)[0].values}

function materialValues(bundle){
  const materials={},problems=[];
  if(toolCount()<2)return {materials,problems};
  // Ein fuer T1, T2, ... gewaehltes Prusa-Material gilt dort auch gegen das Material des Prozesses.
  // Durchmesser, Skripte und Pressure Advance gehoeren zum Drucker und bleiben.
  (enginePreset()?.filaments||[]).slice(0,toolCount()).forEach((name,slot)=>{
    if(!slot||!name)return;
    const own={};
    for(const spec of catalog){
      if(spec.box!=='filament'||!Array.isArray(baseFlat[spec.key]))continue;
      if(/gcode$|^pressure_advance|^filament_diameter$|^custom_parameters/.test(spec.key))continue;
      own[spec.key]=baseFlat[spec.key][slot];
    }
    materials[slot+1]=own;
  });
  for(const [tool,chosen] of Object.entries(state.tool_materials||{})){
    if(!chosen||Number(tool)>toolCount())continue;
    if(chosen.startsWith('lib:')){
      const m=state.filaments.find(x=>x.id===chosen.slice(4));
      if(m?.settings)materials[tool]={...materials[tool],...P.pick(m.settings,catalogByKey,['filament'])};
      else problems.push(`T${tool-1}: Das gewählte Material gibt es in der Bibliothek nicht mehr.`);
      continue;
    }
    const [catId,optId]=chosen.split('|');
    const found=bundle.profile.categories.find(c=>c.id===catId)?.options.find(o=>o.id===optId);
    if(found)materials[tool]={...materials[tool],...found.assignments};
    else problems.push(`T${tool-1}: Das gewählte Material gibt es im Profil „${bundle.profile.name}“ nicht.`);
  }
  return {materials,problems};
}

// Auch Änderungen an einem reinen Zonen-Prozess machen den alten G-Code ungültig.
function zoneLayersOf(plate){
  const wanted=new Set(plateModels(state,plate).filter(m=>m.enabled!==false).flatMap(m=>m.zone_processes||[]));
  return visibleProcesses(state.processes).filter(p=>wanted.has(p.id)&&zoneActive(p)).map(process=>({process,bundle:processProfile(process),values:process.values?P.withOffsets(resolve(processProfile(process),process).values,process,offsetsOf(process),colorOptions(process)):resolve(processProfile(process),process).values}));
}
const supportOptimizationRevision=new Map();
function stampPlate(plate=state.ui.active_plate){
  return JSON.stringify([
    layersOf(plate).map(l=>[l.process.id,l.process.tool,l.values]),
    zoneLayersOf(plate).map(l=>[l.process.id,l.process.tool,l.process.zone,l.values,printerOf(l.process)?.id]),
    state.ui.prusa_preset,
    state.tool_materials,
    supportOptimizationRevision.get(plate)||0,
    plateModels(state,plate).map(({name,...model})=>model),
  ]);
}

/** Veraltete Stuetzen vor dem Slicen nachziehen. Rueckgaengig bleibt moeglich. */
async function adjustSupports(plate,bed,problems){
  const notes=[],list=()=>plateModels(state,plate);
  let remembered=false;
  for(const model of list()){
    if(model.enabled===false||!meshes.has(model.path)||!supportCount(model))continue;
    try{
      await supports.edit({model,plate,models:list,bed:()=>bed},{op:'refresh'},answer=>{
        if(!answer.data)return;
        if(!remembered){models.remember();remembered=true}
        model.straightSupports=answer.data;
        notes.push(`${model.name}: ${answer.notice}`);
      });
    }catch(error){problems.push(`${model.name}: ${error.message||error}`)}
  }
  if(remembered)update();
  return notes;
}

/** Groessen aus der Druckereinstellung `thumbnails` (z. B. "300x300/PNG, 64x64/PNG"); nur PNG. */
async function addThumbnails(path,plate){
  try{
    const spec=String(plateValues(plate).thumbnails??baseFlat?.thumbnails??'');
    const sizes=[...spec.matchAll(/(\d+)\s*x\s*(\d+)(?:\/(\w+))?/gi)].filter(m=>!m[3]||/png/i.test(m[3])).map(m=>[Number(m[1]),Number(m[2])]).filter(([w,h])=>w>0&&h>0&&w<=1024&&h<=1024);
    if(!sizes.length||!viewport)return;
    const images=sizes.map(([width,height])=>({width,height,png:viewport.thumbnail(width,height)})).filter(i=>i.png);
    if(images.length)await invoke('add_thumbnails',{path,images});
  }catch(e){globalThis.testLog?.push?.(`Vorschaubild: ${e}`)}
}

async function prepareJob(plate=state.ui.active_plate,opts={}){
  const layers=layersOf(plate);
  if(layers.some(l=>isDraft(l.bundle))){
    notify('Der MK3S-Teilport ist ein gesperrter Entwurf. Das Profil „MK3S RRF“ oder eine geprüfte Kopie verwenden.',true);
    return null;
  }
  if(!await ensureEngine())return null;
  await fillTool();
  if(!presetReady()){
    await handleAction('open-prusa-presets',{dataset:{}});
    notify('Bitte Drucker, Druckprofil, Werkzeug und Material auswählen.',true);
    return null;
  }
  await loadBase();
  if(!baseConfig){
    notify(baseError||'Das Basisprofil ist noch nicht geladen.',true);
    return null;
  }
  // Eine Platte wird auf einem Drucker gedruckt: Alle Prozesse darauf muessen ihn verwenden.
  const plateprinters=new Set(layers.filter(l=>l.process.values).map(l=>printerOf(l.process)?.id));
  if(plateprinters.size>1){notify('Die Prozesse dieser Platte verwenden verschiedene Drucker. Bitte einen Drucker für alle wählen.',true);return null}
  const list=plateModels(state,plate);
  for(const model of list)if(model.enabled!==false)await loadMesh(model.path);

  const {materials,problems}=materialValues(layers[0].bundle);
  const plan=planPlate({base:baseFlat,layers,byKey:catalogByKey,materials});
  problems.push(...plan.errors);
  await supports.settled();
  const adjusted=await adjustSupports(plate,effectiveBed(baseFlat,plan.values,catalogByKey),problems);
  const prepared=list.map(model=>{
    const proc=visibleProcesses(state.processes).find(p=>p.id===model.process)||activeProcess();
    const settings={...plan.objects.get(proc.id),...model.settings};
    if(model.tool){
      if(model.tool>toolCount())problems.push(`${model.name}: T${model.tool-1} gibt es im Basisprofil nicht.`);
      settings.extruder=model.tool;
    }
    return {...model,settings};
  });
  const built=buildJob({base:baseConfig,values:plan.values,byKey:catalogByKey,models:prepared,meshes,supportKeys:supports.schema().keys});
  problems.push(...built.problems);
  if(built.job){built.job.summary=settingsSummary(layers,list,plan.values);
   {const main=layers[0].process;built.job.restore=P.gcodeConfigLines(processBundle(main,false))}
built.job.fans=(Array.isArray(plan.values['simpliy.fans'])?plan.values['simpliy.fans']:[]).map(f=>({index:f.index,name:f.name||'',setpoints:f.setpoints}));
   const tp=plan.values['simpliy.temps']||{};built.job.temps={tools:Array.from({length:toolCount()},(_,i)=>tp[`t${i}`]||[]),bed:tp.bed||[],chamber:tp.chamber||[]}}
  // Native Prozesszonen werden vor dem Stützen-Preflight in den temporären Auftrag geschrieben.
  // Das bisherige Verfahren bleibt als ausdrücklich gewählte, eingeschränkte Sonderlösung.
  const zoneLayers=opts.quiet?[]:zoneLayersOf(plate);
  let nativeZones=null;
  let notes=[];
  if(!opts.quiet&&built.job&&list.some(m=>m.enabled!==false&&m.zone_processes?.length)){
    const zoneModels=prepared.map(m=>({...m,mainProcessId:(visibleProcesses(state.processes).find(p=>p.id===m.process)||activeProcess()).id}));
    for(const zl of zoneLayers) if(isDraft(zl.bundle)) problems.push(`${zl.process.name}: gesperrtes Entwurfsprofil in einer Zone.`);
    const jobBed=effectiveBed(baseFlat,plan.values,catalogByKey);
    nativeZones=planNativeZones({base:baseConfig,byKey:catalogByKey,models:zoneModels,layers,zones:zoneLayers,tools:toolCount(),
      printerOf:p=>printerOf(p)?.id,
      heightOf:m=>placement(m,meshes.get(m.path),jobBed).max[2]});
    problems.push(...nativeZones.problems);
    if(!nativeZones.problems.length&&!nativeZones.unsupported.length){
      applyNativeZones(built.job,nativeZones);
      notes.push(...nativeZones.notes);
      try{
        const post=zonePostFor(built.job,nativeZones);
        if(post){
          // Objektmarken im G-Code: Rust ordnet die Zonenwerte damit Bauteil und Schicht zu.
          built.job.zonePost=post;
          built.job.config.configuration.print_settings.gcode_label_objects='octoprint';
          const fields=[...new Set(post.objects.flatMap(o=>o.zones.flatMap(z=>Object.keys(z.values))))];
          notes.push(`Zonenwerte per G-Code-Nachbearbeitung gesetzt: ${fields.join(', ')}. Bitte die Vorschau kontrollieren.`);
        }
      }catch(error){problems.push(String(error.message||error))}
      if(nativeZones.count){
        built.job.parts=[];
        built.job.summary.push(['Prozesszonen',`${nativeZones.count} native Höhenbereiche; gemeinsames Slicing`]);
        notes.push(`${nativeZones.count} Prozesszone(n) nativ im gemeinsamen Slicing. Bitte die Schichtvorschau kontrollieren.`);
      }
    }
  }
  if(!problems.length&&built.job?.supportPlate){
    try{
      const checked=await invoke('support_prepare',{enginePath:state.engine_path,job:built.job});
      notes.push(...checked.notes);problems.push(...checked.problems);
    }catch(error){problems.push(String(error.message||error))}
  }
  if(problems.length){
    notify(problems.slice(0,8).join('\n'),true);
    setJobStatus(problems[0]);
    return null;
  }

  if(plan.conflicts.length&&!opts.quiet){
    const short=value=>{const text=vtext(value).replace(/\s+/g,' ');return text.length>32?`${text.slice(0,32)}…`:text};
    const lines=plan.conflicts.slice(0,9).map(c=>`• ${c.process.name}: ${PLACE.get(c.key)?.label||c.key} ${short(c.wanted)} → es gilt ${short(c.plate)}`);
    if(plan.conflicts.length>9)lines.push(`… und ${plan.conflicts.length-9} weitere`);
    const question=`Diese Werte kann die Engine nicht je Prozess ändern. Für die ganze Platte gilt der Hauptprozess „${layers[0].process.name}“:\n\n${lines.join('\n')}\n\nSo slicen? (Für anderes Material dem Prozess ein eigenes Werkzeug geben.)`;
    if(!await confirmRemove(question)){setJobStatus('Abgebrochen: Prozesswerte unterscheiden sich');return null}
  }

  const reviewLayers=[...layers,...zoneLayers];
  for(const bundle of opts.quiet?[]:new Set(reviewLayers.map(l=>l.bundle))){
    if(!needsReview(bundle))continue;
    const own=baseValues(compileConfig(baseConfig,reviewLayers.find(l=>l.bundle===bundle).values,catalogByKey).config);
    const facts=`Düse ${display(own.nozzle_diameter)} mm, ${display(own.temperature,{box:'filament'})} °C, Bett ${display(own.bed_temperature,{box:'filament'})} °C, Firmware ${own.gcode_flavor}`;
    if(!await confirmRemove(`„${bundle.profile.name}“ ist noch nicht auf deinem Drucker erprobt.\n\n${facts}\n\nHast du Werte, Start- und End-Skript geprüft?`))return null;
    bundle.manifest.source.reviewed=true;
    markSave();
  }
  if(!opts.quiet&&built.job&&nativeZones?.unsupported.length){
    const details=nativeZones.unsupported.map(z=>`${z.model} / ${z.zone}: ${z.keys.join(', ')}`).join('\n');
    const wanted=zoneLayers.map(l=>l.process);
    const message=`Diese Zonen-Werte unterstützt die native Höhenbereichs-Schnittstelle nicht:\n${details}`;
    // Der alte Merge ist keine pauschale Ausweichlösung. Kein anderer Drucker, keine
    // Hardware-/Firmwarewechsel, keine unbekannten Einstellungen, kein unkontrollierter Support-Merge.
    if(!canUseLegacyZoneFallback(nativeZones,catalogByKey)){
      notify(message+'\nBitte diese Werte im Hauptprozess angleichen.',true);setJobStatus('Zonen: nicht unterstützte Werte');return null;
    }
    const effectiveMain=baseValues(built.job.config);
    const effectiveZones=zoneLayers.map(l=>baseValues(compileConfig(baseConfig,l.values,catalogByKey).config));
    const reason=Z.zoneBlockReason({models:list.filter(m=>m.enabled!==false).length,tools:toolCount(),hasSupportPlate:!!built.job.supportPlate,mainValues:effectiveMain,zoneValues:effectiveZones});
    if(reason){notify(message+'\n'+reason,true);setJobStatus('Zonen: Sonderlösung nicht zulässig');return null;}
    for(let i=0;i<effectiveZones.length;i++){
      const mismatch=Z.heightMismatch(effectiveMain,effectiveZones[i]);
      if(mismatch){notify(Z.heightMessage(layers[0].process.name,wanted[i].name,mismatch),true);return null;}
    }
    if(await checkZoneSafety(list,wanted,layers[0],built.job))return null;
    if(!await confirmRemove(message+'\n\nFür diesen Auftrag die bisherige G-Code-Zusammenführung nutzen? Nur gleiche Schichtraster, ein Modell und ein Werkzeug; ohne Stützen. Ergebnis sorgfältig prüfen.'))return null;
    built.job.parts=[];
    for(const zp of wanted){
      setJobStatus(`Zone „${zp.name}“ wird vorbereitet`);
      const part=await zones.withProcess(list,zp,()=>prepareJob(plate,{quiet:true}));
      if(!part?.job)return null;
      built.job.parts.push({job:part.job,zone:{...zoneOf(zp),name:zp.name}});
    }
    notes.push('Zonen: ausdrücklich gewählte bisherige G-Code-Zusammenführung; kein natives gemeinsames Slicing.');
  }
  return {...built,supportNotes:[...adjusted,...notes],stamp:stampPlate(plate),binary:built.job.config.configuration.printer_settings.binary_gcode===true};
}

const safeName=text=>text.replace(/[\\/:*?"<>|]/g,'_').trim()||'Druck';
function timeStamp(){
  const now=new Date(),two=n=>String(n).padStart(2,'0');
  return `${now.getFullYear()}${two(now.getMonth()+1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}
async function outputPath(extension,plate){
  const first=plateModels(state,plate).find(m=>m.enabled!==false);
  return invoke('choose_output',{name:`${safeName(first.name.replace(/\.[^.]+$/,''))}_${timeStamp()}`,extension});
}

function skippedNote(ignored){
  const keys=ignored.filter(x=>!x.key.startsWith('simpliy.')).map(x=>x.key);
  return keys.length?` · nicht übergeben: ${keys.join(', ')}`:'';
}

async function runEngine(prepared,plate,label=''){
  const poll=setInterval(async()=>{try{const [text,percent]=await Promise.all([invoke('slicing_status'),invoke('slicing_progress')]);if(!jobPolling||!engineBusy)return;if(text)setJobStatus(label+text);setProgress(Number(percent)*.84||0)}catch{}},120);
  let engineBusy=false,engineDone=false;
  jobPolling=true;
  try{
    // The preview uses ASCII. If a binary export is requested, create it separately from the same job.
    const job=structuredClone(prepared.job),binary=job.config.configuration.printer_settings.binary_gcode===true;
    job.config.configuration.printer_settings.binary_gcode=false;
    if(binary)job.disableWeakRetry=true;
    setProgress(1);const started=invoke('slice_preview',{enginePath:state.engine_path,job});
    setTimeout(()=>{engineBusy=jobPolling&&!engineDone},150);
    const ascii=await started;engineDone=true;engineBusy=false;setProgress(84);
    if(!binary)await addThumbnails(ascii.output,plate);
    const supportInfo=ascii.supportInfo||null;
    let result=ascii;
    if(cancelAll)throw Error('Slicing abgebrochen.');
    if(binary){setJobStatus(label+'Binaeren G-Code vorbereiten');result=await invoke('slice_preview',{enginePath:state.engine_path,job:prepared.job});await addThumbnails(result.output,plate)}
    const first=plateModels(state,plate).find(m=>m.enabled!==false);
    const name=`${safeName(first?.name?.replace(/\.[^.]+$/,'')||'Druck')}_${timeStamp()}.${binary?'bgcode':'gcode'}`;
    setProgress(90);
    features.outputs.set(plate,{path:result.output,previewPath:ascii.output,stamp:prepared.stamp,name,supportInfo,partBottom:Number(ascii.partBottom)||0});

    previews.delete(plate);
    if(state.ui.active_plate===plate){preview=null;previewMode=false;previewPath='';previewStamp=''}
    return result;
  }finally{clearInterval(poll);jobPolling=false}
}
async function loadPreview(plate){
  const out=features.outputs.get(plate);if(!out)return false;
  let cached=previews.get(plate);
  const displayPath=out.previewPath||out.path;
  if(!cached||cached.path!==displayPath){
    // Rust meldet das Einlesen als 95 bis 100.
    const poll=jobRunning?setInterval(async()=>{
      try{const percent=Number(await invoke('slicing_progress'));if(jobRunning&&percent>=95)setProgress(90+(percent-95)*1.8)}catch{}
    },120):null;
    try{
      const data=readPreview(readPacket(await invoke('read_preview',{path:displayPath})));
      cached={data,path:displayPath,stamp:out.stamp};
    }finally{clearInterval(poll)}
    previews.set(plate,cached);
    if(previews.size>3)previews.delete(previews.keys().next().value);
  }
  if(state.ui.active_plate!==plate)return false;
  preview=cached.data;previewPath=out.savedPath?'Export: '+out.savedPath:(out.name||'Druck')+' - nur Vorschau, noch nicht exportiert';previewStamp=cached.stamp;
  stopPlayback();Object.assign(previewView,{layer:preview.layers.length-1,minLayer:0,role:'all',move:null});previewMode=true;return true;
}
async function sliceNow(){
  if(jobRunning)return;jobRunning=true;cancelAll=false;
  try{const plate=state.ui.active_plate,prepared=await prepareJob(plate);if(!prepared)return;
    beginProgress();setJobStatus('Slicing wird vorbereitet');render();await runEngine(prepared,plate);
    setJobStatus('Vorschau wird geladen');const shown=await loadPreview(plate);setProgress(100);
    const supports=features.outputs.get(plate)?.supportInfo;
    const messages=[...(prepared.supportNotes||[]),...(supports?.warning?[supports.warning]:[])];
    if(messages.length)notify(messages.join('\n'),!!supports?.warning);
    setJobStatus(`${shown?'Vorschau bereit: '+preview.layers.length+' Schichten':'Platte vorbereitet'}${supports?' · '+supports.text:''}${skippedNote(prepared.ignored)}`);
  }catch(e){setJobStatus(String(e).split('\n').slice(0,2).join(' '));notify(String(e),true)}finally{jobRunning=false;endProgress();render()}
}
async function sliceAllPlates(){
  if(jobRunning)return;const plates=state.plates.filter(p=>plateModels(state,p.id).some(m=>m.enabled!==false));
  if(!plates.length)return notify('Auf keiner Platte liegt ein Modell zum Drucken.',true);
  jobRunning=true;cancelAll=false;let done=0;
  try{const jobs=[];for(const plate of plates){const prepared=await prepareJob(plate.id);if(!prepared){setJobStatus(`Nicht gestartet: ${plate.name}`);return}jobs.push({plate,prepared})}
    beginProgress(0,jobs.length);render();for(const [i,{plate,prepared}] of jobs.entries()){if(cancelAll)break;beginProgress(i,jobs.length);await runEngine(prepared,plate.id,`Platte ${i+1}/${jobs.length}: `);done++}
    if(features.outputs.has(state.ui.active_plate))await loadPreview(state.ui.active_plate);
    const warnings=jobs.flatMap(({plate})=>{
      const warning=features.outputs.get(plate.id)?.supportInfo?.warning;
      return warning?[`${plate.name}: ${warning}`]:[];
    });
    const messages=[...jobs.flatMap(j=>j.prepared.supportNotes||[]),...warnings];
    if(messages.length)notify(messages.join('\n'),warnings.length>0);
    setJobStatus(cancelAll?`Abgebrochen, ${done} von ${jobs.length} Platten vorbereitet`:`${done} Platten vorbereitet; noch nicht exportiert`);
  }catch(e){setJobStatus(`${done} von ${plates.length} Platten fertig. ${String(e).split('\n')[0]}`);notify(String(e),true)}finally{jobRunning=false;endProgress();render()}
}
async function exportGcode(){
  const plate=state.ui.active_plate,out=features.outputs.get(plate);
  if(!out)return notify('Bitte zuerst diese Platte slicen.',true);
  if(out.stamp!==stampPlate(plate))return notify('Die Vorschau ist veraltet. Bitte vor dem Export neu slicen.',true);
  if(out.supportInfo?.warning&&!await confirmRemove(`${out.supportInfo.warning}\n\nG-Code trotzdem speichern?`))return;
  try{const extension=out.name?.toLowerCase().endsWith('.bgcode')?'bgcode':'gcode';const name=(out.name||'Druck.gcode').replace(/\.(?:bgcode|gcode)$/i,'');const path=await invoke('choose_output',{name,extension});if(!path)return;
    await invoke('export_preview',{source:out.path,output:path});out.savedPath=path;if(previewMode)previewPath='Export: '+path;setJobStatus(`G-Code gespeichert: ${path}`);render();
  }catch(e){notify(String(e),true)}
}

async function exportProject(){
  try{
    const plate=state.ui.active_plate;
    const prepared=await prepareJob(plate);
    if(!prepared)return;
    const output=await outputPath('3mf',plate);
    if(!output)return;
    await invoke('export_project',{enginePath:state.engine_path,job:prepared.job,output});
    setJobStatus(`3MF gespeichert: ${output}`);
  }catch(e){
    notify(String(e),true);
  }
}

function layerFor(model,mesh){
  const painted=Object.values(model.paint||{}).some(layer=>Object.keys(layer).length);
  if(painted&&model.signature!==mesh.signature){
    notify('Die Datei wurde seit dem Anmalen geändert. Bitte die Bemalung zuerst löschen.',true);
    return null;
  }
  model.signature=mesh.signature;
  return ((model.paint??={})[toolOptions.kind]??={});
}

function paintAt(hit,{erase}){
  const model=hit.item.model;
  if(!strokeActive){
    models.remember();
    strokeActive=true;
    state.ui.selected_model_id=model.id;
  }
  if(toolOptions.kind==='color'&&toolCount()<2)return;
  const layer=layerFor(model,hit.item.mesh);
  if(!layer)return;
  const value=erase?0:toolOptions.state;
  const mesh=hit.item.mesh,mode=toolOptions.paintMode;
  // Flaechen-Werkzeuge wirken einmal pro Klick, nicht bei jeder Mausbewegung des Zugs.
  if(['face','fill','bucket'].includes(mode)){if(strokeApplied)return;strokeApplied=true}
  const changed=mode==='triangle'?mesh.paintTriangle(layer,hit.triangle,value)
    :mode==='face'?mesh.paintFace(layer,hit.triangle,value,{planeAngle:toolOptions.planeAngle,smoothAngle:toolOptions.smoothAngle})
    :mode==='fill'?mesh.fill(layer,hit.triangle,value,toolOptions.fillAngle)
    :mode==='bucket'?mesh.bucket(layer,hit.triangle,value)
    :mesh.brush(layer,hit.point,toolOptions.radius,value,toolOptions.front?hit.view:null);
  if(changed){viewport.refreshPaint(model.id);if(mode!=='brush'&&mode!=='triangle')viewport.showFlatFace(null)}
}

function bindViewport(){
  if(!window.__TAURI__)return;
  try{
    viewport=new Viewport({
      select(key){state.ui.selected_model_id=key;update()},
      move(key,position){models.moveTo(key,position);update()},
      gizmo(key,name,values,placement){
        const model=state.models.find(m=>m.id===key); if(!model)return;
        models.remember();
        if(name==='rotate') {model.rotation=values;if(placement){model.position=placement.slice(0,2);model.bedZ=placement[2];delete model.sink;}}
        else if(name==='scale') model.scale=values;
        else {model.position=values.slice(0,2);model.bedZ=Math.max(0,values[2]);delete model.sink;}
        update();
      },
      rotate(key,rotation){
        const model=state.models.find(m=>m.id===key); if(!model)return;
        models.remember(); model.rotation=rotation.map(v=>Math.round(v*1e6)/1e6); update();
      },
      face(key,normal){models.layOnFace(key,normal);update()},
      pick(tool,hit){features.pick(tool,hit)},
      paint:paintAt,
      strokeEnd(){strokeActive=false;strokeApplied=false;update()},
      supportPoint(point){onSupportPick(point)},
      supportWipe(points){onSupportWipe(points)},
      supportPreview(point){return supportPreview(point)},
      sectionPoint(point){const index={X:0,Y:1,Z:2}[sectionState.orientation[1]];sectionState.position=clampSectionPosition(point[index],currentBed(),sectionState.orientation);sectionState.pickPoint=false;scheduleRender()},
    });
  }catch(e){
    notify(`3D-Ansicht nicht verfügbar: ${e}`,true);
  }
}

/** Aktionen des Arbeitsbereichs. true = erledigt. */
function workbenchAction(action,el){
  if(action==='preview-play'){togglePlayback();return true;}
  if(action==='support-mode'){setSupportMode(el.dataset.mode);return true;}
  if(action==='support-tab'){if(el.dataset.group in supportTabs){supportTabs[el.dataset.group]=el.dataset.tab;supportMode='none';supportMoving=null;update()}return true;}
  if(action==='support-style'){changeSupportSetting('style',el.dataset.style);return true;}
  if(supportAction(action))return true;
  if(action==='rename-plate'){renamePlate(el.dataset.id);return true;}
  const d=el.dataset||{};
  const model=selectedModel();
  let changed=true;
  switch(action){
    case'undo':changed=models.undo();break;
    case'redo':changed=models.redo();break;
    case'duplicate-model':changed=models.duplicate();break;
    case'delete-model':
      if(model&&!meshes.has(model.path)){
        models.remember();
        state.models=state.models.filter(m=>m!==model);
        state.ui.selected_model_id=plateModels(state).at(-1)?.id||'';
      }else changed=models.remove();
      break;
    case'arrange-models':changed=models.arrangeAll();break;
    case'auto-orient':changed=models.autoOrient();break;
    case'center-model':changed=models.center();break;
    case'mirror-model':changed=models.mirror(Number(d.axis));break;
    case'turn-model':changed=models.turn(Number(d.axis),Number(d.degrees));break;
    case'reset-scale':changed=models.resetScale();break;
    case'reset-rotation':changed=models.resetRotation();break;
    case'add-volume':changed=models.addVolume(d.kind);break;
    case'remove-volume':changed=models.removeVolume(Number(d.index));break;
    case'add-range':changed=models.addRange();break;
    case'remove-range':changed=models.removeRange(Number(d.index));break;
    case'remove-extra':changed=models.setExtra(d.owner,Number(d.index),d.key,undefined);break;
    case'cut-axis':toolOptions.cutAxis=Number(d.axis);toolOptions.cutHeight=null;render();return true;
    case'cut-model':{
      const {cutHeight,meshHeight}=dockContext(plateValues());
      if(!(cutHeight>0&&cutHeight<meshHeight)){notify('Die Schnitthöhe muss im Modell liegen.',true);return true}
      changed=models.cut(cutHeight,d.keep,toolOptions.cutAxis,toolOptions.cutTilt);
      break;
    }
    case'toggle-triangles':state.ui.show_triangles=!state.ui.show_triangles;break;
    case'paint-kind':toolOptions.kind=d.kind;toolOptions.state=1;render();return true;
    case'paint-state':{
      const value=Number(d.value);
      if(value===0||paintStates(toolOptions.kind,toolCount()).some(([v])=>v===value))toolOptions.state=value;
      render();
      return true;
    }
    case'paint-mode':if(['brush','triangle','face','fill','bucket'].includes(d.mode))toolOptions.paintMode=d.mode;render();return true;
    case'paint-height':{
      const mesh=model&&meshes.get(model.path);
      if(!mesh)return true;
      const layer=layerFor(model,mesh);
      if(!layer)return true;
      models.remember();
      changed=mesh.heightRange(layer,placement(model,mesh,currentBed()).rows,Number(toolOptions.heightFrom),Number(toolOptions.heightTo),toolOptions.state);
      if(!changed)notify('Im Höhenbereich ändert sich nichts (von muss kleiner als bis sein, und der Bereich im Modell liegen).');
      break;
    }
    case'paint-gaps':{
      const mesh=model&&meshes.get(model.path);
      if(!mesh)return true;
      const layer=layerFor(model,mesh);
      if(!layer)return true;
      models.remember();
      changed=mesh.gapFill(layer,Number(toolOptions.gapArea),toolOptions.state);
      if(!changed)notify('Keine umschlossenen Lücken bis zu dieser Fläche gefunden.');
      break;
    }
    case'paint-clear':
      if(!model?.paint)return true;
      models.remember();
      delete model.paint[toolOptions.kind];
      break;
    case'paint-overhangs':{
      const mesh=model&&meshes.get(model.path);
      if(!mesh)return true;
      models.remember();
      const layer=layerFor(model,mesh);
      if(!layer)return true;
      changed=mesh.markOverhangs(layer,toolOptions.angle,placement(model,mesh,currentBed()).rows);
      if(!changed)notify('Keine neuen Überhänge bei diesem Winkel gefunden.');
      break;
    }
    case'camera':viewport?.setView(d.view);return true;
    case'section-flip':sectionState.orientation=(sectionState.orientation[0]==='+'?'-':'+')+sectionState.orientation[1];scheduleRender();return true;
    case'section-pick':if(sectionState.enabled){sectionState.pickPoint=!sectionState.pickPoint;scheduleRender()}return true;
    case'cancel-slice':cancelAll=true;setJobStatus('Wird abgebrochen');invoke('cancel_slicing').catch(e=>notify(String(e),true));return true;
    default:return false;
  }
  if(changed)update();
  return true;
}

/** Eingaben des Arbeitsbereichs. true = erledigt. */
function workbenchChange(el){
  const d=el.dataset;
  if(d.supportSetting){
    const value=el.type==='checkbox'?el.checked:['placement','build','existing','contactPattern','contactLoops','bodyPattern'].includes(d.supportSetting)?el.value:Number(el.value);
    changeSupportSetting(d.supportSetting,value);
    return true;
  }
  const index=Number(d.index);
  if(d.modelEnabled){
    const model=state.models.find(m=>m.id===d.modelEnabled);
    if(model)model.enabled=el.checked;
  }else if(d.modelTool!==undefined){
    const model=selectedModel();
    if(!model)return true;
    models.remember();
    if(Number(el.value))model.tool=Number(el.value);else delete model.tool;
  }else if(d.processTool!==undefined){
    const proc=activeProcess();
    if(Number(el.value))proc.tool=Number(el.value);else delete proc.tool;
  }else if(d.slotFilament){
    const preset=state.ui.prusa_preset;
    const list=Array.from({length:toolCount()},(_,i)=>preset.filaments?.[i]||'');
    list[Number(d.slotFilament)]=el.value;
    preset.filaments=list;
    syncPrusaPrinter();
  }else if(d.slotMaterial){
    state.tool_materials??={};
    if(el.value)state.tool_materials[d.slotMaterial]=el.value;else delete state.tool_materials[d.slotMaterial];
  }else if(d.transform){
    models.transform(d.transform,Number(d.axis),el.value,toolOptions.uniform);
  }else if(d.toolOption){
    const key=d.toolOption;
    if(el.type==='checkbox'){
      toolOptions[key]=el.checked;
    }else if(el.value!==''&&Number.isFinite(Number(el.value))){
      const limits={radius:[0.2,100],angle:[1,89],fillAngle:[1,90],cutHeight:[0,1e5],cutTilt:[-60,60],planeAngle:[0.1,20],smoothAngle:[1,90],heightFrom:[0,1e5],heightTo:[0,1e5],gapArea:[0.1,1e4]}[key];
      if(!limits)return true;
      toolOptions[key]=Math.min(limits[1],Math.max(limits[0],Number(el.value)));
    }
    scheduleRender();
    return true;
  }else if(d.volume){
    models.editVolume(index,d.volume,Number(d.axis),el.value);
  }else if(d.range){
    models.editRange(index,d.range,el.value);
  }else if(d.extraKey){
    models.setExtra(d.owner,index,d.extraKey,el.type==='checkbox'?el.checked:parseValue(el.value));
  }else if(d.addExtra!==undefined){
    if(!el.value)return true;
    const spec=catalogByKey.get(el.value),{values}=resolve();
    const raw=values[el.value]??baseFlat?.[el.value]??spec.default;
    models.setExtra(d.owner,index,el.value,spec.type==='Bool'?[true,'true',1,'1'].includes(raw):display(raw,spec));
  }else{
    return false;
  }
  update();
  return true;
}

async function handleAction(action,el){
 if(action==='dlg-ok'){okAppDialog();return}
 if(action==='dlg-cancel'){cancelAppDialog();return}
 if(action==='serial-open'){openModal('serial');render();await serialPanel.open();return;}
 if(action.startsWith('serial-')){await serialPanel.action(action,el);return;}
 if(action!=='auto-menu')autoConfigActions.view.autoMenu='';if(workbenchAction(action,el))return;const handled=features.action(action,el);if(handled){await handled;return}const proc=activeProcess(),bundle=currentProfile(),p=bundle.profile;const run=actionTable[action];if(run){await run({proc,el,bundle,p,action});return}
 if(await helpAction(action,el))return;
 notify(`Unbekannte Aktion: ${action}`,true);
}
document.addEventListener('pointerdown',e=>{if(e.button===0)pointerDown=true},true);
for(const type of ['pointerup','pointercancel'])document.addEventListener(type,()=>{pointerDown=false;if(renderQueued)scheduleRender()},true);
app.addEventListener('click',e=>{
  if(e.target.closest('[data-model-enabled]'))return;
  const el=e.target.closest('[data-action]');
  if(!el||(el.dataset.action==='click-backdrop'&&e.target!==el))return;
  handleAction(el.dataset.action,el);
});
function renamePlate(plate){
  const tab=[...app.querySelectorAll('.plate-tab')].find(b=>b.dataset.id===plate);
  if(tab)features.renamePlate(tab);
}
app.addEventListener('dblclick',e=>{
  if(e.target.closest('[data-edit="process"]'))return openProcess();
  const tab=e.target.closest('.plate-tab');
  // Der erste Klick hat neu gezeichnet: den aktuellen Reiter nehmen.
  if(tab)setTimeout(()=>renamePlate(tab.dataset.id),30);
});
app.addEventListener('contextmenu',e=>{
  const tab=e.target.closest('.plate-tab');
  if(!tab)return;
  e.preventDefault();
  renamePlate(tab.dataset.id);
});
app.addEventListener('input',e=>{
  const live=e.target.dataset.live;
  if(live==='printer-filter'||live==='material-filter'||live==='assign-filter'){
    if(live==='printer-filter')printerFilter=e.target.value;else if(live==='material-filter')materialFilter=e.target.value;else autoConfigActions.view.assignFilter=e.target.value;
    clearTimeout(searchTimer);searchTimer=setTimeout(()=>{render();const box=document.querySelector(`[data-live="${live}"]`);if(box){box.focus();box.setSelectionRange(box.value.length,box.value.length)}},250);
    return;
  }
  if(favorites.live(e))return;
  if(live!=='search')return;
  settingSearch=e.target.value;
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{const box=$('#search-results');if(box)box.innerHTML=renderSearchResults(settingSearch,catalogByKey)},90);
});
app.addEventListener('input',e=>{
 if(e.target.dataset.section!=='position')return;
 sectionState.position=clampSectionPosition(e.target.value,currentBed(),sectionState.orientation);
 const number=$('#section-number'),slider=$('#section-range'),label=$('#section-value');if(number&&number!==e.target)number.value=sectionState.position;if(slider&&slider!==e.target)slider.value=sectionState.position;if(label)label.textContent=sectionState.position.toFixed(2);
 viewport?.setSection(sectionState);
});
app.addEventListener('input',e=>{
 const key=e.target.dataset.preview;
 if(key==='move'&&preview&&previewMode){stopPlayback();previewView.move=Number(e.target.value)>=Number(e.target.max)?null:Number(e.target.value);showMoves();viewport?.setToolpath(preview,{...previewView});return}
 if(!['layer','minLayer'].includes(key)||!preview||!previewMode)return;
 const value=Math.max(0,Math.min(preview.layers.length-1,Number(e.target.value)));
 if(key==='layer'){previewView.move=null;stopPlayback();previewView.layer=value;previewView.minLayer=Math.min(previewView.minLayer||0,value)}else{previewView.minLayer=Math.min(value,previewView.layer);e.target.value=previewView.minLayer}
 const lower=$('#preview-min-layer');if(lower)lower.value=previewView.minLayer;const lowerLabel=$('#preview-min-label');if(lowerLabel)lowerLabel.textContent=String(previewView.minLayer+1);
 const label=$('#preview-layer-label'),height=$('#preview-layer-height');if(label)label.textContent=`${previewView.layer+1} / ${preview.layers.length}`;
 if(height)height.textContent=preview.layers[previewView.layer].z?.toFixed(2)||'--';
 showMoves();const info=viewport?.setToolpath(preview,{...previewView}),note=$('#stage-note');if(note&&info)note.textContent=`${info.shown} Werkzeugwege${info.total>info.shown?' (gekuerzt)':''}`;
});
app.addEventListener('input',e=>{const field=e.target.dataset.filterSelect;if(!field)return;const select=app.querySelector(`select[data-field="${field}"]`);if(!select)return;const query=e.target.value.trim().toLocaleLowerCase();for(const option of select.options){if(option.value)option.hidden=!option.textContent.toLocaleLowerCase().includes(query)}});
app.addEventListener('change',async e=>{const el=e.target,field=el.dataset.field;
 if(el.dataset.live)return;
 for(const handle of earlyChange)if(handle(el))return;
 if(el.dataset.section){const key=el.dataset.section;if(key==='orientation'){
   if(!/^[+-][XYZ]$/.test(el.value))return;sectionState.orientation=el.value;sectionState.position=sectionCenter(el.value);sectionState.initialized=true;
 }else if(key==='position'){sectionState.position=clampSectionPosition(el.value,currentBed(),sectionState.orientation)}
 else if(['enabled','showPlane','showGizmo'].includes(key)){sectionState[key]=el.checked;if(key==='enabled'&&!el.checked)sectionState.pickPoint=false;if(key==='enabled'&&el.checked&&!sectionState.initialized){sectionState.position=sectionCenter(sectionState.orientation);sectionState.initialized=true}}
 scheduleRender();return;}
 if(el.dataset.preview==='move'||el.dataset.preview==='rate'){
  if(el.dataset.preview==='rate')previewView.rate=Number(el.value);
  return;
 }
 if(el.dataset.preview){const key=el.dataset.preview;previewView[key]=['layer','minLayer'].includes(key)?Number(el.value):el.type==='checkbox'?el.checked:el.value;if(key==='layer')previewView.minLayer=Math.min(previewView.minLayer||0,previewView.layer);if(key==='minLayer')previewView.minLayer=Math.min(previewView.minLayer,previewView.layer);scheduleRender();return}
 if(workbenchChange(el)||features.change(el))return;
 const bundle=currentProfile(),proc=activeProcess();
 if(el.dataset.field==='update-repo'){state.ui.update_repo=el.value.trim();update();return}
 for(const handle of lateChange)if(handle(el,proc))return;
 if(el.dataset.tempSeries){const num=v=>Number(String(v).replace(',','.'));
  editTemps(t=>{const r=t[el.dataset.tempSeries]?.[Number(el.dataset.tempRow)];if(!r)return;const c=Number(el.dataset.tempCol),n=num(el.value);if(!Number.isFinite(n))return;
   r[c]=c===0?Math.max(el.dataset.tempSeries==='chamber'?2:3,Math.round(n)):Math.max(0,Math.min(500,n));t[el.dataset.tempSeries].sort((a,b)=>a[0]-b[0])});return}
 if(el.dataset.fanField||el.dataset.fanRow!==undefined){
  const num=v=>{const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:0};
  editFans(f=>{const fan=f[toolListsActions.view.activeFan];if(!fan)return;
   if(el.dataset.fanField==='name')fan.name=el.value.trim();
   else if(el.dataset.fanField==='index')fan.index=Math.max(0,Math.round(num(el.value)));
   else{const r=fan.setpoints[Number(el.dataset.fanRow)];if(!r)return;const c=Number(el.dataset.fanCol);r[c]=c===0?Math.max(1,Math.round(num(el.value))):Math.min(100,Math.max(0,num(el.value)));fan.setpoints.sort((a,b)=>a[0]-b[0])}});
  return}
 if(el.dataset.setting&&el.dataset.slot!==undefined){highlightKey='';
  // Wert eines Extruders: nur seine Stelle aendern, die anderen Werkzeuge behalten ihre Werte.
  const parts=el.dataset.all.split(';').map(s=>s.trim()),slot=Number(el.dataset.slot);
  parts[slot]=el.dataset.type==='bool'?String(el.checked):el.value.trim();
  writeSetting(el.dataset.setting,parts.map(v=>parseValue(v,el.dataset.type==='bool'?'bool':'')),proc,processProfile(proc));return}
 if(el.dataset.setting){highlightKey='';writeSetting(el.dataset.setting,el.dataset.type==='bool'?el.checked:parseValue(el.value,el.dataset.type),proc,processProfile(proc));return}
 if(el.dataset.assignmentKey){const o=option();if(o)o.assignments[el.dataset.assignmentKey]=parseValue(el.value,catalogByKey.get(el.dataset.assignmentKey)?.type);update();return}
 if(el.dataset.baseKey){bundle.profile.base_parameters[el.dataset.baseKey]=parseValue(el.value,catalogByKey.get(el.dataset.baseKey)?.type);update();return}
 if(el.dataset.assignKey){if(autoConfigActions.view.assignDraft)autoConfigActions.view.assignDraft[el.dataset.assignKey]=el.value;return}
 if(el.dataset.printerEngine!==undefined){const pr=state.printers.find(x=>x.id===libraryActions.view.printerEdit);if(!pr||!el.value)return;
  // Nur die Struktur wechselt (Werkzeuganzahl). Die Druckerwerte bleiben die eigenen.
  pr.engine=P.neutralSkeleton(Number(el.value));baseKey='';update();notify(`${pr.engine.tools} Werkzeug(e) eingestellt. Druckerwerte bleiben unverändert.`);return}
 if(el.dataset.printerNet){const pr=printerOf(proc);if(!pr)return;if(el.dataset.printerNet==='secret')features.setPrinterSecret(pr.id,el.value);else pr[el.dataset.printerNet]=el.value.trim();update();return}
 if(el.dataset.printerSetting||el.dataset.materialSetting){
  const owner=el.dataset.printerSetting?state.printers.find(x=>x.id===libraryActions.view.printerEdit):state.filaments.find(x=>x.id===libraryActions.view.filamentEdit);
  const key=el.dataset.printerSetting||el.dataset.materialSetting;
  if(owner?.settings)owner.settings[key]=el.dataset.type==='bool'?el.checked:parseValue(el.value,el.tagName==='TEXTAREA'?'script':'');
  update();return}
 if(el.dataset.qualityName){const q=state.printers.find(x=>x.id===libraryActions.view.printerEdit)?.qualities?.find(x=>x.id===el.dataset.qualityName);if(q)q.name=el.value.trim()||q.name;update();return}
 if(el.dataset.printerMaterial){const pr=state.printers.find(x=>x.id===libraryActions.view.printerEdit);if(!pr)return;const m=el.dataset.printerMaterial;pr.materials=el.checked?[...new Set([...(pr.materials||[]),m])]:(pr.materials||[]).filter(x=>x!==m);update();return}
 if(el.dataset.filamentField){const f=state.filaments.find(p=>p.id===libraryActions.view.filamentEdit);if(f)f[el.dataset.filamentField]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;update();return}
 if(el.dataset.printerField){const p=state.printers.find(p=>p.id===libraryActions.view.printerEdit);if(p)p[el.dataset.printerField]=el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value;update();return}
 if(!field)return;
 const handleField=fieldTable[field];
 if(handleField&&await handleField({el,proc,bundle}))return;
 update();
});
$('#profile-upload').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';await importFile(f)});
document.addEventListener('input',e=>{if(appDialog&&e.target?.id==='dlg-input')appDialog.value=e.target.value});
document.addEventListener('input',e=>zones.input(e.target));
document.addEventListener('keydown',e=>{
  if(appDialog){
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancelAppDialog()}
    else if(e.key==='Enter'&&e.target?.tagName!=='BUTTON'){e.preventDefault();e.stopImmediatePropagation();okAppDialog()}
    return;
  }
  if(e.key==='F2'&&!modal&&state){e.preventDefault();renamePlate(state.ui.active_plate);return;}
  if(e.key==='Escape'&&sectionState.pickPoint){sectionState.pickPoint=false;scheduleRender();return;}
  if(e.key==='Escape'&&modal){
    if(modal==='process'&&settingSearch){settingSearch='';render()}
    else if(modal==='process')closeProcess(false);
    else closeModal();
  }
  if(!e.ctrlKey)return;
  const key=e.key.toLowerCase();
  if(key==='s'){e.preventDefault();document.activeElement?.blur?.();sync();if(state)features.action('project-save',{dataset:{}})}
  if((key==='z'||key==='y')&&!modal&&!e.target.matches?.('input,textarea')){e.preventDefault();if(key==='y'||e.shiftKey?models.redo():models.undo())update()}
});
globalThis.addEventListener?.('beforeunload',()=>{if(saveTimer)sync()});
// Design ist eine eigenstaendige GUI-Einstellung, kein Prozessparameter.
document.addEventListener('change', event=>{
  if (event.target?.id !== 'simpliy-theme') return;
  event.stopImmediatePropagation();
  setThemePreference(event.target.value);
}, true);
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
async function boot(){
  try{
    const [rs,rc]=await Promise.all([fetch('/api/state'),fetch('./engine-catalog.json')]);
    if(!rs.ok)throw Error((await rs.json()).error||'Arbeitsbereich nicht lesbar.');
    if(!rc.ok)throw Error('Mitgelieferte Programmdaten fehlen.');
    state=await rs.json();
    // Unveraenderte Vorlage halten, damit Sprachwechsel keine Uebersetzungen mischen.
    rawLanguageCatalog=await rc.json();
    await refreshLanguageCatalog();
    if(window.__TAURI__)await supports.load();
    lastSynced=JSON.stringify(state);
    if(!activeProcess())state.processes.push({id:id('proc'),name:'Modell',role:'model',profile_id:state.active_profile_id,selections:{},overrides:{},enabled:true});
    state.active_process_id=activeProcess().id;
    state.ui??={};
    state.ui.tool??='select';
    if(state.ui.tool==='prusa')state.ui.tool='paint';
    state.ui.dock_open??=false;
    state.ui.left_open??=true;
    ensurePlates(state);
    if(!state.engine_path&&window.__TAURI__){
      const found=await fetch('/api/engine').then(r=>r.json()).catch(()=>({}));
      if(found.detected?.length)state.engine_path=found.detected[0];
    }
    bindViewport();
    applyBranding();
    if(window.__TAURI__&&!legal)invoke('legal_texts').then(x=>{legal=x}).catch(()=>{});
    watchTranslations(app);
    render();
    window.__TAURI__?.event?.listen('simpliy-close-requested',()=>closeRequested());
    reportUnsaved();
    // Neueste Prusa-Engine holen (im Hintergrund, nicht beim Start blockierend).
    setTimeout(()=>engineUpdate.check(),4000);
  }catch(e){
    app.innerHTML=`<div class="boot"><h2>Simpliy Slicing konnte nicht starten</h2><p>${esc(e.message)}</p></div>`;
  }
}
applyTheme();
watchSystemTheme();
boot();
