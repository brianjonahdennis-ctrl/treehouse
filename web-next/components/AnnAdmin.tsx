'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// treehouse.ng/home/admin/announcements: the staff dashboard for Product Announcements.
// Only people in announcement_staff see it, and the database checks the role on every action
// (Super Admin, Admin, Editor, Analyst). All numbers come from real records, as counts only.
//   /home/admin/announcements              overview + list
//   /home/admin/announcements/new          composer
//   /home/admin/announcements/<id>         preview, analytics, actions, history
//   /home/admin/announcements/<id>/edit    composer for a draft or scheduled one
//   /home/admin/announcements/staff        staff and roles (Super Admin)
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as api from '@/lib/api';
import { go } from '@/lib/nav';
import { STATES, stateLabel } from '@/lib/options';
import { CATS, CAT_IDS, ROUTES, CTA_PRESETS, safeLink, safeImage, annDate, lagosInputToIso, isoToLagosInput, fmtN, type Ann } from '@/lib/announcements';
import { Icon, EmptyState, SkeletonList } from './ui';
import { toast, confirmSheet } from './overlay';
import { AnnView, CatTag } from './Announcements';

type Me = { role: string; can_publish: boolean };
const ROLE_LABEL: Record<string, string> = { super_admin: 'Super Admin', admin: 'Admin', editor: 'Editor', analyst: 'Analyst' };
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', scheduled: 'Scheduled', publishing: 'Delivering…', published: 'Published', archived: 'Archived' };
const BASES: [string, string, string][] = [
  ['active', 'All active users', 'Used treehouse in the last 30 days'],
  ['all', 'All registered users', 'Everyone with a treehouse profile'],
  ['new', 'Newly registered users', 'Joined in the last N days'],
  ['recent', 'Recently active users', 'Used treehouse in the last N days'],
  ['inactive', 'Inactive users', 'Haven’t used treehouse for N days (re-engagement)'],
];
const PLATFORMS: [string, string][] = [['android-play', 'Android (Google Play)'], ['android-apk', 'Android (APK)'], ['android-app', 'Android (older app)'], ['ios-app', 'iPhone app'], ['web', 'Web browser']];
const Base = Object.fromEntries(BASES.map(([id, label]) => [id, label]));
export function audienceText(a: any) {
  if (!a) return '—';
  const days = a.days ? ` (${a.days} days)` : '';
  const parts = [`${Base[a.base] || 'All active users'}${['new', 'recent', 'inactive'].includes(a.base) ? days : ''}`];
  if (a.states && a.states.length) parts.push(a.states.length <= 2 ? a.states.map(stateLabel).join(', ') : `${a.states.length} states`);
  if (a.platforms && a.platforms.length) parts.push(a.platforms.map((p: string) => (PLATFORMS.find((x) => x[0] === p) || [p, p])[1]).join(', '));
  return parts.join(' · ');
}
const rate = (r: number, d: number) => (d ? `${(Math.round((r * 1000) / d) / 10).toFixed(1)}%` : '—');
const when = (iso?: string | null) => (iso ? annDate(iso, true) : '—');
const shortWhen = (iso?: string | null, time = true) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}), timeZone: 'Africa/Lagos' }) : '—');

export default function AnnAdmin({ sub }: { sub: string[] }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { api.annMe().then(setMe).catch(() => setMe(null)); }, []);
  if (me === undefined) return <SkeletonList n={4} />;
  if (!me) return <EmptyState emoji="🔒" title="Staff only" text="This page is for treehouse staff. If you should have access, ask the Super Admin to add your handle." >
    <button className="btn btn-primary" onClick={() => go('home')}>Back to treehouse</button></EmptyState>;
  const [a, b] = sub;
  if (a === 'staff') return <Staff me={me} />;
  if (a === 'new') return <Composer me={me} id={null} />;
  if (a && b === 'edit') return <Composer me={me} id={a} key={a} />;
  if (a) return <Detail me={me} id={a} key={a} />;
  return <Dashboard me={me} />;
}

function Head({ title, children, back }: { title: string; children?: ReactNode; back?: string }) {
  return (
    <div className="adm-head">
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        {back != null ? <button className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => go(back)}><Icon name="back" /></button> : null}
        <h1>{title}</h1>
      </div>
      <div className="adm-actions">{children}</div>
    </div>
  );
}

