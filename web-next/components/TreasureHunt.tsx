'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { go } from '@/lib/nav';
import { EmptyState, Hero, Icon, SkeletonList } from './ui';
import { toast } from './overlay';

type Hunt = api.TreasureHuntSummary;
type Progress = api.TreasureHuntProgress;
type Position = { latitude: number; longitude: number; accuracy: number };
const positionOnce = () => new Promise<Position>((resolve, reject) => {
  if (process.env.NEXT_PUBLIC_TH_MOCK === '1') { resolve({ latitude: 9.0765, longitude: 7.4793, accuracy: 10 }); return; }
  if (!navigator.geolocation) { reject(new Error('Location is not available on this device.')); return; }
  navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
    () => reject(new Error('Turn on location, move somewhere with a clear view of the sky, then try again.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
});
const distanceAndBearing = (a: Position, b: { latitude: number; longitude: number }) => {
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const x = Math.sin(dLon) * Math.cos(b.latitude * rad);
  const y = Math.cos(a.latitude * rad) * Math.sin(b.latitude * rad) - Math.sin(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.cos(dLon);
  const angle = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return { metres: 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)), bearing: angle, accuracy: a.accuracy };
};
const compassHeading = (raw: DeviceOrientationEvent, absoluteEvent = false): number | null => {
  const event = raw as DeviceOrientationEvent & { webkitCompassHeading?: number };
  const normalise = (value: number) => (value % 360 + 360) % 360;
  if (typeof event.webkitCompassHeading === 'number' && Number.isFinite(event.webkitCompassHeading)) return normalise(event.webkitCompassHeading);
  if (!absoluteEvent && event.absolute !== true) return null;
  if (event.alpha == null || event.beta == null || event.gamma == null) return null;
  const screenRotation = window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
  const alpha = normalise(event.alpha + screenRotation) * Math.PI / 180;
  const beta = event.beta * Math.PI / 180;
  const gamma = event.gamma * Math.PI / 180;
  // Transform the back-facing camera vector into earth coordinates, accounting for
  // the phone's pitch, roll and current screen rotation before finding its bearing.
  const east = -(Math.cos(alpha) * Math.sin(gamma) + Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma));
  const north = -(Math.sin(alpha) * Math.sin(gamma) - Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma));
  if (Math.hypot(east, north) < 0.1) return null;
  return normalise(Math.atan2(east, north) * 180 / Math.PI);
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
  const [showBoard, setShowBoard] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [arrived, setArrived] = useState(false);
  const run = useRef(0);

  const loadHunts = useCallback(() => api.treasureHuntsActive().then(setHunts).catch((e) => setLoadError(api.friendly(e))), []);
  useEffect(() => { void loadHunts(); }, [loadHunts]);

  const joinOrResume = async (hunt: Hunt) => {
    setBusy(true); setNotice('');
    try {
      const data = hunt.joined ? await api.treasureHuntProgress(hunt.id)
        : await api.treasureHuntJoin(hunt.id, hunt.route_assignment_required ? await positionOnce() : { latitude: 0, longitude: 0, accuracy: 1 });
      setProgress(data); setShowCamera(false); setArrived(false); setShowBoard(false);
    } catch (e) { setNotice(api.friendly(e)); }
    setBusy(false);
  };

  const collect = async () => {
    if (!progress) return;
    const start = progress.route?.start;
    if (start && !progress.route?.start_claimed_at) {
      const call = ++run.current; setBusy(true); setNotice('');
      try {
        const here = await positionOnce();
        if (call !== run.current) return;
        const result = await api.treasureHuntClaimStart(progress.hunt.id, start.id, here);
        if (!result.ok) { setNotice(result.error || 'Your start point could not be checked. Try again.'); return; }
        setProgress((prev) => prev ? { ...prev, route: prev.route ? { ...prev.route, start_claimed_at: new Date().toISOString() } : prev.route,
          participant: { ...prev.participant, total_coins: result.total_coins ?? prev.participant.total_coins } } : prev);
        toast(`Start point reached · +${result.coins_awarded || 0} coins`, 'check');
      } catch (e) { setNotice(api.friendly(e)); }
      finally { if (call === run.current) setBusy(false); }
      return;
    }
    const next = progress.checkpoints.find((c) => !c.claimed);
    if (!next) return;
    const call = ++run.current; setBusy(true); setNotice('');
    try {
      const here = await positionOnce();
      if (call !== run.current) return;
      const result = await api.treasureHuntClaimCheckpoint(progress.hunt.id, next.id, here);
      if (!result.ok) { setNotice(result.error || 'That checkpoint could not be checked. Try again.'); return; }
      setProgress((prev) => prev ? { ...prev,
        participant: { ...prev.participant, last_checkpoint_sequence: result.checkpoint_sequence ?? prev.participant.last_checkpoint_sequence,
          total_coins: result.total_coins ?? prev.participant.total_coins },
        checkpoints: prev.checkpoints.map((c) => ({ ...c, claimed: c.sequence <= (result.checkpoint_sequence ?? prev.participant.last_checkpoint_sequence) }))
      } : prev);
      toast(`Checkpoint reached · +${result.coins_awarded || 0} coins`, 'check');
    } catch (e) { setNotice(api.friendly(e)); }
    finally { if (call === run.current) setBusy(false); }
  };

  const finish = async () => {
    if (!progress) return;
    setBusy(true); setNotice('');
    try {
      const finishLocation = progress.route?.finish ? await positionOnce() : { latitude: 0, longitude: 0, accuracy: 1 };
      const result = await api.treasureHuntFinish(progress.hunt.id, finishLocation);
      if (!result.ok) { setNotice(result.error || 'The treasure could not be claimed. Try again.'); return; }
      setProgress((prev) => prev ? { ...prev, participant: { ...prev.participant, completed_at: new Date().toISOString(),
        completion_bonus_coins: result.coins_awarded ?? prev.hunt.completion_bonus_coins, total_coins: result.total_coins ?? prev.participant.total_coins } } : prev);
      toast(`Treasure claimed · +${result.coins_awarded || 0} coins`, 'check');
    } catch (e) { setNotice(api.friendly(e)); }
    finally { setBusy(false); }
  };

  if (progress) return <HuntProgress data={progress} busy={busy} notice={notice} showBoard={showBoard}
    showCamera={showCamera} arrived={arrived} onCameraChange={setShowCamera} onArrivalChange={setArrived} onBack={() => { run.current++; setShowCamera(false); setArrived(false); setProgress(null); void loadHunts(); }}
    onCollect={collect} onFinish={finish} onToggleBoard={() => setShowBoard((x) => !x)} />;

  return (
    <div className="stack-lg th-hunt">
      <Hero title="Treasure Hunt" sub="Follow the clues, find each checkpoint and collect Treehouse Coins." actions={<button className="hero-btn" aria-label="Back to Games" onClick={() => go('games')}><Icon name="back" /></button>} />
      <div className="th-hero-art" aria-hidden="true"><span className="th-spark s1">✦</span><span className="th-spark s2">✦</span><span className="th-chest">🧰</span><span className="th-coin">🪙</span></div>
      <div className="th-privacy"><Icon name="lock" cls="sm" /><span>Camera and compass work on your phone. Location is sent only when you join to choose nearby route points or check in at a checkpoint.</span></div>
      <p className="th-coins-note">Coins are in-game points. They are not cash.</p>
      {loadError ? <EmptyState emoji="🧭" title="Hunts are taking a break" text={loadError}><button className="btn btn-soft" onClick={() => { setLoadError(''); setHunts(null); void loadHunts(); }}>Try again</button></EmptyState>
        : !hunts ? <SkeletonList n={1} />
        : hunts.length ? <section className="th-hunt-list" aria-label="Open hunts">
          {hunts.map((hunt) => <article className="card th-hunt-card" key={hunt.id}>
            <div className="th-card-top"><span className="th-hunt-icon" aria-hidden="true">🗺️</span><span className="th-live-pill"><i /> Open now</span></div>
            <h2>{hunt.title}</h2><p className="muted">📍 {hunt.region}</p>
            {hunt.description ? <p>{hunt.description}</p> : null}
            <div className="th-facts"><span>⚑ {hunt.checkpoint_count} checkpoints</span><span>👥 {hunt.participants.toLocaleString()} playing</span></div>
            <p className="th-end">Hunt ends {relativeTime(hunt.ends_at)}</p>
            {notice ? <p className="error" role="alert">{notice}</p> : null}
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void joinOrResume(hunt)}>{busy ? 'Opening hunt…' : hunt.joined ? 'Continue Hunt' : 'Join the Hunt'} <Icon name="chev" cls="sm" /></button>
          </article>)}
        </section>
        : <EmptyState emoji="🧭" title="No hunts are open right now" text="Check back when the next Treehouse Treasure Hunt is announced."><button className="btn btn-soft" onClick={() => go('games')}>Back to Games</button></EmptyState>}
      <p className="tiny muted th-safety">Stay aware of traffic and your surroundings. Never enter a closed or private place to reach a checkpoint.</p>
    </div>
  );
}

