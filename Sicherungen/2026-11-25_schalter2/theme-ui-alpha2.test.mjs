import test from 'node:test';
import assert from 'node:assert/strict';
import {getThemePreference,resolvedTheme,setThemePreference,applyTheme,THEMES} from '../frontend/themes.js';

test('theme choices and persisted preference do not change slicing data', () => {
  const processValues = {temperature: 260, gcode_flavor: 'reprapfirmware'};
  assert.deepEqual(THEMES, ['system','dark','light','orange','midnight']);
  for (const theme of THEMES) {
    setThemePreference(theme);
    assert.equal(getThemePreference(), theme);
    assert.equal(typeof applyTheme(), 'string');
  }
  assert.deepEqual(processValues, {temperature:260,gcode_flavor:'reprapfirmware'});
});
test('the legacy classic dark theme remains available', () => {
  setThemePreference('dark');
  assert.equal(resolvedTheme(), 'dark');
  setThemePreference('orange');
  assert.equal(resolvedTheme(), 'orange');
  setThemePreference('light');
  assert.equal(resolvedTheme(), 'light');
});
test('invalid themes are rejected', () => {
  assert.throws(() => setThemePreference('invalid'), /Unsupported/);
});
