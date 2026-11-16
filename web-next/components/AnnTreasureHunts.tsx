'use client';
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { go } from '@/lib/nav';
import { Icon, EmptyState, SkeletonList } from './ui';
import { toast } from './overlay';

type Stop = { name: string; hint: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type Point = { name: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type Hunt = { id: string; title: string; region: string; description: string; status: string; starts_at: string; ends_at: string; participant_count: number; checkpoints: any[]; start_points: any[]; finish_points: any[]; coin_avatar: string; treasure_avatar: string };
type Draft = { id?: string; title: string; region: string; description: string; status: string; starts_at: string; ends_at: string; completion_bonus_coins: number; coin_avatar: string; treasure_avatar: string; checkpoints: Stop[]; start_points: Point[]; finish_points: Point[]; participant_count: number };
const dateValue = (date = new Date(Date.now() + 86400000)) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const emptyStop = (): Stop => ({ name: '', hint: '', latitude: '', longitude: '', radius_m: 45, reward_coins: 100, map_ref: '' });
const emptyPoint = (): Point => ({ name: '', latitude: '', longitude: '', radius_m: 60, reward_coins: 0, map_ref: '' });
const blank = (): Draft => ({ title: '', region: '', description: '', status: 'draft', starts_at: dateValue(), ends_at: dateValue(new Date(Date.now() + 2 * 86400000)), completion_bonus_coins: 100, coin_avatar: '🪙', treasure_avatar: '🧰', checkpoints: [emptyStop(), emptyStop()], start_points: [emptyPoint()], finish_points: [emptyPoint()], participant_count: 0 });
function coordsFrom(raw: string): [string, string] | null {
  let text = raw.trim();
  try { if (/^https?:\/\//i.test(text)) { const u = new URL(text); const q = u.searchParams.get('q') || u.searchParams.get('query'); text = q || decodeURIComponent(text); } } catch { /* use the copied text */ }
  for (const re of [/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/, /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/, /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/]) {
    const m = text.match(re); if (m && Number(m[1]) >= -90 && Number(m[1]) <= 90 && Number(m[2]) >= -180 && Number(m[2]) <= 180) return [m[1], m[2]];
  }
  return null;
}
const localValue = (s: string) => dateValue(new Date(s));
const mapSearch = (region: string, name: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${region} ${name}`.trim())}`;

export default function AnnTreasureHunts() {
  const [hunts, setHunts] = useState<Hunt[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reload = () => { setHunts(null); api.treasureHuntsAdmin().then(setHunts).catch((e) => { setError(api.friendly(e)); setHunts([]); }); };
  useEffect(() => { void api.treasureHuntsAdmin().then(setHunts).catch((e) => { setError(api.friendly(e)); setHunts([]); }); }, []);
  const edit = (h?: Hunt) => {
    setError('');
    setDraft(h ? { id: h.id, title: h.title, region: h.region, description: h.description, status: h.status,
      starts_at: localValue(h.starts_at), ends_at: localValue(h.ends_at), completion_bonus_coins: (h as any).completion_bonus_coins || 100,
      coin_avatar: h.coin_avatar || '🪙', treasure_avatar: h.treasure_avatar || '🧰', participant_count: h.participant_count,
      checkpoints: (h.checkpoints || []).map((c) => ({ name: c.name, hint: c.hint, latitude: String(c.latitude), longitude: String(c.longitude), radius_m: c.radius_m, reward_coins: c.reward_coins, map_ref: '' })),
      start_points: (h.start_points || []).map((p) => ({ name: p.name, latitude: String(p.latitude), longitude: String(p.longitude), radius_m: p.radius_m, reward_coins: p.reward_coins, map_ref: '' })),
      finish_points: (h.finish_points || []).map((p) => ({ name: p.name, latitude: String(p.latitude), longitude: String(p.longitude), radius_m: p.radius_m, reward_coins: p.reward_coins, map_ref: '' })) } : blank());
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => d ? { ...d, [k]: v } : d);
  const pointChange = (key: 'start_points' | 'finish_points', i: number, field: keyof Point, value: string | number) => setDraft((d) => {
    if (!d) return d;
    const points = d[key].map((p, n) => {
      if (n !== i) return p;
      const next = { ...p, [field]: value };
      if (field === 'map_ref' && typeof value === 'string') { const coords = coordsFrom(value); if (coords) { next.latitude = coords[0]; next.longitude = coords[1]; } }
      return next;
    });
    return { ...d, [key]: points };
  });
  const stopChange = (i: number, field: keyof Stop, value: string | number) => setDraft((d) => {
    if (!d) return d;
    const checkpoints = d.checkpoints.map((p, n) => {
      if (n !== i) return p;
      const next = { ...p, [field]: value };
      if (field === 'map_ref' && typeof value === 'string') { const coords = coordsFrom(value); if (coords) { next.latitude = coords[0]; next.longitude = coords[1]; } }
      return next;
    });
    return { ...d, checkpoints };
  });
  const save = async () => {
    if (!draft) return;
    setError('');
    if (draft.title.trim().length < 3 || draft.region.trim().length < 2) { setError('Add a hunt name and area.'); return; }
    if (draft.checkpoints.length < 2 || draft.checkpoints.some((p) => !p.name.trim() || p.latitude === '' || p.longitude === '' || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)))) { setError('Add two or more named checkpoints and their map coordinates.'); return; }
    const points = [...draft.start_points, ...draft.finish_points];
    if (!draft.start_points.length || !draft.finish_points.length || points.some((p) => !p.name.trim() || p.latitude === '' || p.longitude === '' || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)) || Number(p.latitude) < -90 || Number(p.latitude) > 90 || Number(p.longitude) < -180 || Number(p.longitude) > 180)) { setError('Add at least one start and final treasure location with valid coordinates.'); return; }
    if (Date.parse(draft.ends_at) <= Date.parse(draft.starts_at)) { setError('The end time must come after the start time.'); return; }
    setBusy(true);
    try {
      await api.treasureHuntAdminSave({ id: draft.id, title: draft.title.trim(), region: draft.region.trim(), description: draft.description.trim(), status: draft.status,
        starts_at: new Date(draft.starts_at).toISOString(), ends_at: new Date(draft.ends_at).toISOString(), completion_bonus_coins: Number(draft.completion_bonus_coins), coin_avatar: draft.coin_avatar, treasure_avatar: draft.treasure_avatar },
      draft.checkpoints.map((p, i) => ({ sequence: i + 1, ...p, name: p.name.trim(), hint: p.hint.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })),
      draft.start_points.map((p, i) => ({ sequence: i + 1, name: p.name.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })),
      draft.finish_points.map((p, i) => ({ sequence: i + 1, name: p.name.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })));
      toast(draft.id ? 'Treasure Hunt updated.' : 'Treasure Hunt saved.'); setDraft(null); reload();
    } catch (e) { setError(api.friendly(e)); }
    finally { setBusy(false); }
  };
  if (!hunts) return <div className="adm"><SkeletonList n={3} /></div>;
  return <div className="adm">
    <div className="adm-head"><div className="row" style={{ gap: 8, alignItems: 'center' }}><button className="btn btn-ghost btn-icon" aria-label="Back to announcements" onClick={() => go('admin/announcements')}><Icon name="back" /></button><h1>Treasure Hunt setup</h1></div><div className="adm-actions"><button className="btn btn-coral" onClick={() => edit()}>New hunt</button></div></div>
    <p className="small muted">Build and manage hunts here alongside announcements. Players get the closest start and grand-prize location when they join, then Google Maps guides each next stop. Camera and movement stay on their phone.</p>
    {error && !draft ? <div className="adm-note">{error}</div> : null}
    <div className="th-admin-list">{hunts.length ? hunts.map((h) => <article className="card" key={h.id} style={{ padding: 16, marginBottom: 12 }}><h2>{h.title}</h2><p className="small muted">{h.region} · {h.checkpoints.length} checkpoints · {(h.start_points || []).length} starts · {(h.finish_points || []).length} prizes · {h.participant_count} players</p><p className="small">{h.status} · {h.coin_avatar || '🪙'} {h.treasure_avatar || '🧰'}</p><button className="btn btn-soft btn-sm" onClick={() => edit(h)}>{h.participant_count ? 'View or cancel' : 'Edit hunt'}</button></article>) : <div className="card" style={{ padding: 18 }}>No hunts yet. Create a safe route in a public area.</div>}</div>
    {draft ? <section className="adm-editor card" style={{ padding: 18, marginTop: 18 }}>
      <div className="adm-head"><h2>{draft.id ? `Edit ${draft.title}` : 'Create Treasure Hunt'}</h2><span className="small muted">{draft.participant_count ? 'Joined hunt: only cancellation is available.' : 'Coordinates are saved on the hunt server for check-in only.'}</span></div>
      <div className="th-member-form">
        <label className="adm-field"><span>Hunt name</span><input disabled={!!draft.participant_count} value={draft.title} onChange={(e) => set('title', e.target.value)} /></label>
        <label className="adm-field"><span>Area</span><input disabled={!!draft.participant_count} value={draft.region} onChange={(e) => set('region', e.target.value)} placeholder="Port Harcourt, Rivers" /></label>
        <label className="adm-field"><span>Short introduction</span><textarea disabled={!!draft.participant_count} rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} /></label>
        <div className="th-member-grid"><label className="adm-field"><span>Starts (Lagos time)</span><input disabled={!!draft.participant_count} type="datetime-local" value={draft.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></label><label className="adm-field"><span>Ends (Lagos time)</span><input disabled={!!draft.participant_count} type="datetime-local" value={draft.ends_at} onChange={(e) => set('ends_at', e.target.value)} /></label></div>
        <div className="th-member-grid"><label className="adm-field"><span>Status</span><select disabled={!!draft.participant_count} value={draft.status} onChange={(e) => set('status', e.target.value)}>{['draft','scheduled','active','completed','cancelled'].map((x) => <option key={x}>{x}</option>)}</select></label><label className="adm-field"><span>Completion coins</span><input disabled={!!draft.participant_count} type="number" min={0} value={draft.completion_bonus_coins} onChange={(e) => set('completion_bonus_coins', Number(e.target.value))} /></label></div>
        <div className="th-member-grid"><label className="adm-field"><span>Coin design</span><select disabled={!!draft.participant_count} value={draft.coin_avatar} onChange={(e) => set('coin_avatar', e.target.value)}>{['🪙','💰','⭐','💎','🟡','🟠'].map((x) => <option key={x}>{x}</option>)}</select></label><label className="adm-field"><span>Treasure design</span><select disabled={!!draft.participant_count} value={draft.treasure_avatar} onChange={(e) => set('treasure_avatar', e.target.value)}>{['🧰','🎁','🏆','💎','👑','🪙'].map((x) => <option key={x}>{x}</option>)}</select></label></div>
        <p className="adm-note">Setup guide: choose public, safe places; paste a Google Maps shared link or coordinate pair for each pin; check start and finish locations; preview the route; then open the hunt. Players are assigned their nearest available start and prize point at join.</p>
        {(['start_points','finish_points'] as const).map((key) => <RoutePoints key={key} kind={key} region={draft.region} points={draft[key]} disabled={!!draft.participant_count} onChange={(i, field, v) => pointChange(key, i, field, v)} onAdd={() => set(key, [...draft[key], emptyPoint()])} onRemove={(i) => set(key, draft[key].filter((_, n) => i !== n))} />)}
        <StopEditor region={draft.region} points={draft.checkpoints} disabled={!!draft.participant_count} onChange={stopChange} onAdd={() => set('checkpoints', [...draft.checkpoints, emptyStop()])} onRemove={(i) => set('checkpoints', draft.checkpoints.filter((_, n) => n !== i))} />
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="adm-actions"><button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(null)}>Close</button>{draft.participant_count > 0 && draft.status !== 'cancelled' ? <button className="btn btn-ghost" disabled={busy} onClick={() => set('status', 'cancelled')}>Cancel this hunt</button> : null}<button className="btn btn-coral" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : draft.participant_count > 0 && draft.status === 'cancelled' ? 'Confirm cancellation' : 'Save hunt'}</button></div>
      </div>
    </section> : null}
  </div>;
}

