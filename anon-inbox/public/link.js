// Get your link: sign up / sign in (same accounts as Date Anonymously) -> choose a username -> your link.

const $ = (id) => document.getElementById(id);
const API = (window.TH_CONFIG && window.TH_CONFIG.apiBase) || '';
const SITE = (window.TH_CONFIG && window.TH_CONFIG.siteUrl) || location.origin;
const PROMPTS = ['send me anonymous messages!', 'ask me anything', 'tell me a secret', 'confessions', 'rate me 1-10', 'what do you really think of me?',
  'never have I ever', 'shoot your shot 💘', 'drop a compliment', 'describe me in one word'];
let sb = null;
let mode = 'signup';
let link = null;   // my links row

let signedIn = false;
let startView = new URLSearchParams(location.search).get('view');   // ?view=settings from the tab bar
function show(id) {
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  window.scrollTo(0, 0);
  if (window.appTabs) {
    if (signedIn && (id === 's-mine' || id === 's-claim')) appTabs.show('inbox');
    else if (signedIn && id === 's-settings') appTabs.show('settings');
    else appTabs.hide();
  }
  document.querySelector('.back').classList.toggle('hidden', signedIn);
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go)));
function fail(message) { $('errorMsg').textContent = message; show('s-error'); }
$('errorRetry').onclick = () => location.replace('/link');

const friendly = (err) => {
  const m = (err && (err.message || err.error_description)) || String(err || '');
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
  return m || 'Something went wrong. Please try again.';
};
const linkUrl = (username) => `${SITE}/u/${username}`;

