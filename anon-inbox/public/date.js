// Date Anonymously: profile -> intent -> create inbox (email sign-up) -> verify -> profile goes live.
// The profile is kept as a draft (this device + the account's private metadata) until the email is
// verified, then created with create_my_profile(), which also enforces 18+ and verification.

const $ = (id) => document.getElementById(id);
// Server address: empty on the website; set by config.js in a phone app build.
const API = (window.TH_CONFIG && window.TH_CONFIG.apiBase) || '';
const DRAFT_KEY = 'th_dating_draft';
const DM_KEY = 'th_dating_dm';   // handle of the card they tapped "Message" on
const GENDER = { male: 'Male', female: 'Female', other: 'Other' };
const INTENT = { fun: 'Fun 😄', love: 'Love ❤️', marriage: 'Marriage 💍' };
let sb = null;        // Supabase client
let signedIn = false; // a session exists (shows the tab bar)
let authMode = 'signup';

// ---- small helpers ---------------------------------------------------------
// Screens live on one page, so each screen change is added to the browser history: the phone's
// back gesture / browser Back then steps back through the screens instead of leaving the page.
const NO_HISTORY = new Set(['s-loading', 's-error']);
function show(id, { conv = null, push = true } = {}) {
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  // Inside chats the chat's own back button is enough; hide the link out to the homepage.
  // Signed-in members navigate with the tab bar; the homepage link is for visitors.
  document.querySelector('.back').classList.toggle('hidden', id === 's-chat' || id === 's-chats' || signedIn);
  window.scrollTo(0, 0);
  updateTabs(id);
  if (NO_HISTORY.has(id)) return;
  const state = { step: id, conv };
  const prev = history.state;
  if (prev && prev.step === id && prev.conv === conv) return;
  if (push && prev && prev.step && !NO_HISTORY.has(prev.step)) history.pushState(state, '', '/date');
  else history.replaceState(state, '', '/date');
}

window.addEventListener('popstate', (e) => {
  const st = e.state;
  if (!st || !st.step) return;
  if (st.step === 's-chat' && st.conv) return openChat(st.conv, { push: false });
  if (st.step === 's-chats') { current = null; return showChats({ push: false }); }
  // Once signed in with a live profile, the sign-up/sign-in screens behind it lead back to the profile.
  const AUTH_STEPS = ['s-profile', 's-intent', 's-inbox', 's-check', 's-forgot', 's-newpass', 's-under18'];
  if ((st.step === 's-live' || AUTH_STEPS.includes(st.step)) && live) { current = null; return renderLive(live, { push: false }); }
  show(st.step, { push: false });
});
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));

function storeGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function storeDel(k) { try { localStorage.removeItem(k); } catch {} }

const draft = () => storeGet(DRAFT_KEY) || {};
const saveDraft = (patch) => storeSet(DRAFT_KEY, { ...draft(), ...patch });
const draftComplete = (d) => d && d.name && d.gender && d.age >= 18 && d.intent && d.adult;

// Remember who they wanted to message (from a card), and say so at the top of the page.
function dmTarget() { try { return sessionStorage.getItem(DM_KEY); } catch { return null; } }
function setDmTarget(handle) { try { handle ? sessionStorage.setItem(DM_KEY, handle) : sessionStorage.removeItem(DM_KEY); } catch {} }
function showDmBanner(signedIn) {
  const target = dmTarget();
  const banner = $('dmBanner');
  banner.classList.toggle('hidden', !target || signedIn);
  if (target) banner.textContent = `Create your anonymous profile to message ${target}. Messaging needs a verified account, so both sides stay accountable.`;
}

function fail(message) {
  $('errorMsg').textContent = message;
  show('s-error');
}
$('errorRetry').onclick = () => location.replace('/date');

const friendly = (err) => {
  const m = (err && (err.message || err.error_description)) || String(err || '');
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
  if (/password/i.test(m) && /characters|weak|contain/i.test(m)) return 'Use at least 8 characters, with letters and numbers.';
  if (/not authorized|email address .* not/i.test(m)) return 'Sign-up emails aren’t switched on yet. Please try again later.';
  return m || 'Something went wrong. Please try again.';
};

