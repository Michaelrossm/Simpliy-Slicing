import test from 'node:test';
import assert from 'node:assert/strict';
import {getLanguage,getLanguagePreference,setLanguagePreference,translate} from '../frontend/i18n.js';

test('manual German and English preferences', () => {
  setLanguagePreference('de');
  assert.equal(getLanguage(), 'de');
  assert.equal(translate('Speichern'), 'Speichern');
  setLanguagePreference('en');
  assert.equal(getLanguagePreference(), 'en');
  assert.equal(translate('Speichern'), 'Save');
  assert.equal(translate('  Neu '), '  New ');
  assert.equal(translate('ABS 260 °C'), 'ABS 260 °C');
});
test('unknown values and technical parameter keys are unchanged', () => {
  setLanguagePreference('en');
  assert.equal(translate('gcode_flavor'), 'gcode_flavor');
  assert.equal(translate('260 −5 → 255'), '260 −5 → 255');
  assert.equal(translate('M106 P1 S153'), 'M106 P1 S153');
});
