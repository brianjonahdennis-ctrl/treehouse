'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { go } from '@/lib/nav';
import { EmptyState, Hero, Icon, SkeletonList } from './ui';
import { toast } from './overlay';

type Hunt = api.TreasureHuntListing;
type Progress = api.TreasureHuntProgress;
type Position = { latitude: number; longitude: number; accuracy: number };
type Vector3 = { east: number; north: number; up: number };
type CameraPose = { heading: number; forward: Vector3; right: Vector3; up: Vector3 };
const positionOnce = () => new Promise<Position>((resolve, reject) => {
  if (process.env.NEXT_PUBLIC_TH_MOCK === '1') { resolve({ latitude: 9.0765, longitude: 7.4793, accuracy: 10 }); return; }
  if (!navigator.geolocation) { reject(new Error('Location is not available on this device.')); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
    () => reject(new Error('Turn on location, move somewhere with a clear view of the sky, then try again.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
});
const distanceAndBearing = (a: Position, b: { latitude: number; longitude: number }) => {
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const east = 6371000 * dLon * Math.cos((a.latitude + b.latitude) * rad / 2);
  const north = 6371000 * dLat;
  const angle = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return { metres: 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)), bearing: angle, east, north, accuracy: a.accuracy };
};
const wrapDegrees = (value: number) => (value + 540) % 360 - 180;
const normaliseDegrees = (value: number) => (value % 360 + 360) % 360;
const cameraPose = (raw: DeviceOrientationEvent, absoluteEvent = false): CameraPose | null => {
  const event = raw as DeviceOrientationEvent & { webkitCompassHeading?: number };
  if (event.alpha == null || event.beta == null || event.gamma == null) return null;
  const webkitHeading = typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)
    ? normaliseDegrees(event.webkitCompassHeading) : null;
  if (webkitHeading == null && !absoluteEvent && event.absolute !== true) return null;
  const screenRotation = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
  const alpha = normaliseDegrees(event.alpha + screenRotation) * Math.PI / 180;
  const beta = event.beta * Math.PI / 180;
  const gamma = event.gamma * Math.PI / 180;
  const ca = Math.cos(alpha), sa = Math.sin(alpha), cb = Math.cos(beta), sb = Math.sin(beta), cg = Math.cos(gamma), sg = Math.sin(gamma);
  // DeviceOrientation's Z-X-Y rotation turns the phone's screen axes into local
  // east/north/up axes. The rear camera points out of the back of the phone (-Z).
  const right: Vector3 = { east: ca * cg - sa * sb * sg, north: sa * cg + ca * sb * sg, up: -cb * sg };
  const up: Vector3 = { east: -sa * cb, north: ca * cb, up: sb };
  const forward: Vector3 = { east: -(ca * sg + sa * sb * cg), north: -(sa * sg - ca * sb * cg), up: -cb * cg };
  let heading = normaliseDegrees(Math.atan2(forward.east, forward.north) * 180 / Math.PI);
  if (Math.hypot(forward.east, forward.north) < 0.08) return null;
  if (webkitHeading != null) {
    // iPhone Safari supplies true-north heading separately from its relative
    // Euler angles. Rotate the full camera pose to that north reference.
    const delta = (webkitHeading - heading) * Math.PI / 180, c = Math.cos(delta), s = Math.sin(delta);
    const align = (v: Vector3): Vector3 => ({ east: v.east * c + v.north * s, north: v.north * c - v.east * s, up: v.up });
    Object.assign(forward, align(forward)); Object.assign(right, align(right)); Object.assign(up, align(up));
    heading = webkitHeading;
  }
  return { heading, forward, right, up };
};
const relativeTime = (date: string) => {
  const ms = Math.max(0, Date.parse(date) - Date.now());
  const mins = Math.ceil(ms / 60000);
  return mins < 60 ? `in ${mins} min` : `in ${Math.ceil(mins / 60)} hr`;
};
export default function TreasureHunt() {
  const [hunts, setHunts] = useState<Hunt[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeHunt, setNoticeHunt] = useState('');
  const [showBoard, setShowBoard] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [mockRoutePlayer, setMockRoutePlayer] = useState('1');
  const run = useRef(0);

  const loadHunts = useCallback(() => api.treasureHuntsList().then(setHunts).catch((e) => setLoadError(api.friendly(e))), []);
  useEffect(() => { void loadHunts(); }, [loadHunts]);
  useEffect(() => { if (process.env.NEXT_PUBLIC_TH_MOCK === '1') setMockRoutePlayer(sessionStorage.getItem('mock-hunt-player') || '1'); }, []);
  const chooseMockPlayer = (player: string) => {
    sessionStorage.setItem('mock-hunt-player', player); setMockRoutePlayer(player); setLoadError(''); setHunts(null); void loadHunts();
  };

  const joinOrResume = async (hunt: Hunt) => {
    setBusy(true); setNotice(''); setNoticeHunt(hunt.id);
    try {
      const data = hunt.joined ? await api.treasureHuntProgress(hunt.id)
        : await api.treasureHuntJoin(hunt.id, await positionOnce());
      setProgress(data); setShowCamera(false); setArrived(false); setShowBoard(false);
    } catch (e) { setNotice(api.friendly(e)); }
    setBusy(false);
  };

  const collect = async (): Promise<boolean> => {
    if (!progress) return false;
    const target = progress.current_target;
    if (!target || target.kind === 'finish') return false;
    if (target.kind === 'start') {
      const call = ++run.current; setBusy(true); setNotice('');
      try {
        const here = await positionOnce();
        if (call !== run.current) return false;
        const result = await api.treasureHuntClaimStart(progress.hunt.id, target.id, here);
        if (!result.ok) { setNotice(result.error || 'Your start point could not be checked. Try again.'); return false; }
        setProgress(result.progress);
        toast(`Start point reached · +${result.coins_awarded || 0} coins`, 'check');
        return true;
      } catch (e) { setNotice(api.friendly(e)); return false; }
      finally { if (call === run.current) setBusy(false); }
    }
    const call = ++run.current; setBusy(true); setNotice('');
    try {
      const here = await positionOnce();
      if (call !== run.current) return false;
      const result = await api.treasureHuntClaimCheckpoint(progress.hunt.id, target.id, here);
      if (!result.ok) { setNotice(result.error || 'That checkpoint could not be checked. Try again.'); return false; }
      setProgress(result.progress);
      toast(`Checkpoint reached · +${result.coins_awarded || 0} coins`, 'check');
      return true;
    } catch (e) { setNotice(api.friendly(e)); return false; }
    finally { if (call === run.current) setBusy(false); }
  };

  const finish = async (): Promise<boolean> => {
    if (!progress) return false;
    setBusy(true); setNotice('');
    try {
      const finishLocation = progress.current_target?.kind === 'finish' ? await positionOnce() : { latitude: 0, longitude: 0, accuracy: 1 };
      const result = await api.treasureHuntFinish(progress.hunt.id, finishLocation);
      if (!result.ok) { setNotice(result.error || 'The treasure could not be claimed. Try again.'); return false; }
      setProgress((prev) => prev ? { ...prev, participant: { ...prev.participant,
        completed_at: new Date().toISOString(), completion_bonus_coins: result.coins_awarded ?? prev.participant.completion_bonus_coins,
        total_coins: result.total_coins ?? prev.participant.total_coins }, current_target: null } : prev);
      toast(`Treasure claimed · +${result.coins_awarded || 0} coins`, 'check');
      return true;
    } catch (e) { setNotice(api.friendly(e)); return false; }
    finally { setBusy(false); }
  };

  if (progress) return <HuntProgress data={progress} busy={busy} notice={notice} showBoard={showBoard}
    showCamera={showCamera} arrived={arrived} onCameraChange={setShowCamera} onArrivalChange={setArrived} onBack={() => { run.current++; setShowCamera(false); setArrived(false); setProgress(null); void loadHunts(); }}
    onCollect={collect} onFinish={finish} onToggleBoard={() => setShowBoard((x) => !x)} />;

  return (
    <div className="stack-lg th-hunt">
      <Hero title="Treasure Hunt" sub="Follow the clues, find each checkpoint and collect Treehouse Coins." actions={<button className="hero-btn" aria-label="Back to Games" onClick={() => go('games')}><Icon name="back" /></button>} />
      <div className="th-hero-art" aria-hidden="true"><span className="th-spark s1">✦</span><span className="th-spark s2">✦</span><span className="th-chest">🧰</span><span className="th-coin">🪙</span></div>
      <div className="th-privacy"><Icon name="lock" cls="sm" /><span>Hunts are for members in the hunt’s state. Camera and compass work on your phone. Location is sent once when you start, to check you’re in the hunt area and choose your nearest checkpoint, then only when you check in.</span></div>
      {process.env.NEXT_PUBLIC_TH_MOCK === '1' ? <section className="card" aria-label="Preview player routes"><b>Preview route spread</b><p className="tiny muted">Both players start at Wuse Market Gate. Player A goes to Garden Gate; Player B goes to River Walk.</p><div className="row" style={{ gap: 8 }}><button className={`btn ${mockRoutePlayer === '1' ? 'btn-primary' : 'btn-soft'}`} onClick={() => chooseMockPlayer('1')}>Preview Player A</button><button className={`btn ${mockRoutePlayer === '2' ? 'btn-primary' : 'btn-soft'}`} onClick={() => chooseMockPlayer('2')}>Preview Player B</button></div></section> : null}
      <p className="th-coins-note">Coins are in-game points. They are not cash.</p>
      {loadError ? <EmptyState emoji="🧭" title="Hunts are taking a break" text={loadError}><button className="btn btn-soft" onClick={() => { setLoadError(''); setHunts(null); void loadHunts(); }}>Try again</button></EmptyState>
        : !hunts ? <SkeletonList n={1} />
        : hunts.length ? <section className="th-hunt-list" aria-label="Treasure hunts">
          {hunts.map((hunt) => <HuntCard key={hunt.id} hunt={hunt} busy={busy} notice={noticeHunt === hunt.id ? notice : ''} onStart={() => void joinOrResume(hunt)} onChanged={() => void loadHunts()} />)}
        </section>
        : <EmptyState emoji="🧭" title="No hunts right now" text="Check back when the next Treehouse Treasure Hunt is announced."><button className="btn btn-soft" onClick={() => go('games')}>Back to Games</button></EmptyState>}
      <p className="tiny muted th-safety">Stay aware of traffic and your surroundings. Never enter a closed or private place to reach a checkpoint.</p>
    </div>
  );
}

