'use client';
import { useEffect, useRef, useState } from 'react';
import { STATES, stateLabel } from '@/lib/options';
import * as api from '@/lib/api';
import { go } from '@/lib/nav';
import { Icon, EmptyState, SkeletonList } from './ui';
import { toast } from './overlay';

type Stop = { name: string; hint: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type Point = { name: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type Prize = api.TreasureHuntPrize;
type Hunt = { id: string; title: string; region: string; state?: string | null; max_registrations?: number; winners_count?: number; rules?: string; join_radius_km?: number; registration_count?: number; prizes?: Prize[]; description: string; status: string; starts_at: string; ends_at: string; participant_count: number; checkpoints: any[]; start_points: any[]; finish_points: any[]; coin_avatar: string; treasure_avatar: string };
type Draft = { id?: string; title: string; region: string; state: string; max_registrations: number; winners_count: number; rules: string; join_radius_km: number; registration_count: number; prizes: Prize[]; prizesChanged: boolean; description: string; status: string; starts_at: string; ends_at: string; completion_bonus_coins: number; coin_avatar: string; treasure_avatar: string; checkpoints: Stop[]; finish_points: Point[]; participant_count: number };
const dateValue = (date = new Date(Date.now() + 86400000)) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const emptyStop = (): Stop => ({ name: '', hint: '', latitude: '', longitude: '', radius_m: 45, reward_coins: 100, map_ref: '' });
const emptyPoint = (): Point => ({ name: '', latitude: '', longitude: '', radius_m: 60, reward_coins: 0, map_ref: '' });
const blank = (): Draft => ({ title: '', region: '', state: '', max_registrations: 1000, winners_count: 10, rules: '', join_radius_km: 60, registration_count: 0, prizes: [], prizesChanged: false, description: '', status: 'draft', starts_at: dateValue(), ends_at: dateValue(new Date(Date.now() + 2 * 86400000)), completion_bonus_coins: 100, coin_avatar: '🪙', treasure_avatar: '🧰', checkpoints: [emptyStop()], finish_points: [emptyPoint()], participant_count: 0 });
function coordsFrom(raw: string): [string, string] | null {
  let text = raw.trim();
  try { if (/^https?:\/\//i.test(text)) { const u = new URL(text); const q = u.searchParams.get('q') || u.searchParams.get('query'); text = q || decodeURIComponent(text); } } catch { /* use the copied text */ }
  for (const re of [/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/, /[?&](?:q|ll|query|destination)=(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/, /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/, /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/]) {
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
  // One grand prize location per hunt: older hunts with extra spots show only the first.
  useEffect(() => { void api.treasureHuntsAdmin().then(setHunts).catch((e) => { setError(api.friendly(e)); setHunts([]); }); }, []);
  const edit = (h?: Hunt) => {
    setError('');
    setDraft(h ? { id: h.id, title: h.title, region: h.region, state: h.state || '', max_registrations: h.max_registrations || 1000, winners_count: h.winners_count || 10, rules: h.rules || '', join_radius_km: h.join_radius_km || 60, registration_count: h.registration_count || 0, prizes: h.prizes || [], prizesChanged: false, description: h.description, status: h.status,
      starts_at: localValue(h.starts_at), ends_at: localValue(h.ends_at), completion_bonus_coins: (h as any).completion_bonus_coins || 100,
      coin_avatar: h.coin_avatar || '🪙', treasure_avatar: h.treasure_avatar || '🧰', participant_count: h.participant_count,
      checkpoints: h.checkpoints?.length ? h.checkpoints.map((c) => ({ name: c.name, hint: c.hint, latitude: String(c.latitude), longitude: String(c.longitude), radius_m: c.radius_m, reward_coins: c.reward_coins, map_ref: '' })) : [emptyStop()],
      finish_points: (h.finish_points || []).slice(0, 1).map((p) => ({ name: p.name, latitude: String(p.latitude), longitude: String(p.longitude), radius_m: p.radius_m, reward_coins: p.reward_coins, map_ref: '' })) } : blank());
  };
  // A link without numbers in it (e.g. a maps.app.goo.gl share link) is read on our server.
  const [lookups, setLookups] = useState<Record<string, string>>({});
  const lookup = (kind: 'checkpoints' | 'finish_points', i: number, value: string) => {
    const key = `${kind}-${i}`;
    if (!/^https?:\/\//i.test(value.trim()) || coordsFrom(value)) { setLookups((l) => ({ ...l, [key]: '' })); return; }
    setLookups((l) => ({ ...l, [key]: 'Reading the link…' }));
    api.mapLinkCoords(value.trim()).then((c) => {
      setDraft((d) => {
        if (!d) return d;
        const list = d[kind] as (Stop | Point)[];
        if (!list[i] || list[i].map_ref !== value) return d;
        return { ...d, [kind]: list.map((p, n) => n === i ? { ...p, latitude: String(c.latitude), longitude: String(c.longitude) } : p) };
      });
      setLookups((l) => ({ ...l, [key]: `Found it: ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}` }));
    }).catch((e) => setLookups((l) => ({ ...l, [key]: api.friendly(e) })));
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => d ? { ...d, [k]: v } : d);
  const pointChange = (i: number, field: keyof Point, value: string | number) => setDraft((d) => {
    if (!d) return d;
    const points = d.finish_points.map((p, n) => {
      if (n !== i) return p;
      const next = { ...p, [field]: value };
      if (field === 'map_ref' && typeof value === 'string') { const coords = coordsFrom(value); if (coords) { next.latitude = coords[0]; next.longitude = coords[1]; } }
      return next;
    });
    return { ...d, finish_points: points };
  });
  const pointLink = (i: number, value: string) => { pointChange(i, 'map_ref', value); lookup('finish_points', i, value); };
  const stopLink = (i: number, value: string) => { stopChange(i, 'map_ref', value); lookup('checkpoints', i, value); };
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
    if (!draft.state && !draft.participant_count) { setError('Choose the state this hunt is in. Only members in that state can register.'); return; }
    if (!(draft.max_registrations >= 10 && draft.max_registrations <= 1000)) { setError('Set the participant limit between 10 and 1,000.'); return; }
    if (draft.max_registrations < draft.registration_count) { setError(`${draft.registration_count} people have already registered, so the limit can’t be lower than that.`); return; }
    if (!(draft.winners_count >= 1 && draft.winners_count <= 100) || draft.winners_count > draft.max_registrations) { setError('Choose between 1 and 100 winners (no more than the participant limit).'); return; }
    if (draft.prizes.some((p) => p.title.trim().length < 2)) { setError('Give every prize a short name.'); return; }
    if (!draft.checkpoints.length || draft.checkpoints.some((p) => !p.name.trim() || p.latitude === '' || p.longitude === '' || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)))) { setError('Keep at least one named checkpoint and add its map coordinates.'); return; }
    const points = draft.finish_points;
    if (points.length !== 1) { setError('Add one grand prize location. Every player finishes there.'); return; }
    if (!points.length || points.some((p) => !p.name.trim() || p.latitude === '' || p.longitude === '' || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)) || Number(p.latitude) < -90 || Number(p.latitude) > 90 || Number(p.longitude) < -180 || Number(p.longitude) > 180)) { setError('Add at least one grand-prize location with valid coordinates.'); return; }
    if (Date.parse(draft.ends_at) <= Date.parse(draft.starts_at)) { setError('The end time must come after the start time.'); return; }
    setBusy(true);
    try {
      const hid = await api.treasureHuntAdminSave({ id: draft.id, title: draft.title.trim(), region: draft.region.trim(), state: draft.state || null, join_radius_km: Number(draft.join_radius_km), max_registrations: Number(draft.max_registrations), winners_count: Number(draft.winners_count), rules: draft.rules.trim(), description: draft.description.trim(), status: draft.status,
        starts_at: new Date(draft.starts_at).toISOString(), ends_at: new Date(draft.ends_at).toISOString(), completion_bonus_coins: Number(draft.completion_bonus_coins), coin_avatar: draft.coin_avatar, treasure_avatar: draft.treasure_avatar },
      draft.checkpoints.map((p, i) => ({ sequence: i + 1, ...p, name: p.name.trim(), hint: p.hint.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })),
      draft.finish_points.map((p, i) => ({ sequence: i + 1, name: p.name.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })));
      if ((draft.prizesChanged || (!draft.id && draft.prizes.length)) && draft.status !== 'cancelled' && draft.status !== 'completed') {
        await api.treasureHuntAdminSavePrizes(String(hid || draft.id), draft.prizes.map((p) => ({ place: p.place, title: p.title.trim(), media_type: p.media_type, media_url: p.media_url })));
      }
      toast(draft.id ? 'Treasure Hunt updated.' : 'Treasure Hunt saved.'); setDraft(null); reload();
    } catch (e) { setError(api.friendly(e)); }
    finally { setBusy(false); }
  };
  if (!hunts) return <div className="adm"><SkeletonList n={3} /></div>;
  return <div className="adm">
    <div className="adm-head"><div className="row" style={{ gap: 8, alignItems: 'center' }}><button className="btn btn-ghost btn-icon" aria-label="Back to announcements" onClick={() => go('admin/announcements')}><Icon name="back" /></button><h1>Treasure Hunt setup</h1></div><div className="adm-actions"><button className="btn btn-coral" onClick={() => edit()}>New hunt</button></div></div>
    <p className="small muted">Build and manage hunts here alongside announcements. Each player starts at the checkpoint nearest them and goes through every checkpoint. Then everyone goes to the same grand prize location. Camera and movement stay on their phone.</p>
    {error && !draft ? <div className="adm-note">{error}</div> : null}
    <div className="th-admin-list">{hunts.length ? hunts.map((h) => <article className="card" key={h.id} style={{ padding: 16, marginBottom: 12 }}><h2>{h.title}</h2><p className="small muted">{h.region} · {h.state ? `${stateLabel(h.state)} only` : 'any state'} · {h.registration_count || 0} of {h.max_registrations || 1000} places taken · {(h.prizes || []).length} prizes · {h.checkpoints.length} checkpoints · nearest-checkpoint start · {(h.finish_points || []).length} prizes · {h.participant_count} players</p><p className="small">{h.status} · {h.coin_avatar || '🪙'} {h.treasure_avatar || '🧰'}</p><button className="btn btn-soft btn-sm" onClick={() => edit(h)}>{h.participant_count ? 'View or cancel' : 'Edit hunt'}</button></article>) : <div className="card" style={{ padding: 18 }}>No hunts yet. Create a safe route in a public area.</div>}</div>
    {draft ? <section className="adm-editor card" style={{ padding: 18, marginTop: 18 }}>
      <div className="adm-head"><h2>{draft.id ? `Edit ${draft.title}` : 'Create Treasure Hunt'}</h2><span className="small muted">{draft.participant_count ? 'Joined hunt: only cancellation is available.' : 'Coordinates are saved on the hunt server for check-in only.'}</span></div>
      <div className="th-member-form">
        <label className="adm-field"><span>Hunt name</span><input disabled={!!draft.participant_count} value={draft.title} onChange={(e) => set('title', e.target.value)} /></label>
        <label className="adm-field"><span>Area</span><input disabled={!!draft.participant_count} value={draft.region} onChange={(e) => set('region', e.target.value)} placeholder="Port Harcourt, Rivers" /></label>
        <div className="th-member-grid"><label className="adm-field"><span>State</span><select disabled={!!draft.participant_count || draft.registration_count > 0} value={draft.state} onChange={(e) => set('state', e.target.value)}><option value="">Choose a state…</option>{STATES.map((x) => <option key={x} value={x}>{stateLabel(x)}</option>)}</select></label>
          <label className="adm-field"><span>Start area (km)</span><input disabled={!!draft.participant_count} type="number" min={1} max={1000} value={draft.join_radius_km} onChange={(e) => set('join_radius_km', Number(e.target.value))} /></label></div>
        <label className="adm-field"><span>Participant limit (10 to 1,000)</span><input type="number" min={Math.max(10, draft.registration_count)} max={1000} value={draft.max_registrations} onChange={(e) => set('max_registrations', Number(e.target.value))} /></label>
        <label className="adm-field"><span>Number of winners (1 to 100)</span><input type="number" min={1} max={100} value={draft.winners_count} onChange={(e) => set('winners_count', Number(e.target.value))} /></label>
        <small className="muted">When this many players finish, everyone still playing is told the winners are in and can finish or quit.</small>
        <label className="adm-field"><span>Hunt rules (shown at the top of the hunt chat)</span><textarea rows={4} maxLength={2000} value={draft.rules} onChange={(e) => set('rules', e.target.value)} placeholder="Stay on public roads. No running across traffic. Be kind to other players." /></label>
        <small className="muted">When the limit is reached, nobody else can register.{draft.registration_count > 0 ? ` ${draft.registration_count} registered so far; you can raise the limit but not set it below that.` : ''}</small>
        <small className="muted">Only members whose profile is in this state can register.{draft.registration_count > 0 ? ` ${draft.registration_count} registered, so the state is locked.` : ''} To start, players must be within the start area of a checkpoint.</small>
        <PrizeEditor prizes={draft.prizes} disabled={draft.status === 'cancelled' || draft.status === 'completed'} onChange={(prizes) => setDraft((d) => d ? { ...d, prizes, prizesChanged: true } : d)} />
        <label className="adm-field"><span>Short introduction</span><textarea disabled={!!draft.participant_count} rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} /></label>
        <div className="th-member-grid"><label className="adm-field"><span>Starts (Lagos time)</span><input disabled={!!draft.participant_count} type="datetime-local" value={draft.starts_at} onChange={(e) => set('starts_at', e.target.value)} /></label><label className="adm-field"><span>Ends (Lagos time)</span><input disabled={!!draft.participant_count} type="datetime-local" value={draft.ends_at} onChange={(e) => set('ends_at', e.target.value)} /></label></div>
        <div className="th-member-grid"><label className="adm-field"><span>Status</span><select disabled={!!draft.participant_count} value={draft.status} onChange={(e) => set('status', e.target.value)}>{['draft','scheduled','active','completed','cancelled'].map((x) => <option key={x}>{x}</option>)}</select></label><label className="adm-field"><span>Completion coins</span><input disabled={!!draft.participant_count} type="number" min={0} value={draft.completion_bonus_coins} onChange={(e) => set('completion_bonus_coins', Number(e.target.value))} /></label></div>
        <div className="th-member-grid"><label className="adm-field"><span>Coin design</span><select disabled={!!draft.participant_count} value={draft.coin_avatar} onChange={(e) => set('coin_avatar', e.target.value)}>{['🪙','💰','⭐','💎','🟡','🟠'].map((x) => <option key={x}>{x}</option>)}</select></label><label className="adm-field"><span>Treasure design</span><select disabled={!!draft.participant_count} value={draft.treasure_avatar} onChange={(e) => set('treasure_avatar', e.target.value)}>{['🧰','🎁','🏆','💎','👑','🪙'].map((x) => <option key={x}>{x}</option>)}</select></label></div>
        <p className="adm-note">Setup guide: choose public, safe places and add one or more checkpoints. Players start at the checkpoint nearest them and must find every checkpoint. Only then does the grand prize location unlock. It is the same place for every player.</p>
        <RoutePoints region={draft.region} points={draft.finish_points} disabled={!!draft.participant_count} status={(i) => lookups[`finish_points-${i}`]} onLink={pointLink} onChange={pointChange} onAdd={() => set('finish_points', [...draft.finish_points, emptyPoint()])} onRemove={(i) => set('finish_points', draft.finish_points.filter((_, n) => n !== i))} />
        <StopEditor region={draft.region} points={draft.checkpoints} disabled={!!draft.participant_count} status={(i) => lookups[`checkpoints-${i}`]} onLink={stopLink} onChange={stopChange} onAdd={() => set('checkpoints', [...draft.checkpoints, emptyStop()])} onRemove={(i) => set('checkpoints', draft.checkpoints.filter((_, n) => n !== i))} />
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="adm-actions"><button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(null)}>Close</button>{draft.participant_count > 0 && draft.status !== 'cancelled' ? <button className="btn btn-ghost" disabled={busy} onClick={() => set('status', 'cancelled')}>Cancel this hunt</button> : null}<button className="btn btn-coral" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : draft.participant_count > 0 && draft.status === 'cancelled' ? 'Confirm cancellation' : 'Save hunt'}</button></div>
      </div>
    </section> : null}
  </div>;
}

