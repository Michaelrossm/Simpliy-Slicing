import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processModelDraft,applyProcessModelDraft} from '../frontend/process-dialog.js';
import {plateProcesses} from '../frontend/plate-plan.js';

test('process selection assigns each model across plates and feeds the slice planner',()=>{
 const processes=[{id:'a',name:'A'},{id:'b',name:'B'}];
 const models=[{id:'one',plate:'p1',process:'a'},{id:'two',plate:'p1',process:'b'},{id:'three',plate:'p2'}];
 const draft=processModelDraft(models,processes,'a');draft.one='b';draft.three='b';
 applyProcessModelDraft(models,processes,draft);
 assert.deepEqual(models.map(m=>m.process),['b','b','b']);
 assert.deepEqual(plateProcesses(models.filter(m=>m.plate==='p1'),processes,processes[0]),[processes[1]]);
});
test('invalid process assignment is rejected atomically',()=>{
 const models=[{id:'a',process:'one'},{id:'b',process:'one'}];
 assert.throws(()=>applyProcessModelDraft(models,[{id:'one'},{id:'two'}],{a:'two',b:'missing'}));
 assert.deepEqual(models.map(m=>m.process),['one','one']);
});
