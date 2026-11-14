'use client';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/sb';
import { allows } from '@/lib/roles';
import { STATES } from '@/lib/options';
import { ago, date, isoToLagosInput, lagosInputToIso, n, pct } from '@/lib/fmt';
import { Bars } from './charts';
import { useMe } from './Gate';
import { useGo } from './Shell';
import { ImagePick } from './Upload';
import { Btn, Card, Empty, ErrorBox, Field, PageHead, Pill, Spinner, Tabs, toast, useAsync } from './ui';
import { Icon } from './Icon';

const CATS: Record<string, [string, 'blue' | 'pink' | 'violet' | 'green' | 'amber' | 'red']> = {
  product_update: ['Product update', 'blue'], feature_launch: ['Feature launch', 'pink'], event: ['Event', 'violet'],
  community: ['Community', 'green'], maintenance: ['Maintenance', 'amber'], important: ['Important', 'red'],
};
const STATUS: Record<string, [string, 'grey' | 'blue' | 'amber' | 'green' | 'violet']> = {
  draft: ['Draft', 'grey'], scheduled: ['Scheduled', 'blue'], publishing: ['Delivering', 'amber'], published: ['Published', 'green'], archived: ['Archived', 'violet'],
};
const BASES: [string, string][] = [['active', 'Active in the last 30 days'], ['all', 'Everyone with a profile'], ['new', 'Joined in the last N days'], ['recent', 'Active in the last N days'], ['inactive', 'Inactive for N days']];
const PLATFORMS: [string, string][] = [['android-play', 'Android (Play)'], ['android-apk', 'Android (APK)'], ['android-app', 'Android (old app)'], ['ios-app', 'iPhone'], ['web', 'Web']];
const ROUTES: [string, string][] = [['/home', 'Home'], ['/home/discover', 'Discover'], ['/home/discover/nearby', 'Nearby'], ['/home/rooms', 'Chatrooms'], ['/home/matches', 'Inbox'],
  ['/home/games', 'Games'], ['/home/profile', 'Profile'], ['/home/notifications', 'Notifications']];

type Row = { id: string; title: string; category: string; status: string; created_at: string; scheduled_for: string | null; published_at: string | null;
  eligible_count: number | null; delivered_count: number | null; read_count: number | null; click_count: number | null; created_by_handle: string | null; total: number };
type Audience = { base: string; days?: number; states?: string[]; platforms?: string[] };
type Ann = { id: string; title: string; preview: string; body: string; category: string; cover_url: string | null; cta_label: string | null; cta_url: string | null;
  audience: Audience; send_push: boolean; status: string; scheduled_for: string | null; published_at: string | null; expires_at: string | null; created_by_handle: string | null; revised_by: string | null };