function HuntProgress({ data, busy, notice, showBoard, showCamera, arrived, onCameraChange, onArrivalChange, onBack, onCollect, onFinish, onToggleBoard }: {
  data: Progress; busy: boolean; notice: string; showBoard: boolean;
  showCamera: boolean; arrived: boolean; onCameraChange: (open: boolean) => void; onArrivalChange: (arrived: boolean) => void;
  onBack: () => void; onCollect: () => void; onFinish: () => void;
  onToggleBoard: () => void;
}) {
  const next = data.checkpoints.find((c) => !c.claimed);
  const done = !!data.participant.completed_at;
  const startPending = !!data.route?.start && !data.route.start_claimed_at;
  const finishPending = !done && !next && !!data.route?.finish;
  const routeTarget = startPending ? data.route?.start : next || (finishPending ? data.route?.finish : null);
  return (
    <div className="stack-lg th-hunt th-progress">
      <Hero title={data.hunt.title} sub={`📍 ${data.hunt.region}`} actions={<button className="hero-btn" aria-label="Back to hunts" onClick={onBack}><Icon name="back" /></button>} />
      <section className={`th-map-card${done ? ' complete' : ''}`}>
        <div className="th-map-head"><span className="th-map-label">{done ? 'Treasure found' : next ? 'Next checkpoint' : 'Final treasure'}</span><span className="th-map-count">{data.participant.last_checkpoint_sequence} / {data.checkpoints.length}</span></div>
        {done ? (
          <><div className="th-treasure-big" aria-hidden="true">{data.hunt.treasure_avatar || '🏆'}</div><h2>Hunt complete!</h2><p>You collected {data.participant.total_coins.toLocaleString()} Treehouse Coins.</p></>
        ) : startPending ? (
          <><div className="th-treasure-big" aria-hidden="true">📍</div><h2>{data.route?.start?.name}</h2><p>{arrived ? 'You’ve arrived at the starting point. Check in below to unlock your checkpoint trail.' : 'Follow the AR direction to this starting location, then check in to unlock your checkpoint trail.'}</p></>
        ) : next ? (
          <>
            <h2>{next.name}</h2><p>{next.hint || 'Follow the trail to reach this stop.'}</p>
            <div className="th-route-line" aria-hidden="true">{data.checkpoints.map((c) => <span key={c.id} className={c.claimed ? 'past' : c.id === next.id ? 'current' : ''} />)}</div>
          </>
        ) : (
          <><div className="th-treasure-big" aria-hidden="true">{data.hunt.treasure_avatar || '🧰'}</div><h2>{finishPending ? data.route?.finish?.name : 'The final treasure is ready'}</h2><p>{finishPending ? 'Follow the route to your assigned treasure location.' : 'All checkpoints reached. Claim your completion coins.'}</p><button className="btn btn-primary btn-block" disabled={busy} onClick={onFinish}>{busy ? 'Checking treasure…' : finishPending ? 'Claim final treasure' : `Claim treasure · +${data.hunt.completion_bonus_coins} coins`}</button></>
        )}
      </section>
      <div className="th-score"><span>{data.hunt.coin_avatar || '🪙'} <b>{data.participant.total_coins.toLocaleString()}</b> coins</span><span>⚑ {data.participant.last_checkpoint_sequence} of {data.checkpoints.length}</span></div>
      {notice ? <p className="error th-error" role="alert">{notice}</p> : null}
      {routeTarget && !done ? <LocalAR checkpoint={routeTarget.name} destination={routeTarget} active={showCamera} onActiveChange={onCameraChange} onArrivalChange={onArrivalChange} /> : null}
      {routeTarget && !done ? <div className={`th-actions${showCamera ? ' th-actions-ar-open' : ''}`}>
        {showCamera ? <button className="btn btn-soft th-ar-close-button" onClick={() => onCameraChange(false)} disabled={busy}>Close AR view</button> : null}
        {startPending ? <button className="btn btn-primary btn-block th-collect" onClick={onCollect} disabled={busy}>{busy ? 'Checking location…' : arrived ? `You’re here · Check in · +${data.route?.start?.reward_coins || 0} coins` : `Check in at start · +${data.route?.start?.reward_coins || 0} coins`}</button>
          : next ? <button className="btn btn-primary btn-block th-collect" onClick={onCollect} disabled={busy}>{busy ? 'Checking location…' : `Collect checkpoint · +${next.reward_coins} coins`}</button>
          : null}
      </div> : null}
      <section className="card th-checkpoints">
        <div className="th-section-title"><div><h2>Checkpoint trail</h2><p className="muted">Each stop unlocks after the one before.</p></div><span className="th-progress-num">{data.participant.last_checkpoint_sequence}/{data.checkpoints.length}</span></div>
        <ol>{data.checkpoints.map((c) => <li key={c.id} className={c.claimed ? 'claimed' : c.id === next?.id ? 'next' : ''}>
          <span className="th-step-dot">{c.claimed ? '✓' : c.sequence}</span><span className="th-step-copy"><b>{c.name}</b><small>{c.claimed ? 'Reached' : `${data.hunt.coin_avatar || '🪙'} ${c.reward_coins} coins · ${c.hint || 'Waiting for the previous checkpoint'}`}</small></span>
        </li>)}</ol>
      </section>
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

function LocalAR({ checkpoint, destination, active, onActiveChange, onArrivalChange }: {
  checkpoint: string;
  destination: Pick<api.TreasureHuntCheckpoint, 'latitude' | 'longitude' | 'radius_m'>;
  active: boolean;
  onActiveChange: (open: boolean) => void;
  onArrivalChange: (arrived: boolean) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const destinationRef = useRef(destination);
  destinationRef.current = destination;
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState('');
  const [heading, setHeading] = useState<number | null>(null);
  const [compassAvailable, setCompassAvailable] = useState(false);
  const [route, setRoute] = useState<{ metres: number; bearing: number; accuracy: number } | null>(null);
  const hasArrived = !!route && route.accuracy <= 30 && route.metres <= destinationRef.current.radius_m;
  const needsCloseGuidance = !!route && (route.accuracy > 30 || route.metres <= route.accuracy);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${destination.latitude},${destination.longitude}`)}&travelmode=walking&dir_action=navigate`;
  useEffect(() => {
    if (!active) { onArrivalChange(false); return; }
    const camera = stream.current;
    const videoElement = video.current;
    if (!camera || !videoElement) {
      setError('The camera could not start. Close AR and try again.');
      onActiveChange(false);
      return;
    }
    videoElement.srcObject = camera;
    void videoElement.play().catch(() => setError('The camera is ready, but this phone could not display its picture. Close AR and try again.'));
    const setCompass = (ev: DeviceOrientationEvent, absoluteEvent = false) => {
      const value = compassHeading(ev, absoluteEvent);
      if (value == null) return;
      setHeading(Math.round(value));
      setCompassAvailable(true);
    };
    const onAbsoluteOrientation = (ev: Event) => setCompass(ev as DeviceOrientationEvent, true);
    const onOrientation = (ev: DeviceOrientationEvent) => setCompass(ev);
    window.addEventListener('deviceorientationabsolute', onAbsoluteOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    let watchId: number | null = null;
    if (!navigator.geolocation) {
      setError('Allow location access to update directions as you walk.');
      onArrivalChange(false);
    } else {
      watchId = navigator.geolocation.watchPosition((position) => {
        const current = distanceAndBearing({ latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy }, destinationRef.current);
        setRoute(current);
        onArrivalChange(current.accuracy <= 30 && current.metres <= destinationRef.current.radius_m);
        setError('');
      }, () => { onArrivalChange(false); setError('Allow location access to update directions as you walk.'); },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 });
    }
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      window.removeEventListener('deviceorientationabsolute', onAbsoluteOrientation);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      videoElement.pause();
      videoElement.srcObject = null;
      camera.getTracks().forEach((track) => track.stop());
      stream.current = null;
      onArrivalChange(false);
    };
  }, [active, onActiveChange, onArrivalChange]);
  useEffect(() => () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);
  const enable = async () => {
    setError('');
    setRequesting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
      let compassNotice = '';
      setHeading(null);
      setCompassAvailable(false);
      setRoute(null);
      const DeviceOrientation = (typeof DeviceOrientationEvent === 'undefined' ? {} : DeviceOrientationEvent) as { requestPermission?: (absolute?: boolean) => Promise<string> };
      if (DeviceOrientation.requestPermission) {
        try { if (await DeviceOrientation.requestPermission(true) !== 'granted') compassNotice = 'Compass not available. Follow Google Maps for directions.'; }
        catch { compassNotice = 'Compass not available. Follow Google Maps for directions.'; }
      }
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      stream.current = camera;
      camera.getVideoTracks()[0]?.addEventListener('ended', () => onActiveChange(false), { once: true });
      setError(compassNotice);
      onActiveChange(true);
    } catch (e) {
      const cameraError = e as Error & { name?: string };
      setError(cameraError.name === 'NotAllowedError' || cameraError.name === 'PermissionDeniedError'
        ? 'Camera access is blocked. Allow camera access in your phone settings, then try again.'
        : cameraError.message || 'Could not open the camera.');
    } finally { setRequesting(false); }
  };
  return <section className="th-ar" aria-label="Camera directions">
    {active ? <><div className="th-camera"><video ref={video} playsInline muted aria-label="Camera view" /><div className="th-ar-scrim"><div className="th-ar-top">{compassAvailable && heading != null ? `Compass · ${heading}°` : 'Compass not available · follow Google Maps'}</div><div className="th-ar-target">{heading == null || needsCloseGuidance ? <span className="th-ar-arrow" aria-hidden="true">•</span> : <span className="th-ar-arrow" style={{ transform: `rotate(${route ? route.bearing - heading : 0}deg)` }} aria-label="Direction to checkpoint">↑</span>}</div><div className="th-ar-caption">{hasArrived ? `You’ve arrived at ${checkpoint}` : needsCloseGuidance ? 'You’re very close, look around' : route ? `${route.metres < 1000 ? `${Math.round(route.metres)} metres` : `${(route.metres / 1000).toFixed(1)} km`} to ${checkpoint}` : `Finding your location for ${checkpoint}`}</div></div></div>
      <a className="btn btn-soft th-maps-link" href={mapsUrl} target="_blank" rel="noopener noreferrer">Follow the blue line in Google Maps</a></>
      : <div className="th-ar-prompt"><span aria-hidden="true">📷</span><b>Find {checkpoint}</b><p>The arrow and distance guide you toward this point. For turn-by-turn walking directions, follow the blue line in Google Maps.</p><button className="btn btn-primary" onClick={() => void enable()} disabled={requesting}>{requesting ? 'Opening camera…' : 'Open AR directions'}</button><a className="btn btn-soft" href={mapsUrl} target="_blank" rel="noopener noreferrer">Follow route in Google Maps</a></div>}
    {error ? <p className="error" role="alert">{error}</p> : null}
  </section>;
}