function RoutePoints({ kind, region, points, disabled, onChange, onAdd, onRemove }: { kind: 'start_points' | 'finish_points'; region: string; points: Point[]; disabled: boolean; onChange: (i: number, k: keyof Point, v: string | number) => void; onAdd: () => void; onRemove: (i: number) => void }) {
  const title = kind === 'start_points' ? 'Starting locations' : 'Grand prize locations';
  return <section className="th-member-points"><div className="adm-head"><h3>{title}</h3>{!disabled && points.length < 10 ? <button className="btn btn-ghost btn-sm" onClick={onAdd}>Add location</button> : null}</div>
    {points.map((p, i) => <div className="th-member-point" key={i}><div className="adm-head"><b>{kind === 'start_points' ? 'Start' : 'Prize'} {i + 1}</b>{!disabled && points.length > 1 ? <button className="btn btn-ghost btn-sm" onClick={() => onRemove(i)}>Remove</button> : null}</div>
      <label className="adm-field"><span>Place name</span><input disabled={disabled} value={p.name} onChange={(e) => onChange(i, 'name', e.target.value)} /></label>
      <label className="adm-field"><span>Google Maps link or coordinates</span><input disabled={disabled} value={p.map_ref} onChange={(e) => onChange(i, 'map_ref', e.target.value)} placeholder="Paste URL or 4.8156, 7.0498" /></label><small className="muted">Some short share links omit the pin's coordinates; copy the coordinate pair from Google Maps if it does not fill automatically.</small>
      <a className="btn btn-ghost btn-sm" href={mapSearch(region, p.name)} target="_blank" rel="noopener noreferrer">Open this area in Google Maps</a>
      <div className="th-member-grid"><label className="adm-field"><span>Latitude</span><input disabled={disabled} type="number" step="any" value={p.latitude} onChange={(e) => onChange(i, 'latitude', e.target.value)} /></label><label className="adm-field"><span>Longitude</span><input disabled={disabled} type="number" step="any" value={p.longitude} onChange={(e) => onChange(i, 'longitude', e.target.value)} /></label></div>
      <div className="th-member-grid"><label className="adm-field"><span>Check radius (metres)</span><input disabled={disabled} type="number" min={20} max={200} value={p.radius_m} onChange={(e) => onChange(i, 'radius_m', Number(e.target.value))} /></label><label className="adm-field"><span>Coins at location</span><input disabled={disabled} type="number" min={0} max={100000} value={p.reward_coins} onChange={(e) => onChange(i, 'reward_coins', Number(e.target.value))} /></label></div>
    </div>)}
  </section>;
}
function StopEditor({ region, points, disabled, onChange, onAdd, onRemove }: { region: string; points: Stop[]; disabled: boolean; onChange: (i: number, k: keyof Stop, v: string | number) => void; onAdd: () => void; onRemove: (i: number) => void }) {
  return <section className="th-member-points"><div className="adm-head"><h3>Shared checkpoints</h3>{!disabled && points.length < 25 ? <button className="btn btn-ghost btn-sm" onClick={onAdd}>Add checkpoint</button> : null}</div>
    {points.map((p, i) => <div className="th-member-point" key={i}><div className="adm-head"><b>Checkpoint {i + 1}</b>{!disabled && points.length > 2 ? <button className="btn btn-ghost btn-sm" onClick={() => onRemove(i)}>Remove</button> : null}</div>
      <label className="adm-field"><span>Name</span><input disabled={disabled} value={p.name} onChange={(e) => onChange(i, 'name', e.target.value)} /></label><label className="adm-field"><span>Clue</span><input disabled={disabled} value={p.hint} onChange={(e) => onChange(i, 'hint', e.target.value)} /></label>
      <label className="adm-field"><span>Google Maps link or coordinates</span><input disabled={disabled} value={p.map_ref} onChange={(e) => onChange(i, 'map_ref', e.target.value)} placeholder="Paste URL or 4.8156, 7.0498" /></label><small className="muted">Some short share links do not include a pin's coordinates; copy the coordinate pair from Google Maps if it does not fill automatically.</small><a className="btn btn-ghost btn-sm" href={mapSearch(region, p.name)} target="_blank" rel="noopener noreferrer">Open checkpoint area in Google Maps</a>
      <div className="th-member-grid"><label className="adm-field"><span>Latitude</span><input disabled={disabled} type="number" step="any" value={p.latitude} onChange={(e) => onChange(i, 'latitude', e.target.value)} /></label><label className="adm-field"><span>Longitude</span><input disabled={disabled} type="number" step="any" value={p.longitude} onChange={(e) => onChange(i, 'longitude', e.target.value)} /></label></div>
      <div className="th-member-grid"><label className="adm-field"><span>Radius</span><input disabled={disabled} type="number" min={20} max={200} value={p.radius_m} onChange={(e) => onChange(i, 'radius_m', Number(e.target.value))} /></label><label className="adm-field"><span>Coins</span><input disabled={disabled} type="number" min={0} value={p.reward_coins} onChange={(e) => onChange(i, 'reward_coins', Number(e.target.value))} /></label></div>
    </div>)}
  </section>;
}