// ---- Account ------------------------------------------------------------------
function setMode(m) {
  mode = m;
  const signup = m === 'signup';
  $('authTitle').textContent = signup ? 'Create your account' : 'Sign in';
  $('authSub').textContent = signup ? 'Your email is never shown to anyone.' : 'Use the same account as Date Anonymously.';
  $('authBtn').textContent = signup ? 'Create account' : 'Sign in';
  $('authSwitch').textContent = signup ? 'Already have an account? Sign in' : 'New here? Create an account';
  $('fPassword').autocomplete = signup ? 'new-password' : 'current-password';
  $('pwHint').hidden = !signup;
  $('ageRow').hidden = !signup;
  $('forgotLink').classList.toggle('hidden', signup);
  $('authError').textContent = '';
}
$('startSignup').onclick = () => { setMode('signup'); show('s-auth'); };
$('startSignin').onclick = () => { setMode('signin'); show('s-auth'); };
$('authSwitch').onclick = () => setMode(mode === 'signup' ? 'signin' : 'signup');

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('fEmail').value.trim();
  const password = $('fPassword').value;
  const err = $('authError');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = 'Please enter a valid email address.');
  if (mode === 'signup') {
    if (password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) return (err.textContent = 'Use at least 8 characters, with letters and numbers.');
    if (!$('fAge').checked) return (err.textContent = 'Please confirm you are 13 or older.');
  } else if (!password) return (err.textContent = 'Please enter your password.');

  $('authBtn').disabled = true;
  err.textContent = '';
  try {
    if (mode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${SITE}/link` } });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setMode('signin');
        $('fEmail').value = email;
        return (err.textContent = 'That email already has an account. Sign in instead.');
      }
      if (data.session) return afterSignIn();
      $('checkEmail').textContent = email;
      show('s-check');
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        if (/not confirmed/i.test(error.message)) {
          $('checkEmail').textContent = email;
          $('checkMsg').textContent = 'Your email isn’t verified yet. Check your inbox, or resend the link below.';
          return show('s-check');
        }
        throw error;
      }
      await afterSignIn();
    }
  } catch (ex) {
    err.textContent = friendly(ex);
  } finally {
    $('authBtn').disabled = false;
  }
});

let resendWait = 0;
$('resendBtn').onclick = async () => {
  if (resendWait > 0) return;
  const { error } = await sb.auth.resend({ type: 'signup', email: $('checkEmail').textContent, options: { emailRedirectTo: `${SITE}/link` } });
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

async function afterSignIn() {
  signedIn = true;
  show('s-loading');
  const { data, error } = await sb.from('links').select('username, display_name, prompt, is_active, suspended').maybeSingle();
  if (error) return fail(friendly(error));
  if (data) return renderMine(data);
  show('s-claim');
}

// ---- Choose a username --------------------------------------------------------
for (const p of PROMPTS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = p;
  b.onclick = () => { $('fPrompt').value = p; };
  $('promptChips').append(b);
}

let checkTimer = null, available = false;
$('fUsername').addEventListener('input', () => {
  const input = $('fUsername');
  input.value = input.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const name = input.value;
  $('urlPreview').textContent = name ? `Your link: ${linkUrl(name).replace(/^https?:\/\//, '')}` : '';
  const status = $('userStatus');
  available = false;
  updateClaim();
  clearTimeout(checkTimer);
  if (name.length < 3) { status.className = ''; status.textContent = '3–20 letters, numbers or underscores.'; return; }
  status.className = ''; status.textContent = 'Checking…';
  checkTimer = setTimeout(async () => {
    const { data, error } = await sb.rpc('username_available', { p_username: name });
    if (input.value !== name) return;   // they kept typing
    available = !error && data === true;
    status.className = available ? 'ok' : 'bad';
    status.textContent = error ? 'Couldn’t check right now.' : available ? `✓ ${name} is available` : `✗ ${name} is taken`;
    updateClaim();
  }, 350);
});
$('fDisplay').addEventListener('input', updateClaim);
function updateClaim() { $('claimBtn').disabled = !(available && $('fDisplay').value.trim()); }

$('claimForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('claimBtn').disabled) return;
  $('claimBtn').disabled = true;
  const { error } = await sb.rpc('claim_link', {
    p_username: $('fUsername').value, p_display_name: $('fDisplay').value.trim(), p_prompt: $('fPrompt').value.trim(),
  });
  if (error) {
    $('claimError').textContent = /taken/i.test(error.message) ? 'Someone just took that username. Try another.' : friendly(error);
    $('claimBtn').disabled = false;
    return;
  }
  afterSignIn();
});

// ---- My link --------------------------------------------------------------------
function renderMine(l) {
  link = l;
  $('myUrl').textContent = linkUrl(l.username).replace(/^https?:\/\//, '');
  $('pvUser').textContent = l.username;
  $('pvPrompt').textContent = l.prompt;
  $('eDisplay').value = l.display_name;
  renderTopic();
  $('pauseBtn').textContent = l.is_active ? 'Pause my link' : 'Resume my link';
  $('pausedNote').classList.toggle('hidden', l.is_active && !l.suspended);
  $('pausedNote').textContent = l.suspended ? 'Your link has been suspended by Tell Hydra.' : 'Your link is paused, so it isn’t taking messages.';
  $('mineTitle').textContent = `@${l.username} · ${linkUrl(l.username).replace(/^https?:\/\//, '')}`;
  $('topicLineText').textContent = l.prompt;
  if (startView === 'settings') show('s-settings');
  else if (!$('s-settings').classList.contains('hidden')) { /* stay on Settings after saving there */ }
  else show('s-mine');
  startView = null;
  loadInbox();
  startLive();
}

$('copyBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(linkUrl(link.username)); $('copyBtn').textContent = 'Copied!'; }
  catch { $('copyBtn').textContent = 'Copy failed'; }
  setTimeout(() => { $('copyBtn').textContent = 'Copy'; }, 1800);
};
async function shareLink() {
  const url = linkUrl(link.username);
  if (navigator.share) { try { await navigator.share({ title: link.prompt, url }); } catch {} }
  else {
    try { await navigator.clipboard.writeText(url); alert('Link copied!'); } catch { alert(url); }
  }
}
$('shareBtn').onclick = shareLink;
$('shareBtn2').onclick = shareLink;
$('topicLine').onclick = () => { show('s-settings'); $('topicCard').scrollIntoView({ block: 'start' }); };

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const display_name = $('eDisplay').value.trim();
  if (!display_name) return ($('editMsg').textContent = 'Please fill in your display name.');
  const { error } = await sb.from('links').update({ display_name }).eq('username', link.username);
  $('editMsg').style.color = error ? '' : '#1f9d55';
  $('editMsg').textContent = error ? friendly(error) : 'Saved.';
  if (!error) renderMine({ ...link, display_name });
});