const stateName = (s: string | null) => (s === 'FCT' ? 'FCT (Abuja)' : s || 'Nigeria');
const two = (n: number) => String(n).padStart(2, '0');
const startsLabel = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' });

/** Counts down to the start, then tells the card it is live. Re-renders once a second only while shown. */
function Countdown({ to, onDone }: { to: string; onDone: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const end = Date.parse(to);
  useEffect(() => {
    const t = window.setInterval(() => { const n = Date.now(); setNow(n); if (n >= end) { window.clearInterval(t); onDone(); } }, 1000);
    return () => window.clearInterval(t);
  }, [end, onDone]);
  const left = Math.max(0, end - now);
  const d = Math.floor(left / 86400e3), h = Math.floor(left % 86400e3 / 3600e3), m = Math.floor(left % 3600e3 / 60e3), sec = Math.floor(left % 60e3 / 1000);
  return <div className="th-countdown" role="timer" aria-label={`Starts in ${d} days ${h} hours ${m} minutes`}>
    {d ? <span><b>{d}</b><small>{d === 1 ? 'day' : 'days'}</small></span> : null}
    <span><b>{two(h)}</b><small>hrs</small></span><span><b>{two(m)}</b><small>min</small></span><span><b>{two(sec)}</b><small>sec</small></span>
  </div>;
}

function Prizes({ prizes }: { prizes: api.TreasureHuntPrize[] }) {
  if (!prizes.length) return null;
  return <div className="th-prizes" aria-label="Prizes">
    {prizes.map((p, i) => <figure className="th-prize" key={i}>
      {p.media_type === 'video'
        ? <video src={p.media_url} controls playsInline preload="none" aria-label={p.title} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={p.media_url} alt={p.title} loading="lazy" decoding="async" />}
      <figcaption>{p.place ? <b>{p.place === 1 ? '🥇 1st' : p.place === 2 ? '🥈 2nd' : p.place === 3 ? '🥉 3rd' : `${p.place}th`}</b> : null}{p.title}</figcaption>
    </figure>)}
  </div>;
}

function HuntCard({ hunt, busy, notice, onStart, onChanged }: { hunt: Hunt; busy: boolean; notice: string; onStart: () => void; onChanged: () => void }) {
  const [live, setLive] = useState(hunt.live || Date.parse(hunt.starts_at) <= Date.now());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setLive(hunt.live || Date.parse(hunt.starts_at) <= Date.now()); }, [hunt.live, hunt.starts_at]);
  const goLive = useCallback(() => setLive(true), []);
  const register = async () => {
    setSaving(true); setError('');
    try { await api.treasureHuntRegister(hunt.id); toast('You’re registered for this hunt', 'check'); onChanged(); }
    catch (e) { setError(api.friendly(e)); }
    setSaving(false);
  };
  const unregister = async () => {
    setSaving(true); setError('');
    try { await api.treasureHuntUnregister(hunt.id); toast('Registration cancelled'); onChanged(); }
    catch (e) { setError(api.friendly(e)); }
    setSaving(false);
  };
  const mine = hunt.registered || !hunt.needs_registration;
  const others = Math.max(0, (hunt.registered_count || 0) - 1);
  return <article className="card th-hunt-card">
    <div className="th-card-top"><span className="th-hunt-icon" aria-hidden="true">🗺️</span>
      {live ? <span className="th-live-pill"><i /> Live now</span> : <span className="th-soon-pill">Starts {startsLabel(hunt.starts_at)}</span>}</div>
    <h2>{hunt.title}</h2>
    <p className="muted">📍 {hunt.region}{hunt.state ? <span className="th-state-pill">{stateName(hunt.state)} only</span> : null}</p>
    {hunt.description ? <p>{hunt.description}</p> : null}
    <div className="th-facts"><span>⚑ {hunt.checkpoint_count} checkpoints</span>{live ? <span>Ends {relativeTime(hunt.ends_at)}</span> : null}</div>
    <Prizes prizes={hunt.prizes || []} />
    {hunt.registered ? <div className="th-registered">
      <Icon name="check" cls="sm" /><span><b>You’re registered.</b> {others ? `${others.toLocaleString()} other${others === 1 ? '' : 's'} registered too.` : 'You’re the first to register.'}</span>
    </div> : null}
    {mine && !live ? <><p className="th-countdown-label">The hunt starts in</p><Countdown to={hunt.starts_at} onDone={goLive} /></> : null}
    {error || (notice && live && mine) ? <p className="error" role="alert">{error || notice}</p> : null}
    {!mine ? hunt.register_block
      ? <><p className="th-blocked" role="note"><Icon name="lock" cls="sm" />{hunt.register_block}</p>
          <button className="btn btn-soft btn-block" disabled>Registration closed for you</button></>
      : <button className="btn btn-primary btn-block" disabled={saving} onClick={() => void register()}>{saving ? 'Registering…' : 'Register for this hunt'} <Icon name="chev" cls="sm" /></button>
    : live
      ? <button className="btn btn-primary btn-block th-start" disabled={busy} onClick={onStart}>{busy ? 'Opening hunt…' : hunt.joined ? 'Continue treasure hunt' : 'Start treasure hunt'} <Icon name="chev" cls="sm" /></button>
      : hunt.registered ? <button className="link-btn th-unregister" disabled={saving} onClick={() => void unregister()}>Cancel my registration</button> : null}
  </article>;
}

