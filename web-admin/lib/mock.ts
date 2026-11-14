/* eslint-disable @typescript-eslint/no-explicit-any */
// Preview mode (NEXT_PUBLIC_ADMIN_MOCK=1): a fake Supabase client with sample data. Nothing leaves the browser.
// ?role=moderator|admin|editor|analyst|super_admin picks the role; ?fresh=1 starts signed out.
import { STATES } from './options';

const K = 'th-admin-mock';
type S = { signedIn: boolean; enrolled: boolean; aal2: boolean; role: string };
function st(): S {
  const p = new URLSearchParams(location.search);
  if (p.get('fresh')) {
    localStorage.removeItem(K);
    p.delete('fresh');
    history.replaceState(null, '', location.pathname + (p.toString() ? `?${p}` : ''));
  }
  const s: S = JSON.parse(localStorage.getItem(K) || '{"signedIn":false,"enrolled":false,"aal2":false,"role":"super_admin"}');
  if (p.get('role')) s.role = p.get('role')!;
  localStorage.setItem(K, JSON.stringify(s));
  return s;
}
const save = (s: S) => localStorage.setItem(K, JSON.stringify(s));

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const NAMES = ['NobleOwl', 'MellowSparrow', 'HiddenTiger', 'QuietRiver', 'BoldFalcon', 'SunnyKite', 'CalmLion', 'SwiftHeron', 'JollyPanda', 'BraveOtter', 'GentleFox', 'LuckyRaven', 'ShyGazelle', 'WildMango', 'CoolBaobab'];
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const H = 3600e3, D = 86400e3;

const members = Array.from({ length: 64 }, (_, i) => {
  const h = `${NAMES[i % NAMES.length]}${100 + Math.floor(rnd() * 899)}`;
  return {
    handle: h, gender: pick(['female', 'male', 'female', 'male', 'other']), age: 18 + Math.floor(rnd() * 22), state: pick(['Lagos', 'Lagos', 'FCT', 'Rivers', 'Oyo', 'Kano', 'Enugu', 'Kaduna', ...STATES]),
    intent: pick(['fun', 'friendship', 'love', 'marriage']), created_at: iso(rnd() * 90 * D), last_seen_at: iso(rnd() < 0.2 ? rnd() * 4 * 60e3 : rnd() * 9 * D),
    suspended: i % 23 === 5, is_active: i % 17 !== 3, underage: i === 40, room_ban_until: i % 19 === 7 ? iso(-30 * H) : null, open_reports: i % 9 === 2 ? 1 + (i % 3) : 0,
    staff_role: i === 0 ? 'super_admin' : i === 1 ? 'moderator' : i === 2 ? 'editor' : null,
  };
});
const H0 = members[0].handle;
const days = (d: number) => Array.from({ length: d }, (_, i) => new Date(now - (d - 1 - i) * D).toISOString().slice(0, 10));

const chatReports = Array.from({ length: 7 }, (_, i) => ({
  id: 900 - i, created_at: iso(i * 5 * H + 20 * 60e3), status: 'open', reason: ['harassment', 'spam', 'fake', 'inappropriate', 'underage', 'harassment', 'other'][i],
  details: ['Kept sending rude messages after I said stop', 'Asking everyone to send money to an account', 'Uses celebrity photos', 'Explicit messages', 'Said they are 16', 'Threatened me', ''][i],
  conversation_id: i === 6 ? null : `00000000-0000-4000-8000-00000000c0${i}0`, reporter: members[10 + i].handle, reported: members[20 + i].handle, reported_suspended: false,
  reported_room_banned: false, reports_against: 1 + (i % 3), speed: i === 3, has_chat: i !== 6,
}));
const roomReports = [
  { id: 5001, room: 'Lagos', body: 'DM me for cheap iPhones, pay first 🔥🔥', room_name: 'Shiny Hawk', author: members[30].handle, author_suspended: false, author_room_banned: false, created_at: iso(3 * H), reports: 4, reasons: ['spam'], first_reported_at: iso(2.5 * H) },
  { id: 5002, room: 'Football Banter', body: 'you people are all useless', room_name: 'Loud Eagle', author: members[31].handle, author_suspended: false, author_room_banned: false, created_at: iso(9 * H), reports: 1, reasons: ['harassment'], first_reported_at: iso(8 * H) },
];
const ROOMS = ['Nigeria', 'Ages 18-25', 'Ages 26-35', 'Ages 36+', 'Lovers Lounge', 'Ladies Room', 'Mens Room', 'Football Banter', 'Christian Room', 'Muslim Room', ...STATES, 'UNILAG', 'UI', 'OAU', 'UNN', 'ABU', 'UNIBEN', 'LASU', 'UNIPORT', 'FUTA', 'Covenant'];
const rooms = ROOMS.map((r, i) => ({ room: r, group: i < 10 ? 'general' : i < 47 ? 'state' : 'university', online: Math.floor(rnd() * (i < 10 ? 60 : 25)), members: Math.floor(40 + rnd() * 600),
  messages_24h: Math.floor(rnd() * 900), open_reports: r === 'Lagos' ? 1 : r === 'Football Banter' ? 1 : 0, closed: r === 'Mens Room', reason: r === 'Mens Room' ? 'Closed for a clean-up. Back tomorrow.' : '' }));
