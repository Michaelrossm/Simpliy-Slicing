import test from 'node:test';
import assert from 'node:assert/strict';
import {planNativeZones,applyNativeZones,canUseLegacyZoneFallback} from '../frontend/native-zone-plan.js';

const spec=(key,type,perVolume=true,box='print',extra={})=>({key,type,box,perVolume,...extra});
const specs=[spec('layer_height','Float'),spec('first_layer_height','FloatOrPercentage',false),spec('perimeters','Int'),spec('fill_density','Percentage'),spec('infill_speed','Float'),spec('perimeter_speed','Float'),spec('fill_pattern','Enum',true,'print',{options:[{value:'gyroid'},{value:'rectilinear'}]}),spec('perimeter_extruder','Int'),spec('infill_extruder','Int'),spec('solid_infill_extruder','Int'),spec('support_material','Enum',false,'print',{options:[{value:'none'},{value:'everywhere'},{value:'enforcers_only'}]}),spec('temperature','Int',false,'filament'),spec('gcode_flavor','Enum',false,'printer',{options:[{value:'marlin2'},{value:'klipper'}]})];
const byKey=new Map(specs.map(s=>[s.key,s]));
const base={configuration:{print_settings:{layer_height:.2,first_layer_height:{value:.2,is_percent:false},perimeters:2,fill_density:{value:15,is_percent:true},infill_speed:60,perimeter_speed:40,fill_pattern:'gyroid',perimeter_extruder:0,infill_extruder:0,solid_infill_extruder:0,support_material:'none'},printer_settings:{gcode_flavor:'marlin2'},filament_settings:{temperature:[205,210]}},preset:{hw_config:{tools:{a:{features:{nozzle_diameter:.4}},b:{features:{nozzle_diameter:.4}}}}}};
const main=(values={},tool=0)=>({process:{id:'main',name:'Haupt',tool},values});
const zone=(id,from,to,values={},tool=0)=>({process:{id,name:id,tool,zone:{fromOn:from!==null,from,toOn:to!==null,to}},values});
const model=(id,zone_processes=['fine'],extra={})=>({id,name:id,mainProcessId:'main',zone_processes,...extra});
const plan=(options={})=>planNativeZones({base,byKey,models:[model('a')],layers:[main()],zones:[zone('fine',5,10,{layer_height:.1,perimeters:4,fill_density:70})],heightOf:()=>20,tools:2,...options});

test('native mixed heights, walls and percentage infill',()=>{
 const p=plan(); assert.deepEqual(p.problems,[]);assert.deepEqual(p.unsupported,[]);assert.deepEqual(p.ranges.get('a'),[{from:5,to:10,height:.1,settings:{perimeters:4,fill_density:{value:70,is_percent:true}}}]);
});
test('multiple models use independent zones; own support rangeHeights only',()=>{
 const p=plan({models:[model('a'),model('b',['fast']),model('disabled',['missing'],{enabled:false})],zones:[zone('fine',5,10,{layer_height:.1}),zone('fast',0,8,{infill_speed:100,perimeters:3})]});
 assert.equal(p.count,2);assert.deepEqual(p.problems,[]);assert.equal(p.ranges.get('b')[0].settings.infill_speed,100);assert.equal(p.ranges.has('disabled'),false);
 const job={models:[{id:'a',ranges:[]},{id:'b',ranges:[]}],supportPlate:{models:[{id:'a',rangeHeights:[],stored:{x:1}}]},parts:[]};
 applyNativeZones(job,p);assert.deepEqual(job.supportPlate.models[0].rangeHeights,[.1]);assert.deepEqual(job.supportPlate.models[0].stored,{x:1});assert.equal(job.models[1].ranges[0].settings.perimeters,3);
});
test('open limits use actual top; explicit overshoot is noted',()=>{
 let p=plan({zones:[zone('fine',null,null,{layer_height:.12})]});assert.deepEqual(p.ranges.get('a'),[{from:0,to:20,height:.12,settings:{}}]);
 p=plan({zones:[zone('fine',10,30,{perimeters:5})]});assert.equal(p.ranges.get('a')[0].to,20);assert.match(p.notes[0],/Modelloberkante/);
});
test('existing layer ranges survive outside; last zone wins on overlap, no compounded process values',()=>{
 const p=plan({models:[model('a',['fine','last'],{ranges:[{from:0,to:15,height:.15}]})],zones:[zone('fine',5,12,{layer_height:.1,perimeters:4}),zone('last',10,18,{layer_height:.25,infill_speed:90})]});
 assert.deepEqual(p.ranges.get('a'),[{from:0,to:5,height:.15,settings:{}},{from:5,to:10,height:.1,settings:{perimeters:4}},{from:10,to:18,height:.25,settings:{infill_speed:90}}]);assert.match(p.notes[0],/Überlappende/);
});
test('two tools: explicit zone tool maps to native feature extruders',()=>{
 const p=plan({layers:[main({},1)],zones:[zone('fine',5,10,{fill_density:50},2)]});assert.deepEqual(p.unsupported,[]);const s=p.ranges.get('a')[0].settings;for(const key of ['perimeter_extruder','infill_extruder','solid_infill_extruder'])assert.equal(s[key],2);
});
test('Temperatur je Zone wird nicht mehr gesperrt, sondern für die G-Code-Nachbearbeitung vorgemerkt',()=>{
 const p=plan({zones:[zone('fine',5,10,{temperature:[220,230],perimeters:4})]});
 assert.deepEqual(p.unsupported,[]);
 const entry=p.post.get('a');assert.equal(entry.zones[0].values.temperature,220);assert.equal(entry.base.temperature,205);
 assert.equal(p.ranges.get('a')[0].settings.perimeters,4,'native Werte bleiben nativ');
});
test('firmware, nozzle, unknown settings and support settings do not enter fallback',()=>{
 for(const values of [{gcode_flavor:'klipper'},{nozzle_diameter:.6},{'simpliy.unknown':1},{support_material:'everywhere'}]){const p=plan({zones:[zone('fine',5,10,values)]});assert.ok(p.unsupported.length);assert.equal(canUseLegacyZoneFallback(p,byKey),false);}
});
test('native supports unchanged across zones: no blanket prohibition',()=>{
 const p=plan({layers:[main({support_material:'everywhere'})],zones:[zone('fine',5,10,{support_material:'everywhere',perimeters:5,layer_height:.1})]});assert.deepEqual(p.unsupported,[]);assert.equal(p.ranges.get('a')[0].height,.1);
});
test('bad limits, nonexistent assignments, missing tool and invalid settings fail',()=>{
 for(const z of [zone('fine',21,30,{}),zone('fine',8,3,{}),zone('fine',5,10,{layer_height:'abc'}),zone('fine',5,10,{},3)])assert.ok(plan({zones:[z]}).problems.length);
 assert.ok(plan({zones:[]}).problems.length);
 assert.ok(plan({printerOf:p=>p.id}).problems.length);
});
test('no-op zones and adjacent equivalent segments are merged deterministically',()=>{
 const p=plan({models:[model('a',['fine','other'])],zones:[zone('fine',1,4,{perimeters:3}),zone('other',4,8,{perimeters:3})]});assert.deepEqual(p.ranges.get('a'),[{from:1,to:8,height:.2,settings:{perimeters:3}}]);
});
test('different model global base is not confused with per-process differences',()=>{
 const p=plan({models:[model('a')],layers:[main({perimeters:5,fill_density:50})],zones:[zone('fine',5,10,{perimeters:2,fill_density:15})]});assert.deepEqual(p.ranges.get('a')[0].settings,{perimeters:2,fill_density:{value:15,is_percent:true}});
});