function RoutePoints({ region, points, disabled, status, onLink, onChange, onAdd, onRemove }: { region: string; points: Point[]; disabled: boolean; status: (i: number) => string | undefined; onLink: (i: number, v: string) => void; onChange: (i: number, k: keyof Point, v: string | number) => void; onAdd: () => void; onRemove: (i: number) => void }) {
  const title = 'Grand prize location';
  return <section className="th-member-points"><div className="adm-head"><h3>{title}</h3>{!disabled && points.length < 1 ? <button className="btn btn-ghost btn-sm" onClick={onAdd}>Add location</button> : null}</div>
    {points.map((p, i) => <div className="th-member-point" key={i}><div className="adm-head"><b>Same for every player · unlocks after all checkpoints</b>{!disabled && points.length > 1 ? <button className="btn btn-ghost btn-sm" onClick={() => onRemove(i)}>Remove</button> : null}</div>
      <label className="adm-field"><span>Place name</span><input disabled={disabled} value={p.name} onChange={(e) => onChange(i, 'name', e.target.value)} /></label>
      <label className="adm-field"><span>Google Maps link or coordinates</span><input disabled={disabled} value={p.map_ref} onChange={(e) => onLink(i, e.target.value)} placeholder="Paste a Google Maps link or 4.8156, 7.0498" /></label><small className="muted">{status(i) || 'Paste any Google Maps link (share links too). Latitude and longitude fill in by themselves.'}</small>
      <a className="btn btn-ghost btn-sm" href={mapSearch(region, p.name)} target="_blank" rel="noopener noreferrer">Open this area in Google Maps</a>
      <div className="th-member-grid"><label className="adm-field"><span>Latitude</span><input disabled={disabled} type="number" step="any" value={p.latitude} onChange={(e) => onChange(i, 'latitude', e.target.value)} /></label><label className="adm-field"><span>Longitude</span><input disabled={disabled} type="number" step="any" value={p.longitude} onChange={(e) => onChange(i, 'longitude', e.target.value)} /></label></div>
      <div className="th-member-grid"><label className="adm-field"><span>Check radius (metres)</span><input disabled={disabled} type="number" min={20} max={200} value={p.radius_m} onChange={(e) => onChange(i, 'radius_m', Number(e.target.value))} /></label><label className="adm-field"><span>Coins at location</span><input disabled={disabled} type="number" min={0} max={100000} value={p.reward_coins} onChange={(e) => onChange(i, 'reward_coins', Number(e.target.value))} /></label></div>
    </div>)}
  </section>;
}
function StopEditor({ region, points, disabled, status, onLink, onChange, onAdd, onRemove }: { region: string; points: Stop[]; disabled: boolean; status: (i: number) => string | undefined; onLink: (i: number, v: string) => void; onChange: (i: number, k: keyof Stop, v: string | number) => void; onAdd: () => void; onRemove: (i: number) => void }) {
  return <section className="th-member-points"><div className="adm-head"><h3>Shared checkpoints</h3>{!disabled ? <button className="btn btn-ghost btn-sm" onClick={onAdd}>Add checkpoint</button> : null}</div>
    {points.map((p, i) => <div className="th-member-point" key={i}><div className="adm-head"><b>Checkpoint {i + 1}{i === 0 ? ' · Required' : ''}</b>{!disabled && points.length > 1 ? <button className="btn btn-ghost btn-sm" onClick={() => onRemove(i)}>Remove</button> : null}</div>
      <label className="adm-field"><span>Name</span><input disabled={disabled} value={p.name} onChange={(e) => onChange(i, 'name', e.target.value)} /></label><label className="adm-field"><span>Clue</span><input disabled={disabled} value={p.hint} onChange={(e) => onChange(i, 'hint', e.target.value)} /></label>
      <label className="adm-field"><span>Google Maps link or coordinates</span><input disabled={disabled} value={p.map_ref} onChange={(e) => onLink(i, e.target.value)} placeholder="Paste a Google Maps link or 4.8156, 7.0498" /></label><small className="muted">{status(i) || 'Paste any Google Maps link (share links too). Latitude and longitude fill in by themselves.'}</small><a className="btn btn-ghost btn-sm" href={mapSearch(region, p.name)} target="_blank" rel="noopener noreferrer">Open checkpoint area in Google Maps</a>
      <div className="th-member-grid"><label className="adm-field"><span>Latitude</span><input disabled={disabled} type="number" step="any" value={p.latitude} onChange={(e) => onChange(i, 'latitude', e.target.value)} /></label><label className="adm-field"><span>Longitude</span><input disabled={disabled} type="number" step="any" value={p.longitude} onChange={(e) => onChange(i, 'longitude', e.target.value)} /></label></div>
      <div className="th-member-grid"><label className="adm-field"><span>Radius</span><input disabled={disabled} type="number" min={20} max={200} value={p.radius_m} onChange={(e) => onChange(i, 'radius_m', Number(e.target.value))} /></label><label className="adm-field"><span>Coins</span><input disabled={disabled} type="number" min={0} value={p.reward_coins} onChange={(e) => onChange(i, 'reward_coins', Number(e.target.value))} /></label></div>
    </div>)}
  </section>;
}

