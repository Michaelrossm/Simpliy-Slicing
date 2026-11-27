import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS,renderRail} from '../frontend/workbench.js';
test('all existing tool actions have coloured labelled icons and accessible names',()=>{
 const keys=['select','move','scale','rotate','flat','supports','section','paint','volumes','layers','cut','text','measure','repair','object','machine','view'];
 assert.deepEqual(TOOLS.map(t=>t[0]),keys);
 const html=renderRail('move',true);
 // Ansichten gibt es nur noch oben als Textleiste, nicht in der rechten Leiste.
 assert.ok(!html.includes('data-tool="view"'));
 for(const [key,name,svg] of TOOLS.filter(t=>t[0]!=='view')){assert.match(svg,/<svg/);assert.match(svg,/#(?:[a-f0-9]{6})/i);assert.ok(html.includes(`data-tool="${key}"`));assert.ok(html.includes(`aria-label="${name}"`));}
 assert.equal((html.match(/class="rail-label"/g)||[]).length,keys.length-1);
 assert.match(html,/data-tool="move"[^>]*aria-pressed="true"/);
 assert.equal((renderRail('move',false).match(/aria-pressed="true"/g)||[]).length,0);
});