// ---- Step 1: profile -------------------------------------------------------
function fillProfileForm() {
  const d = draft();
  $('fName').value = d.name || '';
  $('fGender').value = d.gender || '';
  $('fAge').value = d.age || '';
  $('fLocation').value = d.location || '';
  $('fAdult').checked = Boolean(d.adult);
}

$('profileForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('fName').value.trim();
  const gender = $('fGender').value;
  const ageText = $('fAge').value.trim();
  const age = Number(ageText);
  const location = $('fLocation').value.trim();
  const adult = $('fAdult').checked;
  const err = $('profileError');

  if (!name) return (err.textContent = 'Please enter your name.');
  if (!gender) return (err.textContent = 'Please choose a gender option.');
  if (!ageText || !Number.isInteger(age) || age < 1 || age > 120) return (err.textContent = 'Please enter your age as a number.');
  if (age < 18) { storeDel(DRAFT_KEY); return show('s-under18'); }
  if (!adult) return (err.textContent = 'Please confirm you are 18 or older.');

  err.textContent = '';
  saveDraft({ name, gender, age, location, adult: true });
  syncIntent();
  show('s-intent');
});

// ---- Step 2: intent --------------------------------------------------------
function syncIntent() {
  const current = draft().intent;
  document.querySelectorAll('input[name=intent]').forEach((r) => { r.checked = r.value === current; });
  $('intentDone').disabled = !current;
}
document.querySelectorAll('input[name=intent]').forEach((r) => r.addEventListener('change', () => {
  saveDraft({ intent: r.value });
  $('intentDone').disabled = false;
}));
$('intentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!draft().intent) return;
  // Already signed in (e.g. verified earlier but no profile yet)? Go straight to creating it.
  const { data } = await sb.auth.getSession();
  if (data.session) return goLive(data.session);
  setAuthMode('signup');
  show('s-inbox');
});

// ---- Step 3: create inbox / sign in ---------------------------------------
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('authStep').textContent = signup ? 'Step 3 of 3' : 'Welcome back';
  $('authTitle').textContent = signup ? 'Create your dating inbox' : 'Sign in';
  $('authSub').textContent = signup
    ? 'So people interested in you can message you. Your email is never shown to anyone.'
    : 'Sign in to your dating inbox.';
  $('authBtn').textContent = signup ? 'Create my inbox' : 'Sign in';
  $('authSwitch').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create a dating inbox';
  $('fPassword').autocomplete = signup ? 'new-password' : 'current-password';
  $('pwHint').hidden = !signup;
  $('forgotLink').classList.toggle('hidden', signup);
  $('authError').textContent = '';
}

// ---- Forgot password ---------------------------------------------------------
$('forgotLink').onclick = () => {
  $('forgotEmail').value = $('fEmail').value.trim();
  $('forgotMsg').textContent = '';
  show('s-forgot');
};

$('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('forgotEmail').value.trim();
  const msg = $('forgotMsg');
  msg.style.color = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (msg.textContent = 'Please enter a valid email address.');
  $('forgotBtn').disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() });
  $('forgotBtn').disabled = false;
  if (error) return (msg.textContent = friendly(error));
  // Same message whether or not the email has an account, so nobody can probe for accounts.
  msg.style.color = '#1f9d55';
  msg.textContent = 'If that email has a dating inbox, a reset link is on its way. Check your inbox (and spam).';
});

$('newPassForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('newPass').value, p2 = $('newPass2').value;
  const msg = $('newPassMsg');
  if (p1.length < 8 || !/[a-z]/i.test(p1) || !/\d/.test(p1)) return (msg.textContent = 'Use at least 8 characters, with letters and numbers.');
  if (p1 !== p2) return (msg.textContent = 'The two passwords don\u2019t match.');
  $('newPassBtn').disabled = true;
  const { data, error } = await sb.auth.updateUser({ password: p1 });
  $('newPassBtn').disabled = false;
  if (error) return (msg.textContent = friendly(error));
  const { data: s } = await sb.auth.getSession();
  goLive(s.session || { user: data.user });
});
$('toSignIn').onclick = () => { setAuthMode('signin'); show('s-inbox'); };