let ads: any[] = [
  { id: 'a1', name: 'Kickrs Fair Cup', advertiser: 'Kickrs', status: 'active', placements: ['home', 'rooms'], title: 'Win ₦50,000 in the Fair Cup', body: 'Penalty shootout tonight at 6pm. Free to enter.', image_url: null,
    cta_label: 'Play now', cta_url: 'https://kickrs.app', starts_at: null, ends_at: null, audience: { states: ['Lagos', 'FCT'] }, weight: 20, created_at: iso(3 * D), views: 4210, taps: 377, reach: 3020, live: true },
  { id: 'a2', name: 'Suya Spot promo', advertiser: 'Suya Spot Lekki', status: 'paused', placements: ['discover'], title: 'Free drink with any suya', body: 'Show this card at the counter.', image_url: null,
    cta_label: 'Get directions', cta_url: 'https://maps.google.com', starts_at: null, ends_at: null, audience: {}, weight: 10, created_at: iso(12 * D), views: 1810, taps: 92, reach: 1500, live: false },
];
const ann = [
  { id: 'n1', title: 'Birthdays are here 🎂', category: 'feature_launch', status: 'published', created_at: iso(2 * D), scheduled_for: null, published_at: iso(2 * D), eligible_count: 9800, delivered_count: 9740, read_count: 4120, click_count: 610, created_by_handle: H0, total: 2 },
  { id: 'n2', title: 'Short maintenance Sunday 2am', category: 'maintenance', status: 'scheduled', created_at: iso(5 * H), scheduled_for: iso(-30 * H), published_at: null, eligible_count: null, delivered_count: null, read_count: null, click_count: null, created_by_handle: members[2].handle, total: 2 },
];
const audit = [
  { at: iso(12 * 60e3), actor: members[1].handle, action: 'view_reported_chat', target_type: 'conversation', target_id: '00000000-0000-4000-8000-00000000c000', meta: { report: 900 }, source: 'console' },
  { at: iso(50 * 60e3), actor: members[1].handle, action: 'room_ban', target_type: 'member', target_id: members[30].handle, meta: { hours: 72, reason: 'Selling phones in Lagos room' }, source: 'console' },
  { at: iso(3 * H), actor: H0, action: 'view_chat', target_type: 'conversation', target_id: '00000000-0000-4000-8000-00000000d001', meta: { basis: 'super_admin', reason: 'Police request ref LG/442' }, source: 'console' },
  { at: iso(6 * H), actor: H0, action: 'staff_set', target_type: 'member', target_id: members[1].handle, meta: { role: 'moderator' }, source: 'console' },
  { at: iso(26 * H), actor: members[2].handle, action: 'published', target_type: 'announcement', target_id: 'n1', meta: {}, source: 'announcements' },
];

