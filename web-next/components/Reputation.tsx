'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Bird Kingdom (levels from active hours; hours and thresholds are never shown to members) and Community Star Ratings (anonymous, from profiles).
// Two separate indicators, never combined. Rules and maths: REPUTATION.md. Everything is decided by the
// database; this file only shows it and sends a once-a-minute "I'm active" ping.
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { state, emit, useAppState } from '@/lib/state';
import { openSheet, toast } from './overlay';
import { vars } from './ui';

export const BIRDS = [
  { n: 1, name: 'Sparrow', hours: 0, emoji: '🐦', c1: '#c9a27e', c2: '#8a6a4b', text: 'Every journey starts here. Small, curious and everywhere.' },
  { n: 2, name: 'Dove', hours: 5, emoji: '🕊️', c1: '#dfe9f3', c2: '#8fa7bf', text: 'You’ve found your feet: calm, friendly and back again.' },
  { n: 3, name: 'Kingfisher', hours: 20, emoji: '🐦', c1: '#3dd6e0', c2: '#0e7c99', text: 'Quick and bright. You know your way around the treehouse.' },
  { n: 4, name: 'Hawk', hours: 50, emoji: '🦅', c1: '#e0a86b', c2: '#8d4a17', text: 'Sharp eyes, steady presence. People know you here.' },
  { n: 5, name: 'Eagle', hours: 100, emoji: '🦅', c1: '#ffd866', c2: '#c48a00', text: 'Soaring high: a true treehouse regular.' },
  { n: 6, name: 'Owl', hours: 250, emoji: '🦉', c1: '#a99bff', c2: '#5141c9', text: 'Wise and seasoned. You’ve watched the treehouse grow.' },
  { n: 7, name: 'Falcon', hours: 500, emoji: '🦅', c1: '#8aa3bd', c2: '#2c3e57', text: 'Fast, loyal and rare: one of the dedicated few.' },
  { n: 8, name: 'Phoenix', hours: 1000, emoji: '🔥', c1: '#ffcf4a', c2: '#e2362b', text: 'Legendary. The rarest bird in the treehouse.' },
];
export const bird = (level: number) => BIRDS[Math.min(Math.max((level || 1) - 1, 0), 7)];