function HuntProgress({ data, busy, notice, showBoard, showCamera, arrived, onCameraChange, onArrivalChange, onBack, onCollect, onFinish, onToggleBoard }: {
  data: Progress; busy: boolean; notice: string; showBoard: boolean;
  showCamera: boolean; arrived: boolean; onCameraChange: (open: boolean) => void; onArrivalChange: (arrived: boolean) => void;
  onBack: () => void; onCollect: () => Promise<boolean>; onFinish: () => Promise<boolean>;
  onToggleBoard: () => void;
}) {
  const target = data.current_target;
  const done = !!data.participant.completed_at;
  const startPending = target?.kind === 'start';
  const finishPending = !done && data.found_count >= data.total_count;
  const routeTarget = target;
  const [coinBurst, setCoinBurst] = useState<{ amount: number; avatar: string } | null>(null);
  const burstTimer = useRef<number | null>(null);
  useEffect(() => () => { if (burstTimer.current !== null) window.clearTimeout(burstTimer.current); }, []);
  const claimFromAR = async () => {
    const success = await (finishPending ? onFinish() : onCollect());
    if (success) {
      if (targetReward > 0) setCoinBurst({ amount: targetReward, avatar: targetAvatar });
      if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
      burstTimer.current = window.setTimeout(() => setCoinBurst(null), 1500);
      try { navigator.vibrate?.([24, 36, 24]); } catch { /* vibration is optional */ }
    }
    return success;
  };
  const targetKind = finishPending ? 'treasure' : startPending ? 'start' : 'coin';
  const targetAvatar = finishPending ? data.hunt.treasure_avatar || '🧰' : data.hunt.coin_avatar || '🪙';
  const targetReward = finishPending ? data.hunt.completion_bonus_coins + (target?.reward_coins || 0) : target?.reward_coins || 0;
  return (
    <div className="stack-lg th-hunt th-progress">
      <Hero title={data.hunt.title} sub={`📍 ${data.hunt.region}`} actions={<button className="hero-btn" aria-label="Back to hunts" onClick={onBack}><Icon name="back" /></button>} />
      <section className={`th-map-card${done ? ' complete' : ''}`}>
        <div className="th-map-head"><span className="th-map-label">{done ? 'Treasure found' : startPending ? 'Starting point' : finishPending ? 'Final treasure' : 'Next checkpoint'}</span><span className="th-map-count">{data.found_count} of {data.total_count} found</span></div>
        {done ? (
          <><div className="th-treasure-big" aria-hidden="true">{data.hunt.treasure_avatar || '🏆'}</div><h2>Hunt complete!</h2><p>You collected {data.participant.total_coins.toLocaleString()} Treehouse Coins.</p></>
        ) : startPending ? (
          <><div className="th-treasure-big" aria-hidden="true">📍</div><h2>{target?.name || 'Nearby checkpoint'}</h2><p>{arrived ? 'You’ve arrived at your starting point. Collect this checkpoint to begin.' : target?.hint || 'Follow the AR direction to your starting checkpoint.'}</p></>
        ) : target?.kind === 'checkpoint' ? (
          <><h2>{target.name}</h2><p>{target.hint || 'Follow the trail to reach this stop.'}</p></>
        ) : (
          <><div className="th-treasure-big" aria-hidden="true">{data.hunt.treasure_avatar || '🧰'}</div><h2>{target?.name || 'The final treasure is ready'}</h2><p>{target?.hint || 'All checkpoints reached. Claim your completion coins.'}<br />{target ? 'Follow the route to your final treasure.' : ''}</p><button className="btn btn-primary btn-block" disabled={busy} onClick={onFinish}>{busy ? 'Checking treasure…' : target ? 'Claim final treasure' : `Claim treasure · +${data.hunt.completion_bonus_coins} coins`}</button></>
        )}
      </section>
      <div className="th-score"><span>{data.hunt.coin_avatar || '🪙'} <b>{data.participant.total_coins.toLocaleString()}</b> coins</span><span>⚑ {data.found_count} of {data.total_count} found</span></div>
      {notice ? <p className="error th-error" role="alert">{notice}</p> : null}
      {coinBurst ? <div className="th-coin-burst th-progress-burst" aria-live="polite"><i>+{coinBurst.amount}</i><span>✦</span><b>{coinBurst.avatar}</b><span>✦</span></div> : null}
      {routeTarget && !done ? <LocalAR huntId={data.hunt.id} checkpoint={routeTarget.name} destination={routeTarget} active={showCamera}
        avatar={targetAvatar} itemKind={targetKind} rewardCoins={targetReward} totalCoins={data.participant.total_coins}
        busy={busy} claimNotice={notice} onClaim={claimFromAR} onActiveChange={onCameraChange} onArrivalChange={onArrivalChange} /> : null}
      {routeTarget && !done ? <div className={`th-actions${showCamera ? ' th-actions-ar-open' : ''}`}>
        {showCamera ? <button className="btn btn-soft th-ar-close-button" onClick={() => onCameraChange(false)} disabled={busy}>Close AR view</button> : null}
        {target?.kind !== 'finish' ? <button className="btn btn-primary btn-block th-collect" onClick={onCollect} disabled={busy}>{busy ? 'Checking location…' : startPending ? arrived ? `You’re here · Collect starting point · +${targetReward} coins` : `Collect starting point · +${targetReward} coins` : `Collect checkpoint · +${targetReward} coins`}</button> : null}
      </div> : null}
      {process.env.NEXT_PUBLIC_TH_MOCK === '1' ? <p className="tiny muted th-route-preview">Preview only · Two players at one starting point can get different next stops: Player A → Garden Gate; Player B → River Walk.</p> : null}
      <section className="card th-board-card">
        <button className="th-board-toggle" onClick={onToggleBoard} aria-expanded={showBoard}><span>🏆 Leaderboard <small>Your standing now; full names after the hunt ends</small></span><Icon name="chev" cls="sm" /></button>
        {showBoard ? <Leaderboard hunt={data.hunt.id} /> : null}
      </section>
      <p className="tiny muted th-safety">Keep your eyes on the road and surroundings. Camera images never leave your phone.</p>
    </div>
  );
}

