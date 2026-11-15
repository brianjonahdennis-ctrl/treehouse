'use client';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/sb';
import { allows } from '@/lib/roles';
import { GENDERS, STATES } from '@/lib/options';
import { date, dayLabel, isoToLagosInput, lagosInputToIso, n, pct } from '@/lib/fmt';
import { Multi } from './Announcements';
import { Bars, Legend } from './charts';
import { useMe } from './Gate';
import { useGo } from './Shell';
import { ImagePick } from './Upload';
import { Btn, Card, Empty, ErrorBox, Field, PageHead, Pill, Spinner, Tabs, toast, useAsync } from './ui';
import { Icon } from './Icon';

const PLACES: [string, string][] = [['home', 'Home screen'], ['rooms', 'Chatrooms list'], ['discover', 'Discover'], ['inbox', 'Inbox']];
type Ad = { id: string; name: string; advertiser: string; status: 'draft' | 'active' | 'paused' | 'ended'; placements: string[]; title: string; body: string; image_url: string | null;
  cta_label: string; cta_url: string; starts_at: string | null; ends_at: string | null; audience: { states?: string[]; genders?: string[]; min_age?: number; max_age?: number };
  weight: number; created_at: string; views?: number; taps?: number; reach?: number; live?: boolean };
const TONE = { draft: 'grey', active: 'green', paused: 'amber', ended: 'violet' } as const;

