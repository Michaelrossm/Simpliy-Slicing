import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = async n => import('data:text/javascript;base64,' + fs.readFileSync(new URL('../frontend/' + n, import.meta.url)).toString('base64'));
const {LAYOUT, TABS} = await load('settings-layout.js');
const catalog = JSON.parse(fs.readFileSync(new URL('../frontend/engine-catalog.json', import.meta.url), 'utf8'));
const placed = TABS.flatMap(t => LAYOUT[t].pages.flatMap(p => p.groups.flatMap(g => g.rows.map(r => r.key))));
test('every engine parameter appears exactly once in the dialog', () => {
  assert.deepEqual(placed.filter((k, i) => placed.indexOf(k) !== i), [], 'duplicate');
  assert.deepEqual(catalog.map(c => c.key).filter(k => !placed.includes(k)), [], 'missing');
  assert.deepEqual(placed.filter(k => k !== 'nozzle_diameter' && !catalog.some(c => c.key === k)), [], 'unknown');
});
