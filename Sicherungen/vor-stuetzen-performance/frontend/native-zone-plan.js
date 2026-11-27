// Simpliy: compile S3D-like process zones to native Prusa 3.x height-range VolumeSettings.
// All planning is pure; never modify the workspace or Prusa's profiles.
import {compileConfig, baseValues} from './engine-config.js';

const boxes = {print: 'print_settings', printer: 'printer_settings', filament: 'filament_settings'};
const equal = (a,b) => {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a-b) <= 1e-8;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a)!==Array.isArray(b)) return false;
  const keys=Object.keys(a); return keys.length===Object.keys(b).length && keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
};
const finite = (n) => typeof n==='number' && Number.isFinite(n);
const numeric = v => typeof v==='number' ? v : typeof v==='string' && v.trim()!=='' ? Number(v.replace(',','.')) : NaN;
const epsilon=1e-7;
// Werte, die die Engine nicht je Höhenbereich kennt, Simpliy aber nach dem Slicing im G-Code je Zone setzt (src-tauri/src/zonepost.rs).
export const POST_KEYS={temperature:'temperature',bed_temperature:'bedTemperature',min_fan_speed:'minFan',max_fan_speed:'maxFan',bridge_fan_speed:'bridgeFan',
  travel_speed:'travelSpeed',support_material_speed:'supportSpeed',support_material_interface_speed:'supportInterfaceSpeed',retract_speed:'retractSpeed',deretract_speed:'deretractSpeed',
  extrusion_multiplier:'extrusionMultiplier',pressure_advance_value:'pressureAdvance',default_acceleration:'defaultAcceleration',perimeter_acceleration:'perimeterAcceleration',
  external_perimeter_acceleration:'externalPerimeterAcceleration',infill_acceleration:'infillAcceleration',solid_infill_acceleration:'solidInfillAcceleration',
  top_solid_infill_acceleration:'topSolidInfillAcceleration',bridge_acceleration:'bridgeAcceleration'};
// Beschleunigungen brauchen einen Wert im Hauptprozess: Nach der Zone muss darauf zurückgeschaltet werden können (0 = Firmware-Standard).
const ACCELERATION=/_acceleration$/;
const postNumber=v=>{const raw=Array.isArray(v)?v[0]:v;const n=numeric(raw?.value??raw);return Number.isFinite(n)?n:undefined};
const featureTools=['perimeter_extruder','infill_extruder','solid_infill_extruder'];
// Global physical controls and object-level support parameters are not VolumeSettings.
const notLocal = key => key==='first_layer_height' || key==='post_process' || key.startsWith('support_') || key.startsWith('raft_');
const allowed = spec => spec?.box==='print' && spec.perVolume===true && !notLocal(spec.key);
const valueOf = (config,key,spec) => config.configuration?.[boxes[spec?.box]]?.[key];
const copy = v => structuredClone(v);
const cleanHeight = n => Math.round(n*1e8)/1e8;

/** Model intervals are in print Z, from zero to model top. Existing explicit layer-height ranges
 * survive outside zones. Where zones overlap, the last assigned zone is the complete winning
 * process; its settings do not accumulate from the overridden zone. No mutation on failure. */
