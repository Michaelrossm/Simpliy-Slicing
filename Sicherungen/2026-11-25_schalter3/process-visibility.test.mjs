import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../frontend/process-utils.js',import.meta.url),'utf8');
const {visibleProcesses}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('internal support processes stay stored but are hidden from the process list',()=>{
 const processes=[{id:'m',role:'model'},{id:'b',role:'support-body'},{id:'i',role:'support-interface'},{id:'p',role:'prusa-support'},{id:'legacy'}];
 assert.deepEqual(visibleProcesses(processes).map(p=>p.id),['m','legacy']);
 assert.equal(processes.length,5);
});
test('support catalog follows alpha14 enum instead of treating support mode as a boolean',()=>{
 const schema=JSON.parse(fs.readFileSync(new URL('../frontend/prusa-support-alpha14.json',import.meta.url),'utf8'));
 const setting=schema.find(x=>x.name==='support_material');
 assert.equal(setting.type,'Enum');assert.deepEqual(setting.enum_values,['none','enforcers_only','everywhere']);
});
