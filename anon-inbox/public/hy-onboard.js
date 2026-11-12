// Signed-out landing, sign up / sign in, and the short onboarding:
// dating card (18+) → a bit more about you → done.
import * as api from './hy-api.js';
import { h, icon, logo, chipGroup, toast, store, stateSelect, dobPicker, yearsOld, formatDob, confirmSheet, sheet } from './hy-ui.js';
import { canSuggest as canInstall, install } from './hy-install.js';
import { state, nav, GENDERS, INTENTS, INTERESTS, STATES, emit } from './hy-state.js';

const redirect = () => `${api.SITE}/home`;
// The Android/iPhone apps can't show Google's sign-in page yet (Google blocks it inside apps), so they
// keep email sign-up until their next version. The website signs people up with Google.
// The phone apps hide Google, except the Android app 1.6+ which opens it in Chrome (see hy-api).
const nativeApp = (/TreehouseApp\//.test(navigator.userAgent || '') || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) && !api.appGoogle();
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>';
// Set once Supabase says Google sign-in is switched on (the landing redraws when it's known).
let googleOn = false, googleAsked = false;
function checkGoogle() {
  if (googleAsked) return;
  googleAsked = true;
  api.googleReady.then((on) => { if (on && !googleOn) { googleOn = true; rerender(); } });
}
window.addEventListener('hy-google-failed', (e) => toast(e.detail, 'x'));
function googleButton(label, before) {
  const btn = h('button', { type: 'button', class: 'btn btn-google btn-block' });
  btn.innerHTML = GOOGLE_G;   // our own fixed logo
  btn.append(document.createTextNode(label));
  btn.onclick = async () => {
    if (before && !before()) return;
    btn.disabled = true;
    try {
      await api.signInWithGoogle(redirect());
      // In the app, Google opens in Chrome; if they close it without signing in, the button works again.
      if (api.appGoogle()) setTimeout(() => { btn.disabled = false; }, 3000);
    }
    catch (e) { btn.disabled = false; toast(api.friendly(e), 'x'); }
  };
  return btn;
}

// ---- Landing + auth ------------------------------------------------------------------------------
let view = 'landing';   // landing | signup | signin | verify | forgot
let pendingEmail = '';

function rerender() { nav.rerender(); }
function setView(v) { view = v; rerender(); window.scrollTo(0, 0); }

export function renderLanding() {
  const authError = store.get('hy-auth-error');
  if (authError) { store.del('hy-auth-error'); view = 'signin'; }
  const page = view === 'landing' ? landing() : view === 'verify' ? verify() : view === 'forgot' ? forgot() : authForm(view, authError);
  return h('div', { class: 'auth-page' }, page);
}

function landing() {
  return h('div', { class: 'auth' },
    h('div', { class: 'brand-head' }, logo(), h('p', { class: 'tagline-caps' }, 'Meet without the pressure.')),
    h('div', { class: 'hero-land', style: { position: 'relative' } },
      h('span', { class: 'floaty', style: { left: '0', top: '-8px' } }, '💘'),
      h('span', { class: 'floaty', style: { right: '2%', top: '34px', animationDelay: '-1.5s' } }, '🎭'),
      h('h1', {}, 'Anonymous users. ', h('em', {}, 'Real connections.')),
      h('p', { class: 'lead' }, 'Meet new people across Nigeria without showing who you are. Chat, match and reveal your name only when you both say yes.')),
    h('div', { class: 'feature-tiles' },
      h('div', { class: 'feature-tile' }, h('span', { class: 'ft-icon date' }, icon('heart', 'fill')), h('b', {}, 'Anonymous Dating'),
        h('p', {}, h('span', {}, 'Like, match and chat. Names show only when you both agree.'))),
      h('div', { class: 'feature-tile' }, h('span', { class: 'ft-icon msg' }, icon('rooms')), h('b', {}, 'State Chatrooms'),
        h('p', {}, h('span', {}, 'Join your state’s chatroom and meet people near you.')))),
    h('div', { class: 'stack' },
      h('button', { class: 'btn btn-white btn-block', onclick: () => setView('signup') }, 'Join treehouse'),
      h('button', { class: 'btn btn-glass btn-block', onclick: () => setView('signin') }, 'I already have an account'),
      canInstall() ? h('button', { class: 'link-btn install-link', onclick: () => install() }, icon('plus', 'sm'), 'Add treehouse to your Home Screen') : null),
    h('p', { class: 'tiny muted center' }, 'For adults 18+. ', h('a', { href: '/terms', style: { color: '#d8b4fe' } }, 'Terms'), ' · ', h('a', { href: '/privacy', style: { color: '#d8b4fe' } }, 'Privacy policy')));
}

// Website sign-up: Google only (no confirmation email to wait for).
function googleSignup() {
  const age = h('input', { type: 'checkbox' });
  const terms = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'error', role: 'alert' });
  const check = () => {
    err.textContent = '';
    if (!age.checked) { err.textContent = 'treehouse is only for people 18 and over.'; return false; }
    if (!terms.checked) { err.textContent = 'Please agree to the Terms of Use to continue.'; return false; }
    store.set('hy-google-terms', Date.now());
    return true;
  };
  return h('div', { class: 'auth' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => setView('landing') }, icon('back')),
    h('div', { class: 'onb-head' }, h('h1', {}, 'Create your account'),
      h('p', {}, 'Join in one tap with your Google account. Your name and email are never shown to anyone on treehouse.')),
    h('div', { class: 'stack' },
      h('label', { class: 'check' }, age, h('span', {}, 'I’m 18 or older. treehouse is for adults only.')),
      h('label', { class: 'check' }, terms, h('span', {}, 'I agree to the ',
        h('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'Terms of Use'), ' and ',
        h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Privacy policy'),
        '. No abusive or objectionable content: it gets removed, and so do the people who post it.')),
      err,
      googleButton('Continue with Google', check)),
    h('p', { class: 'small muted center' }, 'Already have an account? ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => setView('signin') }, 'Sign in')));
}

function authForm(mode, initialError) {
  checkGoogle();
  if (mode === 'signup' && googleOn && !nativeApp) return googleSignup();
  const isUp = mode === 'signup';
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com', value: pendingEmail });
  const pass = h('input', { class: 'input', type: 'password', autocomplete: isUp ? 'new-password' : 'current-password', required: true, minlength: '8', placeholder: isUp ? 'At least 8 characters' : 'Your password' });
  const age = h('input', { type: 'checkbox' });
  const terms = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'error', role: 'alert' }, initialError ? (/expired|invalid/i.test(initialError) ? 'That link has expired or was already used. Sign in to get a new one.' : initialError) : '');
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, isUp ? 'Create account' : 'Sign in');
  const form = h('form', { class: 'stack', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    pendingEmail = email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(pendingEmail)) return (err.textContent = 'Enter a valid email address.');
    if (pass.value.length < 8) return (err.textContent = 'Use a password with at least 8 characters.');
    if (isUp && !age.checked) return (err.textContent = 'treehouse is only for people 18 and over.');
    if (isUp && !terms.checked) return (err.textContent = 'Please agree to the Terms of Use to continue.');
    submit.disabled = true;
    try {
      if (isUp) {
        const chk = await api.emailCheck(pendingEmail);
        if (!chk.ok) {
          if (chk.reason === 'typo' && chk.suggestion) {
            err.replaceChildren(`Did you mean ${chk.suggestion}? `,
              h('button', { type: 'button', class: 'link-btn', onclick: () => { email.value = chk.suggestion; pendingEmail = chk.suggestion; err.textContent = ''; email.focus(); } }, 'Use this'));
          } else {
            err.textContent = 'That email address can’t receive emails. Check it for typos.';
          }
          return;
        }
        const data = await api.signUp(pendingEmail, pass.value, redirect());
        if (data.session) return nav.afterSignIn();
        noteEmailSent(pendingEmail);
        return setView('verify');
      }
      await api.signIn(pendingEmail, pass.value);
      await nav.afterSignIn();
    } catch (e2) {
      err.textContent = api.friendly(e2);
      if (/verify your email/i.test(err.textContent)) setTimeout(() => setView('verify'), 1200);
    } finally { submit.disabled = false; }
  } },
    h('label', { class: 'field' }, h('span', {}, 'Email'), email),
    h('label', { class: 'field' }, h('span', {}, 'Password'), pass),
    isUp ? h('label', { class: 'check' }, age, h('span', {}, 'I’m 18 or older. treehouse is for adults only.')) : null,
    isUp ? h('label', { class: 'check' }, terms, h('span', {}, 'I agree to the ',
      h('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'Terms of Use'), ' and ',
      h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Privacy policy'),
      '. No abusive or objectionable content: it gets removed, and so do the people who post it.')) : null,
    err, submit,
    isUp ? null : h('button', { type: 'button', class: 'link-btn', onclick: () => setView('forgot') }, 'Forgot password?'));
  return h('div', { class: 'auth' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => setView('landing') }, icon('back')),
    h('div', { class: 'onb-head' }, h('h1', {}, isUp ? 'Create your account' : 'Welcome back'),
      h('p', {}, isUp ? 'We’ll send you an email to confirm it’s you. Your email is never shown to anyone.' : 'Sign in to see your chats and matches.')),
    !isUp && googleOn && !nativeApp ? h('div', { class: 'stack' }, googleButton('Continue with Google'), h('p', { class: 'or-line' }, h('span', {}, 'or sign in with email'))) : null,
    form,
    h('p', { class: 'small muted center' }, isUp ? 'Already have an account? ' : 'New here? ',
      h('button', { class: 'link-btn', type: 'button', onclick: () => setView(isUp ? 'signin' : 'signup') }, isUp ? 'Sign in' : 'Create one')));
}