export function planNativeZones({base, byKey, models, layers, zones, heightOf, tools=1, printerOf=()=>undefined}) {
  const result={ranges:new Map(), problems:[], unsupported:[], notes:[], count:0, post:new Map()};
  const compiled=new Map();
  const getLayer=(layer)=>{
    if (!layer?.process?.id) throw Error('Hauptprozess fehlt');
    if (!compiled.has(layer.process.id)) {
      const c=compileConfig(base,layer.values||{},byKey);
      if (c.errors.length) throw Error(c.errors.map(e=>`${e.key}: ${e.message}`).join('; '));
      compiled.set(layer.process.id,{...c,flat:baseValues(c.config),values:layer.values||{}});
    }
    return compiled.get(layer.process.id);
  };
  for (const model of models) {
    if (model.enabled===false || !model.zone_processes?.length) continue;
    const name=model.name||model.id;
    try {
      const main=layers.find(l=>l.process.id===model.mainProcessId);
      const mainC=getLayer(main);
      const height=numeric(heightOf(model));
      if (!finite(height)||height<=0) throw Error('Modellhöhe ist ungültig');
      const original=(model.ranges||[]).map((r,i)=>({from:numeric(r.from),to:numeric(r.to),height:numeric(r.height),i}));
      for (const r of original) if (!finite(r.from)||!finite(r.to)||!finite(r.height)||r.from<0||r.to<=r.from||r.height<=0) throw Error('Ungültiger vorhandener Schichthöhenbereich');
      original.sort((a,b)=>a.from-b.from);
      if (original.some((r,i)=>i>0&&r.from<original[i-1].to-epsilon)) throw Error('Vorhandene Schichthöhenbereiche überlappen');
      const entries=[];
      const mainTool=Number(model.tool||main.process.tool||0);
      for (const id of [...new Set(model.zone_processes)]) {
        const z=zones.find(l=>l.process.id===id);
        if (!z) throw Error(`Zonen-Prozess ${id} fehlt oder hat keinen aktiven Höhenbereich`);
        if (id===main.process.id) throw Error('Hauptprozess darf nicht zugleich Zone desselben Modells sein');
        const p=z.process, bounds=p.zone||{};
        const from=bounds.fromOn ? numeric(bounds.from) : 0;
        const to=bounds.toOn ? numeric(bounds.to) : height;
        if (!finite(from)||!finite(to)||from<0||to<=from) throw Error(`Zone „${p.name}“: ungültige Höhenbegrenzung`);
        if (from>=height-epsilon) throw Error(`Zone „${p.name}“ beginnt oberhalb des Modells`);
        const end=Math.min(to,height);
        if (end<to-epsilon) result.notes.push(`${name}: Zone „${p.name}“ endet an der Modelloberkante (${height.toFixed(3)} mm).`);
        if (printerOf(p)!==printerOf(main.process)) throw Error(`Zone „${p.name}“ verwendet einen anderen Drucker`);
        const zc=getLayer(z);
        const settings={};
        const postValues={};
        const unsupported=[];
        for (const [key,spec] of byKey) {
          const a=valueOf(mainC.config,key,spec), b=valueOf(zc.config,key,spec);
          if (equal(a,b)) continue;
          if (allowed(spec) && b!==undefined && b!==null) {
            if (key!=='layer_height') settings[key]=copy(b);
          } else if (POST_KEYS[key] && postNumber(b)!==undefined && (!ACCELERATION.test(key) || (postNumber(a)>0 && postNumber(b)>0))) postValues[POST_KEYS[key]]=postNumber(b);
          else unsupported.push(key);
        }
        // Nozzle diameter is represented in hardware configuration rather than print_settings.
        if (!equal(mainC.flat.nozzle_diameter,zc.flat.nozzle_diameter)) unsupported.push('nozzle_diameter');
        // Compare non-engine / ignored values too: a zone must never silently drop a setting.
        const ignored=new Set([...mainC.ignored,...zc.ignored].map(x=>x.key));
        for (const key of ignored) {
          if (equal(mainC.values[key],zc.values[key])) continue;
          if (key==='support_material_auto'||key==='printer_technology'||key==='extrusion_axis') continue;
          unsupported.push(key);
        }
        // A tool change is a native region assignment, not a global temperature change.
        const target=Number(p.tool||mainTool||0);
        if (!Number.isInteger(target)||target<0||target>tools) throw Error(`Zone „${p.name}“: Werkzeug T${target-1} fehlt`);
        if (target!==mainTool && target>0) {
          for (const key of featureTools) {
            if (!allowed(byKey.get(key))) {unsupported.push(key);continue;}
            if (!Object.hasOwn(settings,key)) settings[key]=target;
          }
        }
        const h=zc.config.configuration?.print_settings?.layer_height;
        if (!finite(h)||h<=0) throw Error(`Zone „${p.name}“: ungültige Schichthöhe`);
        if (unsupported.length) result.unsupported.push({model:name,zone:p.name,keys:[...new Set(unsupported)].sort()});
        entries.push({from:cleanHeight(from),to:cleanHeight(end),height:h,settings,zone:p.name,post:postValues});
      }
      const boundaries=[...new Set([0,cleanHeight(height),...entries.flatMap(r=>[r.from,r.to]),...original.flatMap(r=>[cleanHeight(Math.min(r.from,height)),cleanHeight(Math.min(r.to,height))])])].sort((a,b)=>a-b);
      const out=[];
      let overlapped=false;
      for(let i=1;i<boundaries.length;i++) {
        const from=boundaries[i-1],to=boundaries[i]; if (to-from<=epsilon) continue;
        const middle=(from+to)/2;
        const candidates=entries.filter(r=>middle>=r.from&&middle<r.to);
        const win=candidates.at(-1);
        const existing=original.find(r=>middle>=r.from&&middle<r.to);
        if (candidates.length>1) overlapped=true;
        if (!win&&!existing) continue;
        const r={from,to,height:win?.height??existing.height,settings:copy(win?.settings||{})};
        const last=out.at(-1);
        if(last&&Math.abs(last.to-r.from)<=epsilon&&equal(last.height,r.height)&&equal(last.settings,r.settings)) last.to=r.to;
        else out.push(r);
      }
      if(overlapped) result.notes.push(`${name}: Überlappende Zonen – zuletzt in der Modellzuordnung eingetragener Zonen-Prozess hat Vorrang.`);
      result.ranges.set(model.id,out);
      if (entries.some(e=>Object.keys(e.post).length)) {
        const base={};
        for (const [key,field] of Object.entries(POST_KEYS)) { const spec=byKey.get(key); const v=postNumber(valueOf(mainC.config,key,spec)); if (v!==undefined) base[field]=v; }
        result.post.set(model.id,{base,baseTemperatures:(()=>{const t=mainC.config.configuration?.filament_settings?.temperature;return Array.isArray(t)?t.map(postNumber).filter(Number.isFinite):[]})(),
          zones:entries.filter(e=>Object.keys(e.post).length).map(e=>({from:e.from,to:e.to,name:e.zone,values:e.post}))});
      }
      result.count+=entries.length;
    } catch(e) {result.problems.push(`${name}: ${e.message||e}`);}
  }
  return result;
}

