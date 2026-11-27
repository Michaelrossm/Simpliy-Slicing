// Profilverwaltung (aelterer Profildialog): Kategorien, Optionen, Basiswerte.
// Erzeugt aus dem frueheren Aktions-Schalter von app.js; Abhaengigkeiten kommen ausdruecklich ueber `env`.

/** env: siehe actionEnv in app.js. */
export function createProfileEditorActions(env) {
  const actions = {
    'new-profile': async ({proc}) => {
      const b = env.makeProfile();
      env.state.profiles.push(b);
      env.state.active_profile_id = b.manifest.profile_id;
      proc.profile_id = b.manifest.profile_id;
      env.editCat = '';
      env.editOpt = '';
      env.update();
    },
    'clone-profile': async ({proc, bundle}) => {
      const b = env.duplicateProfile(bundle);
      env.state.profiles.push(b);
      env.state.active_profile_id = b.manifest.profile_id;
      proc.profile_id = b.manifest.profile_id;
      env.update();
    },
    'remove-profile': async ({bundle, p}) => {
      if (env.state.profiles.length === 1) return env.notify('Mindestens ein Profil muss bleiben.', true);
      if (!(await env.confirmRemove(`Profil „${p.name}“ wirklich löschen?`))) return;
      env.state.profiles = env.state.profiles.filter((x) => x.manifest.profile_id !== bundle.manifest.profile_id);
      env.state.active_profile_id = env.state.profiles[0].manifest.profile_id;
      for (const process of env.state.processes) {
        if (process.profile_id === bundle.manifest.profile_id) process.profile_id = env.state.active_profile_id;
      }
      env.editCat = '';
      env.editOpt = '';
      env.update();
    },
    'edit-cat': async ({el, proc}) => {
      env.openModal('profile');
      env.state.active_profile_id = env.processProfile(proc).manifest.profile_id;
      env.profilePanel = 'auto';
      env.editCat = el.dataset.id;
      env.editOpt = '';
      env.render();
    },
    'edit-option-in-tabs': async ({proc}) => {
      const c = env.category(),
        o = env.option();
      if (!c || !o) return;
      proc.selections[c.id] = o.id;
      env.openProcess();
      env.settingEditTarget = `cat:${c.id}`;
      env.update();
    },
    'choose-cat': async ({el}) => {
      env.editCat = el.dataset.id;
      env.editOpt = '';
      env.render();
    },
    'choose-opt': async ({el}) => {
      env.editOpt = el.dataset.id;
      env.render();
    },
    'add-category': async ({proc}) => {
      env.state.active_profile_id = env.processProfile(proc).manifest.profile_id;
      env.addCategory();
    },
    'duplicate-category': async ({p}) => {
      const c = env.category();
      if (!c) return;
      const copy = env.clone(c);
      copy.id = env.id('cat');
      copy.name += ' – Kopie';
      copy.options = copy.options.map((o) => ({...o, id: env.id('opt')}));
      copy.selected = copy.options[0]?.id || '';
      p.categories.push(copy);
      p.category_order.push(copy.id);
      env.editCat = copy.id;
      env.editOpt = '';
      env.update();
    },
    'delete-category': async ({p}) => {
      const c = env.category();
      if (!c || !(await env.confirmRemove(`Kategorie „${c.name}“ löschen?`))) return;
      p.categories = p.categories.filter((x) => x.id !== c.id);
      p.category_order = p.category_order.filter((x) => x !== c.id);
      env.editCat = '';
      env.editOpt = '';
      env.update();
    },
    'move-category': async ({el, p}) => {
      const idx = p.category_order.indexOf(env.editCat),
        other = idx + Number(el.dataset.dir);
      if (idx < 0 || other < 0 || other >= p.category_order.length) return;
      [p.category_order[idx], p.category_order[other]] = [p.category_order[other], p.category_order[idx]];
      env.update();
    },
    'add-option': async () => {
      const c = env.category();
      if (!c) return;
      const o = {id: env.id('opt'), name: `Option ${c.options.length + 1}`, assignments: {}};
      c.options.push(o);
      if (!c.selected) c.selected = o.id;
      env.editOpt = o.id;
      env.update();
    },
    'duplicate-option': async () => {
      const c = env.category(),
        o = env.option();
      if (!c || !o) return;
      const copy = env.clone(o);
      copy.id = env.id('opt');
      copy.name += ' – Kopie';
      c.options.push(copy);
      env.editOpt = copy.id;
      env.update();
    },
    'delete-option': async () => {
      const c = env.category(),
        o = env.option();
      if (!c || !o || !(await env.confirmRemove(`Option „${o.name}“ löschen?`))) return;
      c.options = c.options.filter((x) => x.id !== o.id);
      if (c.selected === o.id) c.selected = c.options[0]?.id || '';
      env.editOpt = '';
      env.update();
    },
    'move-option': async ({el}) => {
      const c = env.category(),
        idx = c?.options.findIndex((x) => x.id === env.editOpt),
        other = idx + Number(el.dataset.dir);
      if (!c || idx < 0 || other < 0 || other >= c.options.length) return;
      [c.options[idx], c.options[other]] = [c.options[other], c.options[idx]];
      env.update();
    },
    'select-default-option': async () => {
      env.selectDefaultOption();
    },
    'add-assignment': async () => {
      const o = env.option(),
        key = env.$('#new-param-key')?.value.trim(),
        raw = env.$('#new-param-value')?.value;
      if (!o || !key) return env.notify('Bitte einen Parameternamen eingeben.', true);
      o.assignments[key] = env.parseValue(raw, env.catalogByKey.get(key)?.type);
      env.update();
    },
    'delete-assignment': async ({el}) => {
      const o = env.option();
      if (o) delete o.assignments[el.dataset.key];
      env.update();
    },
    'add-base': async ({p}) => {
      const key = env.$('#new-base-key')?.value.trim(),
        raw = env.$('#new-base-value')?.value;
      if (!key) return env.notify('Bitte einen Parameternamen eingeben.', true);
      p.base_parameters[key] = env.parseValue(raw, env.catalogByKey.get(key)?.type);
      env.update();
    },
    'delete-base': async ({el, p}) => {
      delete p.base_parameters[el.dataset.key];
      env.update();
    },
  };
  return {actions};
}
