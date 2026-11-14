// Fake Supabase client for the local design preview (dev/mock-server.mjs). Sample people only.
// ?signedout=1 previews the landing page; ?empty=1 previews a brand-new account with nothing yet.
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('signedout')) sessionStorage.setItem('mock-out', '1');
  if (q.get('empty')) sessionStorage.setItem('mock-empty', '1');
  if (q.get('reset')) { sessionStorage.clear(); }
  const signedOut = sessionStorage.getItem('mock-out') === '1';
  // Preview only: pretend the phone is in Wuse, Abuja (no real location is read).
  try { Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 9.0765, longitude: 7.4793 } }), 300) } }); } catch {}
  const empty = sessionStorage.getItem('mock-empty') === '1';
  const ME = '00000000-0000-0000-0000-000000000001';
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
    'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
    'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];

  const profile = { birth_date: /[?&]nodob=1/.test(location.search) ? null : '1999-03-14', dob_underage_at: null, age_changed_at: new Date(Date.now() - 90 * 864e5).toISOString(), handle: 'Lucky Dolphin 214', name: 'Ada', gender: 'male', age: 27, location: 'Lagos', intent: 'love', is_active: true, suspended: false,
    bio: 'Afrobeats, suya and long walks on Bar Beach.', interests: ['Music', 'Afrobeats', 'Football', 'Food'], interested_in: ['female'], min_age: 21, max_age: 35,
    state: 'Lagos', pref_state: 'Lagos' };

  const convo = (id, handle, extra) => Object.assign({ conversation_id: id, other_handle: handle, other_gender: 'female', other_age: 24, other_location: 'Lagos',
    other_intent: 'love', last_message: null, last_from_me: false, last_at: ago(30), unread: 0, i_revealed: false, they_revealed: false,
    blocked: false, i_blocked: false, status: 'chat', other_online: false, other_active_hours: 3, matched: false, other_read_at: null, accepted_at: ago(500), started_by_me: false }, extra);
  const convos = empty ? [] : [
    convo('c1', 'Velvet Mango 532', { last_message: 'Haha true! Which side of Lekki are you?', unread: 2, last_at: ago(4), other_online: true, other_active_hours: 0, matched: true }),
    convo('c2', 'Quiet Comet 118', { last_message: 'Goodnight 🌙', last_from_me: true, last_at: ago(180), other_age: 26, other_location: 'Ogun', they_revealed: true, i_revealed: true, other_read_at: ago(170), other_delivered_at: ago(170) }),
    convo('c8', 'Sunny Baobab 640', { kind: 'friend', last_message: 'See you in Football Banter later ⚽', last_from_me: false, last_at: ago(40), other_age: 29, other_location: 'Lagos', unread: 1, other_online: true }),
    convo('c9', 'Kind Jaguar 414', { kind: 'friend', last_message: 'Good morning', last_from_me: false, last_at: ago(180), other_age: 27, other_location: 'Lagos', unread: 0, other_online: true }),
    convo('c10', 'Noble Wolf 299', { kind: 'friend', last_message: null, last_from_me: false, last_at: ago(480), accepted_at: ago(480), other_age: 25, other_location: 'Oyo', other_online: false, other_active_hours: 8 }),
    convo('c3', 'Golden Kite 907', { last_at: ago(55), other_age: 23, other_online: true, other_active_hours: 0, matched: true }),
    convo('c4', 'Silver Fern 341', { status: 'request', last_message: 'Hi! Saw you in the Lagos room, you seem fun 😄', last_at: ago(12), unread: 1, other_age: 25, other_online: true, other_active_hours: 0 }),
    convo('c11', 'Rosy Zebra 552', { kind: 'friend', status: 'request', last_message: 'Hey, added you from the Lagos room 👋', last_at: ago(25), unread: 1, other_age: 24, other_location: 'Lagos', other_online: true, other_active_hours: 0 }),
    convo('c5', 'Coral Breeze 760', { status: 'request', last_message: 'Hey, love your bio', last_at: ago(95), unread: 1, other_age: 29, other_location: 'Oyo' }),
    convo('c11', 'Swift Heron 118', { kind: 'friend', status: 'sent', started_by_me: true, accepted_at: null, last_message: null, last_from_me: true, last_at: ago(90), other_age: 24 }),
    convo('c6', 'Indigo Lark 289', { status: 'sent', started_by_me: true, accepted_at: null, other_delivered_at: ago(300), last_message: 'Hey! Are you going to Detty December?', last_from_me: true, last_at: ago(300), other_age: 28 }),
    convo('c7', 'Amber Tide 455', { last_message: 'See you around', last_at: ago(4000), blocked: true, i_blocked: true }),
  ];
  const likes = empty ? [] : [
    { handle: 'Rose Harbor 610', gender: 'female', age: 24, location: 'Lagos', intent: 'love', bio: 'Nurse by day, karaoke queen by night 🎤', interests: ['Music', 'Comedy'], requested_at: ago(20) },
    { handle: 'Misty Palm 203', gender: 'female', age: 27, location: 'FCT', intent: 'marriage', bio: 'Looking for something real.', interests: ['Faith', 'Books', 'Travel'], requested_at: ago(240) },
    { handle: 'Sunny Wren 874', gender: 'female', age: 22, location: 'Lagos', intent: 'fun', bio: '', interests: ['Dancing'], requested_at: ago(900) },
  ];
  const cards = [
    ['Pearl Meadow 128', 24, 'Lagos', 'love', 'Product designer. Big fan of Burna Boy and good jollof.', ['Music', 'Afrobeats', 'Art', 'Food'], true, 0],
    ['Ruby Canyon 571', 26, 'Lagos', 'marriage', 'Faith, family and fun. Let’s talk about your favourite book.', ['Faith', 'Books', 'Travel'], false, 2],
    ['Jade Willow 390', 23, 'Ogun', 'fun', 'Here for good vibes and better conversations ✨', ['Dancing', 'Comedy', 'Movies'], true, 0],
    ['Opal River 662', 29, 'Lagos', 'love', 'Chef in training. I will cook for you (eventually).', ['Cooking', 'Food', 'Travel'], false, 7],
    ['Azure Dawn 245', 25, 'Lagos', 'love', '', ['Fitness', 'Football'], false, 30],
    ['Lilac Brook 813', 27, 'Oyo', 'fun', 'Photographer. Show me your favourite spot in the city.', ['Photography', 'Nature', 'Art'], true, 0],
  ].map(([handle, age, location, intent, bio, interests, online, active_hours]) => ({ handle, gender: 'female', age, location, intent, bio, interests, online, active_hours }));

  const people = { Lagos: 143, FCT: 96, Rivers: 71, Oyo: 54, Kano: 38, Enugu: 31, Kaduna: 22, Delta: 19, Ogun: 17, Edo: 12, Anambra: 9, Imo: 6, Plateau: 4 };
  let myRoom = empty ? null : 'Lagos';
  let roomKick = /[?&]kicked=1/.test(location.search) ? { state: myRoom || 'Lagos', kicked_at: new Date(Date.now() - 3 * 60000).toISOString() } : null;
  if (roomKick) myRoom = null;
  // Like the server: your own state's room, then Nigeria (open to everyone).
  let myStatus = { body: 'Feeling productive today 🚀', updated_at: new Date().toISOString() };
  const roomList = () => [profile.state, ...(profile.state === 'Lagos' ? ['UNILAG', 'LASU'] : []), 'Nigeria', 'Ages 18-25', 'Ages 26-35', 'Ages 36+', 'Lovers Lounge', profile.gender === 'female' ? 'Ladies Room' : profile.gender === 'male' ? 'Mens Room' : null, 'Football Banter', 'Christian Room', 'Muslim Room'].filter(Boolean).map((s) => ({ state: s, people: people[s] || (s === profile.state ? 0 : 40 + (s.length * 13) % 200), online: Math.round((people[s] || (s === profile.state ? 0 : 40 + (s.length * 13) % 200)) * 0.6), mine: s === myRoom, unread: s === myRoom ? 8 : 0, capacity: s === profile.state ? 200 : /^(UNILAG|LASU)$/.test(s) ? 300 : 500 }));
  let msgId = 100;
  // ---- Speed Dating in the preview: each browser tab is one person; tabs pair up with each other ----
  const TAB = sessionStorage.getItem('mock-tab') || (() => { const t = 'T' + Math.random().toString(36).slice(2, 7); sessionStorage.setItem('mock-tab', t); return t; })();
  const SPEED_SECS = Number(sessionStorage.getItem('mock-speedsecs') || (/[?&]speedsecs=(\d+)/.exec(location.search) || [])[1] || 300);
  if (/[?&]speedsecs=\d+/.test(location.search)) sessionStorage.setItem('mock-speedsecs', String(SPEED_SECS));
  const speedBus = new BroadcastChannel('mock-speed-bus');
  const speedDb = () => { try { return JSON.parse(localStorage.getItem('mock-speed')) || { queue: [], sessions: {} }; } catch { return { queue: [], sessions: {} }; } };
  const speedSave = (db) => localStorage.setItem('mock-speed', JSON.stringify(db));
  const speedLive = (db) => Object.values(db.sessions).find((s) => (s.a === TAB || s.b === TAB) && !s.ended && speedTick(s) && !s.ended) || null;
  const speedTick = (s) => { if (!s.ended && s.ends && Date.now() >= s.ends) { s.ended = Date.now(); s.reason = 'time'; } return s; };
  const speedView = (s) => s && ({ id: s.id, role: s.a === TAB ? 'a' : 'b', other: { handle: `Speed ${s.a === TAB ? s.b : s.a}`, age: 26, gender: 'female', state: 'Lagos' },
    status: s.ended ? 'ended' : s.started ? 'live' : 'connecting', started_at: s.started ? new Date(s.started).toISOString() : null, ends_at: s.ends ? new Date(s.ends).toISOString() : null,
    ended_at: s.ended ? new Date(s.ended).toISOString() : null, now: new Date().toISOString(), my_decision: s.a === TAB ? s.aLike : s.bLike,
    result: s.aLike === true && s.bLike === true ? 'match' : (s.aLike === false || s.bLike === false) ? 'no_match' : null, conversation_id: s.aLike && s.bLike ? 'c1' : null });
  // Daily limit (5 per 24 h; ?speedlimit=N to try it quickly). Counts dates that started.
  const SPEED_LIMIT = Number(sessionStorage.getItem('mock-speedlimit') || (/[?&]speedlimit=(\d+)/.exec(location.search) || [])[1] || 5);
  if (/[?&]speedlimit=\d+/.test(location.search)) sessionStorage.setItem('mock-speedlimit', String(SPEED_LIMIT));
  function speedQuota() {
    const starts = Object.values(speedDb().sessions).filter((s) => (s.a === TAB || s.b === TAB) && s.started && Date.now() - s.started < 864e5).map((s) => s.started).sort((x, y) => y - x);
    const left = Math.max(SPEED_LIMIT - starts.length, 0);
    const limUntil = left ? 0 : starts[SPEED_LIMIT - 1] + 864e5;
    const match = Object.values(speedDb().sessions).filter((s) => (s.a === TAB || s.b === TAB) && s.matchedAt && Date.now() - s.matchedAt < 12 * 3600e3).sort((x, y) => y.matchedAt - x.matchedAt)[0];
    const matchUntil = match ? match.matchedAt + 12 * 3600e3 : 0;
    const until = Math.max(limUntil, matchUntil);
    return { limit: SPEED_LIMIT, used: starts.length, left, available_at: until ? new Date(until).toISOString() : null,
      reason: !until ? null : matchUntil >= limUntil ? 'match' : 'limit', match_conversation: match ? 'c1' : null, now: new Date().toISOString() };
  }
  function speedJoin() {
    const db = speedDb();
    const live = speedLive(db); if (live) return speedView(live);
    if (speedQuota().left <= 0) { db.queue = db.queue.filter((q) => q.tab !== TAB); speedSave(db); return { status: 'limit', quota: speedQuota(), now: new Date().toISOString() }; }
    const mine = db.queue.find((q) => q.tab === TAB);
    if (mine) mine.seen = Date.now(); else db.queue.push({ tab: TAB, seen: Date.now(), joined: Date.now() });
    const other = db.queue.find((q) => q.tab !== TAB && Date.now() - q.seen < 20000);
    if (!other) { speedSave(db); return { status: 'waiting', now: new Date().toISOString() }; }
    const id = 'sd' + Math.random().toString(36).slice(2, 10);
    db.sessions[id] = { id, a: other.tab, b: TAB, created: Date.now() };
    db.queue = db.queue.filter((q) => q.tab !== TAB && q.tab !== other.tab);
    speedSave(db);
    speedBus.postMessage({ topic: 'speedq:' + ME, event: 'paired', payload: { session: id } });
    return speedView(db.sessions[id]);
  }
  // No camera here (or ?fakecam=1): a moving test picture and a soft tone stand in for camera and microphone.
  if (/[?&]fakecam=1/.test(location.search)) sessionStorage.setItem('mock-fakecam', '1');
  if (sessionStorage.getItem('mock-fakecam') === '1' && navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement('canvas'); c.width = 480; c.height = 640; c.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none'; document.body.append(c); const g = c.getContext('2d'); let t = 0;
      const hue = TAB.charCodeAt(1) * 37 % 360;
      const draw = () => { t++; g.fillStyle = `hsl(${(hue + t) % 360} 70% 45%)`; g.fillRect(0, 0, 480, 640); g.fillStyle = '#fff'; g.font = 'bold 56px sans-serif'; g.fillText(TAB, 120, 300 + 40 * Math.sin(t / 10)); }; draw(); setInterval(draw, 40);
      const stream = c.captureStream(25);
      try { const ac = new AudioContext(); await ac.resume().catch(() => {}); if (ac.state === 'running') { const o = ac.createOscillator(); o.frequency.value = 220; const gain = ac.createGain(); gain.gain.value = 0.02; const d = ac.createMediaStreamDestination(); o.connect(gain).connect(d); o.start(); stream.addTrack(d.stream.getAudioTracks()[0]); } } catch {}
      return stream;
    };
  }
  const friendAsks = {};
  const roomMsgs = [
    ['Velvet Mango 532', 'Good evening Lagos 🌆 who’s stuck in traffic on Third Mainland?', 40],
    ['Bold Falcon 77', 'Me 😭 two hours and counting', 38],
    ['Lucky Dolphin 214', 'Just got home, the rain is wild today', 30],
    ['Pearl Meadow 128', 'Anyone going to the Afrobeats night at Muri Okunola on Friday?', 22],
    ['Jade Willow 390', 'Yes!! Who else? Let’s link up there 🎶', 18],
    ['Bold Falcon 77', 'Count me in. What time does it start?', 9],
    ['Pearl Meadow 128', '9pm. Bring your dancing shoes 💃', 3],
  ].map(([handle, body, min], i) => ({ id: msgId + i, handle, body, created_at: ago(min), mine: handle === profile.handle, reactions: i === 4 ? { '🔥': 3, '❤️': 1 } : i === 0 ? { '😂': 2 } : {}, my_reactions: [] }));
  roomMsgs[4].reply_to = roomMsgs[3].id; roomMsgs[4].reply_handle = roomMsgs[3].handle; roomMsgs[4].reply_body = roomMsgs[3].body;
  const roomPeople = [profile.handle, 'Velvet Mango 532', 'Bold Falcon 77', 'Pearl Meadow 128', 'Jade Willow 390', 'Cobalt Fox 412', 'Maple Sky 66', 'Tidal Owl 903']
    .map((handle, i) => ({ handle, me: i === 0, dating: i % 3 !== 2, place: ['Lagos', 'Ikeja', 'Lekki', 'Yaba', 'Surulere', 'Ajah', 'Ikorodu', 'Lagos'][i], online: i < 5 }));
  const chatMsgs = {
    c1: [['them', 'Hey! Your bio made me laugh 😂', 90], ['me', 'Haha glad someone gets the Bar Beach joke', 80], ['them', 'I’m in Lekki too actually', 10], ['them', 'Haha true! Which side of Lekki are you?', 4]],
    c2: [['me', 'That was such a good chat', 200], ['them', 'It really was. Talk tomorrow?', 190], ['me', 'Goodnight 🌙', 180]],
    c3: [['them', `⚽ Penalty shootout! I challenge you on Kickrs. Tap to play: ${location.origin}/home/games/penalties?join=ABC234`, 2], ['me', `⚽ Penalty shootout! I challenge you on Kickrs. Tap to play: ${location.origin}/home/games/penalties?join=XYZ789`, 30], ['them', `🧠 Trivia duel! Think you know more than me? Play me on Kickrs. Tap to play: ${location.origin}/home/games/trivia?join=TRV234`, 1]],
    c4: [['them', 'Hi! Saw you in the Lagos room, you seem fun 😄', 12]],
    c5: [['them', 'Hey, love your bio', 95]],
    c6: [['me', 'Hey! Are you going to Detty December?', 300]],
  };
  const messages = (cid) => (chatMsgs[cid] || []).map(([who, body, min], i) => ({ id: i + 1, sender_id: who === 'me' ? ME : 'x', body, created_at: ago(min),
    reply_to: cid === 'c1' && i === 3 ? 2 : null, edited_at: cid === 'c1' && i === 1 ? ago(79) : null, deleted_at: null }));

  let nearbyOn = sessionStorage.getItem('mock-nearby') === '1';
  const np = (handle, age, gender, km, dlat, dlng, online, extra) => Object.assign({ handle, age, gender, location: 'Abuja (FCT)', intent: 'love',
    bio: 'Creative, curious and always up for good conversation. Let’s connect! ✨', interests: ['Music', 'Travel', 'Food', 'Art', 'Movies'],
    online, active_hours: online ? 0 : 2, distance_km: km, map_lat: 9.0643 + dlat, map_lng: 7.4892 + dlng, liked_me: false, i_liked: false, conversation_id: null }, extra);
  const nearbyPeople = [
    np('Ruby Zebra 271', 27, 'female', 0.8, 0.004, -0.006, true, { liked_me: true }),
    np('Calm Lion 315', 31, 'male', 1.2, -0.002, 0.011, true),
    np('Sunny Otter 244', 24, 'female', 1.6, -0.012, 0.004, true),
    np('Bold Falcon 293', 29, 'male', 2.3, -0.02, -0.006, false),
    np('Misty Dove 268', 26, 'female', 3.1, 0.025, 0.012, false, { intent: 'marriage' }),
    np('Quiet Fox 330', 30, 'male', 2.9, 0.008, -0.025, true),
    np('Jade Heron 225', 25, 'female', 4.8, 0.04, -0.005, true, { i_liked: true }),
    np('Amber Kite 287', 28, 'female', 5.6, -0.004, -0.05, false),
    np('Cobalt Owl 341', 34, 'male', 3.4, 0.01, 0.03, false, { map_lat: null, map_lng: null }),
    np('Velvet Ray 222', 22, 'female', null, null, null, true, { map_lat: null, map_lng: null }),
  ];
  let mockBird = { level: 4, seconds: 61 * 3600 + 1200, historical_seconds: 60 * 3600, launch_level: 4, leveled_at: null, now: new Date().toISOString() };
  // Announcements preview data (dev only).
  const annCover = (c1, c2) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><circle cx="120" cy="20" r="30" fill="#fff" opacity=".12"/></svg>`);
  const annBase = { audience: { base: 'active' }, send_push: true, cta_label: null, cta_url: null, cover_url: null, delivered_count: 0, read_count: 0, click_count: 0, push_count: 0, eligible_count: null, scheduled_for: null, published_at: null, delivered_at: null, was_published: false, revises: null, expires_at: null };
  const anns = empty ? [] : [
    { ...annBase, id: 'a0000000-0000-4000-8000-000000000001', title: 'Introducing Nearby! 🎉', preview: 'Discover interesting people around you and connect with Treehouse users in your area.', category: 'feature_launch', status: 'published', cover_url: annCover('#7c3aed', '#ff3f9b'),
      body: 'We’re excited to launch **Nearby** on Treehouse! 🎉\n\nWith Nearby, you can:\n- See active users around you\n- Filter by your preferences\n- Start meaningful conversations\n- Meet new friends, dates and more\n\nNearby only shows your approximate area, and it’s off until you switch it on. Read more in [Profile](/home/profile).',
      cta_label: 'Explore Nearby', cta_url: '/home/discover/nearby', published_at: ago(60), delivered_at: ago(58), created_at: ago(200), was_published: true, eligible_count: 1840, delivered_count: 1840, read_count: 1212, click_count: 431 },
    { ...annBase, id: 'a0000000-0000-4000-8000-000000000002', title: 'Treehouse Beach Hangout', preview: 'Join us for a day of games, music and new connections at Ibeno Beach!', category: 'event', status: 'published', cover_url: annCover('#f97316', '#db2777'),
      body: '## Saturday at Ibeno Beach\nGames, music, suya and good vibes. Bring a friend!\n\n1. Arrive from 12 noon\n2. Find the treehouse tent\n3. Say hi 👋', audience: { base: 'all', states: ['Akwa Ibom', 'Rivers'] },
      cta_label: 'Learn More', cta_url: 'https://treehouse.ng', published_at: ago(60 * 24 * 4), delivered_at: ago(60 * 24 * 4), created_at: ago(60 * 24 * 5), was_published: true, eligible_count: 320, delivered_count: 320, read_count: 216, click_count: 41 },
    { ...annBase, id: 'a0000000-0000-4000-8000-000000000003', title: 'Scheduled Maintenance', preview: 'Treehouse will be offline on Nov 15 from 2:00 AM – 4:00 AM (WAT) for important updates.', category: 'maintenance', status: 'published',
      body: 'We’re upgrading our servers to make treehouse faster.\n\n- **When:** Sunday 15 November, 2:00–4:00 AM (WAT)\n- **What:** chats and chatrooms will be unavailable\n\nThanks for your patience. 💜', audience: { base: 'all' },
      published_at: ago(60 * 24 * 6), delivered_at: ago(60 * 24 * 6), created_at: ago(60 * 24 * 6), was_published: true, eligible_count: 2104, delivered_count: 2104, read_count: 1500, click_count: 0 },
    { ...annBase, id: 'a0000000-0000-4000-8000-000000000004', title: 'Safety Update', preview: 'New tools to keep your conversations and connections safer on Treehouse.', category: 'product_update', status: 'published',
      body: 'You can now report a photo straight from the chat, and links in chatrooms are blocked to stop scams.', cta_label: 'Open Treehouse', cta_url: '/home', published_at: ago(60 * 24 * 9), delivered_at: ago(60 * 24 * 9), created_at: ago(60 * 24 * 9), was_published: true, eligible_count: 1700, delivered_count: 1700, read_count: 990, click_count: 120 },
    { ...annBase, id: 'a0000000-0000-4000-8000-000000000005', title: 'Kickrs game night', preview: 'Play Penalty with your friends this Friday.', category: 'community', status: 'scheduled', scheduled_for: new Date(Date.now() + 2 * 864e5).toISOString(), created_at: ago(30), audience: { base: 'recent', days: 14, platforms: ['android-play', 'ios-app'] }, cta_label: 'Play Now', cta_url: '/home/games' },
    { ...annBase, id: 'a0000000-0000-4000-8000-000000000006', title: 'Welcome to treehouse 👋', preview: 'Here’s how to get the most out of your first week.', category: 'community', status: 'draft', created_at: ago(15), audience: { base: 'new', days: 7 }, body: '- Add a status\n- Join your state’s chatroom' },
  ];
  const annMine = empty ? {} : { 'a0000000-0000-4000-8000-000000000003': { read_at: ago(60 * 24 * 5) }, 'a0000000-0000-4000-8000-000000000004': { read_at: ago(60 * 24 * 8) } };
  let annPush = true;
  const annRow = (a) => ({ id: a.id, title: a.title, preview: a.preview, category: a.category, cover_url: a.cover_url, cta_label: a.cta_label, cta_url: a.cta_url, published_at: a.published_at, delivered_at: a.delivered_at, read_at: annMine[a.id]?.read_at || null, archived_at: annMine[a.id]?.archived_at || null });
const mockRated = new Set();
const RPC = {
    my_pending_likes: () => likes.length,
    // Preview only: sessionStorage mock-failchats=N makes the next N chat-list loads fail (tests the retry).
    dating_summary: (...args) => { const left = Number(sessionStorage.getItem('mock-failchats') || 0); if (left > 0) { sessionStorage.setItem('mock-failchats', String(left - 1)); throw new Error('mock: Supabase did not answer'); } return RPC.__unused_dating_summary(...args); },
    __unused_dating_summary: () => ({ convos, requests: likes, pending: likes.length, my_status: myStatus,
      friend_statuses: [{ conversation_id: 'c8', body: 'Weekend vibes already! 🎉', updated_at: ago(17) }, { conversation_id: 'c9', body: 'At work, hit me up later 💼', updated_at: ago(180) }] }),
    set_my_status: ({ p_body }) => { myStatus = { body: p_body, updated_at: new Date().toISOString() }; return [myStatus]; },
    clear_my_status: () => { myStatus = null; return null; },
    chat_status: ({ p_conversation }) => { const c = convos.find((x) => x.conversation_id === p_conversation); return c ? [{ status: c.status, blocked: c.blocked, other_read_at: c.other_read_at, other_delivered_at: c.other_delivered_at, other_online: c.other_online, other_active_hours: c.other_active_hours, i_revealed: c.i_revealed, they_revealed: c.they_revealed }] : []; },
    discover_cards: () => cards,
    discover_profiles: () => cards,
    incoming_requests: () => likes,
    my_conversations: () => convos,
    room_list: roomList,
    // Preview a kick for inactivity with ?kicked=1 (you were in Lagos and got kicked).
    my_room_kick: () => (roomKick ? [roomKick] : []),
    dismiss_room_kick: () => { roomKick = null; },
    join_room: ({ p_state }) => {
      const band = { 'Ages 18-25': [18, 25], 'Ages 26-35': [26, 35], 'Ages 36+': [36, 200] }[p_state];
      if (band && (profile.age < band[0] || profile.age > band[1])) throw Object.assign(new Error(profile.age < band[0] ? 'You are too young for this group.' : 'You are too old for this group.'), { code: '42501' });
      roomKick = null; const back = myRoom === p_state; myRoom = p_state; return [{ state: p_state, handle: profile.handle, people: people[p_state] || 1, rejoined: back, last_read_id: back ? msgId + 3 : 0 }]; },
    room_heartbeat: () => (roomKick ? null : myRoom),
    leave_room: () => { myRoom = null; roomKick = null; },
    room_mark_read: () => null,
    room_history: () => (myRoom === 'Lagos' ? roomMsgs : []),
    room_people: () => roomPeople,
    send_room_message: ({ p_body, p_reply_to }) => { const q = roomMsgs.find((x) => x.id === p_reply_to); return [{ id: ++msgId + 50, handle: profile.handle, body: p_body, created_at: new Date().toISOString(), reply_to: q ? q.id : null, reply_handle: q ? q.handle : null, reply_body: q ? q.body.slice(0, 140) : null }]; },
    // Bird Kingdom + ratings (sample data)
    my_bird: () => mockBird,
    activity_ping: () => { mockBird = { ...mockBird, seconds: mockBird.seconds + 60, leveled_up: false, added: 60 }; return mockBird; },
    bird_launch_seen: () => { mockBird = { ...mockBird, launch_level: null }; return null; },
    my_reputation: () => ({ score: 4.6, established: true, raters: 9, ratings: 11, band: 'high', distribution: { 5: 6, 4: 2, 3: 1 },
      trend: [{ week: '2026-10-19', score: 4.2 }, { week: '2026-10-26', score: 4.4 }, { week: '2026-11-02', score: 4.5 }, { week: '2026-11-09', score: 4.6 }],
      refreshed_at: new Date().toISOString(), min_raters: 5, high_band: 4, cooldown_days: 7 }),
    rating_status_convo: ({ p_conversation }) => (mockRated.has(p_conversation)
      ? { eligible: false, cooldown: true, next_at: new Date(Date.now() + 5 * 86400000).toISOString(), now: new Date().toISOString() }
      : { eligible: true, now: new Date().toISOString() }),
    rating_status_room: ({ p_handle }) => (p_handle === roomPeople[0].handle ? { eligible: false, self: true } : { eligible: true, now: new Date().toISOString() }),
    rate_convo: ({ p_conversation }) => { mockRated.add(p_conversation); return { eligible: false, cooldown: true }; },
    rate_room_member: () => ({ eligible: false, cooldown: true }),
    badges_for_convos: ({ p_ids }) => p_ids.map((id, i) => ({ conversation_id: id, badge: { birthday: i === 0, level: (i % 8) + 1, rating: i % 3 ? 4.3 + (i % 5) / 10 : null, ratings: i % 3 ? 7 + i : i % 4 } })),
    badges_for_room: ({ p_handles }) => p_handles.map((h, i) => ({ handle: h, badge: { level: ((h.length + i) % 8) + 1, rating: i % 2 ? 4.8 : null, ratings: i % 2 ? 12 : 2 } })),
    // Preview only: sessionStorage mock-roomban=1 shows the 24-hour chatroom ban.
    my_room_ban: () => (sessionStorage.getItem('mock-roomban') ? { until: new Date(Date.now() + 23.9 * 3600000).toISOString(), reason: 'You posted a link in a chatroom. Links aren\'t allowed in treehouse chatrooms.', now: new Date().toISOString() } : null),
    room_birthdays: () => [{ handle: roomPeople[1].handle }],
    badges_for_handles: ({ p_handles }) => p_handles.map((h, i) => ({ handle: h, badge: { level: (h.length % 8) + 1, rating: i % 2 ? null : 4.4, ratings: i % 2 ? 1 : 23 } })),
    room_profile: ({ p_handle }) => { const p = roomPeople.find((x) => x.handle === p_handle) || roomPeople[1]; return [{ handle: p.handle, room: 'Lagos', online: p.online, age: 25, gender: 'female', bio: 'Lagos babe, Afrobeats on repeat.', interests: ['Music', 'Fashion'], dating: p.dating, me: p.me, place: p.place }]; },
    toggle_room_reaction: () => [{ reactions: { '❤️': 1 }, added: true }],
    chat_partner_profile: ({ p_conversation }) => { const c = convos.find((x) => x.conversation_id === p_conversation); return c ? [{ handle: c.other_handle, age: c.other_age, gender: c.other_gender, location: c.other_location, intent: c.other_intent, bio: 'Love good food, music and deep conversations.', interests: ['Music', 'Food', 'Travel'], online: c.other_online, active_hours: c.other_active_hours, available: !c.blocked }] : []; },
    revealed_details: () => [{ name: 'Tolu' }],
    // ---- Speed Dating (shared between tabs through localStorage; each tab is one dater) ----
    speed_quota: () => speedQuota(),
    speed_waiting: () => speedDb().queue.filter((q) => Date.now() - q.seen < 20000).length,
    speed_join: () => speedJoin(),
    speed_poll: () => { const db = speedDb(); const live = speedLive(db); if (live) return speedView(live); return db.queue.some((q) => q.tab === TAB) ? speedJoin() : { status: 'idle', now: new Date().toISOString() }; },
    speed_leave_queue: () => { const db = speedDb(); db.queue = db.queue.filter((q) => q.tab !== TAB); speedSave(db); },
    speed_session: ({ p_session }) => { const db = speedDb(); const s = p_session ? db.sessions[p_session] : speedLive(db); return s ? speedView(speedTick(s)) : null; },
    speed_ready: ({ p_session }) => { const db = speedDb(); const s = db.sessions[p_session]; if (!s) return null; s[s.a === TAB ? 'aReady' : 'bReady'] = Date.now();
      if (s.aReady && s.bReady && !s.started) { s.started = Date.now(); s.ends = s.started + SPEED_SECS * 1000; } speedSave(db); return speedView(s); },
    speed_heartbeat: ({ p_session }) => { const db = speedDb(); const s = db.sessions[p_session]; if (!s) return null; speedTick(s); speedSave(db); return speedView(s); },
    speed_signal: ({ p_session, p_data }) => { const db = speedDb(); const s = db.sessions[p_session]; const from = s.a === TAB ? 'a' : 'b';
      db.signals = db.signals || []; const id = (db.lastSigId = (db.lastSigId || 0) + 1); db.signals.push({ id, session: p_session, from, data: p_data }); speedSave(db);
      if (!/[?&]nolive=1/.test(location.search) && sessionStorage.getItem('mock-nolive') !== '1') speedBus.postMessage({ topic: 'speed:' + p_session, event: 'signal', payload: { id, from, data: p_data } }); },
    speed_pull: ({ p_session, p_after }) => { const s = speedDb().sessions[p_session]; const me = s.a === TAB ? 'a' : 'b';
      return (speedDb().signals || []).filter((x) => x.session === p_session && x.from !== me && x.id > (p_after || 0)).map(({ id, from, data }) => ({ id, from, data })); },
    speed_end: ({ p_session }) => { const db = speedDb(); const s = db.sessions[p_session]; if (s && !s.ended) { s.ended = Date.now(); s.reason = 'left'; speedSave(db); } speedBus.postMessage({ topic: 'speed:' + p_session, event: 'ended' }); return speedView(s); },
    speed_decide: ({ p_session, p_like }) => { const db = speedDb(); const s = db.sessions[p_session]; const k = s.a === TAB ? 'aLike' : 'bLike'; if (s[k] == null) s[k] = !!p_like; if (s.aLike && s.bLike && !s.matchedAt) s.matchedAt = Date.now(); speedSave(db); return speedView(s); },
    speed_report: ({ p_session, p_block }) => { if (p_block) RPC.speed_end({ p_session }); },
    start_friend_request: () => 'c9',
    kickrs_status: () => ({ ready: true, blocker: null, connected: sessionStorage.getItem('mock-kickrs') === '1' }),
    kickrs_connect: () => { sessionStorage.setItem('mock-kickrs', '1'); return [{ kickrs_id: '00000000-0000-4000-8000-000000000214', handle: profile.handle, avatar: null }]; },
    kickrs_disconnect: () => { sessionStorage.removeItem('mock-kickrs'); return null; },
    kickrs_friend_request: () => 'c9',
    // Matches → friends: in Golden Kite's chat (c3) they've asked you; elsewhere nobody has yet.
    friend_ask_state: ({ p_conversation }) => { const c = convos.find((x) => x.conversation_id === p_conversation); return !c ? null : c.kind === 'friend' ? 'friends' : (friendAsks[p_conversation] || (p_conversation === 'c3' ? 'theirs' : 'none')); },
    my_friend_asks: () => { const out = Object.entries(friendAsks).filter(([, v]) => v === 'mine' || v === 'theirs').map(([k, v]) => ({ conversation_id: k, who: v }));
      const c3 = convos.find((x) => x.conversation_id === 'c3'); if (c3 && c3.kind !== 'friend' && !friendAsks.c3) out.push({ conversation_id: 'c3', who: 'theirs' }); return out; },
    ask_friend: ({ p_conversation, p_on }) => {
      const c = convos.find((x) => x.conversation_id === p_conversation);
      const now = friendAsks[p_conversation] || (p_conversation === 'c3' ? 'theirs' : 'none');
      if (p_on === false) { friendAsks[p_conversation] = 'none'; return 'none'; }
      if (now === 'theirs') { c.kind = 'friend'; delete friendAsks[p_conversation]; return 'friends'; }
      friendAsks[p_conversation] = 'mine'; return 'asked';
    },
    get_avatars: () => mockAvatars,
    set_my_avatar: ({ p_config }) => { mockAvatars = [{ handle: profile.handle, config: p_config }]; return null; },
    // Photos: unlocked in Pearl's chat (c3) for the preview; locked everywhere else.
    photos_unlocked: ({ p_conversation }) => p_conversation === 'c3',
    like_profile: ({ p_handle }) => (p_handle.startsWith('Pearl') ? [{ matched: true, conversation_id: 'c3' }] : [{ matched: false }]),
    start_conversation: () => 'c6',
    dating_state_counts: () => [],
    nearby_settings: () => [nearbyOn ? { enabled: true, paused: false, hide_distance: false, hide_on_map: false, updated_at: ago(3), area_lat: 9.0643, area_lng: 7.4892 } : { enabled: false, paused: false, hide_distance: false, hide_on_map: false, updated_at: null, area_lat: null, area_lng: null }],
    nearby_set_location: () => { nearbyOn = true; sessionStorage.setItem('mock-nearby', '1'); },
    nearby_update_settings: ({ p_enabled }) => { if (p_enabled === false) { nearbyOn = false; sessionStorage.removeItem('mock-nearby'); } },
    nearby_people: ({ p_radius_km }) => nearbyPeople.filter((x) => x.distance_km == null || x.distance_km <= p_radius_km),
    block_profile: () => null, report_profile: () => null,
    accept_message_request: ({ p_conversation }) => { const c = convos.find((x) => x.conversation_id === p_conversation); if (c) { c.status = 'chat'; c.accepted_at = new Date().toISOString(); } },
    cancel_request: ({ p_conversation }) => { const i = convos.findIndex((x) => x.conversation_id === p_conversation && x.status === 'sent'); if (i >= 0) convos.splice(i, 1); },
    decline_message_request: ({ p_conversation }) => { const i = convos.findIndex((x) => x.conversation_id === p_conversation); if (i >= 0) convos.splice(i, 1); },
    block_conversation_partner: ({ p_conversation }) => { const c = convos.find((x) => x.conversation_id === p_conversation); if (c) { c.blocked = true; c.i_blocked = true; } },
    unblock_conversation_partner: ({ p_conversation }) => { const c = convos.find((x) => x.conversation_id === p_conversation); if (c) { c.blocked = false; c.i_blocked = false; } },
    delete_conversation: () => null, mark_conversation_read: () => null,
    edit_dating_message: () => null, unsend_dating_message: () => null, hide_dating_message: () => null,
    // ---- Announcements (preview data only) ----
    my_announcements: ({ p_filter, p_before, p_limit }) => anns.filter((a) => a.status === 'published').map(annRow)
      .filter((a) => (p_filter === 'unread' ? !a.read_at && !a.archived_at : p_filter === 'read' ? a.read_at && !a.archived_at : p_filter === 'archived' ? a.archived_at : !a.archived_at))
      .filter((a) => !p_before || a.delivered_at < p_before).slice(0, p_limit || 20),
    my_announcements_unread: () => anns.filter((a) => a.status === 'published' && !annMine[a.id]?.read_at && !annMine[a.id]?.archived_at).length,
    open_announcement: ({ p_id }) => { const a = anns.find((x) => x.id === p_id && x.status === 'published'); if (!a) { const e = new Error('Announcement not found.'); e.code = 'P0002'; throw e; } annMine[p_id] = { ...annMine[p_id], read_at: annMine[p_id]?.read_at || new Date().toISOString() }; return { ...annRow(a), body: a.body, revises: a.revises || null, revised_by: anns.find((x) => x.revises === a.id && x.status === 'published')?.id || null }; },
    mark_announcement: ({ p_id, p_action }) => { const m = annMine[p_id] = { ...annMine[p_id] }; const now = new Date().toISOString();
      if (p_action === 'read' || p_action === 'click') m.read_at = m.read_at || now; if (p_action === 'unread') m.read_at = null;
      if (p_action === 'archive') m.archived_at = now; if (p_action === 'unarchive') m.archived_at = null; },
    mark_all_announcements_read: () => { let n = 0; anns.forEach((a) => { if (a.status === 'published' && !annMine[a.id]?.read_at) { annMine[a.id] = { ...annMine[a.id], read_at: new Date().toISOString() }; n++; } }); return n; },
    my_announcement_prefs: () => ({ push_updates: annPush }), set_announcement_push: ({ p_on }) => { annPush = p_on; },
    ann_me: () => ({ role: 'super_admin', can_publish: true }),
    ann_overview: () => ({ total: anns.length, published: anns.filter((a) => a.status === 'published').length, scheduled: anns.filter((a) => a.status === 'scheduled').length,
      drafts: anns.filter((a) => a.status === 'draft').length, archived: anns.filter((a) => a.status === 'archived').length,
      delivered: anns.reduce((n, a) => n + (a.delivered_count || 0), 0), recipients: 1840, reads: anns.reduce((n, a) => n + (a.read_count || 0), 0), read_rate: 64.2, clicks: anns.reduce((n, a) => n + (a.click_count || 0), 0) }),
    ann_list: ({ p_status, p_category, p_query }) => { const l = anns.filter((a) => (p_status === 'all' || (p_status === 'published' ? ['published', 'publishing'].includes(a.status) : a.status === p_status))
      && (!p_category || a.category === p_category) && (!p_query || a.title.toLowerCase().includes(p_query.toLowerCase()))); return l.map((a) => ({ ...a, total: l.length })); },
    ann_get: ({ p_id }) => { const a = anns.find((x) => x.id === p_id); if (!a) throw new Error('Announcement not found.'); return { ...a, created_by_handle: 'Lucky Dolphin 214', published_by_handle: a.published_at ? 'Lucky Dolphin 214' : null }; },
    ann_estimate: ({ p_audience }) => { const a = p_audience || {}; let n = { all: 2104, active: 1840, new: 212, recent: 990, inactive: 264 }[a.base] || 1840; if (a.states && a.states.length) n = Math.round(n * Math.min(1, a.states.length * 0.11)); if (a.platforms && a.platforms.length) n = Math.round(n * 0.4 * a.platforms.length); return Math.max(n, 0); },
    ann_save: ({ p_id, p_fields }) => { if (p_id) { Object.assign(anns.find((x) => x.id === p_id), p_fields); return p_id; } const id = crypto.randomUUID(); anns.unshift({ id, status: 'draft', created_at: new Date().toISOString(), delivered_count: 0, read_count: 0, click_count: 0, push_count: 0, eligible_count: null, ...p_fields }); return id; },
    ann_publish: ({ p_id, p_when }) => { const a = anns.find((x) => x.id === p_id); if (p_when && new Date(p_when) > new Date()) { a.status = 'scheduled'; a.scheduled_for = p_when; return { status: 'scheduled' }; }
      Object.assign(a, { status: 'published', published_at: new Date().toISOString(), delivered_at: new Date().toISOString(), was_published: true, eligible_count: 1840, delivered_count: 1840 }); return { status: 'published', eligible: 1840 }; },
    ann_cancel: ({ p_id }) => { Object.assign(anns.find((x) => x.id === p_id), { status: 'draft', scheduled_for: null }); },
    ann_archive: ({ p_id, p_on }) => { const a = anns.find((x) => x.id === p_id); a.status = p_on ? 'archived' : (a.was_published ? 'published' : 'draft'); },
    ann_correction: ({ p_id }) => { const a = anns.find((x) => x.id === p_id); const id = crypto.randomUUID(); anns.unshift({ ...a, id, status: 'draft', title: 'Update: ' + a.title, revises: a.id, was_published: false, published_at: null, delivered_at: null, delivered_count: 0, read_count: 0, click_count: 0, eligible_count: null }); return id; },
    ann_delete_draft: ({ p_id }) => { const i = anns.findIndex((x) => x.id === p_id); if (i >= 0) anns.splice(i, 1); },
    ann_analytics: ({ p_id }) => { const a = anns.find((x) => x.id === p_id) || {}; const d = a.delivered_count || 0, r = a.read_count || 0, c = a.click_count || 0;
      return { status: a.status, targeted: a.eligible_count || 1840, delivered: d, pending: 0, failed: 0, push_queued: Math.round(d * 0.13), reads: r, unread: d - r, read_rate: d ? Math.round(r * 1000 / d) / 10 : 0, clicks: c, click_rate: d ? Math.round(c * 1000 / d) / 10 : 0, archived: Math.round(d * 0.02),
        by_day: a.published_at ? [0, 1, 2, 3].map((i) => ({ day: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), reads: Math.round(r / (i + 1.6)), clicks: Math.round(c / (i + 1.6)) })) : [] }; },
    ann_audit_log: ({ p_id }) => [{ at: new Date(Date.now() - 3600000).toISOString(), action: 'published', actor_handle: 'Lucky Dolphin 214', announcement_id: p_id, title: 'Introducing Nearby!', meta: {} },
      { at: new Date(Date.now() - 7200000).toISOString(), action: 'created', actor_handle: 'Lucky Dolphin 214', announcement_id: p_id, title: 'Introducing Nearby!', meta: {} }],
    ann_staff: () => [{ handle: 'Lucky Dolphin 214', role: 'super_admin', can_publish: true, added_at: ago(9000) }, { handle: 'Quiet Comet 118', role: 'editor', can_publish: false, added_at: ago(3000) }],
    ann_set_staff: () => null,
  };

  let mockAvatars = [];
  const mockFiles = new Map();
  function result(data) { return Promise.resolve({ data, error: null }); }
  function from(table) {
    let rows = [];
    if (table === 'dating_profiles') rows = profile;
    if (table === 'dating_messages') rows = [];
    let convId = null, single = false;
    const b = {
      select() { return b; }, insert(v) { if (table === 'dating_messages') rows = { id: Date.now(), sender_id: ME, body: v.photo ? '📷 Photo' : v.body, created_at: new Date().toISOString(), reply_to: v.reply_to || null, edited_at: null, deleted_at: null, photo: v.photo || null, photo_w: v.photo_w || null, photo_h: v.photo_h || null }; return b; },
      update(v) {
        if (table === 'dating_profiles' && v) {
          if (v.birth_date) {
            const [y, m, d] = v.birth_date.split('-').map(Number); const t = new Date();
            const yrs = t.getFullYear() - y - ((t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) ? 1 : 0);
            if (yrs < 18) Object.assign(profile, { birth_date: v.birth_date, dob_underage_at: new Date().toISOString(), suspended: true });
            else Object.assign(profile, { birth_date: v.birth_date, age: yrs, age_changed_at: new Date().toISOString() });
          }
        }
        return b;
      }, delete() { return b; }, order() { return b; }, limit() { return b; },
      eq(col, v) { if (col === 'conversation_id') convId = v; return b; },
      maybeSingle() { single = true; return b; }, single() { single = true; return b; },
      then(ok, bad) {
        let data = rows;
        if (table === 'dating_messages' && convId && !single) data = messages(convId).reverse();
        if (table === 'link_messages') data = [];
        return result(data).then(ok, bad);
      },
    };
    return b;
  }
  function channel(name) {
    // Speed Dating channels talk across browser tabs, so two tabs can video date each other.
    if (typeof name === 'string' && name.startsWith('speed')) {
      const handlers = [];
      const ch = { on(type, filter, cb) { handlers.push([filter && filter.event, cb]); return ch; },
        subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 50); return ch; }, track() {}, send() {}, presenceState() { return {}; } };
      speedBus.addEventListener('message', (e) => { const m = e.data; if (m && m.topic === name) handlers.forEach(([ev, cb]) => { if (ev === m.event) cb({ payload: m.payload }); }); });
      return ch;
    }
    const ch = { on() { return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 50); return ch; }, track() {}, send() {}, presenceState() { return {}; } };
    return ch;
  }
  const session = signedOut ? null : { user: { id: ME, email: 'you@example.com' } };
  window.supabase = {
    createClient() {
      return {
        rpc(fn, args) { const f = RPC[fn]; try { return result(f ? f(args || {}) : null); } catch (e) { return Promise.resolve({ data: null, error: { message: e.message, code: e.code || 'P0001' } }); } },
        from, channel, removeChannel() {},
        storage: { from: () => ({
          upload: (path, blob) => { mockFiles.set(path, URL.createObjectURL(blob)); return result({ path }); },
          createSignedUrl: (path) => result({ signedUrl: mockFiles.get(path) || '/lp-chatroom.jpg' }),
          remove: () => result(null),
          getPublicUrl: (path) => ({ data: { publicUrl: mockFiles.get(path) || '/lp-chatroom.jpg' } }),
        }) },
        auth: {
          getSession: () => result({ session }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          signOut: () => { sessionStorage.setItem('mock-out', '1'); location.reload(); return result(null); },
          signInWithPassword: () => { sessionStorage.removeItem('mock-out'); location.reload(); return result({}); },
          signUp: () => result({ user: null }), resend: () => result(null), resetPasswordForEmail: () => result(null), updateUser: () => result(null), verifyOtp: () => result(null),
        },
      };
    },
  };
})();
