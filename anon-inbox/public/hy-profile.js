// Profile: your dating card, privacy, notifications, appearance and account.
import * as api from './hy-api.js';
import { pushSettingsRow, forget as forgetPush } from './hy-push.js';
import { installRow } from './hy-install.js';
import { openAvatarPicker } from './hy-avatar-ui.js';
import { h, icon, avatar, toast, sheet, confirmSheet, chipGroup, toggle, store, hero, stateSelect, dobPicker, yearsOld, formatDob } from './hy-ui.js';
import { cachedAvatar } from './hy-avatar.js';
import { openNearbySettings } from './hy-nearby.js';
import { state, emit, nav, loadDating, GENDERS, INTENTS, INTERESTS, STATES, stateLabel, GENDER_LABEL, INTENT_LABEL } from './hy-state.js';
import { startDatingSetup } from './hy-onboard.js';

function completion() {
  const p = state.profile;
  const items = [
    ['Create your dating card', !!p],
    ['Customize your avatar', !!(p && cachedAvatar(p.handle))],
    ['Write a short bio', !!(p && p.bio)],
    ['Add your interests', !!(p && p.interests && p.interests.length)],
    ['Choose your state', !!(p && p.state)],
  ];
  const done = items.filter((i) => i[1]).length;
  return { items, pct: Math.round((done / items.length) * 100) };
}

export function renderProfile() {
  const { profile } = state;
  const c = completion();
  const blocked = state.convos.filter((x) => x.i_blocked);
  const facts = [profile.age ? `${profile.age}` : null, GENDER_LABEL[profile.gender], profile.state ? stateLabel(profile.state) : profile.location].filter(Boolean);
  return h('div', { class: 'stack-lg profile' },
    hero({ cls: 'profile-hero', actions: [nav.bell()] },
      h('div', { class: 'pf-head' },
        h('button', { class: 'av-hero-btn', 'aria-label': 'Customize your avatar', onclick: () => openAvatarPicker() }, avatar(profile.handle, profile.handle, 'xl'), h('span', { class: 'av-pencil' }, icon('edit', 'sm'))),
        h('div', { class: 'grow' },
          h('h1', {}, profile.handle),
          h('p', { class: 'pf-facts' }, facts.join(' · ')),
          h('div', { class: 'pf-chips' },
            h('span', { class: 'pf-chip date' }, INTENT_LABEL[profile.intent]),
            h('span', { class: `pf-chip ${profile.is_active && !profile.suspended ? 'on' : ''}` }, profile.suspended ? 'Suspended' : profile.is_active ? 'Visible in Discover' : 'Hidden from Discover')))),
      profile.bio ? h('p', { class: 'pf-bio' }, profile.bio) : h('button', { class: 'pf-bio empty', onclick: () => editDating() }, '+ Add a short bio so people know your vibe')),

    c.pct < 100 ? h('div', { class: 'card pf-complete below-hero' },
      h('div', { class: 'completion' }, h('div', { class: 'ring', style: { '--p': c.pct } }, h('span', {}, `${c.pct}%`)),
        h('div', {}, h('h3', {}, 'Complete your profile'), h('p', { class: 'small muted' }, 'Complete profiles get more likes and message requests.'))),
      h('div', { class: 'pf-todos' }, c.items.map(([label, ok]) => h('div', { class: `todo ${ok ? 'done' : ''}` }, h('span', { class: 'dot' }, ok ? icon('check', 'sm') : ''), label)))) : null,

    group('Your profile',
      row('sparkles', 'Customize avatar', 'Skin tone, hair, outfit, accessories and background', () => openAvatarPicker()),
      row('edit', 'Edit dating profile', 'Age, gender, state' + (api.features.matching ? ', bio' : ''), () => editDating()),
      api.features.matching ? row('heart', 'Interests & intentions', `${INTENT_LABEL[profile.intent]}${(profile.interests || []).length ? ` · ${(profile.interests || []).slice(0, 3).join(', ')}` : ''}`, () => editDating()) : null,
      api.features.matching ? row('sliders', 'Discovery preferences', prefsSummary(profile), () => editPrefs()) : null,
      switchRow('eye', 'Show me in Discover', profile.suspended ? 'Suspended after reports' : profile.is_active ? 'People can find and like you' : 'Paused: you’re hidden from Discover',
        profile.is_active, async (on, input) => {
          try { await api.updateProfile(profile.handle, { is_active: on }); profile.is_active = on; emit('profile'); }
          catch (e) { input.checked = !on; toast(api.friendly(e), 'x'); }
        })),

    group('Privacy & safety',
      info('🎭', 'You’re anonymous', 'People see your nickname and avatar, never your email or real name. Chatrooms use your room nickname.'),
      info('🔓', 'Identity reveal needs both of you', 'Your first name is only shown when you and the other person both choose to reveal. Nobody can reveal you alone.'),
      info('📩', 'Who can send you message requests', 'Anyone with a dating card. Requests wait in your Inbox until you accept; decline or block any time.'),
      row('pin', 'Nearby & location', 'Off by default. Approximate area only; pause or delete any time', () => openNearbySettings()),
      row('ban', 'Blocked people', blocked.length ? `${blocked.length} blocked` : 'No one blocked', () => blockedSheet(blocked)),
      info('🚩', 'Reporting', 'Report anyone from a chat’s ⋯ menu, a request, or a chatroom message. Reported messages are hidden for you straight away, and we act on reports within 24 hours.'),
      h('a', { class: 'settings-row', href: 'mailto:support@treehouse.ng?subject=treehouse%20report' }, icon('flag'), h('span', { class: 'grow' }, 'Report a problem by email', h('span', { class: 'sub' }, 'support@treehouse.ng')), h('span', { class: 'chev' }, icon('chev', 'sm')))),

    group('Notifications', pushSettingsRow(() => emit('push')), installRow()),

    group('Appearance', h('div', { class: 'settings-row', style: { cursor: 'default' } }, icon('moon'), h('span', { class: 'grow' }, 'Theme'), themePicker())),

    group('Account',
      h('div', { class: 'settings-row', style: { cursor: 'default' } }, icon('mail'), h('span', { class: 'grow' }, 'Email', h('span', { class: 'sub' }, `${state.user.email} · never shown to anyone`))),
      row('lock', 'Change password', 'We’ll email you a secure link', () => changePassword()),
      h('a', { class: 'settings-row', href: 'mailto:support@treehouse.ng?subject=treehouse%20report' }, icon('info'), h('span', { class: 'grow' }, 'Contact us & report a problem', h('span', { class: 'sub' }, 'support@treehouse.ng')), h('span', { class: 'chev' }, icon('chev', 'sm'))),
      h('a', { class: 'settings-row', href: '/privacy' }, icon('shield'), h('span', { class: 'grow' }, 'Privacy policy'), h('span', { class: 'chev' }, icon('chev', 'sm'))),
      h('a', { class: 'settings-row', href: '/terms' }, icon('shield'), h('span', { class: 'grow' }, 'Terms of Use'), h('span', { class: 'chev' }, icon('chev', 'sm'))),
      h('button', { class: 'settings-row', onclick: async () => { await forgetPush(); api.signOut(); } }, icon('logout'), 'Sign out'),
      h('button', { class: 'settings-row danger', onclick: deleteAccount }, icon('trash'), 'Delete my account')),

    h('p', { class: 'tiny muted center' }, 'treehouse · Anonymous users. Real connections.'));
}

