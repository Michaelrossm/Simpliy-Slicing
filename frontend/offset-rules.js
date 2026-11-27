// Auto-Konfig-Offset-Regeln bearbeiten: reine Funktionen auf einer Regelliste (der Entwurf liegt im Prozess).
// Regel: {cat, option, enabled?, items: [{key, delta, enabled?}]}; Altformat: {cat, option, key, delta}.

/** Altformat verlustfrei auf `items` bringen. */
export function normalizeRule(rule) {
  rule.items ??= [{key: rule.key || '', delta: rule.delta || 0}];
  delete rule.key;
  delete rule.delta;
  return rule;
}

const matches = (rule, view) => rule.cat === view.cat && rule.option === view.option;

/**
 * Parameter einer Option holen; fehlt er, wird er (deaktiviert, mit `startDelta`) angelegt.
 * `view`: {cat, option}.
 */
export function itemFor(rules, view, key, startDelta = 0) {
  for (const rule of rules) {
    if (!matches(rule, view)) continue;
    const found = normalizeRule(rule).items.find(i => i.key === key);
    if (found) return found;
  }
  let rule = rules.find(r => matches(r, view));
  if (!rule) {
    rule = {cat: view.cat, option: view.option, items: []};
    rules.push(rule);
  }
  const item = {key, delta: startDelta, enabled: false};
  normalizeRule(rule).items.push(item);
  return item;
}

/** Alle Parameter einer Option (vorhandene plus `extraKeys`) an- oder ausschalten. Werte bleiben erhalten. */
export function setAllEnabled(rules, view, on, extraKeys = [], startDelta = () => 0) {
  const keys = new Set(extraKeys);
  for (const rule of rules) if (matches(rule, view)) for (const it of normalizeRule(rule).items) if (it.key) keys.add(it.key);
  for (const key of keys) itemFor(rules, view, key, startDelta(key)).enabled = on;
  if (on) for (const rule of rules) if (matches(rule, view)) rule.enabled = true;
}

/** Parameter einer Option entfernen. */
export function removeItem(rules, view, key) {
  for (const rule of rules) if (matches(rule, view)) normalizeRule(rule).items = rule.items.filter(i => i.key !== key);
}
