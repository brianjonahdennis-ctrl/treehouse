// Fake Supabase client for the local design preview (dev/mock-server.mjs). Sample people only.
// ?signedout=1 previews the landing page; ?empty=1 previews a brand-new account with nothing yet.
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('signedout')) sessionStorage.setItem('mock-out', '1');
  if (q.get('empty')) sessionStorage.setItem('mock-empty', '1');
  if (q.get('reset')) { sessionStorage.clear(); }
  const signedOut = sessionStorage.getItem('mock-out') === '1';
  // Preview only: a small walking route, changing true-north heading and
  // illustrated rear-camera feed let the AR placement be checked without a phone.
  let mockLatitude = 9.07624, mockLongitude = 7.47918, mockGeoSequence = 0;
  const mockWatchers = new Map();
  const mockGeoPosition = () => ({ coords: { latitude: mockLatitude, longitude: mockLongitude, accuracy: 8, speed: 1.1, heading: 35 }, timestamp: Date.now() });
  const mockBearingTo = (target) => {
    if (!target) return 25;
    const rad = Math.PI / 180, dLat = (target.latitude - mockLatitude) * rad;
    const dLon = (target.longitude - mockLongitude) * rad;
    return (Math.atan2(Math.sin(dLon) * Math.cos(target.latitude * rad), Math.cos(mockLatitude * rad) * Math.sin(target.latitude * rad) - Math.sin(mockLatitude * rad) * Math.cos(target.latitude * rad) * Math.cos(dLon)) * 180 / Math.PI + 360) % 360;
  };
  const mockOrientation = () => {
    const player = mockHuntPlayer(), state = mockHuntState(player), order = state.route || mockHuntOrder(player);
    const target = mockHuntCheckpoints[order[Math.min(state.found || 0, mockHuntCheckpoints.length - 1)]];
    const alpha = -mockBearingTo(target);
    const event = new Event('deviceorientationabsolute');
    for (const [key, value] of Object.entries({ alpha, beta: 90, gamma: 0, absolute: true })) {
      Object.defineProperty(event, key, { configurable: true, value });
    }
    window.dispatchEvent(event);
  };
  const mockWatchTick = () => {
    mockLatitude += 0.000006;
    mockLongitude += 0.000005;
    mockOrientation();
    const position = mockGeoPosition();
    for (const watcher of mockWatchers.values()) watcher(position);
  };
  const fakeGeolocation = {
    getCurrentPosition: (ok) => setTimeout(() => ok(mockGeoPosition()), 180),
    watchPosition: (ok) => {
      const id = ++mockGeoSequence;
      mockWatchers.set(id, ok);
      setTimeout(() => { if (mockWatchers.has(id)) ok(mockGeoPosition()); }, 120);
      if (mockWatchers.size === 1) { mockOrientation(); fakeGeolocation.timer = setInterval(mockWatchTick, 900); }
      return id;
    },
    clearWatch: (id) => { mockWatchers.delete(id); if (!mockWatchers.size && fakeGeolocation.timer) { clearInterval(fakeGeolocation.timer); fakeGeolocation.timer = null; } },
    timer: null,
  };
  try { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: fakeGeolocation }); } catch {}
  const empty = sessionStorage.getItem('mock-empty') === '1';
  const ME = '00000000-0000-0000-0000-000000000001';
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
    'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
    'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];

  const profile = { birth_date: /[?&]nodob=1/.test(location.search) ? null : '1999-03-14', dob_underage_at: null, age_changed_at: new Date(Date.now() - 90 * 864e5).toISOString(), handle: 'Lucky Dolphin 214', name: 'Ada', gender: 'male', age: 27, location: 'Lagos', intent: 'love', is_active: true, suspended: false,
    bio: 'Afrobeats, suya and long walks on Bar Beach.', interests: ['Music', 'Afrobeats', 'Football', 'Food'], interested_in: ['female'], min_age: 21, max_age: 35,
    state: 'Lagos', pref_state: 'Lagos' };

  const mockOrigins = {};
  let mockInboxVersion = 0;
  const mockInboxListeners = new Set();
  let mockRole = 'caller'; const mockCalls = [];
  const convo = (id, handle, extra) => Object.assign({ conversation_id: id, other_handle: handle, other_gender: 'female', other_age: 24, other_location: 'Lagos',
    other_intent: 'love', last_message: null, last_from_me: false, last_at: ago(30), unread: 0, i_revealed: false, they_revealed: false,
    blocked: false, i_blocked: false, status: 'chat', other_online: false, other_active_hours: 3, matched: false, other_read_at: null, accepted_at: ago(500), started_by_me: false }, extra);
  const convos = empty ? [] : [
    convo('c1', 'Velvet Mango 532', { last_message: 'Haha true! Which side of Lekki are you?', unread: 2, last_at: ago(4), other_online: true, other_active_hours: 0, matched: true }),
    convo('c2', 'Quiet Comet 118', { last_message: 'Goodnight 🌙', last_from_me: true, last_at: ago(180), other_age: 26, other_location: 'Ogun', they_revealed: true, i_revealed: true, other_read_at: ago(170), other_delivered_at: ago(170) }),
    convo('c8', 'Sunny Baobab 640', { kind: 'friend', last_message: 'See you in Football Banter later ⚽', last_from_me: false, last_at: ago(40), other_age: 29, other_location: 'Lagos', unread: 1, other_online: true }),
    convo('c9', 'Kind Jaguar 414', { kind: 'friend', matched: true, last_message: 'Good morning', last_from_me: false, last_at: ago(180), other_age: 27, other_location: 'Lagos', unread: 0, other_online: true }),
    convo('c10', 'Noble Wolf 299', { kind: 'friend', last_message: null, last_from_me: false, last_at: ago(480), accepted_at: ago(480), other_age: 25, other_location: 'Oyo', other_online: false, other_active_hours: 8 }),
    convo('c3', 'Golden Kite 907', { last_at: ago(55), other_age: 23, other_online: true, other_active_hours: 0, matched: true }),
    convo('c4', 'Silver Fern 341', { status: 'request', last_message: 'Hi! Saw you in the Lagos room, you seem fun 😄', last_at: ago(12), unread: 1, other_age: 25, other_online: true, other_active_hours: 0 }),
    convo('c11', 'Rosy Zebra 552', { kind: 'friend', status: 'request', last_message: 'Hey, added you from the Lagos room 👋', last_at: ago(25), unread: 1, other_age: 24, other_location: 'Lagos', other_online: true, other_active_hours: 0 }),
    convo('c5', 'Coral Breeze 760', { status: 'request', last_message: 'Hey, love your bio', last_at: ago(95), unread: 1, other_age: 29, other_location: 'Oyo' }),
    convo('c11', 'Swift Heron 118', { kind: 'friend', status: 'sent', started_by_me: true, accepted_at: null, last_message: null, last_from_me: true, last_at: ago(90), other_age: 24 }),
    convo('c6', 'Indigo Lark 289', { status: 'sent', started_by_me: true, accepted_at: null, other_delivered_at: ago(300), last_message: 'Hey! Are you going to Detty December?', last_from_me: true, last_at: ago(300), other_age: 28 }),
    convo('c12', 'Brave Panther 502', { last_message: 'Why you dey laugh? 😂', last_at: ago(240), unread: 1, other_age: 26, other_location: 'Lagos', other_online: false, other_active_hours: 1 }),
    convo('c13', 'Calm Leopard 595', { kind: 'friend', last_message: 'Alright…Thank you', last_from_me: false, last_at: ago(2880), other_age: 28, other_location: 'Lagos', other_online: true, other_active_hours: 0 }),
    convo('c14', 'Misty Owl 733', { status: 'sent', started_by_me: true, accepted_at: null, last_message: 'Hi neighbour 👋', last_from_me: true, last_at: ago(60), other_age: 27 }),
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
    reply_to: cid === 'c1' && i === 3 ? 2 : null, edited_at: cid === 'c1' && i === 1 ? ago(79) : null, deleted_at: null,
    ...(cid === 'c2' && i === 1 ? { photo: '00000000-0000-0000-0000-0000000000c2/00000000-0000-0000-0000-000000000001.jpg', photo_w: 1200, photo_h: 800 } : {}) }));

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
  let mockBird = { invites: 2, level: 4, seconds: 61 * 3600 + 1200, historical_seconds: 60 * 3600, launch_level: 4, leveled_at: null, now: new Date().toISOString() };
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
let mockUsername = null; // usernames (sample: 'ada' can be added as a friend, 'taken' is taken)
const mockLater = new Set(); // chats where "Not now" was tapped on the rating card
const mockHuntId = 'd0000000-0000-4000-8000-000000000001';
const mockHuntCheckpoints = [
  ['Wuse Market Gate', 9.0765, 7.4793, 'Start here, then follow your personal route.'],
  ['Garden Gate', 9.0767, 7.4795, 'Look near the open courtyard.'],
  ['River Walk', 9.0769, 7.4797, 'Keep the river path in view.'],
  ['Palm Court', 9.0771, 7.4799, 'The next clue is ahead.'],
  ['City Park Fountain', 9.0773, 7.4801, 'The treasure is close.'],
].map(([name, latitude, longitude, hint], i) => ({
  id: `d0000000-0000-4000-8000-00000000000${i + 2}`, sequence: i + 1, name, hint,
  latitude, longitude, radius_m: 45, reward_coins: 100,
}));
const mockHuntPlayer = () => sessionStorage.getItem('mock-hunt-player') === '2' ? 2 : 1;
const mockHuntStateKey = (player) => `mock-hunt-state-${player}`;
const mockHuntState = (player) => JSON.parse(sessionStorage.getItem(mockHuntStateKey(player)) || '{"found":0,"total_coins":0,"done":false,"claims":[],"route":null}');
const mockHuntSave = (player, state) => sessionStorage.setItem(mockHuntStateKey(player), JSON.stringify(state));
const mockHuntOrder = (player) => player === 2 ? [0, 2, 3, 1, 4] : [0, 1, 2, 3, 4];
function mockHuntProgress() {
  const player = mockHuntPlayer(); const state = mockHuntState(player); const order = state.route || mockHuntOrder(player);
  const found = state.found || 0;
  let target = null;
  if (!state.done && found < mockHuntCheckpoints.length) {
    const checkpoint = mockHuntCheckpoints[order[found]];
    target = { kind: found === 0 ? 'start' : 'checkpoint', id: checkpoint.id, name: checkpoint.name, hint: checkpoint.hint,
      latitude: checkpoint.latitude, longitude: checkpoint.longitude, radius_m: checkpoint.radius_m, reward_coins: checkpoint.reward_coins };
  } else if (!state.done) {
    target = { kind: 'finish', id: 'mock-route-finish', name: 'City Park treasure', hint: 'Every checkpoint is done. Reach your final treasure.',
      latitude: 9.0775, longitude: 7.4803, radius_m: 60, reward_coins: 0 };
  }
  return { hunt: { id: mockHuntId, title: 'Treasure Hunt', region: 'Wuse, Abuja · preview', description: 'Follow the clues and collect a Treehouse Coin at every stop.',
      starts_at: new Date(Date.now() - 3600000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString(), completion_bonus_coins: 100, coin_avatar: '🪙', treasure_avatar: '🧰', checkpoint_count: mockHuntCheckpoints.length },
    participant: { joined_at: new Date().toISOString(), total_coins: state.total_coins || 0, completion_bonus_coins: state.done ? 100 : 0,
      completed_at: state.done ? new Date().toISOString() : null },
    found_count: found, total_count: mockHuntCheckpoints.length, current_target: target };
}

const RPC = {
    my_pending_likes: () => likes.length,
    // Preview only: sessionStorage mock-failchats=N makes the next N chat-list loads fail (tests the retry).
    dating_summary: (...args) => { const left = Number(sessionStorage.getItem('mock-failchats') || 0); if (left > 0) { sessionStorage.setItem('mock-failchats', String(left - 1)); throw new Error('mock: Supabase did not answer'); } return RPC.__unused_dating_summary(...args); },
    // Same as the database: only chats whose fingerprint changed (preview: a simple JSON hash).
    dating_summary_changes: ({ p_known = {}, p_req = '' }) => {
      const full = RPC.dating_summary(); const fp = (o) => { let h = 0; const t = JSON.stringify(o); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h >>> 0); };
      const rows = full.convos.map((c) => ({ ...c, _fp: fp(c) })); const ids = new Set(rows.map((r) => r.conversation_id)); const rf = fp(full.requests);
      window.__mockListBytes = (window.__mockListBytes || 0);
      const out = { changed: rows.filter((r) => p_known[r.conversation_id] !== r._fp), removed: Object.keys(p_known).filter((k) => !ids.has(k)), requests: rf === p_req ? null : full.requests, req_fp: rf,
        pending: full.pending, my_status: full.my_status, friend_statuses: full.friend_statuses, origins: full.origins };
      window.__mockListBytes += JSON.stringify(out).length; window.__mockListCalls = (window.__mockListCalls || 0) + 1; return out; },
    dating_summary_changes_v2: ({ p_known = {}, p_req = '', p_version = null }) => {
      window.__mockListCalls = (window.__mockListCalls || 0) + 1;
      if (p_version != null && Number(p_version) === mockInboxVersion) {
        window.__mockListBytes = (window.__mockListBytes || 0) + 40;
        return { unchanged: true, version: mockInboxVersion };
      }
      const full = RPC.dating_summary(); const fp = (o) => { let h = 0; const t = JSON.stringify(o); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return String(h >>> 0); };
      const rows = full.convos.map((c) => ({ ...c, _fp: fp(c) })); const ids = new Set(rows.map((r) => r.conversation_id)); const rf = fp(full.requests);
      const out = { unchanged: false, version: mockInboxVersion, changed: rows.filter((r) => p_known[r.conversation_id] !== r._fp), removed: Object.keys(p_known).filter((k) => !ids.has(k)),
        requests: rf === p_req ? null : full.requests, req_fp: rf, pending: full.pending, my_status: full.my_status, friend_statuses: full.friend_statuses,
        origins: full.origins, friend_asks: RPC.my_friend_asks() };
      window.__mockListBytes = (window.__mockListBytes || 0) + JSON.stringify(out).length;
      return out;
    },
    __unused_dating_summary: () => ({ convos, requests: likes, pending: likes.length, my_status: myStatus, origins: empty ? {} : { c12: 'nearby', c13: 'nearby', c14: 'nearby', ...mockOrigins },
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
    // "Rate this user" card: every sample chat qualifies until rated or Not now.
    rating_prompt: ({ p_conversation }) => ({ show: !mockRated.has(p_conversation) && !mockLater.has(p_conversation), messages: 14, next_at: 11 }),
    rating_prompt_later: ({ p_conversation }) => { mockLater.add(p_conversation); return null; },
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
    revealed_details: () => [{ name: 'Tolu', username: 'tolu2025' }],
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
    treasure_hunts_active: () => empty ? [] : [{ id: mockHuntId, title: 'Treasure Hunt', region: 'Wuse, Abuja · preview',
      description: 'Follow the clues and collect a Treehouse Coin at every stop.', starts_at: new Date(Date.now() - 3600000).toISOString(),
      ends_at: new Date(Date.now() + 86400000).toISOString(), checkpoint_count: mockHuntCheckpoints.length, participants: 27,
      joined: sessionStorage.getItem(`mock-hunt-joined-${mockHuntPlayer()}`) === '1' }],
    treasure_hunt_join: () => { sessionStorage.setItem(`mock-hunt-joined-${mockHuntPlayer()}`, '1'); return mockHuntProgress(); },
    treasure_hunt_join_with_routes: () => { sessionStorage.setItem(`mock-hunt-joined-${mockHuntPlayer()}`, '1'); return mockHuntProgress(); },
    treasure_hunt_progress: () => { if (sessionStorage.getItem(`mock-hunt-joined-${mockHuntPlayer()}`) !== '1') throw new Error('Join this hunt first.'); return mockHuntProgress(); },
    treasure_hunt_progress_with_routes: () => { if (sessionStorage.getItem(`mock-hunt-joined-${mockHuntPlayer()}`) !== '1') throw new Error('Join this hunt first.'); return mockHuntProgress(); },
    treasure_hunt_claim_start: ({ p_route_point, p_request_id }) => {
      const player = mockHuntPlayer(); const state = mockHuntState(player); const start = mockHuntCheckpoints[0];
      if (sessionStorage.getItem(`mock-hunt-joined-${player}`) !== '1') throw new Error('Join this hunt first.');
      if (p_route_point !== start.id) return { ok: false, error: 'This is not your starting checkpoint.' };
      if (state.claims.includes('start')) return { ok: true, idempotent: true, coins_awarded: start.reward_coins, total_coins: state.total_coins, checkpoint_sequence: state.found, progress: mockHuntProgress() };
      state.route = mockHuntOrder(player); state.found = 1; state.total_coins += start.reward_coins; state.claims.push('start', p_request_id); mockHuntSave(player, state);
      return { ok: true, idempotent: false, coins_awarded: start.reward_coins, total_coins: state.total_coins, checkpoint_sequence: state.found, progress: mockHuntProgress() };
    },
    treasure_hunt_claim_checkpoint: ({ p_checkpoint, p_request_id }) => {
      const player = mockHuntPlayer(); const state = mockHuntState(player); const order = state.route || mockHuntOrder(player);
      if (sessionStorage.getItem(`mock-hunt-joined-${player}`) !== '1') throw new Error('Join this hunt first.');
      const cp = mockHuntCheckpoints.find((item) => item.id === p_checkpoint);
      if (state.claims.includes(p_request_id) || state.claims.includes(p_checkpoint)) return { ok: true, idempotent: true, coins_awarded: cp?.reward_coins || 100, total_coins: state.total_coins, checkpoint_sequence: state.found, progress: mockHuntProgress() };
      if (!cp || p_checkpoint !== mockHuntCheckpoints[order[state.found]]?.id) return { ok: false, error: 'Follow your next checkpoint.' };
      state.found += 1; state.total_coins += cp.reward_coins; state.claims.push(p_checkpoint, p_request_id); mockHuntSave(player, state);
      return { ok: true, idempotent: false, coins_awarded: cp.reward_coins, total_coins: state.total_coins, checkpoint_sequence: state.found, progress: mockHuntProgress() };
    },
    treasure_hunt_finish: () => {
      const player = mockHuntPlayer(); const state = mockHuntState(player);
      if (state.found < mockHuntCheckpoints.length) return { ok: false, error: 'Find every checkpoint before claiming the treasure.' };
      const first = !state.done; state.done = true; if (first) state.total_coins += 100; mockHuntSave(player, state);
      return { ok: true, idempotent: !first, coins_awarded: first ? 100 : 100, total_coins: state.total_coins };
    },
    treasure_hunt_leaderboard: () => {
      const finished = sessionStorage.getItem('mock-hunt-ended') === '1' || sessionStorage.getItem('mock-hunt-status') === 'completed';
      const ownCoins = mockHuntState(mockHuntPlayer()).total_coins || 0;
      if (!finished) return { visibility: 'self', player_count: 27, own_rank: 14, own_coins: ownCoins, items: [], has_more: false };
      return { visibility: 'full', player_count: 3, own_rank: 2, own_coins: ownCoins, items: [
        { rank: 1, handle: 'Lucky Dolphin 214', coins: 500, checkpoints: 5, completed_at: new Date().toISOString(), cursor_key: 'd0000000-0000-4000-8000-000000000010', cursor_coins: 500, cursor_joined_at: new Date(Date.now() - 180000).toISOString() },
        { rank: 2, handle: 'Golden Kite 731', coins: 400, checkpoints: 4, completed_at: null, cursor_key: 'd0000000-0000-4000-8000-000000000011', cursor_coins: 400, cursor_joined_at: new Date(Date.now() - 120000).toISOString() },
        { rank: 3, handle: 'Quiet Falcon 086', coins: 300, checkpoints: 3, completed_at: null, cursor_key: 'd0000000-0000-4000-8000-000000000012', cursor_coins: 300, cursor_joined_at: new Date(Date.now() - 60000).toISOString() },
      ], has_more: false };
    },
    staff_treasure_hunts_personal: () => JSON.parse(sessionStorage.getItem('mock-staff-hunts') || JSON.stringify([{ id: mockHuntId, title: 'Treasure Hunt Preview', region: 'Wuse, Abuja', description: 'Sample safe route.', status: 'draft',
      starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 2 * 86400000).toISOString(), completion_bonus_coins: 100, coin_avatar: '🪙', treasure_avatar: '🧰', participant_count: 0,
      finish_points: [{ id: 'mock-finish-1', sequence: 1, name: 'City Park prize', latitude: 9.0775, longitude: 7.4803, radius_m: 60, reward_coins: 0 }], checkpoints: mockHuntCheckpoints.slice(0, 1) }])),
    staff_treasure_hunt_save_routes_personal: (a) => { const h = a.p_hunt || {}; const current = JSON.parse(sessionStorage.getItem('mock-staff-hunts') || '[]'); const id = h.id || `mock-hunt-${Date.now()}`;
      const value = { ...h, id, participant_count: 0, checkpoints: (a.p_checkpoints || []).map((p, i) => ({ ...p, id: `mock-stop-${i + 1}` })),
        start_points: [], finish_points: (a.p_finish_points || []).map((p, i) => ({ ...p, id: `mock-finish-${i + 1}` })) };
      const at = current.findIndex((x) => x.id === id); if (at < 0) current.unshift(value); else current[at] = value; sessionStorage.setItem('mock-staff-hunts', JSON.stringify(current)); return id; },
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
    start_conversation_from: ({ p_handle, p_origin }) => {
      const had = convos.find((c) => c.other_handle === p_handle); if (had) return had.conversation_id;
      const id = 'c' + (100 + convos.length); convos.unshift(convo(id, p_handle, { status: 'sent', last_from_me: true, last_at: new Date().toISOString(), last_message: null }));
      if (p_origin) mockOrigins[id] = p_origin; return id; },
    remove_friend: ({ p_conversation }) => { const c = convos.find((x) => x.conversation_id === p_conversation); if (c && c.kind === 'friend') { c.kind = undefined; return 'removed'; } return 'none'; },
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
    ad_for: (a) => (a.p_placement === 'home' || a.p_placement === 'rooms' ? { id: 'mock-ad', title: 'Win ₦50,000 in the Kickrs Fair Cup', body: 'Penalty shootout tonight at 6pm. Free to enter.', image_url: null, cta_label: 'Play now', cta_url: 'https://kickrs.app', advertiser: 'Kickrs' } : null),
    ad_event: () => null,
    my_referral: () => (mockUsername ? { code: mockUsername.username, needs_username: false, enabled: true, active: true, joined: 3 } : { code: null, needs_username: true, enabled: true, active: true, joined: 0 }),
    my_username: () => mockUsername,
    check_username: ({ p_username }) => { const n = String(p_username || '').trim().toLowerCase(); const ok = /^[a-z0-9]{3,14}$/.test(n) && /[a-z]/.test(n);
      return { username: n, ok: ok && !['taken', 'ada', 'treehouse'].includes(n), reason: !ok ? 'format' : n === 'treehouse' ? 'reserved' : ['taken', 'ada'].includes(n) ? 'taken' : null }; },
    set_username: ({ p_username }) => { const n = String(p_username || '').trim().toLowerCase();
      if (mockUsername) throw Object.assign(new Error('You can change your username again on 15 November 2027.'), { code: 'P0001' });
      if (n === 'taken') throw Object.assign(new Error('That username is taken. Try another.'), { code: '23505' });
      mockUsername = { username: n, set_at: new Date().toISOString(), next_change_at: new Date(Date.now() + 365 * 86400e3).toISOString(), can_change: false }; return mockUsername; },
    add_friend_by_username: ({ p_username }) => { const n = String(p_username || '').replace(/^@/, '').trim().toLowerCase();
      if (n !== 'ada') throw Object.assign(new Error('No one on treehouse has that username.'), { code: 'P0002' });
      return { conversation_id: 'mock-friend-ada', handle: 'Gentle Fox 610', status: 'sent' }; },
    claim_referral: () => false,
    // Calls (preview only). Two tabs share one pretend call through localStorage, so the real calling
    // engine (offer, answer, network routes) can connect tab to tab. A call is answered from the other tab.
    call_available: ({ p_conversation }) => ['c1', 'c2', 'c9'].includes(p_conversation),
    call_start: ({ p_conversation, p_kind }) => { mockRole = 'caller'; localStorage.setItem('mock-signals-caller', '[]'); localStorage.setItem('mock-signals-callee', '[]');
      const c = { id: '00000000-0000-0000-0000-00000000ca11', conversation_id: p_conversation, kind: p_kind, status: 'ringing', created_at: new Date().toISOString(), answered_at: null, ended_at: null, other_handle: 'Velvet Mango 532' };
      localStorage.setItem('mock-call', JSON.stringify(c)); return { ...c, outgoing: true, now: new Date().toISOString() }; },
    call_get: () => ({ ...(JSON.parse(localStorage.getItem('mock-call') || 'null') || {}), outgoing: mockRole === 'caller', now: new Date().toISOString() }),
    call_beat: () => RPC.call_get(),
    call_answer: ({ p_accept }) => { mockRole = 'callee'; const c = JSON.parse(localStorage.getItem('mock-call') || 'null') || {};
      const n = { ...c, status: p_accept ? 'active' : 'declined', answered_at: p_accept ? new Date().toISOString() : null }; localStorage.setItem('mock-call', JSON.stringify(n)); return { ...n, outgoing: false, now: new Date().toISOString() }; },
    call_end: () => { const c = JSON.parse(localStorage.getItem('mock-call') || 'null') || {}; const n = { ...c, status: c.status === 'ringing' ? 'cancelled' : 'ended', ended_at: new Date().toISOString() };
      localStorage.setItem('mock-call', JSON.stringify(n)); mockCalls.unshift({ ...n, outgoing: mockRole === 'caller' }); return n; },
    call_signal: ({ p_data }) => { const k = 'mock-signals-' + mockRole; const l = JSON.parse(localStorage.getItem(k) || '[]'); l.push({ id: (mockRole === 'caller' ? 0 : 100000) + l.length + 1, from: mockRole, data: p_data }); localStorage.setItem(k, JSON.stringify(l)); return null; },
    call_signals_since: ({ p_after }) => (JSON.parse(localStorage.getItem('mock-signals-' + (mockRole === 'caller' ? 'callee' : 'caller')) || '[]')).filter((m) => m.id > (p_after || 0)),
    call_history: ({ p_conversation }) => [...mockCalls.filter((c) => c.conversation_id === p_conversation), ...(p_conversation === 'c1' ? [{ id: 'old1', conversation_id: 'c1', kind: 'audio', status: 'missed', outgoing: false, created_at: ago(6), answered_at: null, ended_at: ago(6) }, { id: 'old2', conversation_id: 'c1', kind: 'video', status: 'ended', outgoing: true, created_at: ago(20), answered_at: ago(20), ended_at: new Date(Date.now() - 20 * 60000 + 272000).toISOString() }] : [])],
    call_ringing: () => null,
    // My Treehouse: a made-up tree (preview only). 24 direct, some with their own invitees, one level 3.
    my_treehouse: () => { const t = mockTree(); const lv = {}; t.forEach((n) => { if (!n.hidden) lv[n.level] = (lv[n.level] || 0) + 1; });
      const direct = lv[1] || 0, total = Object.values(lv).reduce((a, b) => a + b, 0);
      return { ...(mockUsername ? { code: mockUsername.username, needs_username: false } : { code: null, needs_username: true }), enabled: true, active: true, joined: direct,
        direct, network: total - direct, total, levels: Object.keys(lv).sort().map((k) => ({ level: +k, people: lv[k] })), deepest: Math.max(...Object.keys(lv).map(Number)), window_days: 3, rewards: { enabled: false } }; },
    treehouse_nodes: ({ p_parent, p_sort, p_offset, p_limit }) => { const t = mockTree(); const kids = t.filter((n) => n.parent === (p_parent || null));
      return { parent: p_parent, level: kids[0] ? kids[0].level : 1, count: kids.length, items: mockSort(kids, p_sort).slice(p_offset || 0, (p_offset || 0) + (p_limit || 30)).map(mockNode(t)) }; },
    treehouse_search: ({ p_query, p_level, p_sort, p_offset, p_limit }) => { const t = mockTree(); const q = String(p_query || '').toLowerCase();
      const v = t.filter((n) => !n.hidden && (!q || n.handle.toLowerCase().includes(q)) && (p_level == null || n.level === p_level));
      return { count: v.length, items: mockSort(v, p_sort).slice(p_offset || 0, (p_offset || 0) + (p_limit || 40)).map(mockNode(t)) }; },
    invite_leaderboard: () => ({ enabled: true, week_start: '2026-11-09', week_end: '2026-11-15', ends_at: new Date(Date.now() + 30 * 3600e3).toISOString(), min: 3,
      top: [['Noble Owl 221', 14], ['Mellow Sparrow 799', 11], ['Hidden Tiger 155', 9], ['Calm Lion 412', 6], ['Sunny Kite 87', 4], ['Bold Falcon 330', 3], ['Quiet River 18', 2]]
        .map(([h, n], i) => ({ rank: i + 1, handle: h, invites: n, me: i === 4 })),
      me: { rank: 5, invites: 4 }, last_winner: { handle: 'Gentle Fox 610', title: 'Woman of the Week', invites: 17 } }),
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
  window.__mockInboxMessage = () => {
    const at = new Date().toISOString(), body = 'Mock realtime message — inbox updated';
    const c = convos.find((row) => row.conversation_id === 'c1');
    if (c) { c.last_message = body; c.last_at = at; c.last_from_me = false; c.unread = (c.unread || 0) + 1; }
    const event = { payload: { k: 'message', c: 'c1', at, b: body, m: { id: ++msgId, sender_id: 'mock-other', body, created_at: at, reply_to: null, edited_at: null, deleted_at: null } } };
    mockInboxVersion++;
    mockInboxListeners.forEach((listener) => listener(event));
    return { delivered: mockInboxListeners.size > 0, version: mockInboxVersion, body };
  };
  if (q.get('mock-inbox') === '1') setTimeout(() => window.__mockInboxMessage(), 3000);

  let mockAvatars = [];
  const mockFiles = new Map();
  function result(data) { return Promise.resolve({ data, error: null }); }
  function from(table) {
    let rows = [];
    if (table === 'dating_profiles') rows = profile;
    if (table === 'dating_messages') rows = [];
    let convId = null, single = false, before = null, lim = null;
    const b = {
      select() { return b; }, insert(v) { if (table === 'dating_messages') rows = { id: Date.now(), sender_id: ME, body: v.photo ? '📷 Photo' : v.body, created_at: new Date().toISOString(), reply_to: v.reply_to || null, edited_at: null, deleted_at: null, photo: v.photo || null, photo_w: v.photo_w || null, photo_h: v.photo_h || null, voice: v.voice || null, voice_ms: v.voice_ms || null, voice_played_at: null }; if (table === 'dating_messages' && v.voice) rows.body = '🎤 Voice note'; return b; },
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
      }, delete() { return b; }, order() { return b; }, limit(n) { lim = n; return b; }, lt(col, v) { if (col === 'created_at') before = v; return b; },
      eq(col, v) { if (col === 'conversation_id') convId = v; return b; },
      maybeSingle() { single = true; return b; }, single() { single = true; return b; },
      then(ok, bad) {
        let data = rows;
        if (table === 'dating_messages' && convId && !single) {
          let all = messages(convId);
          // Preview only: sessionStorage mock-longchat=1 gives chat c1 200 extra older messages.
          if (convId === 'c1' && sessionStorage.getItem('mock-longchat')) {
            const t0 = new Date(all[0] ? all[0].created_at : Date.now()).getTime();
            const extra = Array.from({ length: 200 }, (_, i) => ({ id: `old-${i}`, sender_id: i % 2 ? ME : 'them', body: `Older message #${200 - i}`, created_at: new Date(t0 - (i + 1) * 60000).toISOString(), reply_to: null, edited_at: null, deleted_at: null, photo: null }));
            all = [...extra.reverse(), ...all];
          }
          // Preview only: window.__mockMissed[conv] = messages that "arrived while the live connection was down".
          if (window.__mockMissed && window.__mockMissed[convId]) all = [...all, ...window.__mockMissed[convId]];
          let desc = all.slice().reverse();
          if (before) desc = desc.filter((m) => m.created_at < before);
          data = lim ? desc.slice(0, lim) : desc;
        }
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
    if (typeof name === 'string' && name.startsWith('user:')) {
      let inboxHandler = null;
      const ch = { on(type, filter, cb) { if (type === 'broadcast' && filter && filter.event === 'inbox') inboxHandler = cb; return ch; },
        subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 50); return ch; }, track() {}, send() {}, presenceState() { return {}; },
        __leave() { if (inboxHandler) mockInboxListeners.delete(inboxHandler); } };
      const register = () => { if (inboxHandler) mockInboxListeners.add(inboxHandler); };
      setTimeout(register, 0);
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
        from, channel, removeChannel(ch) { if (ch && ch.__leave) ch.__leave(); },
        storage: { from: () => ({
          upload: (path, blob) => { mockFiles.set(path, URL.createObjectURL(blob)); return result({ path }); },
          createSignedUrl: (path) => result({ signedUrl: mockFiles.get(path) || '/icon-512.png?mock-photo' }),
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

// ---- My Treehouse mock tree ----
let _tree = null;
const TREE_NAMES = ['Mimi Sunbird', 'Noble Wolf', 'Brave Panther', 'Kind Jaguar', 'Swift Tiger', 'Calm Leopard', 'Golden Kite', 'Misty Owl', 'Velvet Mango', 'Rosy Zebra', 'Silver Fern', 'Coral Breeze', 'Amber Tide', 'Sunny Baobab', 'Quiet River', 'Bold Falcon', 'Lucky Heron', 'Jolly Gecko', 'Royal Palm', 'Bright Comet', 'Gentle Dove', 'Wild Iroko', 'Cosmic Kola', 'Happy Ube', 'Sweet Agege', 'Shiny Cowrie', 'Fresh Zobo', 'Chill Lagoon', 'Spicy Suya', 'Magic Ankara', 'Neon Okada', 'Dancing Talking-drum'];
function mockTree() {
  if (_tree) return _tree;
  const out = []; let i = 0; const day = 86400e3;
  const add = (parent, level) => { const n = { key: 'k' + (++i), handle: `${TREE_NAMES[i % TREE_NAMES.length]} ${100 + i}`, parent, level, joined_at: new Date(Date.now() - (60 - i % 60) * day / 2).toISOString(), hidden: i === 7 }; out.push(n); return n; };
  for (let a = 0; a < 24; a++) { const n = add(null, 1); const kids = [8, 5, 6, 5, 3, 0, 2, 0, 4][a] || (a % 5 === 0 ? 2 : 0);
    for (let b = 0; b < kids; b++) { const m = add(n.key, 2); if (a === 0 && b < 3) for (let c = 0; c < 2 + b; c++) add(m.key, 3); } }
  _tree = out; return out;
}
const mockSort = (arr, sort) => { const t = mockTree(); const st = (n) => mockStats(t, n);
  return arr.slice().sort((x, y) => (sort === 'direct' ? st(y).direct - st(x).direct : sort === 'total' ? st(y).total - st(x).total : 0) || (y.joined_at > x.joined_at ? 1 : -1)); };
function mockStats(t, n) { const below = (k) => t.filter((z) => z.parent === k).flatMap((z) => [z, ...below(z.key)]);
  const all = below(n.key); return { direct: t.filter((z) => z.parent === n.key && !z.hidden).length, total: all.filter((z) => !z.hidden).length, kids: t.filter((z) => z.parent === n.key).length }; }
const mockNode = (t) => (n) => { const s = mockStats(t, n); const p = t.find((z) => z.key === n.parent);
  return { key: n.key, level: n.level, joined_at: n.joined_at, hidden: n.hidden, handle: n.hidden ? null : n.handle, parent_handle: p && !p.hidden ? p.handle : null, direct: s.direct, total: s.total, has_children: s.kids > 0 }; };