function Leaderboard({ hunt }: { hunt: string }) {
  const [items, setItems] = useState<api.TreasureHuntLeaderboard['items']>([]);
  const [board, setBoard] = useState<api.TreasureHuntLeaderboard | null>(null);
  const [cursor, setCursor] = useState<api.TreasureHuntCursor | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const page = async (after?: api.TreasureHuntCursor) => {
    setLoading(true); setError('');
    try {
      const data = await api.treasureHuntLeaderboard(hunt, after);
      setBoard(data);
      setItems((prev) => after ? [...prev, ...data.items] : data.items); setHasMore(data.has_more);
      const last = data.items[data.items.length - 1];
      setCursor(last ? { coins: last.cursor_coins, joined_at: last.cursor_joined_at, board_key: last.cursor_key } : undefined);
    } catch (e) { setError(api.friendly(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void page(); }, [hunt]);
  if (board?.visibility === 'self') return <div className="th-board-list" aria-live="polite">
    <div className="th-board-row"><span className="th-board-rank">#{board.own_rank}</span><b>Your standing</b><span>{board.own_coins.toLocaleString()} coins</span></div>
    <span className="muted small">You’re ranked {board.own_rank} of {board.player_count} players. Other players’ details stay hidden until the hunt ends.</span>
  </div>;
  return <div className="th-board-list">
    {board ? <span className="muted small">Final standings · {board.player_count} players</span> : null}
    {items.map((item) => <div className="th-board-row" key={`${item.handle}-${item.cursor_key}`}><span className="th-board-rank">{item.rank <= 3 ? ['🥇', '🥈', '🥉'][item.rank - 1] : item.rank}</span><b>{item.handle}</b><span>{item.coins.toLocaleString()} coins</span></div>)}
    {error ? <p className="error" role="alert">{error}</p> : null}
    {loading && !items.length ? <span className="muted small">Loading leaderboard…</span> : null}
    {!loading && !items.length && !error ? <span className="muted small">No players yet. Be the first!</span> : null}
    {hasMore && cursor ? <button className="btn btn-soft btn-block" disabled={loading} onClick={() => void page(cursor)}>{loading ? 'Loading…' : 'Show more'}</button> : null}
  </div>;
}

type ARDestination = { id: string; name: string; latitude: number; longitude: number; radius_m: number };
type ProjectedItem = { x: number; y: number; size: number; visible: boolean; arrowRotation: number; arrowX: number; arrowY: number };
type RoutePosition = { along_m: number; off_route_m: number; total_m: number; snapped: api.TreasureHuntRoutePoint };
type GroundMarker = { x: number; y: number; rotation: number; size: number; distance_m: number };
const dot3 = (a: Vector3, b: Vector3) => a.east * b.east + a.north * b.north + a.up * b.up;
const isIOSAppEnvironment = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const appWindow = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } };
  const inApp = /TreehouseApp\//.test(navigator.userAgent) || !!appWindow.Capacitor?.isNativePlatform?.();
  return inApp && /iPhone|iPad|iPod/i.test(navigator.userAgent);
};
const projectItem = (route: { east: number; north: number; metres: number }, pose: CameraPose, width: number, height: number): ProjectedItem => {
  // The digital item is anchored just above the mapped ground point. Projection,
  // depth and scale are computed on this phone; no frame or location is uploaded.
  const world: Vector3 = { east: route.east, north: route.north, up: -0.75 };
  const depth = dot3(world, pose.forward);
  const side = dot3(world, pose.right);
  const vertical = dot3(world, pose.up);
  const focal = height / (2 * Math.tan(30 * Math.PI / 180));
  const rawX = depth > 0 ? width / 2 + focal * side / depth : Number.NaN;
  const rawY = depth > 0 ? height / 2 - focal * vertical / depth : Number.NaN;
  const safeLeft = 38, safeRight = Math.max(38, width - 38), safeTop = 96, safeBottom = Math.max(96, height - 185);
  const visible = depth > 0 && rawX >= safeLeft && rawX <= safeRight && rawY >= safeTop && rawY <= safeBottom;
  let arrowX = Math.min(safeRight, Math.max(safeLeft, Number.isFinite(rawX) ? rawX : width / 2));
  let arrowY = Math.min(safeBottom, Math.max(safeTop, Number.isFinite(rawY) ? rawY : height - 210));
  let arrowRotation = Number.isFinite(rawX) && Number.isFinite(rawY)
    ? Math.atan2(rawX - width / 2, height / 2 - rawY) * 180 / Math.PI : 180;
  if (depth <= 0) {
    arrowX = width / 2;
    arrowY = height - 210;
    arrowRotation = 180;
  }
  const size = Math.min(158, Math.max(30, 2200 / Math.max(route.metres, 1)));
  return { x: rawX, y: rawY, size, visible, arrowRotation, arrowX, arrowY };
};
const metresLabel = (metres: number) => metres < 1000 ? `${Math.max(1, Math.round(metres))} m` : `${(metres / 1000).toFixed(1)} km`;
const maneuverLabel = (instruction: string, distance: number | null) => {
  if (distance == null) return instruction;
  const amount = metresLabel(distance);
  const turn = /^(Turn\s+(?:(?:slight|sharp)\s+)?(?:left|right))(.*)$/i.exec(instruction);
  const keep = /^(Keep\s+(?:left|right))(.*)$/i.exec(instruction);
  const match = turn || keep;
  return match ? `${match[1]} in ${amount}${match[2]}` : `${instruction} · ${amount}`;
};

