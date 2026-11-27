// Alpha 2: Safe serial machine monitor; intentionally does NOT offer USB printing,
// jogging, homing, heating, or arbitrary G-code execution until hardware QA.
const safe = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const BAUD = [115200, 250000, 57600, 230400, 9600, 500000];
const QUERIES = [
  ['M105', 'Temperatur'],
  ['M114', 'Achsenposition'],
  ['M115', 'Firmware'],
  ['M27', 'SD-Druckfortschritt'],
];

function temperature(value, target) {
  return Number.isFinite(value)
    ? `${Number(value).toFixed(1)} °C` + (Number.isFinite(target) ? ` / ${Number(target).toFixed(1)} °C Soll` : '')
    : '–';
}

export function createSerialPanel({invoke, rerender, visible}) {
  let ports = [], selectedPort = '', selectedBaud = 115200;
  let status = {connected:false, log:[], lastError:''};
  let busy = false, error = '';
  let refreshInProgress = false;
  let timer = null;

  async function loadPorts() {
    try {
      ports = await invoke('serial_ports');
      if (selectedPort && !ports.some(x => x.name === selectedPort)) selectedPort = '';
      error = '';
    } catch (e) { error = String(e); }
  }
  async function loadStatus() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    try { status = await invoke('serial_snapshot'); }
    catch (e) { error = String(e); }
    finally { refreshInProgress = false; }
  }
  function summary() {
    return `<div class="serial-summary" id="serial-summary">
      <div><span>Verbindung</span><b data-serial-stat="connection">${status.connected ? 'Verbunden' : 'Getrennt'}</b></div>
      <div><span>Düse</span><b data-serial-stat="nozzle">${safe(temperature(status.nozzle,status.nozzleTarget))}</b></div>
      <div><span>Druckbett</span><b data-serial-stat="bed">${safe(temperature(status.bed,status.bedTarget))}</b></div>
      <div><span>SD-Fortschritt</span><b data-serial-stat="progress">${Number.isFinite(status.sdProgress) ? `${status.sdProgress.toFixed(1)} %` : '–'}</b></div>
    </div>`;
  }
  function render() {
    return `<div class="serial-monitor">
      <p class="hint">Alpha 2: serieller Monitor, kein G-Code-Druck über USB. Nur ungefährliche Abfragen (M105, M114, M115, M27). Das Öffnen eines COM-Ports kann manche Drucker-Controller neu starten.</p>
      <div class="serial-connect-row">
        <label>COM-Port <select id="serial-port" ${status.connected?'disabled':''}>
          <option value="">Port auswählen …</option>${ports.map(p=>`<option value="${safe(p.name)}" ${selectedPort===p.name?'selected':''}>${safe(p.name)} – ${safe(p.description)}</option>`).join('')}
        </select></label>
        <label>Baudrate <select id="serial-baud" ${status.connected?'disabled':''}>
          ${BAUD.map(b=>`<option value="${b}" ${selectedBaud===b?'selected':''}>${b}</option>`).join('')}
        </select></label>
        <button data-action="serial-refresh" ${busy?'disabled':''}>Ports suchen</button>
        ${status.connected ? '<button data-action="serial-disconnect">Trennen</button>' : `<button class="primary" data-action="serial-connect" ${busy?'disabled':''}>Verbinden</button>`}
      </div>
      ${summary()}
      <div class="serial-buttons">${QUERIES.map(([command,label])=>`<button data-action="serial-query" data-command="${command}" ${status.connected&&!busy?'':'disabled'}>${safe(label)} (${command})</button>`).join('')}</div>
      <div class="serial-info"><span>Firmware:</span> <span data-serial-stat="firmware">${safe(status.firmware||'–')}</span></div>
      <div class="serial-info"><span>Position:</span> <span data-serial-stat="position">${safe(status.position||'–')}</span></div>
      <div class="serial-error" data-serial-stat="error">${safe(error||status.lastError||'')}</div>
      <label class="serial-log-label">Empfangene Antworten und Abfragen (letzte 60 Zeilen)</label>
      <pre class="serial-log" id="serial-log">${safe((status.log||[]).join('\n'))}</pre>
      <p class="muted">Wichtig: Ein SD-Fortschritt ist nicht der Fortschritt eines vom PC gestreamten Drucks. Klipper und RepRapFirmware melden Status zum Teil anders; für Duet ist Netzwerksteuerung meist die bessere Wahl.</p>
    </div>`;
  }
  function setStat(key, value) {
    const element = document.querySelector(`[data-serial-stat="${key}"]`);
    if (element) element.textContent = value;
  }
  function repaintStatus() {
    if (!visible()) return;
    const connection = document.querySelector('[data-serial-stat="connection"]');
    if (!connection) return;
    setStat('connection', status.connected ? 'Verbunden' : 'Getrennt');
    setStat('nozzle', temperature(status.nozzle,status.nozzleTarget));
    setStat('bed', temperature(status.bed,status.bedTarget));
    setStat('progress', Number.isFinite(status.sdProgress)?`${status.sdProgress.toFixed(1)} %`:'–');
    setStat('firmware', status.firmware||'–');
    setStat('position', status.position||'–');
    setStat('error', error||status.lastError||'');
    const log = document.getElementById('serial-log');
    if (log) {
      const previous = log.textContent;
      const next = (status.log||[]).join('\n');
      if (previous!==next) { const atEnd = log.scrollTop+log.clientHeight >= log.scrollHeight-12; log.textContent=next; if(atEnd)log.scrollTop=log.scrollHeight; }
    }
    // If USB connection dropped, re-render controls to show Connect instead of Disconnect.
    const disconnectButton=document.querySelector('[data-action="serial-disconnect"]');
    if (disconnectButton && !status.connected) rerender();
  }
  async function open() {
    await Promise.all([loadPorts(),loadStatus()]);
    rerender();
    if (!timer) {
      timer=setInterval(async()=>{if (!visible()||refreshInProgress) return; await loadStatus();repaintStatus();},1800);
      timer?.unref?.(); // Node-based tests; browser timers are numeric and unaffected.
    }
  }
  async function action(action, el) {
    if (!action.startsWith('serial-')) return false;
    if (busy) return true;
    busy = true;
    try {
      if (action === 'serial-refresh') await loadPorts();
      else if (action === 'serial-connect') {
        selectedPort = document.querySelector('#serial-port')?.value || '';
        selectedBaud = Number(document.querySelector('#serial-baud')?.value||115200);
        if (!selectedPort) throw Error('Bitte einen COM-Port auswählen.');
        status = await invoke('serial_connect',{port:selectedPort,baud:selectedBaud});
        error = '';
      } else if (action === 'serial-disconnect') {
        status = await invoke('serial_disconnect');
        error = '';
      } else if (action === 'serial-query') {
        const command = el.dataset.command;
        if (!QUERIES.some(([q])=>q===command)) throw Error('Abfrage nicht zulässig');
        await invoke('serial_query',{command});
      }
      await loadStatus();
    } catch (e) { error = String(e); }
    finally { busy=false;rerender(); }
    return true;
  }
  return {render,open,action};
}