// ---- Overview + list ---------------------------------------------------------------------------------------
let listState = { status: 'all', category: '', query: '', page: 0 };
function Dashboard({ me }: { me: Me }) {
  const [ov, setOv] = useState<any>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [f, setF] = useState(listState);
  const [err, setErr] = useState('');
  useEffect(() => { api.annOverview().then(setOv).catch((e) => setErr(api.friendly(e))); }, []);
  useEffect(() => {
    listState = f;
    setRows(null);
    const t = setTimeout(() => {
      api.annList({ status: f.status, category: f.category || null, query: f.query || null, offset: f.page * 20, limit: 20 })
        .then(setRows).catch((e) => { setRows([]); setErr(api.friendly(e)); });
    }, f.query ? 300 : 0);
    return () => clearTimeout(t);
  }, [f]);
  const total = rows && rows.length ? Number(rows[0].total) : 0;
  const stat = (icon: string, n: ReactNode, label: string) => <div className="adm-stat"><Icon name={icon} /><div><b>{n}</b><span>{label}</span></div></div>;
  const chip = (id: string, label: string, n?: number) => <button className={`chip ${f.status === id ? 'on' : ''}`} onClick={() => setF({ ...f, status: id, page: 0 })}>{label}{n != null ? ` · ${n}` : ''}</button>;
  return (
    <div className="adm">
      <Head title="Product Announcements">
        {me.role === 'super_admin' ? <button className="btn btn-ghost btn-sm" onClick={() => go('admin/announcements/staff')}><Icon name="userplus" cls="sm" />Staff</button> : null}
        {me.role !== 'analyst' ? <button className="btn btn-coral" onClick={() => go('admin/announcements/new')}><Icon name="plus" cls="sm" />Create Announcement</button> : null}
      </Head>
      <p className="small muted">{`You’re signed in as ${ROLE_LABEL[me.role]}${me.can_publish ? ' · can publish' : me.role === 'analyst' ? ' · view only' : ' · drafts only'}. Counts update every minute.`}</p>
      {err ? <div className="adm-note">{err}</div> : null}
      <div className="adm-stats">
        {stat('megaphone', fmtN(ov?.total), 'Total announcements')}
        {stat('rooms', fmtN(ov?.recipients), 'Total recipients')}
        {stat('mail', fmtN(ov?.delivered), 'Total delivered')}
        {stat('eye', fmtN(ov?.reads), 'Total reads')}
        {stat('chart', ov ? `${ov.read_rate}%` : '—', 'Read rate')}
        {stat('cursor', fmtN(ov?.clicks), 'CTA clicks')}
        {stat('clock', fmtN(ov?.scheduled), 'Scheduled')}
        {stat('edit', fmtN(ov?.drafts), 'Drafts')}
      </div>
      <div className="adm-filters">
        <div className="chips">{chip('all', 'All')}{chip('published', 'Published', ov?.published)}{chip('scheduled', 'Scheduled', ov?.scheduled)}{chip('draft', 'Drafts', ov?.drafts)}{chip('archived', 'Archived', ov?.archived)}</div>
        <select aria-label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, page: 0 })}>
          <option value="">All categories</option>{CAT_IDS.map((c) => <option key={c} value={c}>{CATS[c].label}</option>)}
        </select>
        <input type="search" placeholder="Search titles" aria-label="Search titles" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value, page: 0 })} />
      </div>
      {!rows ? <SkeletonList n={4} /> : !rows.length ? <div className="card ib-empty"><p>No announcements here yet.</p></div> : (
        <>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Title</th><th>Category</th><th>Audience</th><th>Status</th><th>Created</th><th>Published / scheduled</th><th>Recipients</th><th>Delivery</th><th>Reads</th><th>Read rate</th><th>CTA clicks</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} onClick={() => go(`admin/announcements/${r.id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') go(`admin/announcements/${r.id}`); }}>
                  <td><span className="adm-title-cell"><Thumb r={r} />{r.title}</span></td>
                  <td><CatTag cat={r.category} /></td>
                  <td className="adm-aud">{audienceText(r.audience)}</td>
                  <td><span className={`adm-status s-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                  <td>{shortWhen(r.created_at, false)}</td>
                  <td>{r.published_at ? shortWhen(r.published_at) : r.scheduled_for ? shortWhen(r.scheduled_for) : '—'}</td>
                  <td>{fmtN(r.eligible_count)}</td>
                  <td>{r.status === 'publishing' ? `${fmtN(r.delivered_count)} of ${fmtN(r.eligible_count)}` : r.delivered_at ? 'Complete' : '—'}</td>
                  <td>{r.published_at ? fmtN(r.read_count) : '—'}</td>
                  <td>{r.published_at ? rate(r.read_count, r.delivered_count) : '—'}</td>
                  <td>{r.published_at && r.click_count != null ? fmtN(r.click_count) : '—'}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="adm-cards">{rows.map((r) => (
            <button key={r.id} className="adm-card" onClick={() => go(`admin/announcements/${r.id}`)}>
              <span className="adm-title-cell"><Thumb r={r} />{r.title}</span>
              <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}><CatTag cat={r.category} /><span className={`adm-status s-${r.status}`}>{STATUS_LABEL[r.status]}</span></span>
              <span className="small muted">{audienceText(r.audience)}</span>
              <span className="adm-nums"><span>{r.published_at ? when(r.published_at) : r.scheduled_for ? `Scheduled ${when(r.scheduled_for)}` : `Created ${annDate(r.created_at)}`}</span>
                {r.published_at ? <><span>{`${fmtN(r.delivered_count)} delivered`}</span><span>{`${rate(r.read_count, r.delivered_count)} read`}</span><span>{`${fmtN(r.click_count)} clicks`}</span></> : null}</span>
            </button>))}</div>
          <div className="row-between">
            <span className="small muted">{`${f.page * 20 + 1}–${f.page * 20 + rows.length} of ${total}`}</span>
            <div className="adm-actions">
              <button className="btn btn-ghost btn-sm" disabled={f.page === 0} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button>
              <button className="btn btn-ghost btn-sm" disabled={(f.page + 1) * 20 >= total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
function Thumb({ r }: { r: any }) {
  const c = CATS[r.category] || CATS.product_update;
  const img = safeImage(r.cover_url);
  // eslint-disable-next-line @next/next/no-img-element
  return <span className={`ann-thumb tone-${c.tone}`}>{img ? <img src={img} alt="" loading="lazy" /> : <Icon name={c.icon} />}</span>;
}

// ---- Composer: Content → Audience → Schedule --------------------------------------------------------------
type Draft = { title: string; preview: string; body: string; category: string; cover_url: string; cta_label: string; cta_url: string;
  audience: { base: string; days?: number; states?: string[]; platforms?: string[] }; send_push: boolean; expires_at: string; revises?: string | null };
const EMPTY: Draft = { title: '', preview: '', body: '', category: '', cover_url: '', cta_label: '', cta_url: '', audience: { base: 'active' }, send_push: true, expires_at: '' };

function Composer({ me, id }: { me: Me; id: string | null }) {
  const [d, setD] = useState<Draft | null>(id ? null : { ...EMPTY });
  const [savedId, setSavedId] = useState<string | null>(id);
  const [status, setStatus] = useState('draft');
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  useEffect(() => {
    if (!id) return;
    api.annGet(id).then((a: any) => {
      if (!['draft', 'scheduled'].includes(a.status)) { toast('Published announcements can’t be edited. Send a correction instead.', 'info'); go(`admin/announcements/${id}`, { replace: true }); return; }
      setStatus(a.status);
      setScheduledFor(isoToLagosInput(a.scheduled_for));
      setD({ title: a.title, preview: a.preview, body: a.body || '', category: a.category, cover_url: a.cover_url || '', cta_label: a.cta_label || '', cta_url: a.cta_url || '',
        audience: a.audience || { base: 'active' }, send_push: a.send_push, expires_at: isoToLagosInput(a.expires_at), revises: a.revises });
    }).catch((e) => setErr(api.friendly(e)));
  }, [id]);
  if (!d) return err ? <div className="adm-note">{err}</div> : <SkeletonList n={4} />;
  if (me.role === 'analyst') return <EmptyState emoji="🔒" title="View only" text="Analysts can see analytics but can’t create announcements." />;
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const fields = () => ({ ...d, expires_at: d.expires_at ? lagosInputToIso(d.expires_at) : '' });
  const problems = (): string[] => {
    const p: string[] = [];
    if (!d.title.trim()) p.push('Add a title.');
    if (!d.category) p.push('Choose a category.');
    if (!d.preview.trim()) p.push('Add preview text.');
    if ((d.cta_label.trim() === '') !== (d.cta_url.trim() === '')) p.push('A button needs both a label and a destination.');
    if (d.cta_url.trim() && !safeLink(d.cta_url)) p.push('The button must open a treehouse page or an https:// link.');
    if (d.cover_url && !safeImage(d.cover_url)) p.push('Upload the cover image here (images from other websites can’t be shown).');
    return p;
  };
  const save = async (quiet = false): Promise<string | null> => {
    const p = problems();
    if (p.length) { setErr(p.join(' ')); return null; }
    setBusy(true); setErr('');
    try {
      const newId = await api.annSave(savedId, fields());
      setSavedId(newId);
      if (!quiet) toast('Draft saved');
      return newId;
    } catch (e) { setErr(api.friendly(e)); return null; }
    finally { setBusy(false); }
  };
  const stepBtn = (n: number, label: string) => <button className="adm-step" aria-current={step === n ? 'step' : undefined} onClick={() => setStep(n)}><i>{n}</i>{label}</button>;
  return (
    <div className="adm">
      <Head title={id ? 'Edit Announcement' : 'Create Announcement'} back={savedId ? `admin/announcements/${savedId}` : 'admin/announcements'}>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save()}><Icon name="check" cls="sm" />Save draft</button>
      </Head>
      {d.revises ? <div className="adm-note">This is a correction of an earlier announcement. The original and its delivery records stay unchanged.</div> : null}
      {status === 'scheduled' ? <div className="adm-note">This announcement is scheduled. Changes you save apply when it goes out.</div> : null}
      <div className="adm-steps">{stepBtn(1, 'Content')}{stepBtn(2, 'Audience')}{stepBtn(3, 'Schedule')}</div>
      <div className="adm-grid">
        <div className="card stack-lg">
          {step === 1 ? <ContentStep d={d} set={set} /> : step === 2 ? <AudienceStep d={d} set={set} /> : (
            <ScheduleStep me={me} d={d} set={set} busy={busy} status={status} scheduledFor={scheduledFor} setScheduledFor={setScheduledFor}
              publish={async (whenIso) => {
                const sid = await save(true);
                if (!sid) return;
                let n: number | null = null;
                try { n = await api.annEstimate(d.audience); } catch { /* shown as unknown */ }
                const ok = await confirmSheet({
                  title: whenIso ? 'Schedule this announcement?' : 'Publish now?',
                  text: `“${d.title}” goes to ${n == null ? 'the selected audience' : `${fmtN(n)} ${n === 1 ? 'person' : 'people'}`} (${audienceText(d.audience)})${whenIso ? ` on ${annDate(whenIso, true)} (Lagos time)` : ' now'}.${d.send_push ? ' People who allow notifications also get a push.' : ' No push notification.'} Once it’s delivered it can’t be edited; corrections go out as a new announcement.`,
                  yes: whenIso ? 'Schedule' : 'Publish now',
                });
                if (!ok) return;
                setBusy(true); setErr('');
                try {
                  const r = await api.annPublish(sid, whenIso);
                  toast(r.status === 'scheduled' ? 'Scheduled' : `Publishing to ${fmtN(r.eligible)} people`, 'send');
                  go(`admin/announcements/${sid}`, { replace: true });
                } catch (e) { setErr(api.friendly(e)); }
                finally { setBusy(false); }
              }} />
          )}
          {err ? <div className="adm-note" role="alert">{err}</div> : null}
          <div className="row-between">
            <button className="btn btn-ghost" disabled={step === 1} onClick={() => setStep(step - 1)}><Icon name="back" cls="sm" />Back</button>
            {step < 3 ? <button className="btn btn-coral" onClick={() => { if (step === 1 && problems().length) { setErr(problems().join(' ')); return; } setErr(''); setStep(step + 1); }}>
              {step === 1 ? 'Next: Select Audience' : 'Next: Schedule'}<Icon name="chev" cls="sm" /></button> : null}
          </div>
        </div>
        <div className="adm-preview-col"><Preview d={d} /></div>
      </div>
    </div>
  );
}

function Count({ v, max }: { v: string; max: number }) { return <small className={v.length > max ? 'over' : ''}>{`${v.length}/${max}`}</small>; }

function ContentStep({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [uploading, setUploading] = useState(false);
  const insert = (before: string, after = '', placeholder = '') => {
    const el = ta.current; if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd, sel = d.body.slice(s, e) || placeholder;
    const body = d.body.slice(0, s) + before + sel + after + d.body.slice(e);
    set({ body });
    requestAnimationFrame(() => { el.focus(); el.selectionStart = s + before.length; el.selectionEnd = s + before.length + sel.length; });
  };
  const line = (prefix: string, placeholder: string) => {
    const el = ta.current; const s = el ? el.selectionStart : d.body.length;
    const atStart = s === 0 || d.body[s - 1] === '\n';
    insert(`${atStart ? '' : '\n'}${prefix}`, '', placeholder);
  };
  const upload = async (file: File | undefined, cover: boolean) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await api.annUploadImage(file);
      if (cover) set({ cover_url: url }); else line(`![${file.name.replace(/\.[^.]+$/, '').slice(0, 60)}](${url})\n`, '');
      toast('Image uploaded', 'image');
    } catch (e) { toast(api.friendly(e), 'x'); }
    finally { setUploading(false); }
  };
  const custom = d.cta_url && !ROUTES.some(([r]) => r === d.cta_url);
  return (
    <>
      <h2>Announcement details</h2>
      <label className="adm-field"><span>Title *<Count v={d.title} max={100} /></span>
        <input value={d.title} maxLength={100} onChange={(e) => set({ title: e.target.value })} placeholder="Introducing Nearby!" /></label>
      <label className="adm-field"><span>Category *</span>
        <select value={d.category} onChange={(e) => set({ category: e.target.value })}>
          <option value="" disabled>Choose a category</option>{CAT_IDS.map((c) => <option key={c} value={c}>{CATS[c].label}</option>)}
        </select>
        {d.category === 'maintenance' || d.category === 'important' ? <small>Essential notice: it reaches people even if they turned off treehouse update notifications.</small> : null}
      </label>
      <label className="adm-field"><span>Preview text *<Count v={d.preview} max={160} /></span>
        <textarea style={{ minHeight: 70, fontFamily: 'var(--font)' }} value={d.preview} maxLength={160} onChange={(e) => set({ preview: e.target.value })} placeholder="Discover interesting people around you and connect in your area." /></label>
      <div className="adm-field"><span>Content<Count v={d.body} max={20000} /></span>
        <div className="adm-toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" onClick={() => line('## ', 'Heading')} title="Heading"><Icon name="heading" cls="sm" />Heading</button>
          <button type="button" onClick={() => insert('**', '**', 'bold text')} title="Bold"><Icon name="bold" cls="sm" />Bold</button>
          <button type="button" onClick={() => line('- ', 'List item')} title="Bulleted list"><Icon name="list" cls="sm" />List</button>
          <button type="button" onClick={() => insert('[', '](https://)', 'link text')} title="Link"><Icon name="link" cls="sm" />Link</button>
          <label className="adm-tool" aria-disabled={uploading}><Icon name="image" cls="sm" />Image
            <input hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => upload(e.target.files?.[0], false)} /></label>
          <button type="button" onClick={() => line('[[', 'Button label](/home)]')} title="Extra button"><Icon name="plus" cls="sm" />Button</button>
        </div>
        <textarea ref={ta} value={d.body} maxLength={20000} onChange={(e) => set({ body: e.target.value })}
          placeholder={'We’re excited to launch Nearby on Treehouse! 🎉\n\nWith Nearby, you can:\n- See active users around you\n- Filter by your preferences\n- Start meaningful conversations'} />
        <small>Safe format: “## ” heading, “- ” list, **bold**, [text](link). Links must be treehouse pages or https://. No HTML or scripts.</small>
      </div>
      <div className="adm-field"><span>Cover image</span>
        <div className="adm-cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {safeImage(d.cover_url) ? <img src={d.cover_url} alt="Cover preview" /> : null}
          <label className="btn btn-soft btn-sm"><Icon name="image" cls="sm" />{uploading ? 'Uploading…' : d.cover_url ? 'Replace' : 'Upload cover'}
            <input hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(e.target.files?.[0], true)} /></label>
          {d.cover_url ? <button className="btn btn-ghost btn-sm" onClick={() => set({ cover_url: '' })}>Remove</button> : null}
          <small className="muted">JPEG, PNG or WebP, up to 2 MB. Wide (16:9) looks best.</small>
        </div>
      </div>
      <h2>Call-to-action button <small className="muted">(optional)</small></h2>
      <div className="adm-row2">
        <label className="adm-field"><span>Button label</span>
          <input list="ann-cta-presets" value={d.cta_label} maxLength={30} onChange={(e) => set({ cta_label: e.target.value })} placeholder="Explore Nearby" />
          <datalist id="ann-cta-presets">{CTA_PRESETS.map((p) => <option key={p} value={p} />)}</datalist></label>
        <label className="adm-field"><span>Opens</span>
          <select value={custom ? 'custom' : d.cta_url} onChange={(e) => set({ cta_url: e.target.value === 'custom' ? 'https://' : e.target.value })}>
            <option value="">No button</option>
            {ROUTES.map(([r, label]) => <option key={r} value={r}>{`${label} (${r})`}</option>)}
            <option value="custom">Another website (https://)</option>
          </select></label>
      </div>
      {custom ? <label className="adm-field"><span>Website address</span><input value={d.cta_url} onChange={(e) => set({ cta_url: e.target.value })} placeholder="https://…" />
        {!safeLink(d.cta_url) ? <small className="over">Must be a full https:// address.</small> : null}</label> : null}
    </>
  );
}

function AudienceStep({ d, set }: { d: Draft; set: (p: Partial<Draft>) => void }) {
  const a = d.audience;
  const setA = (patch: any) => set({ audience: Object.fromEntries(Object.entries({ ...a, ...patch }).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))) as any });
  const [n, setN] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [stErr, setStErr] = useState('');
  const key = JSON.stringify(a);
  useEffect(() => {
    let live = true; setCounting(true); setStErr('');
    const t = setTimeout(() => {
      api.annEstimate(a).then((x) => { if (live) setN(x); }).catch((e) => { if (live) { setN(null); setStErr(api.friendly(e)); } }).finally(() => { if (live) setCounting(false); });
    }, 600);
    return () => { live = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsDays = ['new', 'recent', 'inactive'].includes(a.base);
  const states = a.states || [], plats = a.platforms || [];
  return (
    <>
      <h2>Who gets it</h2>
      <div className="adm-radio" role="radiogroup" aria-label="Audience">
        {BASES.map(([id, label, sub]) => (
          <label key={id}><input type="radio" name="ann-base" checked={a.base === id} onChange={() => setA({ base: id, days: ['new', 'recent', 'inactive'].includes(id) ? (a.days || (id === 'new' ? 7 : 30)) : null })} />
            <span className="grow">{label}<span className="tiny muted" style={{ display: 'block' }}>{sub}</span></span></label>
        ))}
      </div>
      {needsDays ? <label className="adm-field"><span>Number of days</span>
        <input type="number" min={1} max={365} value={a.days || ''} onChange={(e) => setA({ days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} /></label> : null}
      <div className="adm-field"><span>Nigerian states <small>{states.length ? `${states.length} selected` : 'All states'}</small></span>
        <div className="chips">{STATES.map((st) => <button type="button" key={st} className={`chip ${states.includes(st) ? 'on' : ''}`} aria-pressed={states.includes(st)}
          onClick={() => setA({ states: states.includes(st) ? states.filter((x) => x !== st) : [...states, st] })}>{stateLabel(st)}</button>)}</div>
        {states.length ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setA({ states: null })}>Clear states</button> : null}
      </div>
      <div className="adm-field"><span>Country</span><small>Nigeria. treehouse accounts don’t store another country, so every audience is in Nigeria.</small></div>
      <div className="adm-field"><span>Platform <small>{plats.length ? 'Used in the last 30 days' : 'Any'}</small></span>
        <div className="chips">{PLATFORMS.map(([id, label]) => <button type="button" key={id} className={`chip ${plats.includes(id) ? 'on' : ''}`} aria-pressed={plats.includes(id)}
          onClick={() => setA({ platforms: plats.includes(id) ? plats.filter((x) => x !== id) : [...plats, id] })}>{label}</button>)}</div>
      </div>
      <label className="settings-row" style={{ padding: '6px 0' }}><Icon name="bell" />
        <span className="grow">Also send a push notification<span className="sub">{`“Treehouse Update 🎉” to people who allow notifications${d.category === 'maintenance' || d.category === 'important' ? '' : ' and haven’t turned off treehouse updates'}. The Inbox copy is always delivered.`}</span></span>
        <input type="checkbox" role="switch" checked={d.send_push} onChange={(e) => set({ send_push: e.target.checked })} /></label>
      <div className="adm-estimate" aria-live="polite"><Icon name="rooms" />
        <div><b>{counting && n == null ? '…' : n == null ? '—' : fmtN(n)}</b><div className="small muted">{`Estimated recipients right now${counting ? ' (counting…)' : ''}: ${audienceText(a)}. Suspended and under-18 accounts are always left out.`}</div></div></div>
      {stErr ? <div className="adm-note">{stErr}</div> : null}
    </>
  );
}

function ScheduleStep({ me, d, set, busy, status, scheduledFor, setScheduledFor, publish }: { me: Me; d: Draft; set: (p: Partial<Draft>) => void; busy: boolean; status: string;
  scheduledFor: string; setScheduledFor: (v: string) => void; publish: (whenIso: string | null) => void }) {
  const [mode, setMode] = useState<'now' | 'later'>(scheduledFor ? 'later' : 'now');
  const iso = lagosInputToIso(scheduledFor);
  const tooSoon = mode === 'later' && (!iso || new Date(iso).getTime() < Date.now() + 2 * 60000);
  return (
    <>
      <h2>When it goes out</h2>
      <div className="adm-radio" role="radiogroup" aria-label="Publishing">
        <label><input type="radio" name="ann-when" checked={mode === 'now'} onChange={() => setMode('now')} /><span className="grow">Publish immediately<span className="tiny muted" style={{ display: 'block' }}>Delivery starts at once, in batches of 5,000 a minute for big audiences.</span></span></label>
        <label><input type="radio" name="ann-when" checked={mode === 'later'} onChange={() => setMode('later')} /><span className="grow">Schedule for later<span className="tiny muted" style={{ display: 'block' }}>Goes out within a minute of the time you pick (Lagos time).</span></span></label>
      </div>
      {mode === 'later' ? <label className="adm-field"><span>Date and time (Lagos time, WAT)</span>
        <input type="datetime-local" value={scheduledFor} min={isoToLagosInput(new Date().toISOString())} onChange={(e) => setScheduledFor(e.target.value)} />
        {scheduledFor && tooSoon ? <small className="over">Pick a time at least 2 minutes from now.</small> : null}</label> : null}
      <label className="adm-field"><span>Stop showing it after <small>(optional)</small></span>
        <input type="datetime-local" value={d.expires_at} onChange={(e) => set({ expires_at: e.target.value })} />
        <small>Useful for events and maintenance. After this, members no longer see it; the delivery records stay.</small></label>
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <p className="small"><b>Final check</b></p>
        <p className="small muted">{`${d.title || 'Untitled'} · ${CATS[d.category]?.label || 'No category'} · ${audienceText(d.audience)} · ${d.send_push ? 'push on' : 'no push'}${d.cta_label ? ` · button “${d.cta_label}”` : ''}`}</p>
      </div>
      {me.can_publish ? (
        <div className="adm-actions">
          <button className="btn btn-coral btn-lg" disabled={busy || tooSoon} onClick={() => publish(mode === 'later' ? iso : null)}>
            <Icon name={mode === 'later' ? 'clock' : 'send'} cls="sm" />{mode === 'later' ? (status === 'scheduled' ? 'Update schedule' : 'Schedule') : 'Review and publish'}</button>
        </div>
      ) : <div className="adm-note">Your role can save drafts but not publish. Save the draft and ask an Admin or the Super Admin to publish it.</div>}
    </>
  );
}

function Preview({ d }: { d: Draft }) {
  const [mode, setMode] = useState<'phone' | 'desktop'>('phone');
  const a: Ann = { id: 'preview', title: d.title || 'Your title', preview: d.preview || 'Your preview text', body: d.body, category: d.category || 'product_update',
    cover_url: safeImage(d.cover_url), cta_label: d.cta_label || null, cta_url: safeLink(d.cta_url) ? d.cta_url : null, published_at: new Date().toISOString(), read_at: null, archived_at: null };
  return (
    <div>
      <div className="adm-preview-switch">
        <button className={`chip ${mode === 'phone' ? 'on' : ''}`} onClick={() => setMode('phone')}>Mobile</button>
        <button className={`chip ${mode === 'desktop' ? 'on' : ''}`} onClick={() => setMode('desktop')}>Desktop</button>
        <span className="small muted" style={{ alignSelf: 'center' }}>Preview</span>
      </div>
      <div className={mode === 'phone' ? 'adm-phone' : 'adm-desktop'}><AnnView a={a} preview /></div>
    </div>
  );
}

// ---- One announcement: preview, analytics, actions, history ----------------------------------------------------
function Detail({ me, id }: { me: Me; id: string }) {
  const [a, setA] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  const [log, setLog] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => {
    api.annGet(id).then(setA).catch((e) => setErr(api.friendly(e)));
    api.annAnalytics(id).then(setSt).catch(() => {});
    api.annAudit(id, 30).then(setLog).catch(() => {});
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <EmptyState emoji="📭" title="Not found" text={err}><button className="btn btn-primary" onClick={() => go('admin/announcements')}>Back</button></EmptyState>;
  if (!a) return <SkeletonList n={4} />;
  const canEdit = me.role !== 'analyst';
  const act = async (fn: () => Promise<any>, done: string, after?: (r: any) => void) => {
    setBusy(true);
    try { const r = await fn(); toast(done); if (after) after(r); else load(); } catch (e) { toast(api.friendly(e), 'x'); }
    finally { setBusy(false); }
  };
  const stat = (label: string, v: ReactNode) => <div className="adm-stat"><div><b>{v}</b><span>{label}</span></div></div>;
  const days: any[] = st?.by_day || [];
  const maxDay = Math.max(1, ...days.map((x) => x.reads));
  return (
    <div className="adm">
      <Head title={a.title} back="admin/announcements">
        <span className={`adm-status s-${a.status}`}>{STATUS_LABEL[a.status]}</span>
      </Head>
      <div className="adm-actions">
        {canEdit && ['draft', 'scheduled'].includes(a.status) ? <button className="btn btn-primary btn-sm" onClick={() => go(`admin/announcements/${id}/edit`)}><Icon name="edit" cls="sm" />{me.can_publish ? 'Edit, schedule or publish' : 'Edit draft'}</button> : null}
        {me.can_publish && a.status === 'scheduled' ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
          if (await confirmSheet({ title: 'Cancel the schedule?', text: 'It won’t go out. It moves back to Drafts so you can edit or reschedule it.', yes: 'Cancel schedule', danger: true })) act(() => api.annCancel(id), 'Schedule cancelled');
        }}><Icon name="x" cls="sm" />Cancel schedule</button> : null}
        {canEdit && a.was_published ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.annCorrection(id), 'Correction draft created', (nid) => go(`admin/announcements/${nid}/edit`))}><Icon name="rewind" cls="sm" />Send a correction</button> : null}
        {canEdit && ['draft', 'published'].includes(a.status) ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.annArchive(id, true), 'Archived')}><Icon name="archive" cls="sm" />Archive</button> : null}
        {canEdit && a.status === 'archived' ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => api.annArchive(id, false), 'Restored')}><Icon name="archive" cls="sm" />Unarchive</button> : null}
        {canEdit && a.status === 'draft' && !a.was_published ? <button className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => {
          if (await confirmSheet({ title: 'Delete this draft?', text: 'It was never published, so no one has seen it. This can’t be undone.', yes: 'Delete draft', danger: true })) act(() => api.annDeleteDraft(id), 'Draft deleted', () => go('admin/announcements', { replace: true }));
        }}><Icon name="trash" cls="sm" />Delete draft</button> : null}
      </div>
      {a.revises ? <button className="ann-note" onClick={() => go(`admin/announcements/${a.revises}`)}><Icon name="info" cls="sm" />Correction of an earlier announcement. Open the original.</button> : null}
      {a.revised_by ? <button className="ann-note" onClick={() => go(`admin/announcements/${a.revised_by}`)}><Icon name="info" cls="sm" />A correction of this announcement exists. Open it.</button> : null}
      <div className="adm-grid">
        <div className="stack-lg">
          <div className="adm-stats">
            {stat(a.was_published ? 'Targeted' : 'Would reach now', fmtN(st?.targeted))}
            {stat('Delivered', fmtN(st?.delivered))}
            {stat('Pending', fmtN(st?.pending))}
            {stat('Failed', fmtN(st?.failed))}
            {stat('Reads', fmtN(st?.reads))}
            {stat('Unread', fmtN(st?.unread))}
            {stat('Read rate', st ? `${st.read_rate}%` : '—')}
            {stat('CTA clicks', st ? `${fmtN(st.clicks)} (${st.click_rate}%)` : '—')}
            {stat('Push queued', fmtN(st?.push_queued))}
            {stat('Archived by members', fmtN(st?.archived))}
          </div>
          <div className="card stack">
            <h2>Details</h2>
            <p className="small"><b>Audience:</b> {audienceText(a.audience)}</p>
            <p className="small"><b>Push:</b> {a.send_push ? 'Yes' : 'No'}{a.essential ? ' · essential notice' : ''}</p>
            <p className="small"><b>Created:</b> {`${when(a.created_at)}${a.created_by_handle ? ` by ${a.created_by_handle}` : ''}`}</p>
            {a.scheduled_for ? <p className="small"><b>Scheduled for:</b> {when(a.scheduled_for)}</p> : null}
            {a.published_at ? <p className="small"><b>Published:</b> {`${when(a.published_at)}${a.published_by_handle ? ` by ${a.published_by_handle}` : ' (on schedule)'}`}</p> : null}
            {a.delivered_at ? <p className="small"><b>Delivery finished:</b> {when(a.delivered_at)}</p> : null}
            {a.expires_at ? <p className="small"><b>Stops showing:</b> {when(a.expires_at)}</p> : null}
            <p className="tiny muted">Counts only: we never show who read or tapped.</p>
          </div>
          {days.length ? (
            <div className="card stack"><h2>Engagement over time</h2>
              <div className="adm-bars">{days.slice().reverse().map((x) => (
                <div key={x.day} className="adm-bar"><span>{new Date(x.day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><i style={{ width: `${(x.reads / maxDay) * 100}%` }} /><span>{`${fmtN(x.reads)} · ${fmtN(x.clicks)}`}</span></div>
              ))}</div><p className="tiny muted">Reads · button taps per day (Lagos time)</p></div>) : null}
          <div className="card stack"><h2>History</h2>
            <div className="adm-log">{log.length ? log.map((l, i) => (
              <div key={i}><span>{`${l.action.replace(/_/g, ' ')}${l.actor_handle ? ` · ${l.actor_handle}` : l.action === 'published' ? ' · schedule' : ''}`}</span><span className="muted">{when(l.at)}</span></div>
            )) : <p className="small muted">No history yet.</p>}</div></div>
        </div>
        <div className="adm-preview-col"><div className="adm-phone"><AnnView a={a} preview /></div></div>
      </div>
    </div>
  );
}