export function Emblem({ level, size = 'md' }: { level: number; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const b = bird(level);
  return (
    <span className={`bk-emblem bk-${size} ${b.n === 8 ? 'bk-phoenix' : ''}`} style={vars({ '--b1': b.c1, '--b2': b.c2 })} aria-hidden="true">
      <span className="bk-glyph">{b.emoji}</span><span className="bk-num">{b.n}</span>
    </span>
  );
}
export function BirdBadge({ level, compact = false }: { level?: number | null; compact?: boolean }) {
  if (!level) return null;
  const b = bird(level);
  return <span className={`bk-pill ${b.n === 8 ? 'bk-pill-phoenix' : ''}`} title={`Level ${b.n} — ${b.name}`}><Emblem level={b.n} size="sm" />{compact ? b.name : `Level ${b.n} — ${b.name}`}</span>;
}
export function StarPill({ rating, ratings }: { rating?: number | null; ratings?: number | null }) {
  const n = Number(ratings || 0);
  const count = <small>{` (${n.toLocaleString()})`}</small>;
  if (rating == null) return <span className="rp-pill new" title={`Not enough ratings yet · ${n} rating${n === 1 ? '' : 's'}`}>★ New member{count}</span>;
  return <span className="rp-pill" title={`${rating} out of 5 from ${n} ratings`}>{`★ ${Number(rating).toFixed(1)}`}{count}</span>;
}

// ---- Badges for other people (cached for 10 minutes) -----------------------------------------
const cache = new Map<string, { at: number; b: any }>();
const fresh = (k: string) => { const c = cache.get(k); return c && Date.now() - c.at < 600000 ? c.b : undefined; };
let tick = 0;
const listeners = new Set<() => void>();
function useCacheTick() { const [, set] = useState(0); useEffect(() => { const f = () => set(++tick); listeners.add(f); return () => { listeners.delete(f); }; }, []); }
const pending = new Set<string>();
const queued = { c: new Set<string>(), r: new Set<string>(), h: new Set<string>() };
let flushTimer: any = null;
// Rows ask one by one; requests are grouped (one call per 30 ms burst, up to 200 at a time).
function loadBadges(kind: 'c' | 'r' | 'h', keys: string[]) {
  keys.forEach((k) => { if (k && fresh(`${kind}:${k}`) === undefined && !pending.has(`${kind}:${k}`)) queued[kind].add(k); });
  if (!flushTimer) flushTimer = setTimeout(flush, 30);
}
async function flush() {
  flushTimer = null;
  for (const kind of ['c', 'r', 'h'] as const) {
    const want = [...queued[kind]].slice(0, 200);
    want.forEach((k) => { queued[kind].delete(k); pending.add(`${kind}:${k}`); });
    if (!want.length) continue;
    try {
      const rows = kind === 'c' ? await api.badgesForConvos(want) : kind === 'r' ? await api.badgesForRoom(want) : await api.badgesForHandles(want);
      const now = Date.now();
      want.forEach((k) => cache.set(`${kind}:${k}`, { at: now, b: null }));
      rows.forEach((r: any) => cache.set(`${kind}:${kind === 'c' ? r.conversation_id : r.handle}`, { at: now, b: r.badge }));
      listeners.forEach((f) => f());
    } catch { /* badges are extra: never break the screen */ } finally { want.forEach((k) => pending.delete(`${kind}:${k}`)); }
    if (queued[kind].size && !flushTimer) flushTimer = setTimeout(flush, 30);
  }
}
export function useConvoBadges(ids: string[]) {
  useCacheTick();
  const key = ids.join(',');
  useEffect(() => { loadBadges('c', ids); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (id: string) => fresh(`c:${id}`) || null;
}
export function useRoomBadges(handles: string[]) {
  useCacheTick();
  const key = handles.join('|');
  useEffect(() => { loadBadges('r', handles); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (h: string) => fresh(`r:${h}`) || null;
}
export function useHandleBadges(handles: string[]) {
  useCacheTick();
  const key = handles.join('|');
  useEffect(() => { loadBadges('h', handles); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (h: string) => fresh(`h:${h}`) || null;
}
/** Compact bird + stars (with the number of ratings) for lists, cards and chat headers. */
const Compact = ({ b }: { b: any }) => (b ? <span className="bk-compact"><BirdBadge level={b.level} compact /><StarPill rating={b.rating} ratings={b.ratings} /></span> : null);
export function ConvoBird({ id }: { id: string }) { return <Compact b={useConvoBadges([id])(id)} />; }
export function RoomBird({ handle }: { handle: string }) { return <Compact b={useRoomBadges([handle])(handle)} />; }
export function HandleBadges({ handle }: { handle: string }) { return <Compact b={useHandleBadges([handle])(handle)} />; }
/** The two identity indicators on someone's profile card. */
export function ProfileBadges({ convo, handle, dating }: { convo?: string; handle?: string; dating?: string }) {
  const byC = useConvoBadges(convo ? [convo] : []);
  const byR = useRoomBadges(handle ? [handle] : []);
  const byH = useHandleBadges(dating ? [dating] : []);
  const b = convo ? byC(convo) : handle ? byR(handle) : dating ? byH(dating) : null;
  if (!b) return null;
  return <div className="pc-badges"><BirdBadge level={b.level} /><StarPill rating={b.rating} ratings={b.ratings} /></div>;
}

// ---- "Rate this user" (profile only; never a pop-up) ------------------------------------------
export function RateUser({ convo, handle }: { convo?: string; handle?: string }) {
  const [st, setSt] = useState<any>(null);
  const [stars, setStars] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    (convo ? api.ratingStatusConvo(convo) : api.ratingStatusRoom(handle!)).then(setSt).catch(() => setSt(null));
  }, [convo, handle]);
  if (!st || st.self) return null;
  if (!st.eligible && !st.cooldown) return null;   // no relationship yet: nothing to show
  let body;
  if (done) body = <p className="small rate-done" role="status">Your rating has been submitted anonymously.</p>;
  else if (st.cooldown) {
    const days = Math.max(1, Math.ceil((new Date(st.next_at).getTime() - new Date(st.now).getTime()) / 86400000));
    body = <p className="small muted">{`You’ve already rated this person. You can rate them again in ${days} day${days === 1 ? '' : 's'}.`}</p>;
  } else {
    body = (
      <>
        <div className="rate-stars" role="radiogroup" aria-label="Your rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n === 1 ? '' : 's'}`}
              className={`rate-star ${n <= stars ? 'on' : ''}`} onClick={() => setStars(n)}>★</button>
          ))}
        </div>
        <button className="btn btn-primary btn-block" disabled={!stars || busy} onClick={async () => {
          setBusy(true);
          try { await (convo ? api.rateConvo(convo, stars) : api.rateRoomMember(handle!, stars)); setDone(true); }
          catch (e) { toast(api.friendly(e), 'x'); } finally { setBusy(false); }
        }}>Submit Rating</button>
      </>
    );
  }
  return (
    <div className="pc-rate">
      <h3>Rate this user</h3>
      <p className="small muted">How has your experience with this person been?</p>
      {body}
      <p className="tiny muted">Anonymous: they never see who rated them. No comments, just stars.</p>
    </div>
  );
}

// ---- On my own Profile: two separate cards ----------------------------------------------------
export function MyIdentity() {
  const s = useAppState();
  const [rep, setRep] = useState<any>(null);
  useEffect(() => { loadMyRep().then(setRep); }, []);
  const b = s.bird;
  return (
    <div className="pf-identity below-hero">
      <button className="card pf-id-card" onClick={openBirdKingdom} aria-label="Open the Bird Kingdom">
        <Emblem level={b ? b.level : 1} size="lg" />
        <span className="grow"><span className="tiny muted">Bird Kingdom</span>
          <b>{b ? `Level ${b.level} — ${bird(b.level).name}` : 'Loading…'}</b>
          <span className="tiny muted">{b ? (b.level < 8 ? `Next: ${bird(b.level + 1).name}` : 'Top of the kingdom') : ''}</span></span>
      </button>
      <button className="card pf-id-card" onClick={openReputation} aria-label="Open my reputation">
        <span className="rp-big">★</span>
        <span className="grow"><span className="tiny muted">Community rating</span>
          <b>{rep ? (rep.established ? `${Number(rep.score).toFixed(1)} / 5.0 (${rep.ratings})` : `5.0 · New member (${rep.ratings})`) : '…'}</b>
          <span className="tiny muted">{rep ? (rep.established ? `${rep.ratings} ratings` : 'Not enough ratings yet') : ''}</span></span>
      </button>
    </div>
  );
}

// My own rating: fetched at most every 10 minutes and shared by Home and Profile (keeps start-up light).
let myRep: { at: number; p: Promise<any> } | null = null;
const loadMyRep = () => { if (!myRep || Date.now() - myRep.at > 600000) myRep = { at: Date.now(), p: api.myReputation().catch(() => { myRep = null; return null; }) }; return myRep.p; };

/** Under my nickname on Home: my bird and my stars, each opening its page. */
export function MyHomeBadges() {
  const s = useAppState();
  const [rep, setRep] = useState<any>(null);
  useEffect(() => { loadMyRep().then(setRep); }, []);
  const b = s.bird;
  if (!b && !rep) return null;
  return (
    <div className="hm-badges">
      {b ? <button className="plain-btn" onClick={openBirdKingdom} aria-label={`Bird Kingdom: Level ${b.level} — ${bird(b.level).name}`}><BirdBadge level={b.level} /></button> : null}
      {rep ? <button className="plain-btn" onClick={openReputation} aria-label="My community rating"><StarPill rating={rep.established ? rep.score : null} ratings={rep.ratings} /></button> : null}
    </div>
  );
}

// ---- My Bird Kingdom ---------------------------------------------------------------------------
export function openBirdKingdom() {
  openSheet((close) => <BirdKingdom close={close} />, { label: 'Bird Kingdom' });
}
function BirdKingdom({ close }: { close: () => void }) {
  const s = useAppState();
  const me = s.bird;
  useEffect(() => { api.myBird().then((b) => { state.bird = { ...(state.bird || {}), ...b }; emit('bird'); }).catch(() => {}); }, []);
  if (!me) return <p className="muted center">Loading…</p>;
  const lvl = me.level, cur = bird(lvl), next = lvl < 8 ? bird(lvl + 1) : null;
  const h = me.seconds / 3600;
  const pct = next ? Math.min(100, Math.max(0, ((h - cur.hours) / (next.hours - cur.hours)) * 100)) : 100;
  return (
    <>
      <div className="bk-head">
        <Emblem level={lvl} size="xl" />
        <h2>{`Level ${lvl} — ${cur.name}`}</h2>
        <p className="small muted">{cur.text}</p>
        {next ? (
          <>
            <div className="bk-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
            <p className="tiny muted">{`Keep going to reach Level ${next.n} — ${next.name}`}</p>
          </>
        ) : <p className="small">You’ve reached the top of the Bird Kingdom. 🔥</p>}
      </div>
      <div className="bk-list">
        {BIRDS.map((b) => (
          <div key={b.n} className={`bk-row ${b.n === lvl ? 'cur' : ''} ${b.n > lvl ? 'locked' : ''}`}>
            <Emblem level={b.n} size="md" />
            <span className="grow"><b>{`Level ${b.n} — ${b.name}`}</b>{b.n > lvl ? <span className="tiny muted">Locked</span> : null}
              <span className="tiny">{b.text}</span></span>
            {b.n > lvl ? <span aria-label="Locked">🔒</span> : b.n === lvl ? <span className="bk-you">You</span> : <span aria-label="Reached">✓</span>}
          </div>
        ))}
      </div>
      <p className="tiny muted">Your bird grows the more you take part in treehouse. A level is never taken away.</p>
      <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div>
    </>
  );
}

// ---- My Reputation -----------------------------------------------------------------------------
export function openReputation() {
  openSheet((close) => <MyReputation close={close} />, { label: 'My reputation' });
}
// Bars scaled to this person's own range, so small weekly changes are visible.
function trendH(trend: any[], v: number) {
  const xs = trend.map((t) => Number(t.score)), lo = Math.min(...xs) - 0.2, hi = Math.max(...xs);
  return Math.round(15 + ((v - lo) / Math.max(hi - lo, 0.2)) * 85);
}
function MyReputation({ close }: { close: () => void }) {
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.myReputation().then(setR).catch((e) => setErr(api.friendly(e))); }, []);
  if (err) return <><p className="error">{err}</p><div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div></>;
  if (!r) return <p className="muted center">Loading…</p>;
  const dist = r.distribution || null;
  const total = dist ? Object.values(dist).reduce((a: number, b: any) => a + Number(b), 0) : 0;
  const trend: any[] = r.trend || [];
  return (
    <>
      <div className="rp-head">
        <div className="rp-score">{Number(r.score).toFixed(1)}<small>/ 5.0</small></div>
        <div className="rp-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= Math.round(r.score) ? 'on' : ''}>★</span>)}</div>
        <p className="small muted">{r.established ? `${r.ratings} valid rating${r.ratings === 1 ? '' : 's'} from ${r.raters} people` : 'New member · not enough ratings yet'}</p>
      </div>
      {dist ? (
        <div className="rp-dist">{[5, 4, 3, 2, 1].map((n) => {
          const c = Number(dist[n] || 0);
          return <div key={n} className="rp-dist-row"><span>{`${n}★`}</span><span className="rp-bar"><i style={{ width: `${total ? (c / total) * 100 : 0}%` }} /></span><span className="tiny muted">{c}</span></div>;
        })}</div>
      ) : <p className="tiny muted">{`Your star breakdown and trend appear once ${r.min_raters} different people have rated you.`}</p>}
      {trend.length > 1 ? (
        <div className="rp-trend"><h3>Recent trend</h3><div className="rp-trend-row">{trend.map((t) => (
          <span key={t.week} className="rp-week" title={`Week of ${t.week}: ${t.score}`}><i style={{ height: `${trendH(trend, Number(t.score))}%` }} /></span>
        ))}</div></div>
      ) : null}
      <div className="settings-group rp-explain">
        <div className="settings-row" style={{ cursor: 'default', alignItems: 'flex-start' }}><span style={{ fontSize: '20px' }}>🎭</span><span className="grow">Anonymous<span className="sub">{`You never see who rated you, and nobody sees who you rated. Each person can rate you once every ${r.cooldown_days} days.`}</span></span></div>
        <div className="settings-row" style={{ cursor: 'default', alignItems: 'flex-start' }}><span style={{ fontSize: '20px' }}>🛡️</span><span className="grow">Blocks and reports don’t touch your stars<span className="sub">Safety is handled separately by the treehouse team.</span></span></div>
      </div>
      <p className="tiny muted center">{r.refreshed_at ? `Updated every hour · last update ${new Date(r.refreshed_at).toLocaleString('en-NG', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}` : 'Updated every hour'}</p>
      <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div>
    </>
  );
}

