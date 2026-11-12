// Server address: empty on the website; set by config.js in a phone app build.
const API = (window.TH_CONFIG && window.TH_CONFIG.apiBase) || '';
// Whose page is this? /u/<username> is a member's link; anything else is the site owner's page.
const LINK_USER = ((location.pathname.match(/^\/u\/([a-z0-9_]{3,20})\/?$/i) || [])[1] || '').toLowerCase() || null;
const OWNER_API = LINK_USER ? `/api/u/${LINK_USER}` : '/api/owner';
const SEND_API = LINK_USER ? `/api/u/${LINK_USER}/messages` : '/api/messages';

const form = document.getElementById('form');
const text = document.getElementById('text');
const submit = document.getElementById('submit');
const status = document.getElementById('status');
let ads = null;      // AdSense settings from the server, or null when ads are off
let adsLoaded = false;

// ---- 30-second ad (skippable after 10 seconds) -----------------------------
const AD_SECONDS = 30, SKIP_AFTER = 10;
// Video ads take turns: each one runs for 15 minutes, then the next. Everyone sees the same ad at
// the same time. `go` is the /go/<name> link (counted in Stats, set up in server.js).
// No video ads running right now (Ella and Troit removed 12 Nov 2026). To bring one back, add it here
// as { go, video, label, cta, note? } and restore the #intro block in index.html.
const VIDEO_ADS = [];
const AD_TURN_MS = 15 * 60 * 1000;
(function runIntro() {
  const intro = document.getElementById('intro');
  if (!intro || !VIDEO_ADS.length) { if (intro) intro.remove(); return; }
  // The ad plays once per visit: when someone opens the link, not each time they come back to this
  // page while browsing (from dating, after sending, reloads). A new tab or new visit plays it again.
  let seen = false;
  try { seen = sessionStorage.getItem('adSeen') === '1'; sessionStorage.setItem('adSeen', '1'); } catch {}
  if (seen) { intro.remove(); return; }

  const ad = VIDEO_ADS[Math.floor(Date.now() / AD_TURN_MS) % VIDEO_ADS.length];
  const video = document.getElementById('adVideo');
  video.src = ad.video;
  video.setAttribute('aria-label', ad.label);
  const cta = document.getElementById('adCta');
  cta.href = `/go/${ad.go}`;
  cta.textContent = ad.cta;
  const note = document.getElementById('adNote');
  if (ad.note) { note.textContent = ad.note; note.hidden = false; }
  const sound = document.getElementById('adSound');
  const count = document.getElementById('introCount');
  const skipBtn = document.getElementById('skipAd');
  const skipCount = document.getElementById('skipCount');
  // Browsers only autoplay muted video; the button turns the sound on.
  video.play().catch(() => {});
  sound.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted) video.play().catch(() => {});
    sound.textContent = video.muted ? '🔇 Tap for sound' : '🔊 Sound on';
  });
  intro.querySelector('.kick-bar i').classList.add('run');

  let elapsed = 0, done = false;
  function close() {
    if (done) return;
    done = true;
    clearInterval(timer);
    video.pause();
    intro.classList.add('closing');
    setTimeout(() => intro.remove(), 400);
  }
  const timer = setInterval(() => {
    elapsed += 1;
    if (elapsed >= AD_SECONDS) { close(); return; }
    count.textContent = AD_SECONDS - elapsed;
    if (elapsed < SKIP_AFTER) skipCount.textContent = SKIP_AFTER - elapsed;
    else if (skipBtn.disabled) { skipBtn.disabled = false; skipBtn.textContent = 'Skip ad ✕'; }
  }, 1000);
  skipBtn.addEventListener('click', close);
})();

// ---- Dating: "Date Anonymously" button and dating request cards ------------
const GENDER = { male: 'Male', female: 'Female', other: 'Other' };
const INTENT = { fun: 'Fun 😄', love: 'Love ❤️', marriage: 'Marriage 💍' };
const CARDS_PAGE = 12;

// If this visitor is signed in to dating on this site, send their token so blocked people stay hidden.
function datingToken(url) {
  try {
    const ref = new URL(url).hostname.split('.')[0];
    const s = JSON.parse(localStorage.getItem(`sb-${ref}-auth-token`) || 'null');
    if (s && s.access_token && s.expires_at * 1000 > Date.now() + 30000) return s.access_token;
  } catch {}
  return null;
}

function cardEl(c) {
  const a = document.createElement('a');
  a.className = 'dcard';
  a.href = `/home?to=${encodeURIComponent(c.handle)}`;
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
  return a;
}