function blockedSheet(list) {
  sheet((close) => [h('h2', {}, 'Blocked people'),
    h('p', { class: 'small muted' }, 'They can’t message you or see you in Discover. They aren’t told.'),
    list.length ? h('div', { class: 'menu-list', style: { marginTop: '10px' } }, list.map((c) => h('div', { class: 'blocked-row' },
      avatar(c.other_handle, c.other_handle, 'sm'), h('span', { class: 'grow ellipsis' }, c.other_handle),
      h('button', { class: 'btn btn-soft btn-sm', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { await api.unblockPartner(c.conversation_id); toast(`${c.other_handle} is unblocked`); close(); await loadDating({ force: true }); }
        catch (err) { toast(api.friendly(err), 'x'); e.currentTarget.disabled = false; }
      } }, 'Unblock'))))
      : h('p', { class: 'muted', style: { margin: '14px 0' } }, 'You haven’t blocked anyone.'),
    h('p', { class: 'tiny muted' }, 'People blocked in chatrooms are kept on this device and can be unblocked from their room profile.'),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-soft btn-block', onclick: close }, 'Close'))], { label: 'Blocked people' });
}

async function changePassword() {
  if (!(await confirmSheet({ title: 'Change your password?', yes: 'Email me a link', text: `We’ll send a secure link to ${state.user.email}. Open it on this device to choose a new password.` }))) return;
  try { await api.resetPassword(state.user.email); toast('Check your email for the link', 'mail'); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

function group(title, ...rows) {
  return h('section', {}, h('div', { class: 'section-head' }, h('h2', {}, title)), h('div', { class: 'settings-group' }, rows));
}
function row(ico, title, sub, onclick) {
  return h('button', { class: 'settings-row', onclick }, icon(ico), h('span', { class: 'grow' }, title, h('span', { class: 'sub ellipsis' }, sub)), h('span', { class: 'chev' }, icon('chev', 'sm')));
}
function switchRow(ico, title, sub, on, onChange) {
  return h('div', { class: 'settings-row', style: { cursor: 'default' } }, icon(ico), h('span', { class: 'grow' }, title, h('span', { class: 'sub' }, sub)), toggle(on, onChange, title));
}
function info(emoji, title, sub) {
  return h('div', { class: 'settings-row', style: { cursor: 'default', alignItems: 'flex-start' } }, h('span', { style: { fontSize: '20px' } }, emoji), h('span', { class: 'grow' }, title, h('span', { class: 'sub' }, sub)));
}
function prefsSummary(p) {
  const who = (p.interested_in || []).length >= 3 ? 'Everyone' : (p.interested_in || []).map((g) => GENDER_LABEL[g]).join(', ');
  return `${who} · ${p.min_age}–${p.max_age >= 99 ? '99+' : p.max_age}${api.features.states ? ` · ${stateLabel(p.pref_state)}` : ''}`;
}

function themePicker() {
  const cur = store.get('hy-theme', 'system');
  const seg = h('div', { class: 'segmented', style: { width: '210px' } });
  for (const [v, label] of [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]) {
    seg.append(h('button', { 'aria-selected': String(cur === v), onclick: () => { store.set('hy-theme', v); nav.applyTheme(v); nav.rerender(); } }, label));
  }
  return seg;
}

// ---- Edit sheets --------------------------------------------------------------------------------
function editDating() {
  const p = state.profile;
  const name = h('input', { class: 'input', maxlength: '60', value: p.name || '' });
  // Date of birth (private) sets your age and age chatroom; it can change once every 365 days.
  const dob = dobPicker(p.birth_date || null);
  const nextAge = p.age_changed_at ? new Date(new Date(p.age_changed_at).getTime() + 365 * 864e5) : null;
  const ageLocked = !!(p.birth_date && nextAge && nextAge > new Date());
  if (ageLocked) dob.disabled = true;
  const ageNote = h('small', { class: 'muted' }, ageLocked
    ? `You’re ${p.age}. You can change your date of birth again on ${nextAge.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Nobody else sees it.`
    : `You’re ${p.age}. Nobody else sees your date of birth. It can change once every 365 days.`);
  const loc = api.features.states ? stateSelect(STATES, p.state, { label: 'State' }) : h('input', { class: 'input', maxlength: '80', value: p.location || '' });
  // Your state decides your state chatroom, so it can change once every 30 days.
  const nextChange = p.state && p.state_changed_at ? new Date(new Date(p.state_changed_at).getTime() + 30 * 864e5) : null;
  const stateLocked = !!(api.features.states && nextChange && nextChange > new Date());
  if (stateLocked) loc.disabled = true;
  const stateNote = api.features.states ? h('small', { class: 'muted' }, stateLocked
    ? `You can change your state again on ${nextChange.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Your state decides your state chatroom.`
    : 'Your state decides your state chatroom. You can change it once every 30 days.') : null;
  let gender = p.gender, intent = p.intent, interests = p.interests || [];
  // Gender decides the Ladies'/Men's Room, so it can change once every 90 days.
  const nextGender = p.gender_changed_at ? new Date(new Date(p.gender_changed_at).getTime() + 90 * 864e5) : null;
  const genderLocked = !!(nextGender && nextGender > new Date());
  const g = chipGroup(GENDERS, { selected: gender, onChange: (v) => {
    if (genderLocked && v !== p.gender) { toast(`You can change your gender again on ${nextGender.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, 'lock'); }
    gender = v;
  } });
  const genderNote = h('small', { class: 'muted' }, genderLocked
    ? `You can change this again on ${nextGender.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`
    : 'You can change this once every 90 days.');
  const i = chipGroup(INTENTS, { selected: intent, onChange: (v) => { intent = v; } });
  const bio = api.features.matching ? h('textarea', { class: 'textarea', maxlength: '300', placeholder: 'A line or two about you. No names, numbers or socials.' }, p.bio || '') : null;
  const ints = api.features.matching ? chipGroup(INTERESTS.map((x) => [x, x]), { selected: interests, multi: true, max: 8, onChange: (v) => { interests = v; } }) : null;
  const err = h('p', { class: 'error' });
  sheet((close) => [h('h2', {}, 'Edit dating profile'),
    h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'First name (hidden until you both reveal)'), name),
      h('div', { class: 'field' }, h('span', {}, 'Date of birth'), dob.el, ageNote),
      h('label', { class: 'field' }, h('span', {}, api.features.states ? 'State' : 'Area'), loc, stateNote),
      h('div', { class: 'field' }, h('span', {}, 'I am'), g.el, genderNote),
      h('div', { class: 'field' }, h('span', {}, 'Looking for'), i.el),
      bio ? h('label', { class: 'field' }, h('span', {}, 'Bio'), bio) : null,
      ints ? h('div', { class: 'field' }, h('span', {}, 'Interests (up to 8)'), ints.el) : null,
      err),
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-dark btn-block', onclick: async () => {
      const birth = ageLocked ? p.birth_date : dob.value();
      if (!birth) return (err.textContent = 'Enter your date of birth.');
      if (birth === 'invalid') return (err.textContent = 'That date doesn’t exist. Check your date of birth.');
      const fields = { name: name.value.trim(), location: loc.value.trim(), gender: genderLocked ? p.gender : gender, intent };
      if (api.features.states) {
        if (!loc.value) return (err.textContent = 'Choose your state.');
        if (!stateLocked) fields.state = loc.value;
        if (!p.state && !p.pref_state) fields.pref_state = loc.value;   // first time: the filter starts on their state
        if (p.state && fields.state && fields.state !== p.state
          && !(await confirmSheet({ title: `Move to ${fields.state === 'FCT' ? 'Abuja (FCT)' : fields.state}?`, text: 'You’ll switch to that state’s chatroom, and you won’t be able to change your state again for 30 days.', yes: 'Change state' }))) return;
      }
      if (!fields.name) return (err.textContent = 'Add your first name.');
      if (yearsOld(birth) < 18) return (err.textContent = 'treehouse is only for people 18 and over.');
      if (birth !== p.birth_date) fields.birth_date = birth;
      if (bio) { fields.bio = bio.value.trim(); fields.interests = interests; }
      try {
        const moved = fields.state && fields.state !== p.state && p.state;
        const genderMoved = fields.gender !== p.gender;
        const ageMoved = !!fields.birth_date;
        if (ageMoved && !(await confirmSheet({ title: `Change your date of birth to ${formatDob(birth)}?`, yes: 'Change it',
          text: 'Your age decides which age chatroom you can join. You won’t be able to change it again for 365 days.' }))) return;
        await api.updateProfile(p.handle, fields); Object.assign(p, fields);
        if (moved) p.state_changed_at = new Date().toISOString();
        if (genderMoved) p.gender_changed_at = new Date().toISOString();
        if (ageMoved) Object.assign(p, await api.myProfile());
        close(); emit('profile'); toast('Dating card saved');
      }
      catch (e) { err.textContent = api.friendly(e); }
    } }, 'Save'))], { label: 'Edit dating profile' });
}

export function editPrefs() {
  const p = state.profile;
  let who = p.interested_in || ['male', 'female', 'other'];
  const g = chipGroup(GENDERS, { selected: who, multi: true, onChange: (v) => { who = v; } });
  const min = h('input', { class: 'input', type: 'number', min: '18', max: '99', inputmode: 'numeric', value: p.min_age });
  const max = h('input', { class: 'input', type: 'number', min: '18', max: '120', inputmode: 'numeric', value: Math.min(p.max_age, 99) });
  const where = api.features.states ? stateSelect(STATES, p.pref_state, { anywhere: true, label: 'Location' }) : null;
  const err = h('p', { class: 'error' });
  sheet((close) => [h('h2', {}, 'Discovery preferences'), h('p', { class: 'small muted' }, 'Discover only shows people who fit your preferences, and who you fit too.'),
    h('div', { class: 'field' }, h('span', {}, 'Show me'), g.el),
    h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', {}, 'From age'), min), h('label', { class: 'field grow' }, h('span', {}, 'To age'), max)),
    where ? h('label', { class: 'field' }, h('span', {}, 'Location'), where, p.state ? h('p', { class: 'hint' }, `Your state: ${stateLabel(p.state)}`) : null) : null,
    err,
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-dark btn-block', onclick: async () => {
      const a = Number(min.value), b = Number(max.value);
      if (!who.length) return (err.textContent = 'Pick at least one.');
      if (!(a >= 18 && b >= a)) return (err.textContent = 'Ages start at 18, and “to” must be at least “from”.');
      const fields = { interested_in: who, min_age: a, max_age: b >= 99 ? 120 : b };
      if (where) fields.pref_state = where.value || null;
      try { await api.updateProfile(p.handle, fields); Object.assign(p, fields); close(); emit('profile'); toast('Preferences saved'); }
      catch (e) { err.textContent = api.friendly(e); }
    } }, 'Save'))], { label: 'Preferences' });
}

async function deleteAccount() {
  if (!(await confirmSheet({ title: 'Delete your account?', danger: true, yes: 'Delete everything',
    text: 'This permanently deletes your account, your dating card, matches, chats and chatroom messages. It can’t be undone.' }))) return;
  try { await api.deleteAccount(); await api.signOut(); toast('Your account was deleted', 'trash'); }
  catch (e) { toast(api.friendly(e), 'x'); }
}