export function AnnList() {
  const { me } = useMe();
  const go = useGo();
  const [status, setStatus] = useState('all');
  const ov = useAsync(() => rpc<{ total: number; published: number; scheduled: number; drafts: number; recipients: number; reads: number; read_rate: number; clicks: number }>('ann_overview'), []);
  const list = useAsync(() => rpc<Row[]>('ann_list', { p_status: status, p_limit: 50 }), [status]);
  const o = ov.data;
  return (
    <>
      <PageHead title="Announcements" sub="News for members, shown in Inbox → Announcements, with an optional push notification."
        actions={allows(me.role, 'content') && <Btn kind="primary" icon="plus" onClick={() => go('/announcements/new')}>New announcement</Btn>} />
      {o && (
        <div className="kpis small">
          <div className="kpi"><span className="kpi-l">Published</span><div className="kpi-v"><b>{n(o.published)}</b></div><p className="kpi-hint">{n(o.scheduled)} scheduled · {n(o.drafts)} drafts</p></div>
          <div className="kpi"><span className="kpi-l">People reached</span><div className="kpi-v"><b>{n(o.recipients)}</b></div></div>
          <div className="kpi"><span className="kpi-l">Read</span><div className="kpi-v"><b>{n(o.reads)}</b></div><p className="kpi-hint">{o.read_rate ?? 0}% read rate</p></div>
          <div className="kpi"><span className="kpi-l">Button taps</span><div className="kpi-v"><b>{n(o.clicks)}</b></div></div>
        </div>
      )}
      <div className="toolbar"><Tabs value={status} onChange={setStatus} items={[['all', 'All'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['archived', 'Archived']]} /></div>
      <Card pad={false}>
        {list.error && <ErrorBox text={list.error} retry={list.reload} />}
        {list.loading && !list.data && <Spinner />}
        {list.data && list.data.length === 0 && <Empty text="No announcements here yet." icon="megaphone" />}
        {list.data && list.data.length > 0 && (
          <table className="tbl"><thead><tr><th>Title</th><th>Category</th><th>Status</th><th>Reached</th><th>Read</th><th>When</th></tr></thead>
            <tbody>{list.data.map((a) => (
              <tr key={a.id} className="click" onClick={() => go(`/announcements/${a.id}`)}>
                <td><b>{a.title}</b><small className="muted block">by {a.created_by_handle || '—'}</small></td>
                <td><Pill tone={CATS[a.category]?.[1] || 'grey'}>{CATS[a.category]?.[0] || a.category}</Pill></td>
                <td><Pill tone={STATUS[a.status]?.[1] || 'grey'}>{STATUS[a.status]?.[0] || a.status}</Pill></td>
                <td>{n(a.delivered_count)}</td><td>{pct(a.read_count || 0, a.delivered_count || 0)}</td>
                <td className="muted">{a.status === 'scheduled' ? date(a.scheduled_for) : ago(a.published_at || a.created_at)}</td>
              </tr>))}</tbody></table>
        )}
      </Card>
    </>
  );
}

const blank: Ann = { id: '', title: '', preview: '', body: '', category: 'product_update', cover_url: null, cta_label: null, cta_url: null, audience: { base: 'active' },
  send_push: true, status: 'draft', scheduled_for: null, published_at: null, expires_at: null, created_by_handle: null, revised_by: null };

export function AnnEdit({ id }: { id?: string }) {
  const go = useGo();
  const [a, setA] = useState<Ann | null>(id ? null : blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [est, setEst] = useState<number | null>(null);
  useEffect(() => { if (id) rpc<Ann>('ann_get', { p_id: id }).then(setA).catch((e) => setErr(e.message)); }, [id]);
  useEffect(() => {
    if (!a) return;
    const t = setTimeout(() => rpc<number>('ann_estimate', { p_audience: a.audience }).then(setEst).catch(() => setEst(null)), 400);
    return () => clearTimeout(t);
  }, [a?.audience]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return err ? <ErrorBox text={err} /> : <Spinner />;
  const set = (p: Partial<Ann>) => setA({ ...a, ...p });
  const aud = (p: Partial<Audience>) => set({ audience: { ...a.audience, ...p } });
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const nid = await rpc<string>('ann_save', { p_id: a.id || null, p_fields: { title: a.title, preview: a.preview, body: a.body, category: a.category, cover_url: a.cover_url || '',
        cta_label: a.cta_label || '', cta_url: a.cta_url || '', audience: a.audience, send_push: a.send_push, expires_at: a.expires_at || '' } });
      toast('Saved.');
      go(`/announcements/${nid}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const needsDays = ['new', 'recent', 'inactive'].includes(a.audience.base);
  return (
    <>
      <button className="crumb" onClick={() => go('/announcements')}><Icon name="back" size={15} />Announcements</button>
      <PageHead title={a.id ? 'Edit announcement' : 'New announcement'} sub="Save as a draft first. You publish or schedule it on the next screen." />
      <div className="compose">
        <Card title="Message">
          <Field label="Category"><select value={a.category} onChange={(e) => set({ category: e.target.value })}>{Object.entries(CATS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Title" hint={`${a.title.length}/100`}><input value={a.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Preview" hint={`Shown in the list and the push notification. ${a.preview.length}/160`}><input value={a.preview} maxLength={160} onChange={(e) => set({ preview: e.target.value })} /></Field>
          <Field label="Full text" hint="Plain text. **bold**, [links](https://…), lines starting with “- ” become bullets."><textarea rows={8} value={a.body} onChange={(e) => set({ body: e.target.value })} /></Field>
          <Field label="Cover picture"><ImagePick folder="covers" value={a.cover_url || ''} onChange={(u) => set({ cover_url: u || null })} /></Field>
          <div className="two">
            <Field label="Button label"><input value={a.cta_label || ''} maxLength={30} onChange={(e) => set({ cta_label: e.target.value || null })} placeholder="e.g. Play now" /></Field>
            <Field label="Button opens"><input list="ann-routes" value={a.cta_url || ''} onChange={(e) => set({ cta_url: e.target.value || null })} placeholder="/home/games or https://…" /></Field>
          </div>
          <datalist id="ann-routes">{ROUTES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</datalist>
        </Card>
        <Card title="Who gets it" sub={est == null ? 'Counting…' : `About ${n(est)} people right now`}>
          <Field label="Audience"><select value={a.audience.base} onChange={(e) => aud({ base: e.target.value })}>{BASES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {needsDays && <Field label="Days"><input type="number" min={1} max={365} value={a.audience.days || 7} onChange={(e) => aud({ days: Number(e.target.value) })} /></Field>}
          <Field label="States" hint="None selected = all states."><Multi options={STATES.map((s) => [s, s])} value={a.audience.states || []} onChange={(v) => aud({ states: v })} /></Field>
          <Field label="Apps" hint="None selected = every app."><Multi options={PLATFORMS} value={a.audience.platforms || []} onChange={(v) => aud({ platforms: v })} /></Field>
          <label className="check"><input type="checkbox" checked={a.send_push} onChange={(e) => set({ send_push: e.target.checked })} />Also send a push notification</label>
          <Field label="Stops showing on (optional)"><input type="datetime-local" value={isoToLagosInput(a.expires_at)} onChange={(e) => set({ expires_at: lagosInputToIso(e.target.value) })} /></Field>
          {err && <ErrorBox text={err} />}
          <div className="actions"><Btn kind="primary" icon="check" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save draft'}</Btn></div>
        </Card>
      </div>
    </>
  );
}

export function Multi({ options, value, onChange }: { options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="multi">
      {options.map(([k, l]) => {
        const on = value.includes(k);
        return <button type="button" key={k} className={`chip ${on ? 'on' : ''}`} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}>{l}</button>;
      })}
    </div>
  );
}

export function AnnView({ id }: { id: string }) {
  const { me } = useMe();
  const go = useGo();
  const a = useAsync(() => rpc<Ann>('ann_get', { p_id: id }), [id]);
  const st = useAsync(() => rpc<{ delivered: number; reads: number; read_rate: number; clicks: number; click_rate: number; eligible_now?: number; by_day: { day: string; reads: number; clicks: number }[] }>('ann_analytics', { p_id: id }), [id]);
  const [when, setWhen] = useState('');
  if (a.error) return <ErrorBox text={a.error} />;
  if (!a.data) return <Spinner />;
  const x = a.data;
  const act = async (fn: string, args: Record<string, unknown>, msg: string) => { try { await rpc(fn, args); toast(msg); a.reload(); st.reload(); } catch (e) { toast((e as Error).message, true); } };
  const canPub = me.can_publish;
  return (
    <>
      <button className="crumb" onClick={() => go('/announcements')}><Icon name="back" size={15} />Announcements</button>
      <PageHead title={x.title} sub={<><Pill tone={STATUS[x.status]?.[1] || 'grey'}>{STATUS[x.status]?.[0]}</Pill> {CATS[x.category]?.[0]} · by {x.created_by_handle || '—'}</>} actions={<>
        {['draft', 'scheduled'].includes(x.status) && allows(me.role, 'content') && <Btn icon="note" onClick={() => go(`/announcements/${id}/edit`)}>Edit</Btn>}
        {x.status === 'scheduled' && canPub && <Btn icon="x" onClick={() => act('ann_cancel', { p_id: id }, 'Back to draft.')}>Cancel schedule</Btn>}
        {x.status === 'published' && allows(me.role, 'content') && <Btn icon="lock" onClick={() => act('ann_archive', { p_id: id, p_on: true }, 'Archived.')}>Archive</Btn>}
        {x.status === 'archived' && allows(me.role, 'content') && <Btn icon="unlock" onClick={() => act('ann_archive', { p_id: id, p_on: false }, 'Restored.')}>Restore</Btn>}
        {x.status === 'draft' && allows(me.role, 'content') && <Btn kind="ghost" icon="trash" onClick={() => act('ann_delete_draft', { p_id: id }, 'Draft deleted.').then(() => go('/announcements'))}>Delete draft</Btn>}
      </>} />
      <div className="compose">
        <Card title="Preview">
          <div className="ann-prev">
            {x.cover_url && <img src={x.cover_url} alt="" />}
            <b>{x.title}</b><p className="muted">{x.preview}</p>
            <div className="ann-body">{x.body}</div>
            {x.cta_label && <span className="btn primary sm">{x.cta_label}</span>}
          </div>
        </Card>
        <div className="col">
          {x.status === 'draft' && canPub && (
            <Card title="Publish" sub="Delivery starts within a minute and goes out in batches.">
              <div className="actions"><Btn kind="primary" icon="megaphone" onClick={() => act('ann_publish', { p_id: id }, 'Publishing now.')}>Publish now</Btn></div>
              <Field label="Or schedule for (Lagos time)"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
              <Btn icon="calendar" disabled={!when} onClick={() => act('ann_publish', { p_id: id, p_when: lagosInputToIso(when) }, 'Scheduled.')}>Schedule</Btn>
            </Card>
          )}
          {x.status === 'draft' && !canPub && <Card><p className="muted">Your role can write drafts. Ask an Admin with publishing rights to send it.</p></Card>}
          {st.data && (
            <Card title="Results">
              <div className="stat-grid">
                <div><b>{n(st.data.delivered)}</b><span>Delivered</span></div>
                <div><b>{n(st.data.reads)}</b><span>Read ({st.data.read_rate ?? 0}%)</span></div>
                <div><b>{n(st.data.clicks)}</b><span>Button taps ({st.data.click_rate ?? 0}%)</span></div>
              </div>
              {st.data.by_day?.length > 0 && <Bars height={180} labels={st.data.by_day.map((d) => d.day.slice(5))} series={[{ name: 'Reads', color: '#12b9f5', values: st.data.by_day.map((d) => d.reads) }, { name: 'Taps', color: '#ff3f9b', values: st.data.by_day.map((d) => d.clicks) }]} />}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