// ---- Topic ------------------------------------------------------------------------
// Messages keep the topic they were sent to, so changing it doesn't relabel old messages.
function renderTopic() {
  $('topicNow').textContent = `“${link.prompt}”`;
  const chips = $('topicChips');
  chips.replaceChildren();
  for (const p of PROMPTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p;
    b.classList.toggle('on', p === link.prompt);
    b.onclick = () => saveTopic(p);
    chips.append(b);
  }
}

async function saveTopic(prompt) {
  prompt = prompt.trim();
  const msg = $('topicMsg');
  msg.style.color = '';
  if (!prompt) return (msg.textContent = 'Write a topic first.');
  if (prompt === link.prompt) return (msg.textContent = '');
  const { error } = await sb.from('links').update({ prompt }).eq('username', link.username);
  if (error) return (msg.textContent = friendly(error));
  link = { ...link, prompt };
  $('pvPrompt').textContent = prompt;
  $('topicLineText').textContent = prompt;
  $('topicInput').value = '';
  renderTopic();
  msg.style.color = '#1f9d55';
  msg.textContent = 'Topic saved. Share your link or story sticker!';
}
$('topicForm').addEventListener('submit', (e) => { e.preventDefault(); saveTopic($('topicInput').value); });

$('pauseBtn').onclick = async () => {
  const { error } = await sb.from('links').update({ is_active: !link.is_active }).eq('username', link.username);
  if (error) return fail(friendly(error));
  renderMine({ ...link, is_active: !link.is_active });
};

$('signOutBtn').onclick = async () => { await sb.auth.signOut(); location.replace('/link'); };

// ---- Start --------------------------------------------------------------------------
(async function start() {
  let config;
  try { config = await (await fetch(API + '/api/dating-config')).json(); } catch {}
  if (!config || !config.ready || !window.supabase) return fail('Links aren’t available right now. Please try again later.');
  sb = window.supabase.createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  const hash = new URLSearchParams(location.hash.slice(1));
  const linkError = hash.get('error_description');
  const { data } = await sb.auth.getSession();
  if (location.hash || location.search) history.replaceState(null, '', '/link');
  if (data.session) return afterSignIn();
  if (linkError) {
    setMode('signin');
    show('s-auth');
    $('authError').textContent = /expired|invalid/i.test(linkError)
      ? 'That verification link has expired or was already used. Sign in to get a new one.' : linkError;
    return;
  }
  show('s-welcome');
})();

// ---- Inbox ----------------------------------------------------------------------------
let messages = [];
let current = null;      // the open message
let image = null;        // { blob, url, filename } of the open story image
let live = null;