$('authSwitch').onclick = () => {
  if (authMode === 'signin') {
    // Creating an account needs the profile steps first.
    if (!draftComplete(draft())) { fillProfileForm(); return show('s-profile'); }
    setAuthMode('signup');
  } else setAuthMode('signin');
};

// Email links must open the real website (or the app, via app links) - not the app's internal address.
const SITE = (window.TH_CONFIG && window.TH_CONFIG.siteUrl) || location.origin;
const redirectTo = () => `${SITE}/date`;

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('fEmail').value.trim();
  const password = $('fPassword').value;
  const err = $('authError');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = 'Please enter a valid email address.');
  if (authMode === 'signup' && (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password))) {
    return (err.textContent = 'Use at least 8 characters, with letters and numbers.');
  }
  if (!password) return (err.textContent = 'Please enter your password.');

  $('authBtn').disabled = true;
  err.textContent = '';
  try {
    if (authMode === 'signup') {
      const d = draft();
      if (!draftComplete(d)) { fillProfileForm(); return show('s-profile'); }
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: {
          emailRedirectTo: redirectTo(),
          // Kept privately on the account so the profile can be created after verifying on any device.
          data: { pending_profile: { name: d.name, gender: d.gender, age: d.age, location: d.location || '', intent: d.intent } },
        },
      });
      if (error) throw error;
      // Supabase returns a user with no identities when the email is already registered.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setAuthMode('signin');
        $('fEmail').value = email;
        return (err.textContent = 'That email already has an account. Sign in instead.');
      }
      if (data.session) return goLive(data.session);   // only if confirmations were off
      $('checkEmail').textContent = email;
      $('checkMsg').textContent = '';
      show('s-check');
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) {
          $('checkEmail').textContent = email;
          $('checkMsg').textContent = 'Your email isn’t verified yet. Check your inbox, or resend the link below.';
          return show('s-check');
        }
        throw error;
      }
      await goLive(data.session);
    }
  } catch (ex) {
    err.textContent = friendly(ex);
  } finally {
    $('authBtn').disabled = false;
  }
});

// ---- Check email -----------------------------------------------------------
let resendWait = 0;
$('resendBtn').onclick = async () => {
  if (resendWait > 0) return;
  const email = $('checkEmail').textContent;
  const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirectTo() } });
  $('checkMsg').style.color = error ? '#dc2626' : '';
  $('checkMsg').textContent = error ? friendly(error) : 'Sent! Check your inbox (and spam folder).';
  resendWait = 180;
  const btn = $('resendBtn');
  btn.disabled = true;
  const t = setInterval(() => {
    resendWait -= 1;
    btn.textContent = resendWait > 0 ? `Resend email (${resendWait}s)` : 'Resend email';
    if (resendWait <= 0) { clearInterval(t); btn.disabled = false; }
  }, 1000);
};

// ---- Going live ------------------------------------------------------------
async function myProfile() {
  const { data, error } = await sb.from('dating_profiles').select('handle, gender, age, location, intent, is_active').maybeSingle();
  if (error) throw error;
  return data;
}

// Signed in: create the profile from the pending draft if needed, then show it.
async function goLive(session) {
  signedIn = true;
  show('s-loading');
  try {
    let profile = await myProfile();
    if (!profile) {
      const meta = session.user.user_metadata || {};
      const d = { ...(meta.pending_profile || {}), ...draft() };
      if (!d.name || !d.gender || !d.age || !d.intent) {
        // Verified account without a profile (e.g. new device): ask for the details again.
        fillProfileForm();
        return show('s-profile');
      }
      const { error } = await sb.rpc('create_my_profile', {
        p_name: d.name, p_gender: d.gender, p_age: Number(d.age), p_location: d.location || '', p_intent: d.intent,
      });
      if (error) throw error;
      profile = await myProfile();
    }
    // The draft has done its job: clear it here and from the account metadata.
    storeDel(DRAFT_KEY);
    if (session.user.user_metadata && session.user.user_metadata.pending_profile) {
      sb.auth.updateUser({ data: { pending_profile: null } }).catch(() => {});
    }
    me = session.user.id;
    renderLive(profile);
    startRealtime();
    const target = dmTarget();
    if (target) { setDmTarget(null); await startChatWith(target); }
    else if (startView === 'chats') showChats();
    else if (startView === 'browse') showBrowse();
    startView = null;
  } catch (ex) {
    fail(friendly(ex));
  }
}

