/** Simpliy Slicing theme preferences. Presentation only; no effect on slicing data. */
const KEY = 'simpliy.theme.preference';
export const THEMES = Object.freeze(['system', 'dark', 'light', 'orange', 'midnight']);
let preference = null;

function storage() {
  try { return globalThis.localStorage; } catch { return null; }
}
function systemPrefersLight() {
  try { return !!globalThis.matchMedia?.('(prefers-color-scheme: light)').matches; }
  catch { return false; }
}

/** Defaults to the old Simpliy appearance, avoiding any surprise after upgrading. */
export function getThemePreference() {
  if (preference === null) {
    const stored = storage()?.getItem(KEY);
    preference = THEMES.includes(stored) ? stored : 'dark';
  }
  return preference;
}
export function resolvedTheme() {
  const theme = getThemePreference();
  return theme === 'system' ? (systemPrefersLight() ? 'light' : 'dark') : theme;
}
export function setThemePreference(theme) {
  if (!THEMES.includes(theme)) throw new Error('Unsupported Simpliy theme');
  preference = theme;
  try { storage()?.setItem(KEY, theme); } catch { /* storage is optional */ }
  applyTheme();
}
export function applyTheme() {
  const chosen = resolvedTheme();
  if (globalThis.document?.documentElement) {
    document.documentElement.setAttribute('data-simpliy-theme', chosen);
    document.documentElement.style.colorScheme = chosen === 'light' ? 'light' : 'dark';
  }
  return chosen;
}

let observing = false;
/** Follow changes to the Windows color scheme when the user selected System. */
export function watchSystemTheme() {
  if (observing || !globalThis.matchMedia) return;
  try {
    const media = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (getThemePreference() === 'system') applyTheme(); };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange); // older WebView2 fallback
    observing = true;
  } catch { /* Media query unavailable, keep dark fallback */ }
}