// Verification emails: each send is remembered on this phone (per email address), and the wait
// before "Resend" grows: 2 min after the first email, then 5, then 10. At most 4 emails an hour.
// Repeated resends make Gmail slow down ALL our emails, and the first one usually arrives anyway.
const SENT_KEY = 'hy-verify-sent';
const WAITS = [120, 300, 600];
function sendsFor(addr) {
  const all = store.get(SENT_KEY, {}) || {};
  const hourAgo = Date.now() - 3600 * 1000;
  return (all[(addr || '').toLowerCase()] || []).filter((t) => t > hourAgo);
}
function noteEmailSent(addr) {
  const all = store.get(SENT_KEY, {}) || {};
  const key = (addr || '').toLowerCase();
  all[key] = [...sendsFor(addr), Date.now()];
  store.set(SENT_KEY, all);
}
function waitLeft(addr) {
  const sends = sendsFor(addr);
  if (!sends.length) return 0;
  if (sends.length >= 4) return Math.ceil((sends[0] + 3600 * 1000 - Date.now()) / 1000);
  const wait = WAITS[Math.min(sends.length - 1, WAITS.length - 1)];
  return Math.max(0, Math.ceil((sends[sends.length - 1] + wait * 1000 - Date.now()) / 1000));
}
const mmss = (sec) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}s`);

function verify() {
  let timer = null;
  const btn = h('button', { class: 'btn btn-soft btn-block' }, 'Resend email');
  const tick = () => {
    const left = waitLeft(pendingEmail);
    btn.disabled = left > 0;
    btn.textContent = left > 0 ? `Resend in ${mmss(left)}` : 'Resend email';
    if (left <= 0 && timer) { clearInterval(timer); timer = null; }
  };
  const startTimer = () => { tick(); if (!timer && waitLeft(pendingEmail) > 0) timer = setInterval(() => { if (!btn.isConnected) { clearInterval(timer); timer = null; return; } tick(); }, 1000); };
  btn.onclick = async () => {
    if (waitLeft(pendingEmail) > 0) return;
    btn.disabled = true;
    try { await api.resendVerify(pendingEmail, redirect()); noteEmailSent(pendingEmail); toast('Email sent again. It can take a few minutes to arrive.'); }
    catch (e) { btn.disabled = false; return toast(api.friendly(e), 'x'); }
    startTimer();
  };
  startTimer();
  return h('div', { class: 'auth center' },
    h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, h('span', {}, '📬')),
      h('h3', {}, 'Check your email'),
      h('p', {}, 'We sent a confirmation link to ', h('b', {}, pendingEmail || 'your email'), '. Open it on this device to continue.'),
      h('p', { class: 'small muted' }, 'It can take a few minutes to arrive. Please wait for it rather than resending: extra emails can slow everything down.')),
    btn,
    h('button', { class: 'btn btn-ghost btn-block', onclick: () => setView('signin') }, 'I’ve confirmed, sign in'),
    h('p', { class: 'tiny muted' }, 'Can’t find it? Check your spam and promotions folders.'));
}

function forgot() {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', value: pendingEmail, placeholder: 'you@example.com' });
  const msg = h('p', { class: 'small', role: 'status' });
  return h('div', { class: 'auth' },
    h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => setView('signin') }, icon('back')),
    h('div', { class: 'onb-head' }, h('h1', {}, 'Reset password'), h('p', {}, 'We’ll email you a link to choose a new one.')),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      try { await api.resetPassword(email.value.trim()); msg.className = 'small hint ok'; msg.textContent = 'Check your email for the reset link.'; }
      catch (e2) { msg.className = 'error'; msg.textContent = api.friendly(e2); }
    } }, h('label', { class: 'field' }, h('span', {}, 'Email'), email), msg, h('button', { class: 'btn btn-dark btn-block' }, 'Send reset link')));
}

// ---- Onboarding (signed in) ------------------------------------------------------------------------
const draft = { gender: null, age: '', birth: '', location: '', intent: null, name: '', interested: ['male', 'female', 'other'], bio: '', interests: [] };
let step = 'date-basics';   // date-basics | date-more | done

// Anyone signed in without a dating card is sent here (treehouse is dating only).
export function startDatingSetup() { step = 'date-basics'; state.onboarding = true; rerender(); window.scrollTo(0, 0); }

function goStep(s) { step = s; state.onboarding = true; rerender(); window.scrollTo(0, 0); }
const STEP_ORDER = ['date-basics', 'date-more', 'done'];
function progress() {
  const i = STEP_ORDER.indexOf(step);
  return h('div', { class: 'steps', 'aria-hidden': 'true' }, STEP_ORDER.map((_, j) => h('i', { class: j <= i ? 'on' : '' })));
}
function shell(title, sub, body, back) {
  return h('div', { class: 'auth', style: { alignContent: 'start', paddingTop: '28px' } },
    h('div', { class: 'row-between' }, back ? h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: back }, icon('back')) : logo(),
      h('button', { class: 'link-btn small', onclick: () => api.signOut() }, 'Sign out')),
    progress(),
    h('div', { class: 'onb-head' }, h('h1', {}, title), sub ? h('p', {}, sub) : null),
    body);
}

export function renderOnboarding() {
  if (!state.profile && step === 'done') step = 'date-basics';
  const page = step === 'date-more' ? stepDateMore() : step === 'done' ? stepDone() : stepDateBasics();
  return h('div', { class: 'auth-page' }, page);
}

function stepDateBasics() {
  const name = h('input', { class: 'input', maxlength: '60', placeholder: 'Your first name', value: draft.name });
  const dob = dobPicker(draft.birth || null);
  const loc = stateSelect(STATES, draft.location, { label: 'State' });
  const gender = chipGroup(GENDERS, { selected: draft.gender || [], onChange: (v) => { draft.gender = v; } });
  const intent = chipGroup(INTENTS, { selected: draft.intent || [], onChange: (v) => { draft.intent = v; } });
  const adult = h('input', { type: 'checkbox' });
  const err = h('p', { class: 'error', role: 'alert' });
  const next = h('button', { class: 'btn btn-primary btn-block' }, api.features.matching ? 'Continue' : 'Create dating profile');
  next.onclick = async () => {
    const birth = dob.value();
    Object.assign(draft, { name: name.value.trim(), birth: birth === 'invalid' ? '' : birth, location: loc.value });
    err.textContent = '';
    if (store.get('hy-underage')) return (err.textContent = 'treehouse is only for people 18 and over.');
    if (!draft.name) return (err.textContent = 'Add your first name. It stays hidden until you reveal it.');
    if (!birth) return (err.textContent = 'Enter your date of birth.');
    if (birth === 'invalid') return (err.textContent = 'That date doesn’t exist. Check your date of birth.');
    draft.age = yearsOld(birth);
    if (draft.age < 18) { store.set('hy-underage', 1); return (err.textContent = 'treehouse is only for people 18 and over.'); }
    if (draft.confirmedBirth !== birth) {
      if (!(await confirmSheet({ title: `Born on ${formatDob(birth)}?`, yes: 'Yes, that’s right',
        text: 'Please check it carefully. You can only change your date of birth after 365 days.' }))) return;
      draft.confirmedBirth = birth;
    }
    if (!draft.location) return (err.textContent = 'Choose your state.');
    if (!draft.gender || !draft.intent) return (err.textContent = 'Pick your gender and what you’re looking for.');
    if (!adult.checked) return (err.textContent = 'Please confirm you’re 18 or older.');
    if (api.features.matching) return goStep('date-more');
    next.disabled = true;
    try { await saveDating(); goStep('done'); } catch (e) { err.textContent = api.friendly(e); next.disabled = false; }
  };
  return shell('Create your card', 'You stay anonymous: people see a nickname like “Velvet Owl 342”. Your first name is shown to a match only after you both reveal.', h('div', { class: 'stack-lg' },
    h('label', { class: 'field' }, h('span', {}, 'First name (hidden)'), name),
    h('div', { class: 'field' }, h('span', {}, 'Date of birth'), dob.el, h('p', { class: 'hint' }, 'Required. Private: nobody else sees it. Check it carefully: you can only change your date of birth after 365 days.')),
    h('label', { class: 'field' }, h('span', {}, 'State'), loc, h('p', { class: 'hint' }, 'Discover shows people in your state first. You can change that any time.')),
    h('div', { class: 'field' }, h('span', {}, 'I am'), gender.el),
    h('div', { class: 'field' }, h('span', {}, 'Looking for'), intent.el),
    h('label', { class: 'check' }, adult, h('span', {}, 'I confirm I’m 18 or older. Accounts found to be under 18 are removed.')),
    err, next));
}

function stepDateMore() {
  const interested = chipGroup(GENDERS, { selected: draft.interested, multi: true, onChange: (v) => { draft.interested = v; } });
  const bio = h('textarea', { class: 'textarea', maxlength: '300', placeholder: 'A line or two about you. No names, numbers or socials.' }, draft.bio);
  const count = h('span', { class: 'tiny muted' }, `${draft.bio.length}/300`);
  bio.addEventListener('input', () => { draft.bio = bio.value; count.textContent = `${bio.value.length}/300`; });
  const interests = chipGroup(INTERESTS.map((i) => [i, i]), { selected: draft.interests, multi: true, max: 8, onChange: (v) => { draft.interests = v; } });
  const err = h('p', { class: 'error', role: 'alert' });
  const next = h('button', { class: 'btn btn-primary btn-block' }, 'Create dating profile');
  next.onclick = async () => {
    err.textContent = '';
    if (!draft.interested.length) return (err.textContent = 'Pick at least one.');
    next.disabled = true;
    try { await saveDating(); goStep('done'); } catch (e) { err.textContent = api.friendly(e); next.disabled = false; }
  };
  return shell('A bit more about you', 'This helps the right people find you.', h('div', { class: 'stack-lg' },
    h('div', { class: 'field' }, h('span', {}, 'Show me'), interested.el),
    h('label', { class: 'field' }, h('span', { class: 'row-between' }, 'Bio', count), bio),
    h('div', { class: 'field' }, h('span', {}, 'Interests (up to 8)'), interests.el),
    err, next), () => goStep('date-basics'));
}

async function saveDating() {
  if (!state.profile) await api.createProfile(draft);
  state.profile = await api.myProfile();
  if (!state.profile) return;
  const extra = {};
  if (draft.birth && !state.profile.birth_date) extra.birth_date = draft.birth;
  // Their state, and the Discover filter starting on it.
  if (api.features.states) Object.assign(extra, { state: draft.location, pref_state: draft.location });
  if (api.features.matching) Object.assign(extra, { interested_in: draft.interested, bio: draft.bio.trim(), interests: draft.interests });
  if (Object.keys(extra).length) {
    await api.updateProfile(state.profile.handle, extra);
    state.profile = await api.myProfile();
  }
}

function stepDone() {
  return h('div', { class: 'auth center' },
    h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, h('span', {}, '🎉')),
      h('h3', {}, 'You’re all set!'),
      h('p', {}, 'You’re ', h('b', {}, state.profile ? state.profile.handle : 'in'), ' on treehouse. Start meeting people.')),
    h('button', { class: 'btn btn-white btn-block', onclick: () => finish('discover') }, '🔥 Start discovering'),
    h('button', { class: 'btn btn-glass btn-block', onclick: () => finish(state.profile && state.profile.state ? `rooms/${encodeURIComponent(state.profile.state)}` : 'rooms') }, '💬 Join your state’s chatroom'),
    h('button', { class: 'btn btn-soft btn-block', onclick: () => finish('home') }, 'Go home'));
}
function finish(where) {
  state.onboarding = false; step = 'date-basics';
  nav.go(where, { replace: true });
  emit('all');
  if (nav.offerLike) nav.offerLike();
}

// ---- Password reset (from the email link) -------------------------------------------------------
// ---- Date of birth for the age rooms (people who signed up before it was asked) --------------------
// Under 18 → the database suspends the profile and the app shows the under-18 screen.
export function askBirthday(onDone) {
  const dob = dobPicker(null);
  const err = h('p', { class: 'error', role: 'alert' });
  sheet((close) => {
    const save = h('button', { class: 'btn btn-primary btn-block' }, 'Save date of birth');
    save.onclick = async () => {
      err.textContent = '';
      const birth = dob.value();
      if (!birth) return (err.textContent = 'Choose your day, month and year of birth.');
      if (birth === 'invalid') return (err.textContent = 'That date doesn’t exist. Check your date of birth.');
      if (!(await confirmSheet({ title: `Born on ${formatDob(birth)}?`, yes: 'Yes, that’s right',
        text: 'Please check it carefully. You can only change your date of birth after 365 days.' }))) return;
      save.disabled = true;
      try {
        await api.updateProfile(state.profile.handle, { birth_date: birth });
        state.profile = await api.myProfile();
        close();
        if (state.profile.dob_underage_at) { rerender(); return; }
        toast('Date of birth saved', 'check');
        if (onDone) onDone();
      } catch (e) { err.textContent = api.friendly(e); save.disabled = false; }
    };
    return [h('h2', {}, '🎂 Add your date of birth'),
      h('p', { class: 'muted' }, 'Age rooms are for people the same age as you. Your date of birth is private: nobody else sees it. Your age updates on your birthday, so you move up an age room by yourself.'),
      h('div', { class: 'field' }, h('span', {}, 'Date of birth'), dob.el),
      h('p', { class: 'small muted' }, 'You can only change your date of birth after 365 days.'),
      err, h('div', { class: 'sheet-actions' }, save)];
  }, { label: 'Add your date of birth' });
}

export function renderUnderage() {
  return h('div', { class: 'auth-page' }, h('div', { class: 'auth center' },
    h('div', { class: 'empty' }, h('div', { class: 'empty-art' }, h('span', {}, '🔞')),
      h('h3', {}, 'treehouse is only for people 18 and over'),
      h('p', {}, 'Your account can’t be used. If you entered your date of birth by mistake, email support@treehouse.ng from the email address on your account.'),
      h('button', { class: 'btn btn-soft', onclick: () => api.signOut() }, 'Sign out'))));
}

export function renderNewPassword() {
  const p1 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8', placeholder: 'At least 8 characters' });
  const p2 = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Type it again' });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn btn-white btn-block' }, 'Save new password');
  return h('div', { class: 'auth-page' }, h('div', { class: 'auth' },
    h('div', { class: 'row', style: { justifyContent: 'center' } }, logo()),
    h('div', { class: 'onb-head' }, h('h1', {}, 'Choose a new password'), h('p', {}, 'You’ll use it to sign in from now on.')),
    h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (p1.value.length < 8) return (err.textContent = 'Use at least 8 characters.');
      if (p1.value !== p2.value) return (err.textContent = 'The passwords don’t match.');
      btn.disabled = true;
      try { await api.setPassword(p1.value); state.recovering = false; toast('Password saved'); await nav.afterSignIn(); }
      catch (e2) { err.textContent = api.friendly(e2); btn.disabled = false; }
    } }, h('label', { class: 'field' }, h('span', {}, 'New password'), p1), h('label', { class: 'field' }, h('span', {}, 'Confirm'), p2), err, btn)));
}