let live = null;
function renderLive(p, opts = {}) {
  live = p;
  $('liveHandle').textContent = p.handle;
  $('liveMeta').textContent = [GENDER[p.gender], p.age, p.location].filter(Boolean).join(' · ');
  $('liveIntent').textContent = `Looking for: ${INTENT[p.intent]}`;
  $('liveStatus').textContent = p.is_active ? 'Your dating request is active.' : 'Your profile is paused, so your card is hidden.';
  $('liveStatus').style.color = p.is_active ? '' : '#b45309';
  $('pauseBtn').textContent = p.is_active ? 'Pause my profile' : 'Resume my profile';
  $('pauseHint').textContent = p.is_active ? 'Pausing hides your card. You can resume anytime.' : 'Resume to show your card again.';
  showDmBanner(true);
  show('s-live', opts);
  refreshChats();
}

$('pauseBtn').onclick = async () => {
  if (!live) return;
  $('pauseBtn').disabled = true;
  const { error } = await sb.from('dating_profiles').update({ is_active: !live.is_active }).eq('handle', live.handle);
  $('pauseBtn').disabled = false;
  if (error) return fail(friendly(error));
  renderLive({ ...live, is_active: !live.is_active });
};

$('deleteProfileBtn').onclick = async () => {
  if (!confirm('Delete your dating profile? Your card and name will be removed.')) return;
  const { error } = await sb.from('dating_profiles').delete().eq('handle', live.handle);
  if (error) return fail(friendly(error));
  live = null;
  $('deletedTitle').textContent = 'Profile deleted';
  $('deletedMsg').textContent = 'Your dating profile and card are gone. Your account still exists, so you can create a new profile anytime.';
  $('newProfileBtn').hidden = false;
  show('s-deleted');
};

$('deleteAccountBtn').onclick = async () => {
  if (!confirm('Permanently delete your account, email, profile and all chats? This cannot be undone.')) return;
  const { error } = await sb.rpc('delete_my_account');
  if (error) return fail(friendly(error));
  await sb.auth.signOut().catch(() => {});
  storeDel(DRAFT_KEY);
  setDmTarget(null);
  $('deletedTitle').textContent = 'Account deleted';
  $('deletedMsg').textContent = 'Your account, email, dating profile and chats have been permanently erased.';
  $('newProfileBtn').hidden = true;
  show('s-deleted');
};

$('newProfileBtn').onclick = () => { fillProfileForm(); show('s-profile'); };

$('signOutBtn').onclick = async () => {
  await sb.auth.signOut();
  location.replace('/date');
};

// ---- Start -----------------------------------------------------------------
(async function start() {
  // A failed or expired verification link comes back with an error in the URL.
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  const linkError = hash.get('error_description') || query.get('error_description');
  const recovering = hash.get('type') === 'recovery';

  let config;
  try { config = await (await fetch(API + '/api/dating-config')).json(); } catch {}
  if (!config || !config.ready || !window.supabase) return fail('Dating isn’t available right now. Please try again later.');

  sb = window.supabase.createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });

  const { data } = await sb.auth.getSession();
  startView = query.get('view');
  const to = query.get('to');
  if (to && /^[A-Za-z]+ [A-Za-z]+ \d{3}$/.test(to)) setDmTarget(to);
  if (location.hash || location.search) history.replaceState(null, '', '/date');

  if (data.session && recovering) return show('s-newpass');
  if (data.session) return goLive(data.session);
  if (linkError) {
    setAuthMode('signin');
    show('s-inbox');
    $('authError').textContent = /expired|invalid/i.test(linkError)
      ? 'That verification link has expired or was already used. Sign in to get a new one.'
      : linkError;
    return;
  }
  if (startView === 'browse') { startView = null; return showBrowse(); }
  fillProfileForm();
  showDmBanner(false);
  show('s-profile');
})();

// ---- Chats -------------------------------------------------------------------
let me = null;            // my user id (only used to tell my messages from theirs)
let chats = [];           // my_conversations() rows
let current = null;       // the open conversation row
let realtime = null;