function dashboard(d: number) {
  const ds = days(d);
  return {
    days: d, at: new Date().toISOString(), accounts: 31840, profiles: 26412, online_now: 412, active_1d: 5230, active_7d: 13980, active_30d: 19870, new_today: 188,
    suspended: 143, underage_marked: 37, room_bans: 21, chat_messages_today: 48210, room_messages_today: 22940, in_rooms_now: 690,
    open_reports: { chat: chatReports.length, room: roomReports.length, link: 1 }, signups: ds.map((x) => ({ day: x, profiles: 120 + Math.floor(rnd() * 140) })),
    gender: { female: 12110, male: 13520, other: 782 },
    top_states: [{ state: 'Lagos', people: 9120 }, { state: 'FCT', people: 4210 }, { state: 'Rivers', people: 2380 }, { state: 'Oyo', people: 1640 }, { state: 'Enugu', people: 990 }],
    ads: { active: 1, views_today: 612, taps_today: 51 }, referrals: { joined_today: 23, joined_period: 389 },
    dating: { daily: ds.map((x, i) => ({ date: x, accounts: 150 + Math.floor(rnd() * 120) + i * 4, profiles: 110 + Math.floor(rnd() * 110) + i * 4, conversations: 300 + Math.floor(rnd() * 260) + i * 6, messages: 30000 + Math.floor(rnd() * 22000) })),
      inRange: { accounts: 2800, profiles: 2410, conversations: 6120, messages: 612000 }, totals: {}, intent: [] },
    speed: { now: { onDates: 14, waiting: 9 }, daily: ds.map((x) => ({ date: x, dates: 30 + Math.floor(rnd() * 80), matches: 10 + Math.floor(rnd() * 20) })), inRange: { pairings: 900, matches: 210 } },
    deletions: { inRange: 64, daily: [] }, photos: { stored: 8120, storedMB: 612.4, sentToday: 940 },
    platforms: { people: { 'android-play': 6120, 'android-apk': 1200, 'ios-app': 2410, web: 4800 } }, reputation: { needs_review: 12, ratings_24h: 830 },
  };
}

const chatMsgs = (a: string, b: string) => [
  { id: 1, sender: a, body: 'Hi, how far?', photo: null, created_at: iso(5 * H) },
  { id: 2, sender: b, body: 'I’m fine. You?', photo: null, created_at: iso(4.9 * H) },
  { id: 3, sender: a, body: 'Send me your number now', photo: null, created_at: iso(4.5 * H) },
  { id: 4, sender: b, body: 'I don’t want to, let’s keep chatting here', photo: null, created_at: iso(4.4 * H) },
  { id: 5, sender: a, body: 'You’re wasting my time. Stupid girl.', photo: null, created_at: iso(4.3 * H) },
];