export function AdsList() {
  const { me } = useMe();
  const go = useGo();
  const [tab, setTab] = useState('all');
  const ads = useAsync(() => rpc<Ad[]>('staff_ads'), []);
  const list = (ads.data || []).filter((a) => tab === 'all' || (tab === 'live' ? a.live : a.status === tab));
  const t = (ads.data || []).reduce((s, a) => ({ views: s.views + (a.views || 0), taps: s.taps + (a.taps || 0) }), { views: 0, taps: 0 });
  return (
    <>
      <PageHead title="Ads" sub="Sponsored cards inside the app. Counted once per member per day, so numbers are real people." actions={allows(me.role, 'content') && <Btn kind="primary" icon="plus" onClick={() => go('/ads/new')}>New ad</Btn>} />
      {ads.data && (
        <div className="kpis small">
          <div className="kpi"><span className="kpi-l">Live now</span><div className="kpi-v"><b>{ads.data.filter((a) => a.live).length}</b></div></div>
          <div className="kpi"><span className="kpi-l">Views (all time)</span><div className="kpi-v"><b>{n(t.views)}</b></div></div>
          <div className="kpi"><span className="kpi-l">Taps</span><div className="kpi-v"><b>{n(t.taps)}</b></div></div>
          <div className="kpi"><span className="kpi-l">Tap rate</span><div className="kpi-v"><b>{pct(t.taps, t.views)}</b></div></div>
        </div>
      )}
      <div className="toolbar"><Tabs value={tab} onChange={setTab} items={[['all', 'All'], ['live', 'Live'], ['draft', 'Drafts'], ['paused', 'Paused'], ['ended', 'Ended']]} /></div>
      {ads.error && <ErrorBox text={ads.error} retry={ads.reload} />}
      {ads.loading && !ads.data && <Spinner />}
      {ads.data && list.length === 0 && <Card><Empty text="No ads here yet." icon="ad" /></Card>}
      <div className="ad-grid">
        {list.map((a) => (
          <button key={a.id} className="ad-card" onClick={() => go(`/ads/${a.id}`)}>
            {a.image_url ? <img src={a.image_url} alt="" /> : <div className="ad-ph"><Icon name="ad" size={28} /></div>}
            <div className="ad-b">
              <div className="ad-t"><b>{a.name}</b><Pill tone={a.live ? 'green' : TONE[a.status]}>{a.live ? 'Live' : a.status}</Pill></div>
              <p className="muted">{a.advertiser || 'treehouse'} · {a.placements.map((p) => PLACES.find((x) => x[0] === p)?.[1] || p).join(', ')}</p>
              <div className="ad-s"><span><b>{n(a.views)}</b> views</span><span><b>{n(a.taps)}</b> taps</span><span><b>{pct(a.taps || 0, a.views || 0)}</b> rate</span></div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

const blank: Ad = { id: '', name: '', advertiser: '', status: 'draft', placements: ['home'], title: '', body: '', image_url: null, cta_label: 'Learn more', cta_url: 'https://',
  starts_at: null, ends_at: null, audience: {}, weight: 10, created_at: '' };

export function AdEdit({ id }: { id?: string }) {
  const { me } = useMe();
  const go = useGo();
  const [a, setA] = useState<Ad | null>(id ? null : blank);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const stats = useAsync(() => (id ? rpc<{ daily: { day: string; views: number; taps: number }[]; placements: Record<string, { views: number; taps: number }> }>('staff_ad_stats', { p_id: id, p_days: 30 }) : Promise.resolve(null)), [id]);
  useEffect(() => { if (id) rpc<Ad[]>('staff_ads').then((l) => { const x = l.find((y) => y.id === id); if (x) setA(x); else setErr('Ad not found.'); }).catch((e) => setErr(e.message)); }, [id]);
  if (!a) return err ? <ErrorBox text={err} /> : <Spinner />;
  const can = allows(me.role, 'content');
  const set = (p: Partial<Ad>) => setA({ ...a, ...p });
  const aud = (p: Partial<Ad['audience']>) => set({ audience: { ...a.audience, ...p } });
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const nid = await rpc<string>('staff_ad_save', { p: { ...a, id: a.id || null } });
      toast('Ad saved.');
      if (!a.id) go(`/ads/${nid}`); else setBusy(false);
    } catch (e) { setErr((e as Error).message.replace(/.*violates check constraint.*/, 'Check the fields: title, https link and picture.')); setBusy(false); }
  };
  const status = async (s: string) => {
    try { await rpc('staff_ad_status', { p_id: a.id, p_status: s }); toast(s === 'deleted' ? 'Deleted.' : `Ad ${s}.`); if (s === 'deleted') go('/ads'); else set({ status: s as Ad['status'] }); } catch (e) { toast((e as Error).message, true); }
  };
  return (
    <>
      <button className="crumb" onClick={() => go('/ads')}><Icon name="back" size={15} />Ads</button>
      <PageHead title={a.id ? a.name : 'New ad'} sub={a.id ? <><Pill tone={TONE[a.status]}>{a.status}</Pill> created {date(a.created_at)}</> : 'Fill it in, save, then start it.'} actions={a.id && can && <>
        {a.status !== 'active' && a.status !== 'ended' && <Btn kind="primary" icon="pulse" onClick={() => status('active')}>Start</Btn>}
        {a.status === 'active' && <Btn icon="clock" onClick={() => status('paused')}>Pause</Btn>}
        {a.status !== 'ended' && a.status !== 'draft' && <Btn kind="ghost" icon="x" onClick={() => status('ended')}>End</Btn>}
        {a.status === 'draft' && <Btn kind="ghost" icon="trash" onClick={() => status('deleted')}>Delete</Btn>}
      </>} />
      <div className="compose">
        <Card title="The ad">
          <div className="two">
            <Field label="Name (staff only)"><input value={a.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} disabled={!can} /></Field>
            <Field label="Advertiser"><input value={a.advertiser} maxLength={80} onChange={(e) => set({ advertiser: e.target.value })} disabled={!can} /></Field>
          </div>
          <Field label="Headline" hint={`${a.title.length}/60`}><input value={a.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} disabled={!can} /></Field>
          <Field label="Text" hint={`${a.body.length}/140`}><textarea rows={2} value={a.body} maxLength={140} onChange={(e) => set({ body: e.target.value })} disabled={!can} /></Field>
          <Field label="Picture"><ImagePick folder="ads" value={a.image_url || ''} onChange={(u) => set({ image_url: u || null })} /></Field>
          <div className="two">
            <Field label="Button"><input value={a.cta_label} maxLength={24} onChange={(e) => set({ cta_label: e.target.value })} disabled={!can} /></Field>
            <Field label="Opens (https only)"><input value={a.cta_url} onChange={(e) => set({ cta_url: e.target.value })} disabled={!can} /></Field>
          </div>
          <Field label="Where it shows"><Multi options={PLACES} value={a.placements} onChange={(v) => set({ placements: v.length ? v : a.placements })} /></Field>
        </Card>
        <div className="col">
          <Card title="Preview" sub="How members see it">
            <div className="ad-preview">
              <span className="sponsored">Sponsored{a.advertiser ? ` · ${a.advertiser}` : ''}</span>
              {a.image_url && <img src={a.image_url} alt="" />}
              <b>{a.title || 'Your headline'}</b>
              {a.body && <p>{a.body}</p>}
              <span className="btn primary sm">{a.cta_label || 'Learn more'}</span>
            </div>
          </Card>
          <Card title="Who sees it" sub="Leave empty to show to everyone 18+.">
            <Field label="States"><Multi options={STATES.map((s) => [s, s])} value={a.audience.states || []} onChange={(v) => aud({ states: v })} /></Field>
            <Field label="Gender"><Multi options={GENDERS} value={a.audience.genders || []} onChange={(v) => aud({ genders: v })} /></Field>
            <div className="two">
              <Field label="Min age"><input type="number" min={18} max={99} value={a.audience.min_age ?? ''} onChange={(e) => aud({ min_age: e.target.value ? Number(e.target.value) : undefined })} /></Field>
              <Field label="Max age"><input type="number" min={18} max={99} value={a.audience.max_age ?? ''} onChange={(e) => aud({ max_age: e.target.value ? Number(e.target.value) : undefined })} /></Field>
            </div>
            <div className="two">
              <Field label="Starts (Lagos time)"><input type="datetime-local" value={isoToLagosInput(a.starts_at)} onChange={(e) => set({ starts_at: lagosInputToIso(e.target.value) })} /></Field>
              <Field label="Ends"><input type="datetime-local" value={isoToLagosInput(a.ends_at)} onChange={(e) => set({ ends_at: lagosInputToIso(e.target.value) })} /></Field>
            </div>
            <Field label="Share of slots" hint="When several ads fit, higher numbers show more often (1–100)."><input type="number" min={1} max={100} value={a.weight} onChange={(e) => set({ weight: Number(e.target.value) })} /></Field>
            {err && <ErrorBox text={err} />}
            {can && <div className="actions"><Btn kind="primary" icon="check" disabled={busy || !a.name || !a.title} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn></div>}
          </Card>
        </div>
      </div>
      {stats.data && (
        <Card title="Last 30 days" sub={Object.entries(stats.data.placements).map(([k, v]) => `${PLACES.find((x) => x[0] === k)?.[1] || k}: ${n(v.views)} views, ${n(v.taps)} taps`).join(' · ') || 'No results yet.'}>
          <Legend series={[{ name: 'Views', color: '#12b9f5' }, { name: 'Taps', color: '#ff3f9b' }]} />
          <Bars height={200} labels={stats.data.daily.map((d) => dayLabel(d.day))} series={[{ name: 'Views', color: '#12b9f5', values: stats.data.daily.map((d) => d.views) }, { name: 'Taps', color: '#ff3f9b', values: stats.data.daily.map((d) => d.taps) }]} />
        </Card>
      )}
    </>
  );
}
