// Aktionen fuer Platten, Projekte, Upload, Text, Messen und Reparatur.
import {parse as parseFont} from './vendor/opentype/opentype.module.js';
import {textVolume} from './text-mesh.js';
import {measure, MODES} from './measure.js';
import {plateModels, ensurePlates, freePlateName, setPlateName} from './plate-plan.js';
import {linear} from './geometry.js';
import {projectDocument, applyProject} from './project-file.js';
import {renderTextPanel, renderMeasurePanel, renderRepairPanel, renderUploadDialog} from './feature-panels.js';

const fileName = path => path.split(/[\\/]/).pop();
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 30));

/**
 * @param env {state, invoke, id, notify, confirm, update, render, setStatus, openModal, history, sync,
 *             meshes, loadMesh, selected, tools, resetView, overlay, stamp, busy}
 */
export function createFeatures(env) {
  const text = {text: 'Text', font: '', height: 8, depth: 0.8, angle: 0, engrave: false, tool: 0, index: null, owner: ''};
  const measuring = {mode: 'distance', picks: [], result: null};
  const reports = new Map(); // Modell-ID -> {path, report}
  const outputs = new Map(); // Platte -> {path, stamp}
  const secrets = new Map(); // Drucker -> Passwort, nur im Speicher
  const fontCache = new Map();
  let fonts = null;
  let fontsLoading = null;
  let tolerance = 0.001;
  let upload = {printer: '', file: null, busy: false, text: '', error: false};
  let renaming = false;

  const state = () => env.state();

  function clearMeasure() {
    measuring.picks = [];
    measuring.result = null;
    env.overlay(null);
  }

  function leavePlate() {
    text.index = null;
    clearMeasure();
    env.resetView();
  }

  // Platten

  function pickPlate(key) {
    const s = state();
    if (key === s.ui.active_plate || !s.plates.some(p => p.id === key)) return;
    s.ui.active_plate = key;
    s.ui.selected_model_id = plateModels(s)[0]?.id || '';
    leavePlate();
    env.update();
  }

  function addPlate(copyModels) {
    const s = state();
    if (s.plates.length >= 100) return env.notify('Mehr als 100 Platten werden nicht unterstützt.', true);
    env.history.remember();
    const plate = {id: env.id('plate'), name: freePlateName(s.plates)};
    if (copyModels) {
      for (const model of plateModels(s)) s.models.push({...structuredClone(model), id: env.id('model'), plate: plate.id});
    }
    s.plates.push(plate);
    pickPlate(plate.id);
  }

  function deletePlate() {
    const s = state();
    if (s.plates.length < 2) return env.notify('Mindestens eine Platte muss bleiben.', true);
    const plate = s.plates.find(p => p.id === s.ui.active_plate);
    const count = plateModels(s).length;
    if (count && !env.confirm(`„${plate.name}“ mit ${count} Modell(en) löschen? Strg+Z holt sie zurück.`)) return;
    env.history.remember();
    s.models = s.models.filter(m => m.plate !== plate.id);
    s.plates = s.plates.filter(p => p !== plate);
    // Eine einzelne Platte ohne eigenen Namen ist immer Platte 1.
    const [only, ...others] = s.plates;
    if (!others.length && !only.named && /^Platte \d+$/.test(only.name)) only.name = 'Platte 1';
    s.ui.active_plate = s.plates[0].id;
    s.ui.selected_model_id = plateModels(s)[0]?.id || '';
    leavePlate();
    env.update();
  }

  /** Doppelklick auf den Reiter: Name direkt dort bearbeiten. */
  function renamePlate(button) {
    const plate = state().plates.find(p => p.id === button.dataset.id);
    if (!plate || renaming) return;
    const input = document.createElement('input');
    input.className = 'plate-rename';
    input.id = 'plate-rename';
    input.maxLength = 60;
    input.value = plate.name;
    input.placeholder = 'leer = Standardname';
    let finished = false;
    const finish = keep => {
      if (finished) return;
      finished = true;
      renaming = false;
      const name = input.value.trim();
      if (keep && name !== plate.name) {
        env.history.remember();
        setPlateName(state().plates, plate, name);
      }
      env.update();
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    renaming = true;
    button.replaceWith(input);
    input.focus();
    input.select();
  }

  // Projekte

  function projectName() {
    const path = state().ui.project_path;
    return path ? fileName(path).replace(/\.simpliyproject$/i, '') : '';
  }

  async function saveProject(asNew) {
    const s = state();
    let path = asNew ? '' : s.ui.project_path;
    path ||= await env.invoke('choose_project', {save: true, name: projectName() || 'Projekt'});
    if (!path) return;
    env.setStatus('Projekt wird gespeichert');
    await env.invoke('save_project', {document: projectDocument(s, fileName(path)), path});
    s.ui.project_path = path;
    env.setStatus(`Projekt gespeichert: ${fileName(path)}`);
    env.update();
  }

  async function replaceWorkspace(change) {
    await env.sync();
    await env.invoke('backup_workspace');
    change();
    env.history.clear();
    outputs.clear();
    reports.clear();
    leavePlate();
    env.update();
  }

  async function openProject() {
    const path = await env.invoke('choose_project', {save: false, name: ''});
    if (!path) return;
    if (state().models.length && !env.confirm('Aktuelle Platten durch das Projekt ersetzen? Der Arbeitsbereich wird vorher gesichert.')) return;
    env.setStatus('Projekt wird geöffnet');
    const doc = await env.invoke('open_project', {path});
    const next = structuredClone(state());
    applyProject(next, doc, env.id);
    await replaceWorkspace(() => {
      Object.assign(state(), next);
      state().ui.project_path = path;
      state().ui.selected_model_id = plateModels(state())[0]?.id || '';
    });
    env.setStatus(`Projekt geöffnet: ${fileName(path)}`);
  }

  async function newProject() {
    if (state().models.length && !env.confirm('Alle Platten leeren? Der Arbeitsbereich wird vorher gesichert.')) return;
    await replaceWorkspace(() => {
      const s = state();
      s.models = [];
      s.plates = [];
      s.tool_materials = {};
      s.ui.project_path = '';
      s.ui.selected_model_id = '';
      ensurePlates(s);
    });
    env.setStatus('Neues Projekt');
  }

  // Text

  function loadFonts() {
    if (fonts || fontsLoading) return fontsLoading;
    fontsLoading = env.invoke('list_fonts').then(list => {
      fonts = list;
      text.font ||= list.find(f => f.toLowerCase() === 'arial.ttf') || list[0] || '';
      env.render();
    }).catch(e => env.notify(String(e), true)).finally(() => (fontsLoading = null));
    return fontsLoading;
  }

  async function fontFor(name) {
    if (!name) throw Error('Keine Schrift gewählt');
    if (!fontCache.has(name)) {
      const data = await env.invoke('read_font', {name});
      fontCache.set(name, parseFont(data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer));
    }
    return fontCache.get(name);
  }

  async function putText(model, place) {
    const editing = text.index !== null && text.owner === model.id && model.volumes?.[text.index]?.shape === 'text';
    if (!editing) text.index = null;
    const spec = {
      text: text.text.slice(0, 300),
      font: text.font,
      height: Number(text.height),
      depth: Number(text.depth),
      angle: Number(text.angle),
      engrave: text.engrave,
      position: place.point,
      normal: place.normal,
    };
    const index = text.index;
    const before = editing ? model.volumes[index] : null;
    const volume = textVolume(await fontFor(text.font), spec, linear(model)[2]);
    // Waehrend die Schrift geladen hat, kann das Modell geaendert worden sein.
    if (!state().models.includes(model) || (before && model.volumes[index] !== before)) return;
    if (text.tool && !text.engrave && env.tools() > 1) volume.settings.extruder = Number(text.tool);
    env.history.remember();
    model.volumes ??= [];
    if (before) model.volumes[index] = volume;
    else model.volumes.push(volume);
    text.index = before ? index : model.volumes.length - 1;
    text.owner = model.id;
    env.update();
  }

  function editText(index) {
    const model = env.selected();
    const volume = model?.volumes?.[index];
    if (volume?.shape !== 'text') return;
    const {text: content, font, height, depth, angle, engrave} = volume.text;
    Object.assign(text, {text: content, font, height, depth, angle, engrave, index, owner: model.id, tool: volume.settings?.extruder || 0});
    env.render();
  }

  async function changeText() {
    const model = env.selected();
    const volume = text.index !== null && model?.id === text.owner ? model.volumes?.[text.index] : null;
    if (volume?.shape === 'text') await putText(model, {point: volume.text.position, normal: volume.text.normal});
    else env.render();
  }

  // Reparatur

  async function checkMesh() {
    const model = env.selected();
    const mesh = model && env.meshes().get(model.path);
    if (!mesh) return;
    env.setStatus('Netz wird geprüft');
    await nextFrame();
    const path = model.path;
    const report = await env.invoke('check_mesh', {enginePath: state().engine_path, path});
    reports.set(model.id, {path, report});
    env.setStatus('Netzprüfung fertig');
    env.render();
  }

  async function applyRepair() {
    const model = env.selected();
    const mesh = model && env.meshes().get(model.path);
    if (!mesh) return;
    const source = model.path;
    env.setStatus('Netz wird repariert');
    await nextFrame();
    const painted = Object.values(model.paint || {}).some(layer => Object.keys(layer).length);
    const request = {enginePath: state().engine_path, path: source, tolerance: Number(tolerance)};
    // Bemalte Modelle erst rechnen, dann fragen, dann speichern.
    let answer = await env.invoke('repair_mesh', {...request, save: !painted});
    if (!answer.changed) {
      reports.set(model.id, {path: source, report: answer.report});
      env.setStatus(answer.report.after.closed ? 'Das Netz war schon in Ordnung' : 'Keine automatische Reparatur möglich');
      env.render();
      return;
    }
    if (painted) {
      if (!env.confirm('Die Reparatur ändert die Dreiecke. Die Bemalung dieses Modells wird dabei gelöscht. Fortfahren?')) return;
      answer = await env.invoke('repair_mesh', {...request, save: true});
    }
    const {report: result, path} = answer;
    await env.loadMesh(path);
    if (!state().models.includes(model) || model.path !== source) return;
    env.history.remember();
    model.original_path ??= source;
    model.path = path;
    delete model.paint;
    delete model.signature;
    reports.set(model.id, {path, report: result});
    env.setStatus(result.after.closed ? 'Netz repariert' : 'Netz teilweise repariert');
    env.update();
  }

  function revertRepair() {
    const model = env.selected();
    if (!model?.original_path) return;
    env.history.remember();
    model.path = model.original_path;
    for (const key of ['original_path', 'paint', 'signature']) delete model[key];
    env.update();
  }

  // Upload

  function uploadPrinter() {
    const s = state();
    return s.printers.find(p => p.id === upload.printer) || s.printers.find(p => p.id === s.active_printer_id) || s.printers[0];
  }

  function uploadFile() {
    if (upload.file) return {path: upload.file, stale: false};
    const plate = state().ui.active_plate;
    const last = outputs.get(plate);
    return last ? {path: last.path, name: last.name, warning: last.supportInfo?.warning, stale: last.stamp !== env.stamp(plate)} : null;
  }

  async function runUpload(send) {
    if (upload.busy) return;
    if (send && env.busy()) return env.notify('Bitte warten, bis das Slicen fertig ist.', true);
    const printer = uploadPrinter();
    if (!printer?.web_url) {
      Object.assign(upload, {text: 'Bitte die Adresse des Druckers eintragen.', error: true});
      env.render();
      return;
    }
    const target = {kind: printer.host_type || 'duet', address: printer.web_url, secret: secrets.get(printer.id) || ''};
    const file = uploadFile();
    if (send && !file) return;
    if (send && file.stale && !env.confirm('Seit dem Slicen wurde etwas geändert. Den alten G-Code trotzdem senden?')) return;
    if (send && file.warning && !env.confirm(`${file.warning}\n\nG-Code trotzdem senden?`)) return;
    Object.assign(upload, {busy: true, text: send ? 'Wird gesendet …' : 'Verbindung wird geprüft …', error: false});
    env.render();
    const poll = send && setInterval(async () => {
      const status = await env.invoke('slicing_status').catch(() => '');
      const label = document.querySelector('#upload-message');
      if (upload.busy && label && status.startsWith('Upload')) label.textContent = status;
    }, 400);
    try {
      upload.text = send
        ? `Auf dem Drucker gespeichert: ${await env.invoke('printer_upload', {target, path: file.path, name: file.name || fileName(file.path)})}. Druck nicht gestartet.`
        : await env.invoke('printer_test', {target});
    } catch (e) {
      Object.assign(upload, {text: String(e), error: true});
    }
    if (poll) clearInterval(poll);
    upload.busy = false;
    env.render();
  }

  // Anbindung an app.js

  const ACTIONS = {
    'pick-plate': d => pickPlate(d.id),
    'add-plate': () => addPlate(false),
    'duplicate-plate': () => addPlate(true),
    'delete-plate': () => deletePlate(),
    'project-new': () => newProject(),
    'project-open': () => openProject(),
    'project-save': () => saveProject(false),
    'project-save-as': () => saveProject(true),
    'text-mode': d => {
      text.engrave = d.engrave === '1';
      return changeText();
    },
    'text-new': () => {
      text.index = null;
      env.render();
    },
    'text-edit': d => editText(Number(d.index)),
    'text-remove': d => {
      const model = env.selected();
      if (model?.volumes?.[Number(d.index)]?.shape !== 'text') return;
      env.history.remember();
      model.volumes.splice(Number(d.index), 1);
      text.index = null;
      env.update();
    },
    'measure-mode': d => {
      measuring.mode = d.mode;
      clearMeasure();
      env.render();
    },
    'measure-clear': () => {
      clearMeasure();
      env.render();
    },
    'repair-check': () => checkMesh(),
    'repair-apply': () => applyRepair(),
    'repair-revert': () => revertRepair(),
    'open-upload': () => {
      upload = {...upload, file: null, text: '', error: false};
      env.openModal('upload');
      env.render();
    },
    'upload-choose': async () => {
      const path = await env.invoke('choose_gcode');
      if (path) upload.file = path;
      env.render();
    },
    'upload-test': () => runUpload(false),
    'upload-send': () => runUpload(true),
  };

  async function guarded(work) {
    try {
      await work();
    } catch (e) {
      env.setStatus(String(e.message || e));
      env.notify(String(e.message || e), true);
    }
  }

  return {
    outputs,
    projectName,
    isRenaming: () => renaming,
    renamePlate,
    leavePlate,

    action(name, el) {
      if (!Object.hasOwn(ACTIONS, name)) return null;
      return guarded(() => ACTIONS[name](el.dataset || {}));
    },

    change(el) {
      const d = el.dataset;
      const s = state();
      if (d.text) {
        text[d.text] = ['height', 'depth', 'angle', 'tool'].includes(d.text) ? Number(el.value) : el.value;
        guarded(changeText);
      } else if (d.repair) {
        const value = Number(el.value);
        if (value >= 0.00001 && value <= 1) tolerance = value;
        env.render();
      } else if (d.assign) {
        const model = env.selected();
        if (!model) return true;
        env.history.remember();
        if (d.assign === 'plate') {
          model.plate = el.value;
          delete model.position;
          s.ui.active_plate = el.value;
          leavePlate();
          env.history.placeFree(model);
        } else if (el.value) {
          model.process = el.value;
        } else {
          delete model.process;
        }
        env.update();
      } else if (d.upload) {
        const printer = uploadPrinter();
        if (d.upload === 'printer') upload.printer = el.value;
        else if (d.upload === 'kind') printer.host_type = el.value;
        else if (d.upload === 'address') printer.web_url = el.value.trim();
        else secrets.set(printer.id, el.value);
        env.update();
      } else {
        return false;
      }
      return true;
    },

    /** Klick aufs Modell im Text- oder Messwerkzeug. */
    pick(tool, hit) {
      if (tool === 'measure') {
        if (measuring.picks.length >= MODES[measuring.mode].picks) measuring.picks = [];
        measuring.picks.push({point: hit.snapped, normal: hit.worldNormal});
        measuring.result = measure(measuring.mode, measuring.picks);
        env.overlay({points: measuring.picks.map(p => p.point), line: measuring.result?.line});
        env.render();
        return;
      }
      const s = state();
      const model = s.models.find(m => m.id === hit.id);
      if (!model) return;
      if (text.owner !== model.id) text.index = null;
      s.ui.selected_model_id = model.id;
      guarded(async () => {
        await loadFonts();
        await putText(model, {point: hit.point, normal: hit.normal});
      });
    },

    toolChanged: clearMeasure,

    panel(tool) {
      const model = env.selected();
      if (tool === 'text') {
        loadFonts();
        if (text.index !== null && (model?.id !== text.owner || model?.volumes?.[text.index]?.shape !== 'text')) text.index = null;
        return renderTextPanel({model, text, fonts, tools: env.tools()});
      }
      if (tool === 'measure') return renderMeasurePanel(measuring);
      const saved = model && reports.get(model.id);
      return renderRepairPanel({model, report: saved && saved.path === model.path ? saved.report : null, tolerance});
    },

    printerSecret: id => secrets.get(id) || '',
    setPrinterSecret: (id, value) => secrets.set(id, value),

    uploadDialog() {
      const printer = uploadPrinter();
      return renderUploadDialog({
        printers: state().printers,
        printer,
        secret: secrets.get(printer?.id) || '',
        file: uploadFile(),
        busy: upload.busy,
        message: {text: upload.text, error: upload.error},
      });
    },
  };
}