const placeLabel = (k: number) => (k === 1 ? '1st place' : k === 2 ? '2nd place' : k === 3 ? '3rd place' : `${k}th place`);
function PrizeEditor({ prizes, disabled, onChange }: { prizes: Prize[]; disabled: boolean; onChange: (p: Prize[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try { const m = await api.uploadHuntPrize(f); onChange([...prizes, { place: prizes.length < 3 ? prizes.length + 1 : null, title: '', media_type: m.type, media_url: m.url }]); }
    catch (e) { toast(api.friendly(e), 'x'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const edit = (i: number, patch: Partial<Prize>) => onChange(prizes.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  return <section className="th-member-points"><div className="adm-head"><h3>Prizes</h3>{!disabled && prizes.length < 12 ? <button className="btn btn-coral btn-sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : '＋ Add picture or video'}</button> : null}</div>
    <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={(e) => void pick(e.target.files?.[0])} />
    <small className="muted">Show members what they can win: pictures (under 1.5 MB) or short videos (under 20 MB). Videos only download when a member taps play.</small>
    {prizes.map((p, i) => <div className="th-member-point th-member-prize" key={p.media_url}>
      {p.media_type === 'video' ? <video src={p.media_url} controls playsInline preload="metadata" /> : <img src={p.media_url} alt="" />}
      <label className="adm-field"><span>Prize name</span><input disabled={disabled} value={p.title} maxLength={80} placeholder="Grand prize: a new phone" onChange={(e) => edit(i, { title: e.target.value })} /></label>
      <label className="adm-field"><span>For</span><select disabled={disabled} value={p.place ?? ''} onChange={(e) => edit(i, { place: e.target.value ? Number(e.target.value) : null })}><option value="">Everyone who finishes</option>{Array.from({ length: 20 }, (_, k) => k + 1).map((k) => <option key={k} value={k}>{placeLabel(k)}</option>)}</select></label>
      {!disabled ? <button className="btn btn-ghost btn-sm" onClick={() => onChange(prizes.filter((_, n) => n !== i))}>Remove prize</button> : null}
    </div>)}
  </section>;
}
