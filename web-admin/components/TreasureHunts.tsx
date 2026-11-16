'use client';
import { useState } from 'react';
import { rpc } from '@/lib/sb';
import { useAsync, PageHead, Spinner, ErrorBox, Card, Field, Btn, Empty, Pill, toast } from './ui';

type Stop = { sequence: number; name: string; hint: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type RoutePoint = { sequence: number; name: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type Hunt = { id: string; title: string; region: string; description: string; status: string; starts_at: string; ends_at: string; completion_bonus_coins: number; coin_avatar: string; treasure_avatar: string; participant_count: number;
  checkpoints: { id: string; sequence: number; name: string; hint: string; latitude: number; longitude: number; radius_m: number; reward_coins: number }[];
  start_points: { id: string; sequence: number; name: string; latitude: number; longitude: number; radius_m: number; reward_coins: number }[];
  finish_points: { id: string; sequence: number; name: string; latitude: number; longitude: number; radius_m: number; reward_coins: number }[] };
type Draft = { id?: string; title: string; region: string; description: string; status: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled'; starts_at: string; ends_at: string; completion_bonus_coins: number; coin_avatar: string; treasure_avatar: string; checkpoints: Stop[]; start_points: RoutePoint[]; finish_points: RoutePoint[]; participant_count: number };
const localValue = (v?: string) => { const d = v ? new Date(v) : new Date(Date.now() + 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const emptyStop = (sequence: number): Stop => ({ sequence, name: '', hint: '', latitude: '', longitude: '', radius_m: 45, reward_coins: 100, map_ref: '' });
const emptyRoutePoint = (sequence: number): RoutePoint => ({ sequence, name: '', latitude: '', longitude: '', radius_m: 60, reward_coins: 0, map_ref: '' });
const blank = (): Draft => ({ title: '', region: '', description: '', status: 'draft', starts_at: localValue(), ends_at: localValue(new Date(Date.now() + 2 * 86400000).toISOString()), completion_bonus_coins: 100, coin_avatar: '🪙', treasure_avatar: '🧰', checkpoints: [emptyStop(1), emptyStop(2)], start_points: [emptyRoutePoint(1)], finish_points: [emptyRoutePoint(1)], participant_count: 0 });
function coordinatesFrom(value: string): [string, string] | null {
  let text = value.trim();
  try { if (/^https?:\/\//i.test(text)) { const url = new URL(text); const q = url.searchParams.get('q') || url.searchParams.get('query'); if (q) text = q; else text = decodeURIComponent(text); } } catch { text = value.trim(); }
  const patterns = [/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/, /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/, /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/];
  for (const pattern of patterns) { const match = text.match(pattern); if (match) { const lat = Number(match[1]), lon = Number(match[2]); if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return [String(lat), String(lon)]; } }
  return null;
}

export default function TreasureHunts() {
  const list = useAsync(() => rpc<Hunt[]>('staff_treasure_hunts'), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const edit = (h?: Hunt) => {
    setError('');
    setDraft(h ? { id: h.id, title: h.title, region: h.region, description: h.description, status: h.status as Draft['status'],
      starts_at: localValue(h.starts_at), ends_at: localValue(h.ends_at), completion_bonus_coins: h.completion_bonus_coins,
      coin_avatar: h.coin_avatar || '🪙', treasure_avatar: h.treasure_avatar || '🧰',
      participant_count: h.participant_count, checkpoints: h.checkpoints.map((c) => ({ sequence: c.sequence, name: c.name, hint: c.hint,
        latitude: String(c.latitude), longitude: String(c.longitude), radius_m: c.radius_m, reward_coins: c.reward_coins, map_ref: '' })),
      start_points: (h.start_points || []).map((p, i) => ({ sequence: i + 1, name: p.name, latitude: String(p.latitude), longitude: String(p.longitude), radius_m: p.radius_m, reward_coins: p.reward_coins, map_ref: '' })),
      finish_points: (h.finish_points || []).map((p, i) => ({ sequence: i + 1, name: p.name, latitude: String(p.latitude), longitude: String(p.longitude), radius_m: p.radius_m, reward_coins: p.reward_coins, map_ref: '' })) } : blank());
  };
  const frozen = !!draft?.id && draft.participant_count > 0;
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => d ? { ...d, [key]: value } : d);
  const changeStop = (index: number, key: keyof Stop, value: string | number) => setDraft((d) => d ? { ...d, checkpoints: d.checkpoints.map((s, i) => {
    if (i !== index) return s;
    const next = { ...s, [key]: value };
    if (key === 'map_ref' && typeof value === 'string') { const coords = coordinatesFrom(value); if (coords) { next.latitude = coords[0]; next.longitude = coords[1]; } }
    return next;
  }) } : d);
  const changeRoutePoint = (kind: 'start_points' | 'finish_points', index: number, key: keyof RoutePoint, value: string | number) => setDraft((d) => {
    if (!d) return d;
    const points = d[kind].map((p, i) => {
      if (i !== index) return p;
      const next = { ...p, [key]: value };
      if (key === 'map_ref' && typeof value === 'string') { const coords = coordinatesFrom(value); if (coords) { next.latitude = coords[0]; next.longitude = coords[1]; } }
      return next;
    });
    return { ...d, [kind]: points };
  });
  const save = async () => {
    if (!draft) return;
    setError('');
    if (draft.title.trim().length < 3 || draft.region.trim().length < 2) { setError('Add a hunt name and area.'); return; }
    if (draft.checkpoints.length < 2 || draft.checkpoints.some((c) => !c.name.trim() || !Number.isFinite(Number(c.latitude)) || !Number.isFinite(Number(c.longitude)) || c.latitude === '' || c.longitude === '')) {
      setError('Add at least two checkpoints, each with a name and map coordinates.'); return;
    }
    const routePoints = [...draft.start_points, ...draft.finish_points];
    if (!draft.start_points.length || !draft.finish_points.length || draft.start_points.some((p) => !p.name.trim() || p.latitude === '' || p.longitude === '' || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude))) || draft.finish_points.some((p) => !p.name.trim() || p.latitude === '' || p.longitude === '' || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)))) {
      setError('Add at least one named start and final treasure location with valid coordinates.'); return;
    }
    if (routePoints.some((p) => Number(p.latitude) < -90 || Number(p.latitude) > 90 || Number(p.longitude) < -180 || Number(p.longitude) > 180)) { setError('Check that each map location has a valid latitude and longitude.'); return; }
    if (Date.parse(draft.ends_at) <= Date.parse(draft.starts_at)) { setError('The end time must come after the start time.'); return; }
    setSaving(true);
    try {
      await rpc('staff_treasure_hunt_save_routes', {
        p_hunt: { id: draft.id, title: draft.title.trim(), region: draft.region.trim(), description: draft.description.trim(), status: draft.status,
          starts_at: new Date(draft.starts_at).toISOString(), ends_at: new Date(draft.ends_at).toISOString(), completion_bonus_coins: Number(draft.completion_bonus_coins), coin_avatar: draft.coin_avatar, treasure_avatar: draft.treasure_avatar },
        p_checkpoints: draft.checkpoints.map((c, i) => ({ sequence: i + 1, name: c.name.trim(), hint: c.hint.trim(), latitude: Number(c.latitude), longitude: Number(c.longitude),
          radius_m: Number(c.radius_m), reward_coins: Number(c.reward_coins) })),
        p_start_points: draft.start_points.map((p, i) => ({ sequence: i + 1, name: p.name.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })),
        p_finish_points: draft.finish_points.map((p, i) => ({ sequence: i + 1, name: p.name.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })),
      });
      toast(draft.id ? 'Hunt updated.' : 'Hunt saved.'); setDraft(null); list.reload();
    } catch (e) { setError((e as Error).message || 'Could not save this hunt.'); }
    finally { setSaving(false); }
  };
  if (list.error) return <><PageHead title="Treasure Hunts" sub="Create safe, public routes for members." /><ErrorBox text={list.error} retry={list.reload} /></>;
  if (!list.data) return <Spinner />;
  return (
    <>
      <PageHead title="Treasure Hunts" sub="Create a route, set its time, then make it available in Games." actions={<Btn kind="primary" onClick={() => edit()}>New hunt</Btn>} />
      <Card title="Keep routes safe" sub="Use public places, check every coordinate and avoid roads or private property. Camera and location stay on each player’s phone until a checkpoint is checked.">
        <p className="muted small">Coins are in-game points, not cash. A route with players already joined is locked so checkpoint locations and rewards cannot change mid-hunt. You can still cancel it.</p>
      </Card>
      <div className="th-admin-list">
        {list.data.length ? list.data.map((h) => <Card key={h.id} title={h.title} sub={`${h.region} · ${h.checkpoints.length} checkpoints`}>
          <div className="th-admin-meta"><Pill tone={h.status === 'active' ? 'green' : h.status === 'cancelled' ? 'red' : 'grey'}>{h.status}</Pill><span>{h.participant_count.toLocaleString()} players joined</span><span>{h.checkpoints.length} stops</span><span>{(h.start_points || []).length} starts · {(h.finish_points || []).length} treasures</span></div>
          <p className="small muted">{new Date(h.starts_at).toLocaleString()} – {new Date(h.ends_at).toLocaleString()}</p>
          <Btn kind="soft" disabled={h.participant_count > 0 && h.status === 'cancelled'} onClick={() => edit(h)}>{h.participant_count > 0 ? 'View or cancel' : 'Edit hunt'}</Btn>
        </Card>) : <Empty icon="gift" text="No hunts yet. Create one with public checkpoints to make it show in Games." />}
      </div>
      {draft ? <div className="th-admin-editor">
        <Card title={draft.id ? `Edit ${draft.title}` : 'New Treasure Hunt'} sub={frozen ? `${draft.participant_count} players joined. Route, times and rewards are locked; you can cancel the hunt.` : 'Set a route using latitude and longitude from a trusted map.'}>
          <div className="th-admin-form">
            <Field label="Hunt name"><input disabled={frozen} value={draft.title} maxLength={80} onChange={(e) => change('title', e.target.value)} placeholder="Port Harcourt Edition" /></Field>
            <Field label="Area"><input disabled={frozen} value={draft.region} maxLength={80} onChange={(e) => change('region', e.target.value)} placeholder="Port Harcourt, Rivers" /></Field>
            <Field label="Short introduction"><textarea disabled={frozen} value={draft.description} maxLength={500} rows={3} onChange={(e) => change('description', e.target.value)} placeholder="Follow the clues and find the treasure." /></Field>
            <div className="th-admin-row">
              <Field label="Starts"><input disabled={frozen} type="datetime-local" value={draft.starts_at} onChange={(e) => change('starts_at', e.target.value)} /></Field>
              <Field label="Ends"><input disabled={frozen} type="datetime-local" value={draft.ends_at} onChange={(e) => change('ends_at', e.target.value)} /></Field>
            </div>
            <div className="th-admin-row">
              <Field label="Status"><select disabled={frozen} value={draft.status} onChange={(e) => change('status', e.target.value as Draft['status'])}>
                <option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="active">Open now</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
              </select></Field>
              <Field label="Completion coins"><input disabled={frozen} type="number" min={0} max={100000} value={draft.completion_bonus_coins} onChange={(e) => change('completion_bonus_coins', Number(e.target.value))} /></Field>
            </div>
            <div className="th-admin-row">
              <Field label="Coin design"><select disabled={frozen} value={draft.coin_avatar} onChange={(e) => change('coin_avatar', e.target.value)}>{['🪙','💰','⭐','💎','🟡','🟠'].map((emoji) => <option key={emoji} value={emoji}>{emoji}</option>)}</select></Field>
              <Field label="Treasure design"><select disabled={frozen} value={draft.treasure_avatar} onChange={(e) => change('treasure_avatar', e.target.value)}>{['🧰','🎁','🏆','💎','👑','🪙'].map((emoji) => <option key={emoji} value={emoji}>{emoji}</option>)}</select></Field>
            </div>
            <p className="muted small">Players are assigned the closest available start and final treasure location when they join. Their route is fixed for that hunt.</p>
            {(['start_points', 'finish_points'] as const).map((kind) => {
              const label = kind === 'start_points' ? 'Starting locations' : 'Grand prize locations';
              const points = draft[kind];
              return <div className="th-admin-stops" key={kind}>
                <div className="th-admin-stops-head"><b>{label}</b>{!frozen && points.length < 10 ? <Btn kind="soft" onClick={() => change(kind, [...points, emptyRoutePoint(points.length + 1)])}>Add location</Btn> : null}</div>
                {points.map((p, i) => <section className="th-admin-stop" key={i}>
                  <div className="th-admin-stop-head"><b>{kind === 'start_points' ? 'Start' : 'Treasure'} {i + 1}</b>{!frozen && points.length > 1 ? <button className="th-admin-remove" onClick={() => change(kind, points.filter((_, at) => at !== i).map((x, at) => ({ ...x, sequence: at + 1 })))}>Remove</button> : null}</div>
                  <Field label="Location name"><input disabled={frozen} value={p.name} maxLength={80} onChange={(e) => changeRoutePoint(kind, i, 'name', e.target.value)} placeholder={kind === 'start_points' ? 'Waterlines junction' : 'Isaac Boro Park treasure'} /></Field>
                  <Field label="Paste Google Maps link or coordinates" hint="Some short links omit the pin. If it does not fill in, copy the coordinate pair from Google Maps."><input disabled={frozen} value={p.map_ref} onChange={(e) => changeRoutePoint(kind, i, 'map_ref', e.target.value)} placeholder="https://maps.google.com/... or 4.8156, 7.0498" /></Field>
                  <a className="btn btn-ghost btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${draft.region} ${p.name}`.trim())}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
                  <div className="th-admin-row"><Field label="Latitude"><input disabled={frozen} type="number" step="any" value={p.latitude} onChange={(e) => changeRoutePoint(kind, i, 'latitude', e.target.value)} placeholder="4.8" /></Field>
                    <Field label="Longitude"><input disabled={frozen} type="number" step="any" value={p.longitude} onChange={(e) => changeRoutePoint(kind, i, 'longitude', e.target.value)} placeholder="7.0" /></Field></div>
                  <div className="th-admin-row"><Field label="Check radius (metres)"><input disabled={frozen} type="number" min={20} max={200} value={p.radius_m} onChange={(e) => changeRoutePoint(kind, i, 'radius_m', Number(e.target.value))} /></Field>
                    <Field label="Coins here"><input disabled={frozen} type="number" min={0} max={100000} value={p.reward_coins} onChange={(e) => changeRoutePoint(kind, i, 'reward_coins', Number(e.target.value))} /></Field></div>
                </section>)}
              </div>;
            })}
            <div className="th-admin-stops"><div className="th-admin-stops-head"><b>Checkpoints</b>{!frozen && draft.checkpoints.length < 25 ? <Btn kind="soft" onClick={() => change('checkpoints', [...draft.checkpoints, emptyStop(draft.checkpoints.length + 1)])}>Add stop</Btn> : null}</div>
              {draft.checkpoints.map((c, i) => <section className="th-admin-stop" key={i}>
                <div className="th-admin-stop-head"><b>Stop {i + 1}</b>{!frozen && draft.checkpoints.length > 2 ? <button className="th-admin-remove" onClick={() => change('checkpoints', draft.checkpoints.filter((_, at) => at !== i).map((s, at) => ({ ...s, sequence: at + 1 })))}>Remove</button> : null}</div>
                <Field label="Place name"><input disabled={frozen} value={c.name} maxLength={80} onChange={(e) => changeStop(i, 'name', e.target.value)} placeholder="Isaac Boro Park" /></Field>
                <Field label="Clue"><input disabled={frozen} value={c.hint} maxLength={240} onChange={(e) => changeStop(i, 'hint', e.target.value)} placeholder="Look near the entrance." /></Field>
                <Field label="Google Maps link or coordinates" hint="Some short links omit the pin. If it does not fill in, copy the coordinate pair from Google Maps."><input disabled={frozen} value={c.map_ref} onChange={(e) => changeStop(i, 'map_ref', e.target.value)} placeholder="4.8156, 7.0498" /></Field>
                <a className="btn btn-ghost btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${draft.region} ${c.name}`.trim())}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
                <div className="th-admin-row"><Field label="Latitude"><input disabled={frozen} type="number" step="any" value={c.latitude} onChange={(e) => changeStop(i, 'latitude', e.target.value)} placeholder="4.8" /></Field>
                  <Field label="Longitude"><input disabled={frozen} type="number" step="any" value={c.longitude} onChange={(e) => changeStop(i, 'longitude', e.target.value)} placeholder="7.0" /></Field></div>
                <div className="th-admin-row"><Field label="Check radius (metres)"><input disabled={frozen} type="number" min={20} max={200} value={c.radius_m} onChange={(e) => changeStop(i, 'radius_m', Number(e.target.value))} /></Field>
                  <Field label="Coins"><input disabled={frozen} type="number" min={0} max={100000} value={c.reward_coins} onChange={(e) => changeStop(i, 'reward_coins', Number(e.target.value))} /></Field></div>
              </section>)}
            </div>
            {error ? <p className="err" role="alert">{error}</p> : null}
            <div className="th-admin-actions"><Btn kind="ghost" disabled={saving} onClick={() => setDraft(null)}>Close</Btn>{frozen && draft.status !== 'cancelled' ? <Btn kind="soft" disabled={saving} onClick={() => change('status', 'cancelled')}>Cancel this hunt</Btn> : null}<Btn kind="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : frozen && draft.status === 'cancelled' ? 'Confirm cancellation' : 'Save hunt'}</Btn></div>
          </div>
        </Card>
      </div> : null}
    </>
  );
}
