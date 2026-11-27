// Dialog „Modelle für Prozesse auswählen“: Hauptprozess je Modell und zusätzliche Zonen-Prozesse.
// Das Modul besitzt die beiden Entwürfe (Hauptprozess-Wahl, Zonen-Haken); „Übernehmen“ schreibt sie in die Modelle.
import {esc, processModelDraft, applyProcessModelDraft} from '../process-dialog.js';
import {zoneActive} from '../zone-plan.js';

/** env: {state (Getter), notify, render, update, openModal, closeModal, shell, activeProcess, visibleProcesses} */
export function createAssignmentActions(env) {
  let selection = null; // Modell-Id -> Hauptprozess-Id (Entwurf)
  let zoneChoice = null; // Modell-Id -> [Zonen-Prozess-Ids] (Entwurf)

  function renderDialog() {
    const state = env.state;
    const procs = env.visibleProcesses(state.processes);
    const proc = env.activeProcess();
    const zoned = procs.filter(zoneActive);
    const rows = state.models.map(m => {
      const plate = state.plates.find(p => p.id === m.plate);
      const options = procs.map(p => `<option value="${esc(p.id)}" ${selection[m.id] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
      const boxes = zoned.filter(p => p.id !== selection[m.id])
        .map(p => `<label class="check"><input type="checkbox" data-zone-assign="${esc(m.id)}|${esc(p.id)}" ${(zoneChoice?.[m.id] || []).includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join(' ');
      return `<tr><td>${esc(m.name)}</td><td>${esc(plate?.name || '')}</td><td><select data-process-model="${esc(m.id)}">${options}</select></td><td>${boxes || '<span class="meta">Kein Prozess mit Z-Bereich</span>'}</td></tr>`;
    }).join('');
    return env.shell('Modelle fuer Prozesse auswaehlen', `Aktiver Prozess: ${esc(proc.name)}`,
      `<p>Jedes Modell hat einen Hauptprozess. Prozesse mit Z-Bereich (Benutzerdefinierte Zonen) kannst du zusätzlich auf ein Modell legen: Sie drucken dann nur in ihrem Bereich, der Rest kommt vom Hauptprozess. Waehle den Hauptprozess je Modell; bei einer Aenderung wird das Modell dem bisherigen Prozess entzogen. Modelle auf allen Platten werden angezeigt.</p>${rows ? `<table class="assign-table"><thead><tr><th>Modell</th><th>Platte</th><th>Prozess</th><th>Zusätzlich nach Z-Bereich</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Es sind noch keine Modelle geladen.</p>'}`,
      '<button data-action="apply-process-models" class="primary">Uebernehmen</button>');
  }

  const actions = {
    'process-models'({proc}) {
      const state = env.state;
      zoneChoice = Object.fromEntries(state.models.map(m => [m.id, [...(m.zone_processes || [])]]));
      selection = processModelDraft(state.models, env.visibleProcesses(state.processes), proc.id);
      env.openModal('process-models');
      env.render();
    },
    'apply-process-models'() {
      const state = env.state;
      const procs = env.visibleProcesses(state.processes);
      try {
        applyProcessModelDraft(state.models, procs, selection);
      } catch (error) {
        env.notify(error.message, true);
        return;
      }
      for (const m of state.models) {
        const ids = (zoneChoice?.[m.id] || []).filter(id => id !== m.process && procs.some(p => p.id === id && zoneActive(p)));
        if (ids.length) m.zone_processes = ids;
        else delete m.zone_processes;
      }
      zoneChoice = null;
      selection = null;
      env.closeModal();
      env.update();
    },
  };

  /** Änderungen im Dialog. Liefert true, wenn das Ereignis zu diesem Modul gehört. */
  function change(el) {
    if (el.dataset.zoneAssign !== undefined && zoneChoice) {
      const [modelId, processId] = el.dataset.zoneAssign.split('|');
      const list = (zoneChoice[modelId] ??= []);
      const at = list.indexOf(processId);
      if (el.checked && at < 0) list.push(processId);
      if (!el.checked && at >= 0) list.splice(at, 1);
      return true;
    }
    if (el.dataset.processModel !== undefined) {
      if (selection && env.visibleProcesses(env.state.processes).some(p => p.id === el.value)) {
        selection[el.dataset.processModel] = el.value;
        env.render();
      }
      return true;
    }
    return false;
  }

  /** Nur für Tests: Hauptprozess-Wahl im offenen Dialog setzen. */
  const select = (modelId, processId) => { selection[modelId] = processId; };

  return {actions, change, renderDialog, select};
}