/** Grenzen, die schon die Engine einhält und die Zonenwerte nicht aushebeln dürfen (siehe zonepost::Limits). */
export function postLimits(config) {
  const c=config?.configuration||{},printer=c.printer_settings||{},print=c.print_settings||{},filament=c.filament_settings||{};
  const first=v=>{const raw=Array.isArray(v)?v[0]:v;const n=numeric(raw?.value??raw);return Number.isFinite(n)&&n>0?n:undefined};
  const smaller=(a,b)=>a===undefined?b:b===undefined?a:Math.min(a,b);
  const limits={};
  const xy=smaller(first(printer.machine_max_feedrate_x),first(printer.machine_max_feedrate_y));
  if(xy!==undefined)limits.maxFeedXy=xy;
  const e=first(printer.machine_max_feedrate_e);if(e!==undefined)limits.maxFeedE=e;
  const accel=first(printer.machine_max_acceleration_extruding);if(accel!==undefined)limits.maxAccel=accel;
  const vol=smaller(first(print.max_volumetric_speed),first(filament.filament_max_volumetric_speed));if(vol!==undefined)limits.maxVolumetric=vol;
  const cooling=[true,1,'1','true'].includes(Array.isArray(filament.cooling)?filament.cooling[0]:filament.cooling);
  const layerTime=first(filament.slowdown_below_layer_time);if(cooling&&layerTime!==undefined)limits.minLayerTime=layerTime;
  return limits;
}

/** Zonenwerte für die G-Code-Nachbearbeitung (Rust: zonepost). Objektnummer = Reihenfolge der Modelle im Auftrag. */
export function zonePostFor(job,plan) {
  const ids=job.models.map(m=>m.id);
  const objects=[];let base=null,baseTemperatures=[];
  for (const [id,entry] of plan.post) {
    const index=ids.indexOf(id);
    if (index<0) continue;
    if (base && !equal(base,entry.base)) throw Error('Die Hauptprozesse der Modelle mit Zonen unterscheiden sich in Temperatur-, Lüfter- oder Geschwindigkeitswerten. Bitte angleichen, damit die Zonenwerte eindeutig sind.');
    base=entry.base;baseTemperatures=entry.baseTemperatures;
    objects.push({index,name:job.models[index].name||id,zones:entry.zones});
  }
  return objects.length?{base:base||{},baseTemperatures,objects,limits:postLimits(job.config),flavor:String(job.config?.configuration?.printer_settings?.gcode_flavor||'')}:null;
}

/** Commit all compiled ranges to temporary job; mirror heights into support planner. */
export function applyNativeZones(job,plan) {
  if(plan.problems.length||plan.unsupported.length) throw Error('Nicht vollständig abbildbare Prozesszonen');
  for(const model of job.models) if(plan.ranges.has(model.id)) model.ranges=copy(plan.ranges.get(model.id));
  for(const model of job.supportPlate?.models||[]) if(plan.ranges.has(model.id)) {
    model.rangeHeights=plan.ranges.get(model.id).map(r=>r.height);
    model.rangeSpans=plan.ranges.get(model.id).map(r=>[r.from,r.to,r.height]);
  }
  return job;
}

/** Preserve legacy handling of selected non-native print/material controls only.
 * Never accept hardware, firmware, tool topology, user scripts or unknown settings. */
export function canUseLegacyZoneFallback(plan,byKey) {
  const special=new Set(['simpliy.fans','simpliy.temps','temperature','bed_temperature','chamber_temperature','min_fan_speed','max_fan_speed','fan_always_on','cooling','disable_fan_first_layers','full_fan_speed_layer']);
  return !plan.problems.length&&plan.unsupported.length>0&&plan.unsupported.every(z=>z.keys.every(key=>{
    if(special.has(key))return true;
    const spec=byKey.get(key);
    return spec?.box==='print'&&!notLocal(key)&&!/(?:gcode|script|wipe|tower|complete_objects|spiral_vase|extruder|tool|skirt|brim|first_layer)/i.test(key);
  }));
}