function rpc(fn: string, a: any): any {
  switch (fn) {
    case 'staff_me': { const s = st(); return { role: s.role, can_publish: ['super_admin', 'admin'].includes(s.role), handle: s.role === 'super_admin' ? H0 : members[1].handle, mfa: s.aal2 }; }
    case 'staff_signed_in': return null;
    case 'staff_dashboard': return dashboard(a.p_days || 14);
    case 'staff_report_counts': return { chat: chatReports.length, room: roomReports.length, link: 1 };
    case 'staff_reports': return a.p_status !== 'open' ? [] : a.p_kind === 'chat' ? chatReports.slice(0, a.p_limit || 50) : a.p_kind === 'room' ? roomReports
      : [{ id: 77, created_at: iso(30 * H), status: 'open', reason: 'threat', body: 'I know where you live', username: 'tolu', link_suspended: false, reports_for_link: 1 }];
    case 'staff_report_context': {
      if (a.p_kind === 'room') { const r = roomReports.find((x) => x.id === a.p_id)!; return { room: r.room, messages: [{ id: 1, room_name: 'Tall Palm', author: members[40].handle, body: 'Good evening Lagos', created_at: iso(3.2 * H) }, { id: r.id, room_name: r.room_name, author: r.author, body: r.body, created_at: r.created_at, reported: true }], reports: [{ by: members[12].handle, reason: 'spam', at: iso(2 * H) }] }; }
      const r = chatReports.find((x) => x.id === a.p_id)!;
      if (!r.conversation_id) return { messages: [], note: 'This report wasn’t made from a chat, or the chat was deleted.' };
      return { conversation_id: r.conversation_id, reported: r.reported, reporter: r.reporter, messages: chatMsgs(r.reported, r.reporter), unsent: [{ sender: r.reported, body: 'I will find you', sent_at: iso(4.2 * H), unsent_at: iso(4.19 * H) }] };
    }
    case 'staff_report_set': case 'staff_link_suspend': case 'staff_member_suspend': case 'staff_room_ban': case 'staff_member_reset_dob_clock': case 'staff_member_block_sign_in':
    case 'staff_member_note': case 'staff_member_delete': case 'staff_room_delete_message': case 'staff_room_set': case 'staff_setting_set': case 'staff_filter_word': case 'staff_rating_set':
    case 'staff_team_set': case 'staff_referral_campaign': case 'staff_referral_code_active': case 'ann_publish': case 'ann_cancel': case 'ann_archive': case 'ann_delete_draft': return null;
    case 'staff_members': {
      const q = (a.p_q || '').toLowerCase();
      return members.filter((m) => (!q || m.handle.toLowerCase().includes(q)) && (a.p_filter === 'suspended' ? m.suspended : a.p_filter === 'reported' ? m.open_reports > 0 : a.p_filter === 'room_banned' ? !!m.room_ban_until
        : a.p_filter === 'underage' ? m.underage : a.p_filter === 'staff' ? !!m.staff_role : a.p_filter === 'online' ? now - Date.parse(m.last_seen_at) < 300e3 : a.p_filter === 'new' ? now - Date.parse(m.created_at) < 7 * D : true)).slice(a.p_offset || 0, (a.p_offset || 0) + 50);
    }
    case 'staff_member': {
      const m = members.find((x) => x.handle.toLowerCase() === String(a.p_handle).toLowerCase());
      if (!m) throw new Error('No member has that handle.');
      const s = st();
      return { ...m, location: 'Lekki', bio: 'Here for good vibes and better jollof.', interests: ['Afrobeats', 'Football', 'Food'], updated_at: m.created_at, underage_at: m.underage ? iso(5 * D) : null, age_changed_at: null,
        signed_up_at: m.created_at, last_sign_in_at: iso(2 * H), sign_in_blocked: false, room_ban: m.room_ban_until ? { until: m.room_ban_until, reason: 'Spam' } : null,
        counts: { chats: 14, requests: 3, friends: 6, messages_sent: 812, room_messages: 240, blocked_others: 2, blocked_by: 1, reports_against: m.open_reports, reports_made: 0, push_devices: 2 },
        reputation: { score: 4.3, raters: 18, band: 'normal', established: true }, bird_level: 3, kickrs: true, platforms: ['android-play'],
        referral: { code: 'k7mq2xa', joined: 4, came_from: null },
        reports: chatReports.filter((r) => r.reported === m.handle).map((r) => ({ id: r.id, created_at: r.created_at, reason: r.reason, details: r.details, status: r.status, by: r.reporter, conversation_id: r.conversation_id })),
        notes: [{ at: iso(2 * D), by: members[1].handle, body: 'Warned in chat about sharing numbers.' }],
        ...(['super_admin', 'admin'].includes(s.role) ? { name: 'Adaeze O.', email: 'ada***@gmail.com', birth_date: '1999-04-12', providers: ['google'] } : {}) };
    }
    case 'staff_member_chats': return [{ id: '00000000-0000-4000-8000-00000000d001', kind: 'dating', created_at: iso(9 * D), accepted_at: iso(9 * D), partner: members[50].handle, messages: 120, last_at: iso(2 * H), reported: false },
      { id: '00000000-0000-4000-8000-00000000c000', kind: 'friend', created_at: iso(20 * D), accepted_at: iso(19 * D), partner: members[10].handle, messages: 40, last_at: iso(5 * H), reported: true }];
    case 'staff_chat': {
      const reported = chatReports.some((r) => r.conversation_id === a.p_conversation);
      if (!reported && (!a.p_reason || a.p_reason.length < 5)) throw new Error('Nobody reported this chat. Write why you need to open it.');
      return { id: a.p_conversation, kind: 'dating', created_at: iso(9 * D), reported, people: [members[20].handle, members[10].handle], messages: chatMsgs(members[20].handle, members[10].handle), unsent: [] };
    }
    case 'staff_rooms': return rooms;
    case 'staff_room_messages': return Array.from({ length: 24 }, (_, i) => ({ id: 6000 + i, room_name: pick(['Tall Palm', 'Shiny Hawk', 'Blue Kite', 'Red Mango']), author: members[30 + (i % 10)].handle,
      author_suspended: false, body: pick(['Good evening everyone', 'Who dey Lekki?', 'Arsenal go win today', 'Abeg how una dey', 'This room sweet', 'DM me for cheap phones']), created_at: iso((24 - i) * 4 * 60e3), reply_to: null, reports: i === 20 ? 2 : 0 }));
    case 'staff_ads': return ads;
    case 'staff_ad_save': { const p = a.p; if (p.id) { ads = ads.map((x) => (x.id === p.id ? { ...x, ...p } : x)); return p.id; } const id = `a${ads.length + 1}`; ads = [{ ...p, id, status: 'draft', created_at: new Date().toISOString(), views: 0, taps: 0, reach: 0, live: false }, ...ads]; return id; }
    case 'staff_ad_status': ads = ads.map((x) => (x.id === a.p_id ? { ...x, status: a.p_status, live: a.p_status === 'active' } : x)); return null;
    case 'staff_ad_stats': return { daily: days(30).map((d) => ({ day: d, views: Math.floor(rnd() * 300), taps: Math.floor(rnd() * 30) })), placements: { home: { views: 3000, taps: 300 }, rooms: { views: 1210, taps: 77 } } };
    case 'staff_referrals': return { enabled: true, total_joined: 2140, joined_period: 389, came_back: 1310, codes: 5120, daily: days(a.p_days || 30).map((d) => ({ day: d, joined: Math.floor(rnd() * 30) })),
      top: [{ code: 'k7mq2xa', handle: members[5].handle, active: true, clicks: 310, joined: 41, came_back: 30, suspended: 0, last_joined: iso(3 * H), max_in_an_hour: 4 },
        { code: 'p9xw3ze', handle: members[6].handle, active: true, clicks: 95, joined: 26, came_back: 3, suspended: 6, last_joined: iso(1 * H), max_in_an_hour: 18 }],
      campaigns: [{ code: 'unilagfair', campaign: 'UNILAG fair flyers', note: '2,000 flyers', active: true, clicks: 1420, joined: 212, came_back: 140, created_at: iso(10 * D) }] };
    case 'staff_invite_week': {
      const last = a.p_weeks_ago === 1;
      const ws = new Date(now - ((new Date().getDay() + 6) % 7) * D - (last ? 7 * D : 0)).toISOString().slice(0, 10);
      const we = new Date(Date.parse(ws) + 6 * D).toISOString().slice(0, 10);
      const top = [['NobleOwl221', 'male', 14, 15], ['GentleFox610', 'female', 11, 12], ['HiddenTiger155', 'male', 9, 31], ['CalmLion412', 'female', 6, 6], ['SunnyKite87', 'other', 4, 5]]
        .map(([h, g, c, all], i) => ({ rank: i + 1, handle: h, gender: g, invites: c, joined_all: all, reached_at: iso(i * H), title: g === 'male' ? 'Man of the Week' : g === 'female' ? 'Woman of the Week' : 'Star of the Week' }));
      return { week_start: ws, week_end: we, current: !last, announce_at: new Date(Date.parse(we) + D + 11 * H).toISOString(), enabled: true, min: 3, top,
        excluded: last ? [] : [{ handle: 'ShyGazelle895', reason: '20 sign-ups in one hour from the same phone model', by: H0, at: iso(5 * H) }],
        winner: last ? { handle: 'GentleFox610', title: 'Woman of the Week', invites: 17, at: iso(5 * D) } : null,
        winners: [{ week: days(14)[0], handle: 'GentleFox610', title: 'Woman of the Week', invites: 17 }, { week: days(21)[0], handle: 'BoldFalcon330', title: 'Man of the Week', invites: 12 }] };
    }
    case 'staff_invite_exclude': return null;
    case 'staff_referral_joined': return members.slice(40, 48).map((m) => ({ handle: m.handle, joined_at: m.created_at, last_seen_at: m.last_seen_at, suspended: m.suspended, state: m.state }));
    case 'staff_settings': return { settings: { signups_paused: false, signups_paused_reason: '', ads_enabled: true, referrals_enabled: true, invite_winner_enabled: true, invite_winner_min: 3 }, filter_words: ['scam', 'whatsappme', 'paypal'],
      rating: [{ key: 'min_raters', value: 5, note: 'different raters needed before a score is "established"' }, { key: 'cooldown_days', value: 7, note: 'one rating per person per rolling N days' }] };
    case 'staff_team': return members.filter((m) => m.staff_role).map((m, i) => ({ handle: m.handle, role: m.staff_role, can_publish: i !== 1, added_at: iso((30 - i) * D), added_by: i ? H0 : null, authenticator: i !== 2, last_action_at: iso(i * H), email: st().role === 'super_admin' ? `staff${i}@treehouse.ng` : null }));
    case 'staff_audit_log': return a.p_before ? [] : audit.filter((x) => (!a.p_action || x.action === a.p_action) && (!a.p_actor || (x.actor || '').toLowerCase() === a.p_actor.toLowerCase()));
    case 'ann_overview': return { total: 2, published: 1, scheduled: 1, drafts: 0, recipients: 9740, reads: 4120, read_rate: 42.3, clicks: 610 };
    case 'ann_list': return ann.filter((x) => a.p_status === 'all' || x.status === a.p_status);
    case 'ann_get': { const x = ann.find((y) => y.id === a.p_id) || ann[0]; return { ...x, preview: 'Show your birthday on your profile and get cards from friends.', body: 'From today you can turn on **Show my birthday**.\n- A badge on your profile\n- A banner in chatrooms', cover_url: null, cta_label: 'Open profile', cta_url: '/home/profile', audience: { base: 'active' }, send_push: true, expires_at: null, revised_by: null }; }
    case 'ann_estimate': return 9800;
    case 'ann_save': return a.p_id || 'n1';
    case 'ann_analytics': return { delivered: 9740, reads: 4120, read_rate: 42.3, clicks: 610, click_rate: 6.3, by_day: days(7).map((d) => ({ day: d, reads: Math.floor(rnd() * 900), clicks: Math.floor(rnd() * 120) })) };
  }
  throw new Error(`Preview mode has no sample data for ${fn}.`);
}