// ---- Staff (Super Admin) ------------------------------------------------------------------------------------------
function Staff({ me }: { me: Me }) {
  const [list, setList] = useState<any[] | null>(null);
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState('editor');
  const [pub, setPub] = useState(false);
  const [log, setLog] = useState<any[]>([]);
  const load = () => { api.annStaff().then(setList).catch(() => setList([])); api.annAudit(null, 50).then(setLog).catch(() => {}); };
  useEffect(load, []);
  const save = async (h: string, r: string | null, p: boolean) => {
    try { await api.annSetStaff(h, r, p); toast(r ? 'Saved' : 'Removed'); setHandle(''); load(); } catch (e) { toast(api.friendly(e), 'x'); }
  };
  if (me.role !== 'super_admin') return <EmptyState emoji="🔒" title="Super Admin only" text="Only the Super Admin can manage staff." />;
  return (
    <div className="adm">
      <Head title="Announcement staff" back="admin/announcements" />
      <div className="card stack">
        <p className="small muted">Super Admin: everything. Admin: create, edit, and publish if allowed. Editor: create and edit drafts; publish only if allowed. Analyst: view analytics only.</p>
        <div className="adm-row2">
          <label className="adm-field"><span>treehouse handle</span><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Lucky Dolphin 214" /></label>
          <label className="adm-field"><span>Role</span><select value={role} onChange={(e) => setRole(e.target.value)}>{Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        {role === 'admin' || role === 'editor' ? <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} />Allowed to publish</label> : null}
        <button className="btn btn-primary" disabled={!handle.trim()} onClick={() => save(handle.trim(), role, pub)}>Add or update</button>
      </div>
      <div className="card ib-list">{!list ? <SkeletonList n={2} /> : list.map((s) => (
        <div key={s.handle} className="row-between" style={{ padding: '10px 4px' }}>
          <span><b>{s.handle}</b><span className="small muted">{` · ${ROLE_LABEL[s.role]}${s.role !== 'super_admin' && s.role !== 'analyst' ? (s.can_publish ? ' · can publish' : ' · drafts only') : ''}`}</span></span>
          {s.role !== 'super_admin' ? <button className="btn btn-ghost btn-sm" onClick={async () => { if (await confirmSheet({ title: `Remove ${s.handle}?`, yes: 'Remove', danger: true })) save(s.handle, null, false); }}>Remove</button> : null}
        </div>))}</div>
      <div className="card stack"><h2>Audit log</h2>
        <div className="adm-log">{log.map((l, i) => <div key={i}><span>{`${l.action.replace(/_/g, ' ')}${l.title ? ` · ${l.title}` : l.meta && l.meta.handle ? ` · ${l.meta.handle}` : ''}${l.actor_handle ? ` · by ${l.actor_handle}` : ''}`}</span><span className="muted">{when(l.at)}</span></div>)}</div></div>
    </div>
  );
}