const routePosition = (position: Position, points: api.TreasureHuntRoute['points']): RoutePosition => {
  if (points.length < 2) return { along_m: 0, off_route_m: Number.POSITIVE_INFINITY, total_m: 0, snapped: position };
  const local = points.map((point) => distanceAndBearing(position, point));
  let passed = 0, closest = Number.POSITIVE_INFINITY, along = 0, snappedEast = 0, snappedNorth = 0;
  for (let i = 0; i < local.length - 1; i++) {
    const a = local[i], b = local[i + 1], east = b.east - a.east, north = b.north - a.north;
    const length = Math.hypot(east, north);
    const t = length ? Math.min(1, Math.max(0, -((a.east * east) + (a.north * north)) / (length * length))) : 0;
    const offsetEast = a.east + east * t, offsetNorth = a.north + north * t;
    const distance = Math.hypot(offsetEast, offsetNorth);
    if (distance < closest) {
      closest = distance; along = passed + length * t;
      snappedEast = a.east + east * t; snappedNorth = a.north + north * t;
    }
    passed += length;
  }
  const latitude = position.latitude + snappedNorth / 111_320;
  const longitude = position.longitude + snappedEast / (111_320 * Math.max(0.01, Math.cos(position.latitude * Math.PI / 180)));
  return { along_m: along, off_route_m: closest, total_m: passed, snapped: { latitude, longitude } };
};

const groundMarkers = (position: Position, points: api.TreasureHuntRoute['points'], pose: CameraPose,
  width: number, height: number, progress: RoutePosition): GroundMarker[] => {
  if (points.length < 2) return [];
  const local = points.map((point) => distanceAndBearing(position, point));
  const focal = height / (2 * Math.tan(30 * Math.PI / 180));
  const project = (east: number, north: number) => {
    const world: Vector3 = { east, north, up: -1.4 };
    const depth = dot3(world, pose.forward);
    if (depth <= 1) return null;
    const side = dot3(world, pose.right), vertical = dot3(world, pose.up);
    const x = width / 2 + focal * side / depth, y = height / 2 - focal * vertical / depth;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y, depth } : null;
  };
  const markers: GroundMarker[] = [];
  const spacing = 9, endAt = progress.along_m + 90;
  let total = 0, nextAt = Math.max(5, Math.ceil((progress.along_m + 5) / spacing) * spacing);
  for (let i = 0; i < local.length - 1 && markers.length < 18; i++) {
    const a = local[i], b = local[i + 1], east = b.east - a.east, north = b.north - a.north;
    const segment = Math.hypot(east, north);
    if (!segment) continue;
    while (total + segment >= nextAt && nextAt <= endAt && markers.length < 18) {
      const t = (nextAt - total) / segment;
      if (t >= 0 && t <= 1) {
        const e = a.east + east * t, n = a.north + north * t;
        const screen = project(e, n), next = project(e + east * Math.min(1, t + Math.min(0.35, 4 / segment)), n + north * Math.min(1, t + Math.min(0.35, 4 / segment)));
        if (screen && next && screen.x > -50 && screen.x < width + 50 && screen.y > 70 && screen.y < height - 100) {
          markers.push({ x: screen.x, y: screen.y, rotation: Math.atan2(next.x - screen.x, screen.y - next.y) * 180 / Math.PI,
            size: Math.max(10, Math.min(40, 850 / Math.max(1, screen.depth))), distance_m: nextAt - progress.along_m });
        }
      }
      nextAt += spacing;
    }
    total += segment;
    if (total > endAt) break;
  }
  return markers;
};