const timeAgo = (iso) => {
  const hours = Math.floor((Date.now() - new Date(iso)) / 3.6e6);
  if (hours < 1) return 'Within the last hour';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const storyFooter = () => linkUrl(link.username).replace(/^https?:\/\//, '');

async function loadInbox() {
  const { data, error } = await sb.from('link_messages')
    .select('id, prompt, body, created_at, is_read').order('id', { ascending: false }).limit(100);
  if (error) return;
  messages = data || [];
  renderInbox();
}

let datingBadgeAt = 0;
function renderInbox() {
  const list = $('inboxList');
  list.replaceChildren();
  const unread = messages.filter((m) => !m.is_read).length;
  $('inboxBadge').textContent = unread ? `${unread} new` : '';
  $('inboxBadge').classList.toggle('hidden', !unread);
  $('inboxEmpty').classList.toggle('hidden', messages.length > 0);
  if (window.appTabs) {
    appTabs.badge('inbox', unread);
    // The Dating tab's unread count: at most once a minute, it's only a badge.
    if (Date.now() - datingBadgeAt > 60000) {
      datingBadgeAt = Date.now();
      sb.rpc('my_conversations').then(({ data }) => appTabs.badge('dating', (data || []).reduce((n, c) => n + (c.unread || 0), 0)));
    }
  }
  for (const m of messages) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'msg-row' + (m.is_read ? '' : ' unread');
    const icon = document.createElement('span');
    icon.className = 'msg-icon';
    icon.textContent = m.is_read ? '💬' : '🔒';
    const text = document.createElement('span');
    text.className = 'msg-text';
    const title = document.createElement('b');
    title.textContent = m.is_read ? m.body : 'New message!';
    const when = document.createElement('small');
    when.textContent = timeAgo(m.created_at);
    text.append(title, when);
    row.append(icon, text);
    row.onclick = () => openMessage(m);
    list.append(row);
  }
}

// New messages arrive live (row-level security only sends this person their own rows),
// with a once-a-minute check as a fallback.
function startLive() {
  if (live) return;
  live = sb.channel('my-link-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'link_messages' }, () => loadInbox())
    .subscribe();
}
setInterval(() => { if (link && !document.hidden && !$('s-mine').classList.contains('hidden')) loadInbox(); }, 60000);

const blobToDataUrl = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

async function showStory(opts, filename, moderation) {
  const img = $('msgImg');
  img.classList.add('hidden');
  img.removeAttribute('src');
  $('msgLoading').classList.remove('hidden');
  $('msgModeration').classList.toggle('hidden', !moderation);
  $('reportSheet').classList.add('hidden');
  show('s-msg');
  history.pushState({ step: 's-msg' }, '', '/link');
  const blob = await drawStory({ ...opts, footer: storyFooter() });
  if (image) URL.revokeObjectURL(image.url);
  image = { blob, filename, url: URL.createObjectURL(blob) };
  img.src = await blobToDataUrl(blob);   // a plain image, so press-and-hold offers "Save"
  img.classList.remove('hidden');
  $('msgLoading').classList.add('hidden');
}

function openMessage(m) {
  current = m;
  $('msgTime').textContent = timeAgo(m.created_at);
  $('msgImg').alt = `Message: ${m.body}`;
  showStory({ prompt: m.prompt || link.prompt, text: m.body }, `tell-hydra-${m.id}.jpg`, true);
  if (!m.is_read) {
    m.is_read = true;
    renderInbox();
    sb.from('link_messages').update({ is_read: true }).eq('id', m.id).then(() => {});
  }
}

$('stickerBtn').onclick = () => {
  current = null;
  $('msgTime').textContent = 'Your story sticker';
  $('msgImg').alt = 'Story sticker inviting anonymous messages';
  showStory({ prompt: link.prompt, sticker: true }, 'tell-hydra-sticker.jpg', false);
};

function backToInbox() { show('s-mine'); renderInbox(); }
$('msgBack').onclick = () => history.back();
window.addEventListener('popstate', () => { if (!$('s-msg').classList.contains('hidden')) backToInbox(); });

function saveImage() {
  if (!image) return;
  const a = document.createElement('a');
  a.href = image.url;
  a.download = image.filename;
  a.click();
}
$('msgSave').onclick = saveImage;
$('msgShare').onclick = async () => {
  if (!image) return;
  const file = new File([image.blob], image.filename, { type: 'image/jpeg' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text: linkUrl(link.username) }); } catch {}
  } else saveImage();
};

async function deleteCurrent() {
  const { error } = await sb.from('link_messages').delete().eq('id', current.id);
  if (error) return alert(friendly(error));
  messages = messages.filter((x) => x.id !== current.id);
  current = null;
  history.back();
}
$('msgDelete').onclick = () => { if (current && confirm('Delete this message for good?')) deleteCurrent(); };

$('msgReport').onclick = () => {
  document.querySelectorAll('input[name=reason]').forEach((r) => { r.checked = false; });
  $('reportSend').disabled = true;
  $('reportError').textContent = '';
  $('reportSheet').classList.remove('hidden');
};
document.querySelectorAll('input[name=reason]').forEach((r) => r.addEventListener('change', () => { $('reportSend').disabled = false; }));
$('reportCancel').onclick = () => $('reportSheet').classList.add('hidden');
$('reportSheet').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = (document.querySelector('input[name=reason]:checked') || {}).value;
  if (!reason || !current) return;
  $('reportSend').disabled = true;
  const { error } = await sb.rpc('report_link_message', { p_message: current.id, p_reason: reason });
  if (error) { $('reportSend').disabled = false; return ($('reportError').textContent = friendly(error)); }
  $('reportSheet').classList.add('hidden');
  if ($('reportDelete').checked) return deleteCurrent();
  alert('Thanks, your report was sent.');
});

if (window.appTabs) {
  appTabs.onSelect('inbox', () => { if (link) { show('s-mine'); loadInbox(); } else location.href = '/link'; });
  appTabs.onSelect('settings', () => { if (link) show('s-settings'); else location.href = '/link'; });
}