import {POST_KEYS, zonePostFor} from '../frontend/native-zone-plan.js';

test('Zonenwerte für die Nachbearbeitung: Objektnummer aus der Auftragsreihenfolge, Hauptprozesse müssen gleich sein', () => {
  const job = {models: [{id: 'a', name: 'A'}, {id: 'b', name: 'B'}]};
  const entry = temp => ({base: {temperature: 210}, baseTemperatures: [210], zones: [{from: 5, to: 10, name: 'z', values: {temperature: temp}}]});
  const plan = {post: new Map([['b', entry(240)]])};
  const post = zonePostFor(job, plan);
  assert.equal(post.objects[0].index, 1);
  assert.equal(post.objects[0].zones[0].values.temperature, 240);
  const mixed = {post: new Map([['a', entry(240)], ['b', {...entry(240), base: {temperature: 200}}]])};
  assert.throws(() => zonePostFor(job, mixed), /Hauptprozesse/);
  assert.equal(zonePostFor(job, {post: new Map()}), null);
  assert.equal(POST_KEYS.bed_temperature, 'bedTemperature');
});

import {postLimits} from '../frontend/native-zone-plan.js';

test('Grenzen der Engine für die Nachbearbeitung: Maschinenlimits, kleinster Volumenstrom, Kühlzeit nur mit Kühlung', () => {
  const config = {configuration: {printer_settings: {machine_max_feedrate_x: [200, 100], machine_max_feedrate_y: [150, 100], machine_max_feedrate_e: [60, 60]},
    print_settings: {max_volumetric_speed: 15}, filament_settings: {filament_max_volumetric_speed: [11], cooling: [true], slowdown_below_layer_time: [8]}}};
  assert.deepEqual(postLimits(config), {maxFeedXy: 150, maxFeedE: 60, maxVolumetric: 11, minLayerTime: 8});
  config.configuration.filament_settings.cooling = [false];
  assert.equal(postLimits(config).minLayerTime, undefined);
});

test('Flow und Beschleunigung je Zone: Beschleunigung nur mit Wert im Hauptprozess, Flow immer', () => {
  const extra = [spec('extrusion_multiplier', 'Float', false, 'filament'), spec('perimeter_acceleration', 'Float', false, 'print')];
  const specs2 = new Map([...byKey, ...extra.map(s => [s.key, s])]);
  const cfg = JSON.parse(JSON.stringify(base));
  cfg.configuration.filament_settings.extrusion_multiplier = [1];
  cfg.configuration.print_settings.perimeter_acceleration = 0;
  const run = values => planNativeZones({base: cfg, byKey: specs2, models: [model('a')], layers: [main()], zones: [zone('fine', 5, 10, values)], heightOf: () => 20, tools: 2});
  const flow = run({extrusion_multiplier: [0.9]});
  assert.deepEqual(flow.unsupported, []);
  assert.equal(flow.post.get('a').zones[0].values.extrusionMultiplier, 0.9);
  const accel = run({perimeter_acceleration: 2000});
  assert.equal(accel.unsupported[0]?.keys.includes('perimeter_acceleration'), true, 'ohne Hauptwert nicht sicher zurückschaltbar');
});
