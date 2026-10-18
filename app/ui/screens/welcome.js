// Welcome: pick a profile, or make one. On a device with progress from the
// old app, the names found in the data are offered as "Profil gefunden".
import { el, mount, append } from '../dom.js';
import { horizon } from '../horizon.js';
import { listProfiles, detectLegacyProfiles, legacyCustomProfiles, legacyLastProfile, saveProfile, setCurrentProfile, keyFromName, validKey, AVATARS, GRADES } from '../../core/profiles.js';

export function renderWelcome(root, ctx, params = {}) {
  const { i18n, store } = ctx;
  const profiles = listProfiles(store);
  const found = detectLegacyProfiles(store);
  const custom = legacyCustomProfiles(store).filter(c => !profiles.some(p => p.key === c.key) && !found.some(f => f.key === c.key));
  const hintKey = legacyLastProfile(store);

  const col = el('div', { class: 'col welcome enter' });
  col.appendChild(el('div', { class: 'brand' }, i18n.t('app.name')));

  if (params.form) {
    col.appendChild(renderForm(ctx, params.form, () => ctx.go('home'), () => ctx.go('welcome')));
  } else {
    col.appendChild(el('h1', {}, i18n.t('welcome.who')));
    const row = el('div', { class: 'avatars' });
    for (const p of profiles) {
      row.appendChild(el('button', { class: `avatar${p.key === hintKey ? ' selected' : ''}`, type: 'button', onClick: () => { setCurrentProfile(store, p.key); ctx.go('home'); } },
        el('span', { class: 'disc' }, p.avatar || AVATARS[0]), el('span', { class: 'name' }, p.name)));
    }
    for (const f of [...found.map(f => ({ key: f.key, name: f.key, avatar: '🌱' })), ...custom]) {
      row.appendChild(el('button', { class: 'avatar found', type: 'button', title: i18n.t('welcome.found.hint'),
        onClick: () => ctx.go('welcome', { form: { key: f.key, name: f.name, avatar: f.avatar, found: true } }) },
        el('span', { class: 'disc' }, f.avatar), el('span', { class: 'name' }, f.name), el('span', { class: 'sub' }, i18n.t('welcome.found'))));
    }
    row.appendChild(el('button', { class: 'avatar new', type: 'button', onClick: () => ctx.go('welcome', { form: {} }) },
      el('span', { class: 'disc' }, '+'), el('span', { class: 'name' }, i18n.t('welcome.new'))));
    col.appendChild(row);
    col.appendChild(el('div', { class: 'bottom' }, el('button', { class: 'btn ghost', type: 'button', onClick: () => ctx.go('eltern') }, i18n.t('welcome.parents'))));
  }
  mount(root, el('div', { class: 'stage' }, horizon(), col));
}

function renderForm(ctx, preset, onDone, onCancel) {
  const { i18n, store } = ctx;
  let avatar = preset.avatar && AVATARS.includes(preset.avatar) ? preset.avatar : (preset.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const card = el('div', { class: 'card form' });
  const name = el('input', { type: 'text', id: 'profile-name', value: preset.name || '', autocomplete: 'off', autocapitalize: 'words', maxlength: 24, readOnly: !!preset.found });
  const picks = el('div', { class: 'avatar-pick' });
  const paint = () => picks.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === avatar));
  for (const a of [...new Set([avatar, ...AVATARS])]) picks.appendChild(el('button', { type: 'button', onClick: () => { avatar = a; paint(); } }, a));
  paint();
  const grade = el('select', { id: 'profile-grade' }, el('option', { value: '' }, '–'), ...GRADES.map(g => el('option', { value: String(g), selected: preset.grade === g }, `${i18n.t('profile.grade')} ${g}`)));
  const gentle = el('input', { type: 'checkbox', id: 'profile-gentle', checked: !!preset.gentle });
  const error = el('div', { class: 'form-error', hidden: true });
  const save = () => {
    const n = name.value.trim();
    const key = preset.key || keyFromName(n);
    if (!n || !validKey(key)) { error.textContent = i18n.t('profile.invalid'); error.hidden = false; name.focus(); return; }
    try {
      const p = saveProfile(store, { key, name: n, avatar, grade: grade.value ? Number(grade.value) : null, gentle: gentle.checked });
      setCurrentProfile(store, p.key);
      onDone();
    } catch (e) { error.textContent = e.message; error.hidden = false; }
  };
  name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  append(card, [
    el('h1', {}, preset.found ? i18n.t('welcome.found') : i18n.t('welcome.new')),
    preset.found ? el('div', { class: 'soft' }, i18n.t('welcome.found.hint')) : null,
    el('label', { for: 'profile-name' }, i18n.t('profile.name'), name),
    el('label', {}, i18n.t('profile.avatar'), picks),
    el('label', { for: 'profile-grade' }, i18n.t('profile.grade'), grade),
    el('label', { class: 'check' }, gentle, i18n.t('profile.gentle')),
    error,
    el('div', { class: 'row end' }, el('button', { class: 'btn ghost', type: 'button', onClick: onCancel }, i18n.t('profile.cancel')), el('button', { class: 'btn primary', type: 'button', onClick: save }, i18n.t('profile.save'))),
  ]);
  setTimeout(() => { if (!preset.found) name.focus(); }, 80);
  return card;
}