function LocalAR({ huntId, checkpoint, destination, active, avatar, itemKind, rewardCoins, totalCoins, busy,
  claimNotice, onClaim, onActiveChange, onArrivalChange }: {
  huntId: string;
  checkpoint: string;
  destination: ARDestination;
  active: boolean;
  avatar: string;
  itemKind: 'start' | 'coin' | 'treasure';
  rewardCoins: number;
  totalCoins: number;
  busy: boolean;
  claimNotice: string;
  onClaim: () => Promise<boolean>;
  onActiveChange: (open: boolean) => void;
  onArrivalChange: (arrived: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const destinationRef = useRef(destination);
  const lastPosition = useRef<{ value: Position; timestamp: number } | null>(null);
  const smoothedHeading = useRef<number | null>(null);
  const lastOrientationAt = useRef(0);
  destinationRef.current = destination;
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [pose, setPose] = useState<CameraPose | null>(null);
  const [route, setRoute] = useState<{ metres: number; bearing: number; east: number; north: number; accuracy: number } | null>(null);
  const [playerPosition, setPlayerPosition] = useState<Position | null>(null);
  const [navigation, setNavigation] = useState<{ key: string; route: api.TreasureHuntRoute } | null>(null);
  const [navigationError, setNavigationError] = useState('');
  const [travelMode, setTravelMode] = useState<'WALK' | 'DRIVE'>('WALK');
  const [recenterVersion, setRecenterVersion] = useState(0);
  const [cameraAvailable, setCameraAvailable] = useState(false);
  const [iosApp, setIosApp] = useState(false);
  const [safetyReminder, setSafetyReminder] = useState(false);
  const [pendingCamera, setPendingCamera] = useState(true);
  const [viewport, setViewport] = useState({ width: 360, height: 640 });
  const navigationRequest = useRef<{ key: string; route: api.TreasureHuntRoute | null; lastAttemptAt: number; inFlight: boolean; rerouteLatched: boolean }>({ key: '', route: null, lastAttemptAt: 0, inFlight: false, rerouteLatched: false });
  const lastRouteRequestAt = useRef(0);
  const handledRecenter = useRef(0);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${destination.latitude},${destination.longitude}`)}&travelmode=${travelMode === 'WALK' ? 'walking' : 'driving'}&dir_action=navigate`;
  const compassAvailable = pose != null;
  const mockCamera = process.env.NEXT_PUBLIC_TH_MOCK === '1';
  const locationAccurate = !!route && route.accuracy <= 30;
  const hasArrived = !!route && locationAccurate && route.metres <= 60;
  const canClaim = hasArrived && !busy;
  const projected = route && pose ? projectItem(route, pose, viewport.width, viewport.height)
    : route && locationAccurate && hasArrived ? {
      x: viewport.width / 2, y: viewport.height * 0.43, size: 76, visible: true,
      arrowRotation: 0, arrowX: viewport.width / 2, arrowY: viewport.height * 0.43,
    } : null;
  const navigationKey = `${destination.id}:${travelMode}`;
  const navigationRoute = navigation?.key === navigationKey ? navigation.route : null;
  const navigationPosition = playerPosition && navigationRoute ? routePosition(playerPosition, navigationRoute.points) : null;
  const remainingRouteMetres = navigationRoute && navigationPosition ? Math.max(0, navigationRoute.distance_m - navigationPosition.along_m) : null;
  const nextManeuver = navigationRoute?.steps.find((step) => step.distance_from_start_m > (navigationPosition?.along_m || 0) + 12);
  const maneuverDistance = nextManeuver && navigationPosition ? Math.max(0, nextManeuver.distance_from_start_m - navigationPosition.along_m) : null;
  const snappedPosition = playerPosition && navigationPosition && navigationPosition.off_route_m <= 40
    ? { ...playerPosition, ...navigationPosition.snapped } : playerPosition;
  const etaMinutes = navigationRoute && remainingRouteMetres != null && navigationRoute.distance_m > 0
    ? Math.max(1, Math.round(navigationRoute.duration_seconds * remainingRouteMetres / navigationRoute.distance_m / 60)) : null;
  const roadMarkers = navigationRoute && snappedPosition && pose && navigationPosition
    ? groundMarkers(snappedPosition, navigationRoute.points, pose, viewport.width, viewport.height, navigationPosition) : [];
  const roadOpacity = playerPosition ? Math.max(0.14, Math.min(1, 1 - Math.max(0, playerPosition.accuracy - 10) / 55)) : 0;
  const isRadar = active && !cameraAvailable;
  const viewInCamera = !isRadar && !!projected?.visible;
  const distanceText = route ? metresLabel(route.metres) : 'Finding you…';

  useEffect(() => { setIosApp(isIOSAppEnvironment()); }, []);
  useEffect(() => {
    if (!active) return;
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [active]);
  useEffect(() => {
    const last = lastPosition.current?.value;
    if (last) {
      const current = distanceAndBearing(last, destination);
      setRoute(current);
      onArrivalChange(current.accuracy <= 30 && current.metres <= 60);
    }
  }, [destination.id, destination.latitude, destination.longitude, destination.radius_m, onArrivalChange]);
  useEffect(() => {
    if (!active) { onArrivalChange(false); return; }
    const camera = cameraAvailable && !mockCamera ? stream.current : null;
    const videoElement = cameraAvailable && !mockCamera ? video.current : null;
    let onVideoPlaying: (() => void) | null = null;
    if (camera && videoElement) {
      videoElement.srcObject = camera;
      onVideoPlaying = () => setError((value) => /camera|picture/i.test(value) ? '' : value);
      videoElement.addEventListener('playing', onVideoPlaying);
      void videoElement.play().catch((cause: unknown) => {
        const playError = cause as DOMException | undefined;
        if (playError?.name === 'AbortError') return;
        const unavailable = ['NotAllowedError', 'PermissionDeniedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'SecurityError']
          .includes(playError?.name || '');
        if (!unavailable) {
          setError('Camera is still starting. Keep this screen open or use the compass view.');
          return;
        }
        setError('Camera picture is unavailable. Showing the compass view instead.');
        if (stream.current === camera) stream.current = null;
        camera.getTracks().forEach((track) => track.stop());
        setCameraAvailable(false);
      });
    }
    let watchId: number | null = null;
    const setCameraPose = (ev: DeviceOrientationEvent, absoluteEvent = false) => {
      const now = performance.now();
      if (now - lastOrientationAt.current < 33) return;
      lastOrientationAt.current = now;
      const fresh = cameraPose(ev, absoluteEvent);
      if (!fresh) return;
      const previous = smoothedHeading.current;
      const heading = previous == null ? fresh.heading : normaliseDegrees(previous + wrapDegrees(fresh.heading - previous) * 0.22);
      smoothedHeading.current = heading;
      const delta = (heading - fresh.heading) * Math.PI / 180, c = Math.cos(delta), s = Math.sin(delta);
      const align = (v: Vector3): Vector3 => ({ east: v.east * c + v.north * s, north: v.north * c - v.east * s, up: v.up });
      setPose({ heading, forward: align(fresh.forward), right: align(fresh.right), up: align(fresh.up) });
    };
    const onAbsoluteOrientation = (ev: Event) => setCameraPose(ev as DeviceOrientationEvent, true);
    const onOrientation = (ev: DeviceOrientationEvent) => setCameraPose(ev);
    const onVisibility = () => { if (document.visibilityState !== 'visible') onActiveChange(false); };
    const onScreenOrientation = () => { lastOrientationAt.current = 0; };
    window.addEventListener('deviceorientationabsolute', onAbsoluteOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    window.addEventListener('orientationchange', onScreenOrientation);
    window.screen.orientation?.addEventListener?.('change', onScreenOrientation);
    document.addEventListener('visibilitychange', onVisibility);
    if (!navigator.geolocation) {
      setError('Location is not available. Use Google Maps for directions.');
      onArrivalChange(false);
    } else {
      watchId = navigator.geolocation.watchPosition((position) => {
        const now = position.timestamp || Date.now();
        const currentPosition: Position = { latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy };
        const previous = lastPosition.current;
        if (previous) {
          const jump = distanceAndBearing(previous.value, currentPosition).metres;
          const elapsed = Math.max(0, (now - previous.timestamp) / 1000);
          const plausible = currentPosition.accuracy + previous.value.accuracy + elapsed * 5;
          if (elapsed < 30 && jump > Math.max(8, plausible)) return;
        }
        lastPosition.current = { value: currentPosition, timestamp: now };
        setPlayerPosition(currentPosition);
        const current = distanceAndBearing(currentPosition, destinationRef.current);
        setRoute(current);
        onArrivalChange(current.accuracy <= 30 && current.metres <= 60);
        if (current.accuracy <= 30) setError((value) => value.startsWith('Allow location') ? '' : value);
      }, () => {
        onArrivalChange(false);
        setError('Allow location access to place the item. Follow Google Maps if location stays unavailable.');
      }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    }
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('deviceorientationabsolute', onAbsoluteOrientation);
      window.removeEventListener('orientationchange', onScreenOrientation);
      window.screen.orientation?.removeEventListener?.('change', onScreenOrientation);
      document.removeEventListener('visibilitychange', onVisibility);
      if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
      if (videoElement) {
        if (onVideoPlaying) videoElement.removeEventListener('playing', onVideoPlaying);
        videoElement.pause(); videoElement.srcObject = null;
      }
      camera?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      onArrivalChange(false);
    };
  }, [active, cameraAvailable, mockCamera, onActiveChange, onArrivalChange]);
  useEffect(() => {
    if (!active || !playerPosition || playerPosition.accuracy > 30) return;
    const key = `${destination.id}:${travelMode}`;
    let state = navigationRequest.current;
    if (state.key !== key) {
      state = { key, route: null, lastAttemptAt: 0, inFlight: false, rerouteLatched: false };
      navigationRequest.current = state;
      setNavigation(null);
      setNavigationError('');
    }
    if (state.inFlight) return;
    const now = Date.now();
    const requestWindowReady = now - lastRouteRequestAt.current >= 20_000;
    const force = recenterVersion !== handledRecenter.current;
    const offRoute = state.route ? routePosition(playerPosition, state.route.points).off_route_m : 0;
    if (state.route && offRoute <= 40) state.rerouteLatched = false;
    const initial = !state.route && state.lastAttemptAt === 0 && requestWindowReady;
    const reroute = !!state.route && offRoute > 40 && !state.rerouteLatched && requestWindowReady;
    const recenter = force && requestWindowReady;
    if (!initial && !reroute && !recenter) return;
    if (recenter) handledRecenter.current = recenterVersion;
    if (reroute) state.rerouteLatched = true;
    state.inFlight = true;
    state.lastAttemptAt = now;
    lastRouteRequestAt.current = now;
    setNavigationError('');
      void api.treasureHuntNavigationRoute(huntId, playerPosition, destination, travelMode).then((nextRoute) => {
      if (navigationRequest.current !== state) return;
      state.route = nextRoute;
      setNavigation({ key, route: nextRoute });
    }).catch((cause) => {
      if (navigationRequest.current !== state) return;
      state.route = null;
      setNavigationError(api.friendly(cause));
    }).finally(() => {
      if (navigationRequest.current === state) state.inFlight = false;
    });
  }, [active, destination.id, destination.latitude, destination.longitude, huntId, playerPosition, recenterVersion, travelMode]);
  useEffect(() => () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const requestOrientation = async () => {
    const orientationEvent = (typeof DeviceOrientationEvent === 'undefined' ? {} : DeviceOrientationEvent) as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
    if (!orientationEvent.requestPermission) return true;
    try { return await orientationEvent.requestPermission() === 'granted'; }
    catch { return false; }
  };
  const open = async (withCamera: boolean) => {
    setError(''); setNavigationError(''); setPose(null); smoothedHeading.current = null; lastPosition.current = null;
    setPlayerPosition(null); setRoute(null); setRequesting(true);
    const compassGranted = await requestOrientation();
    if (!compassGranted) setError('Compass not available, use Google Maps.');
    if (withCamera && !iosApp && mockCamera) {
      setCameraAvailable(true);
      onActiveChange(true);
    } else if (withCamera && !iosApp) {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is unavailable in this browser.');
        const camera = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: false,
        });
        stream.current = camera;
        camera.getVideoTracks()[0]?.addEventListener('ended', () => {
          setError('Camera closed. Showing the compass view instead.');
          setCameraAvailable(false);
        }, { once: true });
        setCameraAvailable(true);
        onActiveChange(true);
      } catch (cause) {
        const cameraError = cause as Error & { name?: string };
        const blocked = cameraError.name === 'NotAllowedError' || cameraError.name === 'PermissionDeniedError';
        setError(blocked ? 'Camera access is blocked. Showing the compass view instead.' : `${cameraError.message || 'Camera could not open.'} Showing the compass view instead.`);
        setCameraAvailable(false);
        onActiveChange(true);
      }
    } else {
      setCameraAvailable(false);
      onActiveChange(true);
    }
    setRequesting(false);
  };
  const requestOpen = (withCamera: boolean) => {
    setPendingCamera(withCamera);
    let reminded = false;
    try { reminded = localStorage.getItem('treehouse-hunt-passenger-reminder-v2') === 'seen'; } catch { /* continue without storage */ }
    if (!reminded) { setSafetyReminder(true); return; }
    void open(withCamera);
  };
  const confirmSafety = () => {
    try { localStorage.setItem('treehouse-hunt-passenger-reminder-v2', 'seen'); } catch { /* the reminder still appears now */ }
    setSafetyReminder(false);
    void open(pendingCamera);
  };
  const claimItem = async () => {
    if (!canClaim) return;
    await onClaim();
  };
  const arrowStyle = projected ? { left: `${projected.arrowX}px`, top: `${projected.arrowY}px`, transform: `translate(-50%, -50%) rotate(${projected.arrowRotation}deg)` } : undefined;
  const radarPoint = route && pose ? ((route.bearing - pose.heading + 360) % 360) * Math.PI / 180 : null;
  const radarRadius = Math.min(viewport.width, viewport.height) * 0.32;
  const radarDistance = route ? Math.min(0.88, Math.max(0.12, route.metres / 260)) * radarRadius : 0;
  const radarX = viewport.width / 2 + Math.sin(radarPoint || 0) * radarDistance;
  const radarY = viewport.height / 2 - Math.cos(radarPoint || 0) * radarDistance;
  const radarItemStyle = pose ? { left: `${radarX}px`, top: `${radarY}px` }
    : { left: `${viewport.width / 2}px`, top: `${viewport.height * 0.4}px` };

  return <section className="th-ar" aria-label="Treasure Hunt camera and compass">
    {!active ? <div className="th-ar-prompt">
      <span aria-hidden="true">{itemKind === 'treasure' ? avatar : '🧭'}</span>
      <b>{iosApp ? 'Use the compass view' : `Find ${checkpoint}`}</b>
      <p>{iosApp ? 'The iPhone app keeps the camera closed. Use the compass view to find the next Treehouse treasure.' : 'The next Treehouse treasure will appear in your camera view when you point toward its real location. Its size changes as you get closer.'}</p>
      <button className="btn btn-primary" onClick={() => requestOpen(!iosApp)} disabled={requesting}>{requesting ? 'Getting ready…' : iosApp ? 'Open compass view' : 'Open Treasure Hunt AR'}</button>
      {!iosApp ? <button className="btn btn-soft" onClick={() => requestOpen(false)} disabled={requesting}>Use compass view</button> : null}
      {error ? <p className="error th-error" role="status">{error}</p> : null}
      <a className="btn btn-soft" href={mapsUrl} target="_blank" rel="noopener noreferrer">Follow route in Google Maps</a>
    </div> : <div className={`th-ar-live${isRadar ? ' th-ar-live-radar' : ''}`}>
      <div className={`th-camera th-camera-feed${cameraAvailable && !mockCamera ? ' is-active' : ''}`} aria-hidden={!(cameraAvailable && !mockCamera)}>
        <video ref={video} playsInline muted aria-label="Live rear camera picture" /><div className="th-camera-tint" />
      </div>
      {cameraAvailable && mockCamera ? <div className="th-camera th-camera-mock" aria-label="Illustrated camera preview">
          <div className="th-mock-sky" /><div className="th-mock-horizon" /><div className="th-mock-street" />
          <div className="th-mock-road-line" />
          {[0, 1, 2, 3, 4, 5].map((tree) => <i key={tree} className={`th-mock-tree tree-${tree}`} />)}
          <div className="th-mock-camera-label">TREEHOUSE HUNT · PREVIEW</div>
          <div className="th-camera-tint" />
        </div>
        : !cameraAvailable ? <div className="th-radar-scene" aria-hidden="true"><div className="th-radar-rings"><i /><i /><i /><span className="th-radar-player">⌖</span></div></div> : null}
      <div className="th-ar-live-top"><div className="th-ar-chip">{isRadar ? 'Treehouse compass' : mockCamera ? 'Treehouse Hunt · Preview' : 'Treehouse Hunt'}</div><div className="th-ar-chip th-ar-score">{avatar} {totalCoins.toLocaleString()} coins</div></div>
      <div className="th-route-banner" aria-live="polite">
        <span aria-hidden="true" className={`th-route-turn-icon${maneuverDistance != null && maneuverDistance < 45 ? ' near' : ''}`}>{nextManeuver ? /left/i.test(nextManeuver.instruction) ? '↶' : /right/i.test(nextManeuver.instruction) ? '↷' : '↱' : '↑'}</span>
        <div><b>{nextManeuver ? maneuverLabel(nextManeuver.instruction, maneuverDistance) : navigationRoute ? `Continue to ${checkpoint}` : `Head toward ${checkpoint}`}</b>
          <small>{navigationRoute && remainingRouteMetres != null ? `${metresLabel(remainingRouteMetres)} left${etaMinutes ? ` · about ${etaMinutes} min` : ''}` : navigationError ? 'Road directions unavailable · use Google Maps' : route ? `${distanceText} straight line · getting road route…` : 'Getting road directions…'}</small>
        </div>
      </div>
      <div className="th-route-mode" role="group" aria-label="Travel mode">
        <button className={travelMode === 'WALK' ? 'selected' : ''} onClick={() => setTravelMode('WALK')} aria-pressed={travelMode === 'WALK'}>Walking</button>
        <button className={travelMode === 'DRIVE' ? 'selected' : ''} onClick={() => setTravelMode('DRIVE')} aria-pressed={travelMode === 'DRIVE'}>On a bus / in a car</button>
      </div>
      <div className="th-ar-world">
      {roadMarkers.length ? <div className="th-ground-route" aria-hidden="true" style={{ opacity: roadOpacity }}>
        {roadMarkers.map((marker, index) => <i key={`${index}-${Math.round(marker.distance_m)}`} className="th-ground-chevron" style={{ left: `${marker.x}px`, top: `${marker.y}px`, width: `${marker.size}px`, height: `${marker.size}px`, fontSize: `${marker.size}px`, transform: `translate(-50%, -50%) rotate(${marker.rotation}deg)` }} />)}
      </div> : null}
      {isRadar && route && locationAccurate && (pose || hasArrived) ? <div className="th-radar-item" style={radarItemStyle}>
        <button className={`th-world-item-button ${itemKind === 'treasure' ? 'treasure' : 'coin'}`} onClick={() => void claimItem()} disabled={!canClaim || busy}
          aria-label={canClaim ? `Collect ${checkpoint}` : `${checkpoint}, ${distanceText} away`}><span className="th-world-item-face"><i className="th-world-item-ring" /><b>{avatar}</b><i className="th-world-item-glint" /></span></button>
        <small>{distanceText}</small>{canClaim ? <b>{busy ? 'Checking…' : itemKind === 'start' ? 'Tap to arrive' : `Tap to collect · +${rewardCoins}`}</b> : null}
      </div> : null}
      {!isRadar && route && pose && projected && (!hasArrived || !viewInCamera || !locationAccurate) ? <div className={`th-ar-edge${locationAccurate ? '' : ' uncertain'}`} style={arrowStyle} aria-label={`Target is ${distanceText} away`}>↑</div> : null}
      {!isRadar && route && locationAccurate && hasArrived && projected?.visible ? <div className={`th-world-item${canClaim && itemKind !== 'start' ? ' ready' : ''}`} style={{ left: `${projected.x}px`, top: `${projected.y}px`, width: `${projected.size}px`, height: `${projected.size}px` }}>
        <button className={`th-world-item-button ${itemKind === 'treasure' ? 'treasure' : 'coin'}`} onClick={() => void claimItem()} disabled={!canClaim || busy}
          aria-label={canClaim ? `${itemKind === 'start' ? 'Check in at start' : `Collect ${rewardCoins} coins`} at ${checkpoint}` : `${checkpoint}, ${distanceText} away`}>
          <span className="th-world-item-face"><i className="th-world-item-ring" /><b>{avatar}</b><i className="th-world-item-glint" /></span>
        </button>
        <span className="th-world-item-name">{checkpoint}</span>
        <span className="th-world-item-distance">{distanceText}</span>
        {canClaim ? <span className="th-world-item-action">{busy ? 'Checking…' : itemKind === 'start' ? 'Tap to arrive' : `Tap to collect · +${rewardCoins}`}</span> : null}
      </div> : null}
      </div>
      <div className="th-ar-hud">
        <div className="th-ar-status" aria-live="polite">
          <b>{route && route.accuracy > 30 ? 'Getting a better location…' : !compassAvailable ? 'Compass not available, use Google Maps' : hasArrived ? 'You’re close enough to collect' : viewInCamera ? checkpoint : route ? `${distanceText} to ${checkpoint}` : `Finding ${checkpoint}…`}</b>
          <small>{route ? `GPS accuracy about ${Math.round(route.accuracy)} m · ${distanceText}` : 'Waiting for a clear GPS position'}</small>
        </div>
        {isRadar && !iosApp ? <button className="th-ar-camera-again" onClick={() => requestOpen(true)}>Try camera</button> : null}
      </div>
      <div className="th-ar-bottom-bar">
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer">Destination</a>
        <button onClick={() => setRecenterVersion((version) => version + 1)} aria-label="Recenter and refresh route">◎ Recenter</button>
        <button onClick={() => onActiveChange(false)}>Close</button>
      </div>
      {claimNotice || error ? <div className="th-ar-error" role="status">{claimNotice || error}</div> : null}
    </div>}
    {safetyReminder ? <div className="th-safety-modal" role="dialog" aria-modal="true" aria-labelledby="th-road-title">
      <div className="th-safety-card"><span aria-hidden="true">⚠️</span><h2 id="th-road-title">Stay safe while you play</h2>
        <p>Passengers only: never play while driving. Watch out for traffic.</p>
        <button className="btn btn-primary btn-block" onClick={confirmSafety}>OK</button>
      </div>
    </div> : null}
  </section>;
}
