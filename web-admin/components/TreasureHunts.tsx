'use client';
import { useState } from 'react';
import { rpc } from '@/lib/sb';
import { useAsync, PageHead, Spinner, ErrorBox, Card, Field, Btn, Empty, Pill, toast } from './ui';

type Stop = { sequence: number; name: string; hint: string; latitude: string; longitude: string; radius_m: number; reward_coins: number };
type Hunt = { id: string; title: string; region: string; description: string; status: string; starts_at: string; ends_at: string; completion_bonus_coins: number; participant_count: number; checkpoints: (Stop & { id: string; latitude: number; longitude: number })[] };
type Draft = { id?: string; title: string; region: string; description: string; status: 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled'; starts_at: string; ends_at: string; completion_bonus_coins: number; checkpoints: Stop[]; participant_count: number };
const localValue = (v?: string) => { const d = v ? new Date(v) : new Date(Date.now() + 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const emptyStop = (sequence: number): Stop => ({ sequence, name: '', hint: '', latitude: '', longitude: '', radius_m: 45, reward_coins: 100 });
const blank = (): Draft => ({ title: '', region: '', description: '', status: 'draft', starts_at: localValue(), ends_at: localValue(new Date(Date.now() + 2 * 86400000).toISOString()), completion_bonus_coins: 100, checkpoints: [emptyStop(1), emptyStop(2)], participant_count: 0 });

export default function TreasureHunts() {
  const list = useAsync(() => rpc<Hunt[]>('staff_treasure_hunts'), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const edit = (h?: Hunt) => {
    setError('');
    setDraft(h ? { id: h.id, title: h.title, region: h.region, description: h.description, status: h.status as Draft['status'],
      starts_at: localValue(h.starts_at), ends_at: localValue(h.ends_at), completion_bonus_coins: h.completion_bonus_coins,
      participant_count: h.participant_count, checkpoints: h.checkpoints.map((c) => ({ sequence: c.sequence, name: c.name, hint: c.hint,
        latitude: String(c.latitude), longitude: String(c.longitude), radius_m: c.radius_m, reward_coins: c.reward_coins })) } : blank());
  };
  const frozen = !!draft?.id && draft.participant_count > 0;
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => d ? { ...d, [key]: value } : d);
  const changeStop = (index: number, key: keyof Stop, value: string | number) => setDraft((d) => d ? { ...d, checkpoints: d.checkpoints.map((s, i) => i === index ? { ...s, [key]: value } : s) } : d);
  const save = async () => {
    if (!draft) return;
    setError('');
    if (draft.title.trim().length < 3 || draft.region.trim().length < 2) { setError('Add a hunt name and area.'); return; }
    if (draft.checkpoints.length < 2 || draft.checkpoints.some((c) => !c.name.trim() || !Number.isFinite(Number(c.latitude)) || !Number.isFinite(Number(c.longitude)) || c.latitude === '' || c.longitude === '')) {
      setError('Add at least two checkpoints, each with a name and map coordinates.'); return;
    }
    if (Date.parse(draft.ends_at) <= Date.parse(draft.starts_at)) { setError('The end time must come after the start time.'); return; }
    setSaving(true);
    try {
      await rpc('staff_treasure_hunt_save', {
        p_hunt: { id: draft.id, title: draft.title.trim(), region: draft.region.trim(), description: draft.description.trim(), status: draft.status,
          starts_at: new Date(draft.starts_at).toISOString(), ends_at: new Date(draft.ends_at).toISOString(), completion_bonus_coins: Number(draft.completion_bonus_coins) },
        p_checkpoints: draft.checkpoints.map((c, i) => ({ sequence: i + 1, name: c.name.trim(), hint: c.hint.trim(), latitude: Number(c.latitude), longitude: Number(c.longitude),
          radius_m: Number(c.radius_m), reward_coins: Number(c.reward_coins) })),
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
          <div className="th-admin-meta"><Pill tone={h.status === 'active' ? 'green' : h.status === 'cancelled' ? 'red' : 'grey'}>{h.status}</Pill><span>{h.participant_count.toLocaleString()} players joined</span><span>{h.checkpoints.length} stops</span></div>
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
            <div className="th-admin-stops"><div className="th-admin-stops-head"><b>Checkpoints</b>{!frozen && draft.checkpoints.length < 25 ? <Btn kind="soft" onClick={() => change('checkpoints', [...draft.checkpoints, emptyStop(draft.checkpoints.length + 1)])}>Add stop</Btn> : null}</div>
              {draft.checkpoints.map((c, i) => <section className="th-admin-stop" key={i}>
                <div className="th-admin-stop-head"><b>Stop {i + 1}</b>{!frozen && draft.checkpoints.length > 2 ? <button className="th-admin-remove" onClick={() => change('checkpoints', draft.checkpoints.filter((_, at) => at !== i).map((s, at) => ({ ...s, sequence: at + 1 })))}>Remove</button> : null}</div>
                <Field label="Place name"><input disabled={frozen} value={c.name} maxLength={80} onChange={(e) => changeStop(i, 'name', e.target.value)} placeholder="Isaac Boro Park" /></Field>
                <Field label="Clue"><input disabled={frozen} value={c.hint} maxLength={240} onChange={(e) => changeStop(i, 'hint', e.target.value)} placeholder="Look near the entrance." /></Field>
                <div className="th-admin-row"><Field label="Latitude"><input disabled={frozen} type="number" step="any" value={c.latitude} onChange={(e) => changeStop(i, 'latitude', e.target.value)} placeholder="4.8" /></Field>
                  <Field label="Longitude"><input disabled={frozen} type="number" step="any" value={c.longitude} onChange={(e) => changeStop(i, 'longitude', e.target.value)} placeholder="7.0" /></Field></div>
                <div className="th-admin-row"><Field label="Check radius (metres)"><input disabled={frozen} type="number" min={20} max={200} value={c.radius_m} onChange={(e) => changeStop(i, 'radius_m', Number(e.target.value))} /></Field>
                  <Field label="Coins"><input disabled={frozen} type="number" min={0} max={100000} value={c.reward_coins} onChange={(e) => changeStop(i, 'reward_coins', Number(e.target.value))} /></Field></div>
              </section>)}
            </div>
            {error ? <p className="err" role="alert">{error}</p> : null}
            <div className="th-admin-actions"><Btn kind="ghost" disabled={saving} onClick={() => setDraft(null)}>Cancel</Btn><Btn kind="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save hunt'}</Btn></div>
          </div>
        </Card>
      </div> : null}
    </>
  );
}
