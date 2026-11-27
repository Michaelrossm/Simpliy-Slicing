// Favoriten-Reiter: Liste in state.favorites, Suchtext und Aktionen.
import {renderFavResults} from '../process-dialog.js';

/** env: {state (Getter), catalogByKey (Getter), update, byId} */
export function createFavoriteActions(env) {
  let search = '';
  let timer = 0;

  const actions = {
    'fav-add'({el}) {
      const state = env.state;
      state.favorites ??= [];
      if (!state.favorites.includes(el.dataset.key)) state.favorites.push(el.dataset.key);
      search = '';
      env.update();
    },
    'fav-remove'({el}) {
      env.state.favorites = (env.state.favorites || []).filter(k => k !== el.dataset.key);
      env.update();
    },
  };

  /** Live-Suche (input-Ereignis). Liefert true, wenn das Ereignis zu diesem Modul gehört. */
  function live(event) {
    if (event.target.dataset.live !== 'fav-search') return false;
    search = event.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const box = env.byId('fav-results');
      if (box) box.innerHTML = renderFavResults(search, env.catalogByKey, env.state.favorites || []);
    }, 90);
    return true;
  }

  return {actions, live, search: () => search};
}