// Cards load a page at a time; "Show more" fetches the next page until everyone has been shown.
let cardsOffset = 0;
let cardsAuth = {};
async function loadCards() {
  const more = document.getElementById('moreCards');
  more.disabled = true;
  more.textContent = 'Loading…';
  try {
    const res = await fetch(`${API}/api/dating-cards?offset=${cardsOffset}&limit=${CARDS_PAGE}`, cardsAuth).then((r) => r.json());
    const list = document.getElementById('cards');
    const shown = new Set([...list.querySelectorAll('.dcard')].map((a) => a.dataset.handle));
    for (const card of res.cards || []) {
      if (shown.has(card.handle)) continue;   // a new profile can shift pages by one
      const el = cardEl(card);
      el.dataset.handle = card.handle;
      list.append(el);
    }
    cardsOffset += (res.cards || []).length;
    if (list.children.length) document.getElementById('dating').classList.remove('hidden');
    more.classList.toggle('hidden', !res.more);
  } catch {
    more.classList.remove('hidden');
  }
  more.disabled = false;
  more.textContent = 'Show more';
}

fetch(API + '/api/dating-config').then((r) => r.json()).then((c) => {
  if (!c.enabled) return;
  document.getElementById('dateBtn').classList.remove('hidden');
  const token = datingToken(c.url);
  cardsAuth = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  document.getElementById('moreCards').onclick = loadCards;
  loadCards();
}).catch(() => {});

const IDEAS = [
  'what’s something you’ve never told anyone?',
  'honest first impression of me?',
  'what’s your biggest goal this year?',
  'who do you look up to the most?',
  'what song are you obsessed with right now?',
  'what’s your unpopular opinion?',
  'if you could live anywhere, where would it be?',
  'what’s the best advice you’ve ever gotten?',
  'what makes you really happy?',
  'what would you do if you won a million?',
  'rate your week out of 10',
  'what’s one thing you wish people knew about you?',
];

fetch(API + OWNER_API).then((r) => {
  if (!r.ok) throw Object.assign(new Error('missing'), { missing: r.status === 404 });
  return r.json();
}).then(({ name, username, prompt, maxLength: limit, ads: adSettings }) => {
  ads = adSettings;
  if (limit) { maxLength = limit; text.maxLength = limit; update(); }
  if (ads) {
    document.getElementById('cookieNote').textContent =
      'No cookies or trackers while you write. After you send, ads by Google may appear, and Google may use cookies.';
  }
  document.getElementById('owner').textContent = username || name;
  document.getElementById('prompt').textContent = prompt;
  document.title = `Message ${name} · treehouse`;
  if (LINK_USER) {
    // Members don't have a photo yet: show their initial.
    const avatar = document.getElementById('avatar');
    avatar.replaceChildren(document.createTextNode((name || username || '?').trim().charAt(0).toUpperCase()));
    avatar.classList.add('initial');
  }
}).catch((err) => {
  if (err && err.missing) {
    document.getElementById('intro')?.remove();
    document.getElementById('compose').classList.add('hidden');
    document.getElementById('missing').classList.remove('hidden');
    document.title = 'Link not found · treehouse';
  }
});

let maxLength = Number(text.maxLength) || 250;
const counter = document.getElementById('counter');

function update() {
  submit.disabled = !text.value.trim();
  const left = maxLength - text.value.length;
  counter.textContent = left;
  counter.classList.toggle('low', left <= 30);
  document.getElementById('outOfRoom').classList.toggle('hidden', left > 0);
}
text.addEventListener('input', update);

document.getElementById('dice').addEventListener('click', () => {
  let idea;
  do { idea = IDEAS[Math.floor(Math.random() * IDEAS.length)]; } while (idea === text.value && IDEAS.length > 1);
  text.value = idea;
  update();
  text.focus();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submit.disabled = true;
  status.textContent = 'Sending…';
  try {
    const res = await fetch(API + SEND_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ text: text.value, website: document.getElementById('website').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not send.');
    text.value = '';
    status.textContent = '';
    document.getElementById('compose').classList.add('hidden');
    document.getElementById('sent').classList.remove('hidden');
    showAd();
  } catch (err) {
    status.textContent = err.message;
    update();
  }
});

// Google's ad code is only ever added after a message has been sent.
function showAd() {
  if (!ads || adsLoaded) return;
  adsLoaded = true;
  if (ads.slot) {
    const box = document.getElementById('adBox');
    const unit = document.createElement('ins');
    unit.className = 'adsbygoogle';
    unit.style.display = 'block';
    unit.dataset.adClient = ads.client;
    unit.dataset.adSlot = ads.slot;
    unit.dataset.adFormat = 'auto';
    unit.dataset.fullWidthResponsive = 'true';
    box.append(unit);
    box.classList.remove('hidden');
  }
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ads.client)}`;
  document.head.append(script);
  if (ads.slot) (window.adsbygoogle = window.adsbygoogle || []).push({});
}

document.getElementById('again').addEventListener('click', () => {
  // Start fresh so no ad code is running while the next message is written.
  if (adsLoaded) {
    location.reload();   // the ad won't replay: it already played this visit
    return;
  }
  document.getElementById('sent').classList.add('hidden');
  document.getElementById('compose').classList.remove('hidden');
  update();
  text.focus();
});
