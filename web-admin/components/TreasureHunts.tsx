'use client';
import { useState } from 'react';
import { rpc, mapLinkCoords } from '@/lib/sb';
import { useAsync, PageHead, Spinner, ErrorBox, Card, Field, Btn, Empty, Pill, toast } from './ui';
import { STATES } from '@/lib/options';
import { MediaPick } from './Upload';

type Stop = { sequence: number; name: string; hint: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type RoutePoint = { sequence: number; name: string; latitude: string; longitude: string; radius_m: number; reward_coins: number; map_ref: string };
type Prize = { place: number | null; title: string; media_type: 'image' | 'video'; media_url: string };
type Hunt = { id: string; title: string; region: string; state: string | null; max_registrations: number; winners_count: number; rules: string; join_radius_km: number; registration_count: number; prizes: Prize[]; description: string; status: string; starts_at: string; ends_at: string; completion_bonus_coins: number; coin_avatar: string; treasure_avatar: string; participant_count: number;
  checkpoints: { id: string; sequence: number; name: string; hint: string; latitude: number; longitude: number; radius_m: number; reward_coins: number }[];
  start_points: { id: string; sequence: number; name: string; latitude: number; longitude: number; radius_m: number; reward_coins: number }[];
  finish_points: { id: string; sequence: number; name: string; latitude: number; longitude: number; radius_m: number; reward_coins: number }[] };
type Draft = { id?: string; title: string; region: string; state: string; max_registrations: number; winners_count: number; rules: string; join_radius_km: number; registration_count: number; prizes: Prize[]; prizesChanged: boolean; description: string; status: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled'; starts_at: string; ends_at: string; completion_bonus_coins: number; coin_avatar: string; treasure_avatar: string; checkpoints: Stop[]; finish_points: RoutePoint[]; participant_count: number };
const localValue = (v?: string) => { const d = v ? new Date(v) : new Date(Date.now() + 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const emptyStop = (sequence: number): Stop => ({ sequence, name: '', hint: '', latitude: '', longitude: '', radius_m: 45, reward_coins: 100, map_ref: '' });
const emptyRoutePoint = (sequence: number): RoutePoint => ({ sequence, name: '', latitude: '', longitude: '', radius_m: 60, reward_coins: 0, map_ref: '' });
const blank = (): Draft => ({ title: '', region: '', state: '', max_registrations: 1000, winners_count: 10, rules: '', join_radius_km: 60, registration_count: 0, prizes: [], prizesChanged: false, description: '', status: 'draft', starts_at: localValue(), ends_at: localValue(new Date(Date.now() + 2 * 86400000).toISOString()), completion_bonus_coins: 100, coin_avatar: '🪙', treasure_avatar: '🧰', checkpoints: [emptyStop(1)], finish_points: [emptyRoutePoint(1)], participant_count: 0 });
function coordinatesFrom(value: string): [string, string] | null {
  let text = value.trim();
  try { if (/^https?:\/\//i.test(text)) { const url = new URL(text); const q = url.searchParams.get('q') || url.searchParams.get('query'); if (q) text = q; else text = decodeURIComponent(text); } } catch { text = value.trim(); }
  const patterns = [/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/, /[?&](?:q|ll|query|destination)=(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/, /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/, /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/];
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
    setDraft(h ? { id: h.id, title: h.title, region: h.region, state: h.state || '', max_registrations: h.max_registrations || 1000, winners_count: h.winners_count || 10, rules: h.rules || '', join_radius_km: h.join_radius_km || 60, registration_count: h.registration_count || 0,
      prizes: h.prizes || [], prizesChanged: false, description: h.description, status: h.status as Draft['status'],
      starts_at: localValue(h.starts_at), ends_at: localValue(h.ends_at), completion_bonus_coins: h.completion_bonus_coins,
      coin_avatar: h.coin_avatar || '🪙', treasure_avatar: h.treasure_avatar || '🧰',
      participant_count: h.participant_count, checkpoints: h.checkpoints.length ? h.checkpoints.map((c) => ({ sequence: c.sequence, name: c.name, hint: c.hint,
        latitude: String(c.latitude), longitude: String(c.longitude), radius_m: c.radius_m, reward_coins: c.reward_coins, map_ref: '' }))
        : [emptyStop(1)],
      finish_points: (h.finish_points || []).slice(0, 1).map((p, i) => ({ sequence: i + 1, name: p.name, latitude: String(p.latitude), longitude: String(p.longitude), radius_m: p.radius_m, reward_coins: p.reward_coins, map_ref: '' })) } : blank());
  };
  const frozen = !!draft?.id && draft.participant_count > 0;
  // A link without numbers in it (e.g. a maps.app.goo.gl share link) is read on our server.
  const [lookups, setLookups] = useState<Record<string, string>>({});
  const lookup = (kind: 'checkpoints' | 'finish_points', i: number, value: string) => {
    const key = `${kind}-${i}`;
    if (!/^https?:\/\//i.test(value.trim()) || coordinatesFrom(value)) { setLookups((l) => ({ ...l, [key]: '' })); return; }
    setLookups((l) => ({ ...l, [key]: 'Reading the link…' }));
    mapLinkCoords(value.trim()).then((c) => {
      setDraft((d) => {
        if (!d) return d;
        const list = d[kind] as (Stop | RoutePoint)[];
        if (!list[i] || list[i].map_ref !== value) return d;
        return { ...d, [kind]: list.map((p, n) => n === i ? { ...p, latitude: String(c.latitude), longitude: String(c.longitude) } : p) };
      });
      setLookups((l) => ({ ...l, [key]: `Found it: ${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}` }));
    }).catch((e) => setLookups((l) => ({ ...l, [key]: (e as Error).message })));
  };
  const linkHint = (key: string) => lookups[key] || 'Paste any Google Maps link (share links too). Latitude and longitude fill in by themselves.';
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => d ? { ...d, [key]: value } : d);
  const changeStop = (index: number, key: keyof Stop, value: string | number) => setDraft((d) => d ? { ...d, checkpoints: d.checkpoints.map((s, i) => {
    if (i !== index) return s;
    const next = { ...s, [key]: value };
    if (key === 'map_ref' && typeof value === 'string') { const coords = coordinatesFrom(value); if (coords) { next.latitude = coords[0]; next.longitude = coords[1]; } }
    return next;
  }) } : d);
  const changeRoutePoint = (index: number, key: keyof RoutePoint, value: string | number) => setDraft((d) => {
    if (!d) return d;
    const points = d.finish_points.map((p, i) => {
      if (i !== index) return p;
      const next = { ...p, [key]: value };
      if (key === 'map_ref' && typeof value === 'string') { const coords = coordinatesFrom(value); if (coords) { next.latitude = coords[0]; next.longitude = coords[1]; } }
      return next;
    });
    return { ...d, finish_points: points };
  });
  const save = async () => {
    if (!draft) return;
    setError('');
    if (draft.title.trim().length < 3 || draft.region.trim().length < 2) { setError('Add a hunt name and area.'); return; }
    if (!draft.state && !frozen) { setError('Choose the state this hunt is in. Only members in that state can register.'); return; }
    if (!(draft.max_registrations >= 10 && draft.max_registrations <= 1000)) { setError('Set the participant limit between 10 and 1,000.'); return; }
    if (draft.max_registrations < draft.registration_count) { setError(`${draft.registration_count} people have already registered, so the limit can’t be lower than that.`); return; }
    if (!(draft.winners_count >= 1 && draft.winners_count <= 100) || draft.winners_count > draft.max_registrations) { setError('Choose between 1 and 100 winners (no more than the participant limit).'); return; }
    if (draft.prizes.some((p) => p.title.trim().length < 2)) { setError('Give every prize a short name.'); return; }
    if (!draft.checkpoints.length || draft.checkpoints.some((c) => !c.name.trim() || !Number.isFinite(Number(c.latitude)) || !Number.isFinite(Number(c.longitude)) || c.latitude === '' || c.longitude === '')) {
      setError('Keep at least one named checkpoint and add its map coordinates.'); return;
    }
    const routePoints = draft.finish_points;
    if (!draft.finish_points.length || draft.finish_points.some((p) => !p.name.trim() || p.latitude === '' || p.longitude === '' || !Number.isFinite(Number(p.latitude)) || !Number.isFinite(Number(p.longitude)))) {
      setError('Add the grand prize location with a name and valid coordinates.'); return;
    }
    if (routePoints.some((p) => Number(p.latitude) < -90 || Number(p.latitude) > 90 || Number(p.longitude) < -180 || Number(p.longitude) > 180)) { setError('Check that each map location has a valid latitude and longitude.'); return; }
    if (Date.parse(draft.ends_at) <= Date.parse(draft.starts_at)) { setError('The end time must come after the start time.'); return; }
    setSaving(true);
    try {
      const hid = await rpc<string>('staff_treasure_hunt_save_routes', {
        p_hunt: { id: draft.id, title: draft.title.trim(), region: draft.region.trim(), state: draft.state || null, join_radius_km: Number(draft.join_radius_km), max_registrations: Number(draft.max_registrations), winners_count: Number(draft.winners_count), rules: draft.rules.trim(), description: draft.description.trim(), status: draft.status,
          starts_at: new Date(draft.starts_at).toISOString(), ends_at: new Date(draft.ends_at).toISOString(), completion_bonus_coins: Number(draft.completion_bonus_coins), coin_avatar: draft.coin_avatar, treasure_avatar: draft.treasure_avatar },
        p_checkpoints: draft.checkpoints.map((c, i) => ({ sequence: i + 1, name: c.name.trim(), hint: c.hint.trim(), latitude: Number(c.latitude), longitude: Number(c.longitude),
          radius_m: Number(c.radius_m), reward_coins: Number(c.reward_coins) })),
        p_start_points: [],
        p_finish_points: draft.finish_points.map((p, i) => ({ sequence: i + 1, name: p.name.trim(), latitude: Number(p.latitude), longitude: Number(p.longitude), radius_m: Number(p.radius_m), reward_coins: Number(p.reward_coins) })),
      });
      if ((draft.prizesChanged || (!draft.id && draft.prizes.length)) && draft.status !== 'cancelled' && draft.status !== 'completed') {
        await rpc('staff_treasure_hunt_prizes_save', { p_hunt: hid || draft.id, p_prizes: draft.prizes.map((p) => ({ place: p.place, title: p.title.trim(), media_type: p.media_type, media_url: p.media_url })) });
      }
      toast(draft.id ? 'Hunt updated.' : 'Hunt saved.'); setDraft(null); list.reload();
    } catch (e) { setError((e as Error).message || 'Could not save this hunt.'); }
    finally { setSaving(false); }
  };
  if (list.error) return <><PageHead title="Treasure Hunts" sub="Create safe, public routes for members." /><ErrorBox text={list.error} retry={list.reload} /></>;
  if (!list.data) return <Spinner />;
  return (
    <>
      <PageHead title="Treasure Hunts" sub="Create a route, set its time, then make it available in Games." actions={<Btn kind="primary" onClick={() => edit()}>New hunt</Btn>} />
      <Card title="Keep routes safe" sub="Use public places, check every coordinate and avoid roads or private property. Each player starts at the checkpoint nearest them and goes through every checkpoint, then everyone goes to the same grand prize location.">
        <p className="muted small">Coins are in-game points, not cash. A route with players already joined is locked so checkpoint locations and rewards cannot change mid-hunt. You can still cancel it.</p>
      </Card>
      <div className="th-admin-list">
        {list.data.length ? list.data.map((h) => <Card key={h.id} title={h.title} sub={`${h.region} · ${h.checkpoints.length} checkpoints`}>
          <div className="th-admin-meta"><Pill tone={h.status === 'active' ? 'green' : h.status === 'cancelled' ? 'red' : 'grey'}>{h.status}</Pill><span>{h.state ? (h.state === 'FCT' ? 'FCT (Abuja)' : h.state) + ' only' : 'Any state (older hunt)'}</span><span>{(h.registration_count || 0).toLocaleString()} of {(h.max_registrations || 1000).toLocaleString()} places taken</span><span>{h.participant_count.toLocaleString()} players joined</span>{h.prizes?.length ? <span>{h.prizes.length} prizes</span> : null}<span>{h.checkpoints.length} checkpoints</span><span>Nearest-checkpoint start · {(h.finish_points || []).length} treasures</span></div>
          <p className="small muted">{new Date(h.starts_at).toLocaleString()} – {new Date(h.ends_at).toLocaleString()}</p>
          <Btn kind="soft" disabled={h.participant_count > 0 && h.status === 'cancelled'} onClick={() => edit(h)}>{h.participant_count > 0 ? 'View or cancel' : 'Edit hunt'}</Btn>
        </Card>) : <Empty icon="gift" text="No hunts yet. Create one with public checkpoints to make it show in Games." />}
      </div>
      {draft ? <div className="th-admin-editor">
        <Card title={draft.id ? `Edit ${draft.title}` : 'New Treasure Hunt'} sub={frozen ? `${draft.participant_count} players joined. Route, times and rewards are locked; you can cancel the hunt.` : 'Set a route using latitude and longitude from a trusted map.'}>
          <div className="th-admin-form">
            <Field label="Hunt name"><input disabled={frozen} value={draft.title} maxLength={80} onChange={(e) => change('title', e.target.value)} placeholder="Port Harcourt Edition" /></Field>
            <Field label="Area"><input disabled={frozen} value={draft.region} maxLength={80} onChange={(e) => change('region', e.target.value)} placeholder="Port Harcourt, Rivers" /></Field>
            <div className="th-admin-row">
              <Field label="State" hint={draft.registration_count > 0 ? `${draft.registration_count} registered, so the state is locked.` : 'Only members whose profile is in this state can register.'}>
                <select disabled={frozen || draft.registration_count > 0} value={draft.state} onChange={(e) => change('state', e.target.value)}>
                  <option value="">Choose a state…</option>{STATES.map((st) => <option key={st} value={st}>{st === 'FCT' ? 'FCT (Abuja)' : st}</option>)}
                </select></Field>
              <Field label="Participant limit" hint={draft.registration_count > 0 ? `${draft.registration_count} registered; you can raise it but not go below that.` : '10 to 1,000. When it’s full, nobody else can register.'}><input type="number" min={Math.max(10, draft.registration_count)} max={1000} value={draft.max_registrations} onChange={(e) => change('max_registrations', Number(e.target.value))} /></Field>
              <Field label="Start area (km)" hint="Players must be this close to a checkpoint to start."><input disabled={frozen} type="number" min={1} max={1000} value={draft.join_radius_km} onChange={(e) => change('join_radius_km', Number(e.target.value))} /></Field>
            </div>
            <Field label="Number of winners" hint="1 to 100. When this many players finish, everyone still playing is told the winners are in and can finish or quit."><input type="number" min={1} max={100} value={draft.winners_count} onChange={(e) => change('winners_count', Number(e.target.value))} /></Field>
            <Field label="Hunt rules" hint="Pinned at the top of the hunt chat. Everyone who registers is added to that chat automatically."><textarea value={draft.rules} maxLength={2000} rows={4} onChange={(e) => change('rules', e.target.value)} placeholder="Stay on public roads. No running across traffic. Be kind to other players." /></Field>
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
            <p className="muted small">The starting checkpoint is chosen from the player’s location when they start. The grand prize location unlocks only after a player has found every checkpoint, and it is the same place for everyone.</p>
            <div className="th-admin-stops">
              <div className="th-admin-stops-head"><b>Grand prize location</b>{!frozen && draft.finish_points.length < 1 ? <Btn kind="soft" onClick={() => change('finish_points', [...draft.finish_points, emptyRoutePoint(draft.finish_points.length + 1)])}>Add location</Btn> : null}</div>
              {draft.finish_points.map((p, i) => <section className="th-admin-stop" key={i}>
                <div className="th-admin-stop-head"><b>Same for every player · unlocks after all checkpoints</b>{!frozen && draft.finish_points.length > 1 ? <button className="th-admin-remove" onClick={() => change('finish_points', draft.finish_points.filter((_, at) => at !== i).map((x, at) => ({ ...x, sequence: at + 1 })))}>Remove</button> : null}</div>
                <Field label="Location name"><input disabled={frozen} value={p.name} maxLength={80} onChange={(e) => changeRoutePoint(i, 'name', e.target.value)} placeholder="Isaac Boro Park treasure" /></Field>
                <Field label="Google Maps link or coordinates" hint={linkHint(`finish_points-${i}`)}><input disabled={frozen} value={p.map_ref} onChange={(e) => { changeRoutePoint(i, 'map_ref', e.target.value); lookup('finish_points', i, e.target.value); }} placeholder="https://maps.google.com/... or 4.8156, 7.0498" /></Field>
                <a className="btn btn-ghost btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${draft.region} ${p.name}`.trim())}`} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
                <div className="th-admin-row"><Field label="Latitude"><input disabled={frozen} type="number" step="any" value={p.latitude} onChange={(e) => changeRoutePoint(i, 'latitude', e.target.value)} placeholder="4.8" /></Field>
                  <Field label="Longitude"><input disabled={frozen} type="number" step="any" value={p.longitude} onChange={(e) => changeRoutePoint(i, 'longitude', e.target.value)} placeholder="7.0" /></Field></div>
                <div className="th-admin-row"><Field label="Check radius (metres)"><input disabled={frozen} type="number" min={20} max={200} value={p.radius_m} onChange={(e) => changeRoutePoint(i, 'radius_m', Number(e.target.value))} /></Field>
                  <Field label="Coins here"><input disabled={frozen} type="number" min={0} max={100000} value={p.reward_coins} onChange={(e) => changeRoutePoint(i, 'reward_coins', Number(e.target.value))} /></Field></div>
              </section>)}
            </div>
            <div className="th-admin-stops">
              <div className="th-admin-stops-head"><b>Prizes</b>{draft.prizes.length < 12 && draft.status !== 'cancelled' ? <MediaPick onUploaded={(m) => setDraft((d) => d ? { ...d, prizesChanged: true, prizes: [...d.prizes, { place: d.prizes.length < 3 ? d.prizes.length + 1 : null, title: '', media_type: m.type, media_url: m.url }] } : d)} /> : null}</div>
              <p className="muted small">Show members what they can win: pictures (under 1.5 MB) or short videos (under 20 MB). Videos only download when a member taps play.</p>
              {draft.prizes.length === 0 ? <p className="muted small">No prizes added yet.</p> : null}
              {draft.prizes.map((p, i) => <section className="th-admin-stop th-admin-prize" key={p.media_url}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p.media_type === 'video' ? <video src={p.media_url} controls playsInline preload="metadata" /> : <img src={p.media_url} alt="" />}
                <div>
                  <Field label="Prize name"><input value={p.title} maxLength={80} placeholder="Grand prize: a new phone" onChange={(e) => setDraft((d) => d ? { ...d, prizesChanged: true, prizes: d.prizes.map((x, at) => at === i ? { ...x, title: e.target.value } : x) } : d)} /></Field>
                  <Field label="For"><select value={p.place ?? ''} onChange={(e) => setDraft((d) => d ? { ...d, prizesChanged: true, prizes: d.prizes.map((x, at) => at === i ? { ...x, place: e.target.value ? Number(e.target.value) : null } : x) } : d)}>
                    <option value="">Everyone who finishes</option>{Array.from({ length: 20 }, (_, k) => k + 1).map((k) => <option key={k} value={k}>{k === 1 ? '1st place' : k === 2 ? '2nd place' : k === 3 ? '3rd place' : `${k}th place`}</option>)}
                  </select></Field>
                  <button className="th-admin-remove" onClick={() => setDraft((d) => d ? { ...d, prizesChanged: true, prizes: d.prizes.filter((_, at) => at !== i) } : d)}>Remove prize</button>
                </div>
              </section>)}
            </div>
            <div className="th-admin-stops"><div className="th-admin-stops-head"><b>Checkpoints</b>{!frozen ? <Btn kind="soft" onClick={() => change('checkpoints', [...draft.checkpoints, emptyStop(draft.checkpoints.length + 1)])}>Add stop</Btn> : null}</div>
              <p className="muted small">Keep one checkpoint for the route to work. Add as many extra stops as you need and remove any extras before the hunt starts.</p>
              {draft.checkpoints.map((c, i) => <section className="th-admin-stop" key={i}>
                <div className="th-admin-stop-head"><b>Checkpoint {i + 1}{i === 0 ? ' · Required' : ''}</b>{!frozen && draft.checkpoints.length > 1 ? <button className="th-admin-remove" onClick={() => change('checkpoints', draft.checkpoints.filter((_, at) => at !== i).map((s, at) => ({ ...s, sequence: at + 1 })))}>Remove</button> : null}</div>
                <Field label="Place name"><input disabled={frozen} value={c.name} maxLength={80} onChange={(e) => changeStop(i, 'name', e.target.value)} placeholder="Isaac Boro Park" /></Field>
                <Field label="Clue"><input disabled={frozen} value={c.hint} maxLength={240} onChange={(e) => changeStop(i, 'hint', e.target.value)} placeholder="Look near the entrance." /></Field>
                <Field label="Google Maps link or coordinates" hint={linkHint(`checkpoints-${i}`)}><input disabled={frozen} value={c.map_ref} onChange={(e) => { changeStop(i, 'map_ref', e.target.value); lookup('checkpoints', i, e.target.value); }} placeholder="https://maps.app.goo.gl/... or 4.8156, 7.0498" /></Field>
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