// ---- Level-up and launch cards ------------------------------------------------------------------
function Celebrate({ level, title, text, close }: { level: number; title: string; text: string; close: () => void }) {
  return (
    <div className="bk-celebrate">
      <div className="bk-burst"><Emblem level={level} size="xl" /></div>
      <h2>{title}</h2>
      <p className="muted">{text}</p>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" onClick={() => { close(); openBirdKingdom(); }}>See the Bird Kingdom</button>
        <button className="btn btn-soft btn-block" onClick={close}>Nice!</button>
      </div>
    </div>
  );
}
function showLevelUp(level: number) {
  const b = bird(level);
  openSheet((close) => <Celebrate level={level} close={close} title={`Level ${b.n} — ${b.name}!`} text={`You’ve earned the ${b.name} emblem. ${b.text}`} />, { label: 'Level up' });
}
function showLaunch(level: number) {
  const b = bird(level);
  openSheet((close) => <Celebrate level={level} close={close} title="Your treehouse journey has been recognised!"
    text={`Based on your previous activity, you’ve been awarded Level ${b.n} — ${b.name}.`} />,
  { label: 'Bird Kingdom', onClose: () => { api.birdLaunchSeen().catch(() => {}); } });
}

// ---- Active-time ping ----------------------------------------------------------------------------
// Every 3 minutes (kept light for the database), only while the page is visible AND the person
// touched/typed/scrolled in the last 3 minutes (or is on a game or a Speed Dating video, where input happens inside the video/game).
// The server measures the time itself; this only says "still here".
let started = false;
export function startActivity() {
  if (started || typeof window === 'undefined') return;
  started = true;
  let lastInput = Date.now();
  const mark = () => { lastInput = Date.now(); };
  ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'].forEach((ev) => window.addEventListener(ev, mark, { passive: true, capture: true }));
  const watching = () => /\/home\/games/.test(location.pathname) || !!document.querySelector('.sd-page');
  const apply = (b: any) => {
    const before = state.bird && state.bird.level;
    state.bird = { ...(state.bird || {}), ...b };
    emit('bird');
    if (b.leveled_up && b.level > (before || 1)) showLevelUp(b.level);
  };
  const ping = async () => {
    if (!state.user || document.visibilityState !== 'visible') return;
    if (Date.now() - lastInput > 180000 && !watching()) return;
    try { apply(await api.activityPing()); } catch { /* never interrupt the app */ }
  };
  api.myBird().then((b) => { apply(b); if (b && b.launch_level >= 2) showLaunch(b.launch_level); }).catch(() => {});
  setTimeout(ping, 20000);   // starts the measuring clock; time then counts between pings
  setInterval(ping, 180000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mark(); });
}