export function mockClient() {
  const listeners: ((ev: string) => void)[] = [];
  return {
    rpc: async (fn: string, args: any) => {
      await new Promise((r) => setTimeout(r, 120));
      try { return { data: rpc(fn, args || {}), error: null }; } catch (e) { return { data: null, error: { message: (e as Error).message, code: 'P0001' } }; }
    },
    auth: {
      getSession: async () => ({ data: { session: st().signedIn ? { user: { email: 'you@treehouse.ng' } } : null } }),
      onAuthStateChange: (cb: (ev: string) => void) => { listeners.push(cb); return { data: { subscription: { unsubscribe: () => {} } } }; },
      signInWithOAuth: async () => { const s = st(); s.signedIn = true; save(s); return { error: null }; },
      signInWithPassword: async () => { const s = st(); s.signedIn = true; save(s); return { error: null }; },
      signOut: async () => { const s = st(); s.signedIn = false; s.aal2 = false; save(s); listeners.forEach((l) => l('SIGNED_OUT')); return { error: null }; },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: st().aal2 ? 'aal2' : 'aal1', nextLevel: 'aal2' } }),
        listFactors: async () => { const s = st(); const f = s.enrolled ? [{ id: 'f1', status: 'verified', factor_type: 'totp' }] : []; return { data: { totp: f, all: f } }; },
        unenroll: async () => ({ error: null }),
        enroll: async () => ({ data: { id: 'f1', totp: { qr_code: QR, secret: 'JBSWY3DPEHPK3PXP', uri: '' } }, error: null }),
        challengeAndVerify: async ({ code }: { code: string }) => {
          if (code !== '123456') return { error: { message: 'Invalid TOTP code entered' } };
          const s = st(); s.enrolled = true; s.aal2 = true; save(s); return { error: null };
        },
      },
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'preview' } }), upload: async () => ({ error: null }) }) },
  };
}

const QR = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"/>' +
  Array.from({ length: 29 * 29 }, (_, i) => { const x = i % 29, y = Math.floor(i / 29); const f = (x < 8 && y < 8) || (x > 20 && y < 8) || (x < 8 && y > 20); const on = f ? (x % 7 === 0 || y % 7 === 0 || (x % 7 > 1 && x % 7 < 5 && y % 7 > 1 && y % 7 < 5)) && !(x === 7 || y === 7 || x === 21 || y === 21) : ((x * 7 + y * 13 + x * y) % 5 < 2); return on ? `<rect x="${x}" y="${y}" width="1" height="1" fill="#090d2b"/>` : ''; }).join('') + '</svg>');