const timeLabel = (iso) => {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                 : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const cardMeta = (c) => [GENDER[c.other_gender], c.other_age, c.other_location].filter(Boolean).join(' · ');

// Live events can arrive in bursts; gather them into one chat-list refresh.
let chatsSoon = null;
function refreshChatsSoon() {
  clearTimeout(chatsSoon);
  chatsSoon = setTimeout(refreshChats, 2000);
}

async function refreshChats() {
  const { data, error } = await sb.rpc('my_conversations');
  if (error) return;
  chats = data || [];
  const unread = chats.reduce((n, c) => n + (c.unread || 0), 0);
  $('chatsBadge').textContent = unread;
  $('chatsBadge').classList.toggle('hidden', !unread);
  refreshTabBadges();
  if (!$('s-chats').classList.contains('hidden')) renderChats();
  if (current) {
    const fresh = chats.find((c) => c.conversation_id === current.conversation_id);
    if (fresh) { current = fresh; renderChatState(); }
  }
}

function renderChats() {
  $('chatsMe').textContent = live ? live.handle : 'your anonymous name';
  const list = $('chatList');
  list.replaceChildren();
  $('chatsEmpty').classList.toggle('hidden', chats.length > 0);
  for (const c of chats) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'chat-row' + (c.unread ? ' unread' : '');
    const top = document.createElement('div');
    top.className = 'chat-row-top';
    const name = document.createElement('span');
    name.className = 'chat-row-handle';
    name.textContent = c.other_handle || 'Deleted profile';
    const when = document.createElement('span');
    when.className = 'chat-row-time';
    when.textContent = timeLabel(c.last_at);
    top.append(name, when);
    const meta = document.createElement('div');
    meta.className = 'chat-row-meta';
    meta.textContent = cardMeta(c);
    const last = document.createElement('div');
    last.className = 'chat-row-last';
    last.textContent = c.last_message ? (c.last_from_me ? 'You: ' : '') + c.last_message : 'Say hi 👋';
    row.append(top, meta, last);
    if (c.unread) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = c.unread;
      row.append(b);
    }
    row.onclick = () => openChat(c.conversation_id);
    list.append(row);
  }
}

function showChats(opts = {}) {
  renderChats();            // show the list straight away…
  show('s-chats', opts);
  refreshChats();           // …then bring it up to date (it re-renders while visible)
}
$('myChatsBtn').onclick = () => showChats();
$('chatBack').onclick = () => {
  current = null;
  if (history.state && history.state.step === 's-chat' && history.length > 1) history.back();
  else showChats();
};
document.querySelectorAll('[data-go-live]').forEach((b) => b.addEventListener('click', () => live && renderLive(live)));

// From a dating card: open (or create) the chat with that handle.
async function startChatWith(handle) {
  const { data: id, error } = await sb.rpc('start_conversation', { p_handle: handle });
  if (error) {
    $('dmSoon').textContent = /not available/i.test(error.message)
      ? `${handle} isn't available right now. They may have paused or deleted their profile.`
      : friendly(error);
    $('dmSoon').classList.remove('hidden');
    return;
  }
  await refreshChats();
  await openChat(id);
}

function bubble(m) {
  const el = document.createElement('div');
  el.className = 'msg ' + (m.sender_id === me ? 'mine' : 'theirs');
  el.dataset.id = m.id;
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = m.body;
  const t = document.createElement('div');
  t.className = 'msg-time';
  t.textContent = timeLabel(m.created_at);
  el.append(body, t);
  return el;
}

function addMessages(rows) {
  const box = $('chatMsgs');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  for (const m of rows) {
    if (box.querySelector(`[data-id="${m.id}"]`)) continue;   // already shown (realtime + reload)
    box.append(bubble(m));
  }
  if (nearBottom || rows.some((m) => m.sender_id === me)) box.scrollTop = box.scrollHeight;
}

async function openChat(conversationId, opts = {}) {
  current = chats.find((c) => c.conversation_id === conversationId) || { conversation_id: conversationId };
  $('chatHandle').textContent = current.other_handle || 'Anonymous';
  $('chatMeta').textContent = current.other_handle ? `${cardMeta(current)} · ${INTENT[current.other_intent]}` : '';
  $('chatError').textContent = '';
  const box = $('chatMsgs');
  box.querySelectorAll('.msg').forEach((m) => m.remove());
  show('s-chat', { conv: conversationId, push: opts.push !== false });
  const { data, error } = await sb.from('dating_messages')
    .select('id, sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(200);
  if (error) return ($('chatError').textContent = friendly(error));
  addMessages((data || []).reverse());
  box.scrollTop = box.scrollHeight;
  sb.rpc('mark_conversation_read', { p_conversation: conversationId }).then(refreshChats);
  revealedName = null;
  closeMenu();
  $('reportSheet').classList.add('hidden');
  renderChatState();
  if (!current.blocked) $('chatInput').focus({ preventScroll: true });
}

// Grow the message box with its text (up to a few lines).
$('chatInput').addEventListener('input', () => {
  const t = $('chatInput');
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
});
// Enter sends on computers; on phones Enter adds a new line and the button sends.
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); $('chatForm').requestSubmit(); }
});

$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = $('chatInput').value.trim();
  if (!body || !current) return;
  $('chatSend').disabled = true;
  $('chatError').textContent = '';
  const { data, error } = await sb.from('dating_messages')
    .insert({ conversation_id: current.conversation_id, body })
    .select('id, sender_id, body, created_at').single();
  $('chatSend').disabled = false;
  if (error) {
    $('chatError').textContent = /slow down|too many/i.test(error.message)
      ? 'Slow down a little. You can send up to 20 messages a minute.'
      : /row-level security|violates/i.test(error.message) ? 'You can’t message in this chat.' : friendly(error);
    return;
  }
  $('chatInput').value = '';
  $('chatInput').style.height = 'auto';
  addMessages([data]);
});

// Live updates: new messages in any of my chats (the database only sends me rows I'm allowed to see).
function startRealtime() {
  if (realtime) return;
  realtime = sb.channel('dating-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dating_messages' }, (payload) => {
      const m = payload.new;
      if (current && m.conversation_id === current.conversation_id) {
        addMessages([m]);
        if (m.sender_id !== me) sb.rpc('mark_conversation_read', { p_conversation: m.conversation_id });
      }
      refreshChatsSoon();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dating_reveals' }, () => refreshChatsSoon())
    .subscribe();
}

// Safety net if live updates drop (sleeping phone, flaky network): check every minute.
setInterval(async () => {
  if (!sb || !me || document.hidden) return;
  if (current) {
    const box = $('chatMsgs');
    const lastShown = box.querySelector('.msg:last-of-type');
    const { data } = await sb.from('dating_messages').select('id, sender_id, body, created_at')
      .eq('conversation_id', current.conversation_id).order('created_at', { ascending: false }).limit(20);
    if (data) addMessages(data.reverse());
    if (lastShown !== box.querySelector('.msg:last-of-type')) sb.rpc('mark_conversation_read', { p_conversation: current.conversation_id });
  }
  refreshChats();
}, 60000);

// ---- Reveal, block, report -----------------------------------------------------
let revealedName = null;
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The bar under the chat header. `html` is built only from fixed text plus esc()-escaped values.
function revealBar(html, buttons = []) {
  const bar = $('revealBar');
  bar.replaceChildren();
  const p = document.createElement('p');
  p.innerHTML = html;
  bar.append(p);
  if (buttons.length) {
    const row = document.createElement('div');
    row.className = 'reveal-actions';
    for (const [label, cls, fn] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.onclick = fn;
      row.append(b);
    }
    bar.append(row);
  }
}

async function renderChatState() {
  if (!current) return;
  const who = esc(current.other_handle || 'They');
  const blocked = Boolean(current.blocked);
  $('chatInput').disabled = blocked;
  $('chatSend').disabled = blocked;
  $('blockBtn').textContent = current.i_blocked ? 'Unblock' : 'Block';
  $('chatMenuBtn').hidden = !current.other_handle;

  if (current.i_blocked) {
    $('chatName').classList.add('hidden');
    return revealBar(`You blocked ${who}. They can't message you or see your card.`, [['Unblock', 'rb ghost', unblock]]);
  }
  if (blocked) {
    $('chatName').classList.add('hidden');
    return revealBar('This chat is closed. You can’t message here any more.');
  }
  if (current.i_revealed && current.they_revealed) {
    if (!revealedName) {
      const { data } = await sb.rpc('revealed_details', { p_conversation: current.conversation_id });
      revealedName = data && data[0] ? data[0].name : null;
    }
    if (revealedName) {
      $('chatName').textContent = `Real name: ${revealedName}`;
      $('chatName').classList.remove('hidden');
      return revealBar(`💫 You've both revealed. ${who} is <b>${esc(revealedName)}</b>.`);
    }
  }
  $('chatName').classList.add('hidden');
  if (current.i_revealed) {
    return revealBar(`You asked to reveal. Waiting for ${who} to agree. Your name stays hidden until they do.`,
      [['Cancel my reveal', 'rb ghost', cancelReveal]]);
  }
  if (current.they_revealed) {
    return revealBar(`<b>${who} wants to reveal.</b> Reveal too? Names show to both of you only if you agree.`,
      [['Reveal too', 'rb', askReveal]]);
  }
  revealBar('🔒 You’re anonymous to each other.', [['Reveal my details', 'rb', askReveal]]);
}

async function askReveal() {
  const who = current.other_handle;
  const msg = current.they_revealed
    ? `Reveal your name to ${who}? You'll both see each other's names.`
    : `Ask to reveal names with ${who}? Your name only shows if they agree too, and you can cancel until then.`;
  if (!confirm(msg)) return;
  const { error } = await sb.from('dating_reveals').insert({ conversation_id: current.conversation_id });
  if (error && !/duplicate/i.test(error.message)) return ($('chatError').textContent = friendly(error));
  current.i_revealed = true;
  renderChatState();
  refreshChats();
}

async function cancelReveal() {
  const { error } = await sb.from('dating_reveals').delete().eq('conversation_id', current.conversation_id).eq('user_id', me);
  if (error) return ($('chatError').textContent = friendly(error));
  current.i_revealed = false;
  renderChatState();
  refreshChats();
}

// ⋯ menu
function closeMenu() { $('chatMenu').classList.add('hidden'); $('chatMenuBtn').setAttribute('aria-expanded', 'false'); }
$('chatMenuBtn').onclick = (e) => {
  e.stopPropagation();
  const open = $('chatMenu').classList.toggle('hidden') === false;
  $('chatMenuBtn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('click', (e) => { if (!$('chatMenu').contains(e.target)) closeMenu(); });

async function block() {
  if (!confirm(`Block ${current.other_handle}? They won't be able to message you or see your card. You can unblock later.`)) return;
  const { error } = await sb.rpc('block_conversation_partner', { p_conversation: current.conversation_id });
  if (error) return ($('chatError').textContent = friendly(error));
  current.i_blocked = true; current.blocked = true;
  renderChatState();
  refreshChats();
}
async function unblock() {
  const { error } = await sb.rpc('unblock_conversation_partner', { p_conversation: current.conversation_id });
  if (error) return ($('chatError').textContent = friendly(error));
  current.i_blocked = false;
  await refreshChats();
  renderChatState();
}
$('blockBtn').onclick = () => { closeMenu(); current.i_blocked ? unblock() : block(); };

// Report sheet
$('reportBtn').onclick = () => {
  closeMenu();
  $('reportWho').textContent = current.other_handle;
  document.querySelectorAll('input[name=reason]').forEach((r) => { r.checked = false; });
  $('reportDetails').value = '';
  $('reportBlock').checked = !current.i_blocked;
  $('reportBlock').closest('label').hidden = Boolean(current.i_blocked);
  $('reportSend').disabled = true;
  $('reportError').textContent = '';
  $('reportSheet').classList.remove('hidden');
};
document.querySelectorAll('input[name=reason]').forEach((r) => r.addEventListener('change', () => { $('reportSend').disabled = false; }));
$('reportCancel').onclick = () => $('reportSheet').classList.add('hidden');
$('reportSheet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = (document.querySelector('input[name=reason]:checked') || {}).value;
  if (!reason) return;
  $('reportSend').disabled = true;
  const { error } = await sb.rpc('report_conversation_partner', {
    p_conversation: current.conversation_id, p_reason: reason, p_details: $('reportDetails').value.trim(),
  });
  if (error) { $('reportSend').disabled = false; return ($('reportError').textContent = friendly(error)); }
  if ($('reportBlock').checked && !current.i_blocked) {
    await sb.rpc('block_conversation_partner', { p_conversation: current.conversation_id });
    current.i_blocked = true; current.blocked = true;
  }
  $('reportSheet').classList.add('hidden');
  await renderChatState();
  const note = document.createElement('p');
  note.innerHTML = '<b>Thanks, your report was sent.</b>';
  $('revealBar').append(note);
  refreshChats();
});

// ---- Browse dating requests (inside the app) ------------------------------------------
let startView = null;        // ?view=browse|chats from the tab bar
let browseOffset = 0;
const BROWSE_PAGE = 12;

function browseCard(c) {
  const a = document.createElement('button');
  a.type = 'button';
  a.className = 'dcard';
  const head = document.createElement('div');
  head.className = 'dcard-head';
  head.textContent = c.handle;
  const body = document.createElement('div');
  body.className = 'dcard-body';
  const meta = document.createElement('div');
  meta.className = 'dcard-meta';
  meta.textContent = [GENDER[c.gender], c.age, c.location].filter(Boolean).join(' · ');
  const intent = document.createElement('span');
  intent.className = 'dcard-intent';
  intent.textContent = INTENT[c.intent] || c.intent;
  const cta = document.createElement('span');
  cta.className = 'dcard-cta';
  cta.textContent = 'Message';
  body.append(meta, intent, cta);
  a.append(head, body);
  a.onclick = () => {
    if (live) return startChatWith(c.handle);
    // No dating profile yet: remember who they picked and start the profile steps.
    setDmTarget(c.handle);
    fillProfileForm();
    showDmBanner(false);
    show('s-profile');
  };
  return a;
}

async function loadBrowse(reset) {
  const list = $('browseCards'), more = $('browseMore');
  if (reset) { list.replaceChildren(); browseOffset = 0; }
  more.disabled = true;
  more.textContent = 'Loading…';
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session && data.session.access_token;
    const res = await fetch(`${API}/api/dating-cards?offset=${browseOffset}&limit=${BROWSE_PAGE}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {}).then((r) => r.json());
    const shown = new Set([...list.querySelectorAll('.dcard-head')].map((h) => h.textContent));
    for (const c of res.cards || []) if (!shown.has(c.handle)) list.append(browseCard(c));
    browseOffset += (res.cards || []).length;
    $('browseEmpty').classList.toggle('hidden', list.children.length > 0);
    more.classList.toggle('hidden', !res.more);
  } catch {
    more.classList.remove('hidden');
  }
  more.disabled = false;
  more.textContent = 'Show more';
}
$('browseMore').onclick = () => loadBrowse(false);

function showBrowse(opts = {}) {
  show('s-browse', opts);
  loadBrowse(true);
}
document.querySelectorAll('[data-browse]').forEach((b) => b.addEventListener('click', () => showBrowse()));

// ---- Tab bar ------------------------------------------------------------------------
const DATING_TAB_SCREENS = new Set(['s-live', 's-chats', 's-profile', 's-intent', 's-deleted']);
function updateTabs(id) {
  if (!window.appTabs) return;
  if (!signedIn || id === 's-chat' || id === 's-loading' || id === 's-newpass') return appTabs.hide();
  appTabs.show(id === 's-browse' ? 'browse' : DATING_TAB_SCREENS.has(id) ? 'dating' : null);
}
if (window.appTabs) {
  appTabs.onSelect('browse', () => showBrowse());
  appTabs.onSelect('dating', () => (live ? showChats() : (fillProfileForm(), show('s-profile'))));
}
async function refreshTabBadges() {
  if (!signedIn || !window.appTabs) return;
  appTabs.badge('dating', chats.reduce((n, c) => n + (c.unread || 0), 0));
  const { count } = await sb.from('link_messages').select('id', { count: 'exact', head: true }).eq('is_read', false);
  appTabs.badge('inbox', count || 0);
}
