'use client';
import { useState } from 'react';
import { rpc } from '@/lib/sb';
import { allows, ROLE_HELP, ROLE_LABEL, type Role } from '@/lib/roles';
import { ago, date, words } from '@/lib/fmt';
import { useMe } from './Gate';
import { useGo } from './Shell';
import { Avatar, Btn, Card, Empty, ErrorBox, Field, Modal, PageHead, Pill, Spinner, Switch, toast, useAsync } from './ui';
import { Icon } from './Icon';

type Settings = { settings: Record<string, unknown>; filter_words: string[]; rating: { key: string; value: number; note: string }[] };

export function SettingsPage() {
  const { me } = useMe();
  const s = useAsync(() => rpc<Settings>('staff_settings'), []);
  const [word, setWord] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const manage = allows(me.role, 'manage');
  const set = async (key: string, value: unknown, done: string) => {
    try { await rpc('staff_setting_set', { p_key: key, p_value: value }); toast(done); s.reload(); } catch (e) { toast((e as Error).message, true); }
  };
  if (s.error) return <><PageHead title="Settings" /><ErrorBox text={s.error} retry={s.reload} /></>;
  if (!s.data) return <Spinner />;
  const v = s.data.settings;
  const reason = msg ?? String(v.signups_paused_reason || '');
  return (
    <>
      <PageHead title="Settings" sub={manage ? 'Switches that change the live app straight away.' : 'Only Admins can change these.'} />
      <div className="row-2 even">
        <Card title="Switches">
          <div className="set-row">
            <div><b>Pause new sign-ups</b><p className="muted">For emergencies (spam waves, outages). People already signed up aren’t affected.</p></div>
            <Switch label="Pause new sign-ups" on={v.signups_paused === true} disabled={!manage} onChange={(on) => set('signups_paused', on, on ? 'Sign-ups paused.' : 'Sign-ups open again.')} />
          </div>
          <Field label="Message new people see while paused">
            <div className="inline-form">
              <input value={reason} disabled={!manage} maxLength={200} onChange={(e) => setMsg(e.target.value)} placeholder="New sign-ups are paused for a short while. Please try again later." />
              {manage && msg !== null && <Btn small kind="primary" onClick={() => { set('signups_paused_reason', reason, 'Message saved.'); setMsg(null); }}>Save</Btn>}
            </div>
          </Field>
          <div className="set-row">
            <div><b>Show ads</b><p className="muted">Turns every sponsored card off at once.</p></div>
            <Switch label="Show ads" on={v.ads_enabled !== false} disabled={!manage} onChange={(on) => set('ads_enabled', on, on ? 'Ads on.' : 'Ads off.')} />
          </div>
          <div className="set-row">
            <div><b>Announce Man & Woman of the Week</b><p className="muted">Every Monday at noon, last week’s top inviter is announced to all members.</p></div>
            <Switch label="Announce Man & Woman of the Week" on={v.invite_winner_enabled !== false} disabled={!manage} onChange={(on) => set('invite_winner_enabled', on, on ? 'Weekly winner on.' : 'Weekly winner off.')} />
          </div>
          <div className="set-row">
            <div><b>Invites needed to win</b><p className="muted">Fewer than this and nobody is announced that week.</p></div>
            <input className="num" type="number" min={1} max={1000} disabled={!manage} defaultValue={Number(v.invite_winner_min ?? 3)}
              onBlur={(e) => { const x = Number(e.target.value); if (x && x !== Number(v.invite_winner_min ?? 3)) set('invite_winner_min', x, 'Saved.'); }} aria-label="Invites needed to win" />
          </div>
          <div className="set-row">
            <div><b>Credit referrals</b><p className="muted">When off, invite links still work but nobody is credited.</p></div>
            <Switch label="Credit referrals" on={v.referrals_enabled !== false} disabled={!manage} onChange={(on) => set('referrals_enabled', on, on ? 'Referrals on.' : 'Referrals off.')} />
          </div>
        </Card>
        <Card title="Blocked words" sub="Messages with these words are blocked in rooms and chats.">
          {manage && (
            <form className="inline-form" onSubmit={async (e) => { e.preventDefault(); try { await rpc('staff_filter_word', { p_word: word, p_add: true }); setWord(''); toast('Word added.'); s.reload(); } catch (er) { toast((er as Error).message, true); } }}>
              <input value={word} onChange={(e) => setWord(e.target.value)} placeholder="Add a word" maxLength={30} />
              <Btn kind="primary" type="submit" icon="plus" disabled={!word.trim()}>Add</Btn>
            </form>
          )}
          <div className="chips words">
            {s.data.filter_words.map((w) => (
              <span key={w} className="chip">{w}{manage && <button aria-label={`Remove ${w}`} onClick={async () => { try { await rpc('staff_filter_word', { p_word: w, p_add: false }); s.reload(); } catch (er) { toast((er as Error).message, true); } }}><Icon name="x" size={12} /></button>}</span>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Star rating rules" sub={allows(me.role, 'super') ? 'Super Admin only. Changes apply at the next rating refresh.' : 'Only a Super Admin can change these.'} pad={false}>
        <table className="tbl"><thead><tr><th>Setting</th><th>What it does</th><th>Value</th></tr></thead>
          <tbody>{s.data.rating.map((r) => <RatingRow key={r.key} r={r} can={allows(me.role, 'super')} onSaved={s.reload} />)}</tbody></table>
      </Card>
    </>
  );
}

function RatingRow({ r, can, onSaved }: { r: { key: string; value: number; note: string }; can: boolean; onSaved: () => void }) {
  const [v, setV] = useState(String(r.value));
  const dirty = v !== String(r.value);
  return (
    <tr>
      <td><code>{r.key}</code></td><td className="muted">{r.note}</td>
      <td className="nowrap">
        <input className="num" type="number" step="any" value={v} disabled={!can} onChange={(e) => setV(e.target.value)} aria-label={r.key} />
        {dirty && <Btn small kind="primary" onClick={async () => { try { await rpc('staff_rating_set', { p_key: r.key, p_value: Number(v) }); toast('Saved.'); onSaved(); } catch (e) { toast((e as Error).message, true); } }}>Save</Btn>}
      </td>
    </tr>
  );
}

type Member = { handle: string | null; role: Role; can_publish: boolean; added_at: string; added_by: string | null; authenticator: boolean; last_action_at: string | null; email: string | null };

export function StaffPage() {
  const { me } = useMe();
  const go = useGo();
  const t = useAsync(() => rpc<Member[]>('staff_team'), []);
  const [edit, setEdit] = useState<Member | null>(null);
  const sup = allows(me.role, 'super');
  return (
    <>
      <PageHead title="Staff" sub="Who can open this console, and what each role can do." actions={sup && <Btn kind="primary" icon="plus" onClick={() => setEdit({ handle: '', role: 'moderator', can_publish: false, added_at: '', added_by: null, authenticator: false, last_action_at: null, email: null })}>Add staff</Btn>} />
      <Card pad={false}>
        {t.error && <ErrorBox text={t.error} retry={t.reload} />}
        {t.loading && !t.data && <Spinner />}
        {t.data && (
          <table className="tbl"><thead><tr><th>Person</th><th>Role</th><th>Can publish</th><th>Authenticator</th><th>Last action</th><th>Added</th><th /></tr></thead>
            <tbody>{t.data.map((s) => (
              <tr key={s.handle || s.added_at}>
                <td><div className="who-cell"><Avatar name={s.handle || '?'} /><div><b>{s.handle || 'deleted'}</b>{s.email && <small>{s.email}</small>}</div></div></td>
                <td><Pill tone={s.role === 'super_admin' ? 'pink' : s.role === 'admin' ? 'blue' : 'violet'}>{ROLE_LABEL[s.role]}</Pill></td>
                <td>{s.can_publish ? 'Yes' : '—'}</td>
                <td>{s.authenticator ? <Pill tone="green">Set up</Pill> : <Pill tone="amber">Not yet</Pill>}</td>
                <td className="muted">{ago(s.last_action_at)}</td>
                <td className="muted">{date(s.added_at, false)}{s.added_by ? ` by ${s.added_by}` : ''}</td>
                <td className="nowrap">{s.handle && <Btn small kind="ghost" icon="user" onClick={() => go(`/members/${encodeURIComponent(s.handle!)}`)}>Profile</Btn>}{sup && s.handle && s.handle !== me.handle && <Btn small kind="ghost" onClick={() => setEdit(s)}>Change</Btn>}</td>
              </tr>))}</tbody></table>
        )}
      </Card>
      <Card title="What each role can do">
        <ul className="roles">{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <li key={r}><Pill tone={r === 'super_admin' ? 'pink' : r === 'admin' ? 'blue' : 'violet'}>{ROLE_LABEL[r]}</Pill><span>{ROLE_HELP[r]}</span></li>)}</ul>
        <p className="muted">Everyone signs in with their treehouse account plus an authenticator code. Staff need a treehouse profile; add them by their handle.</p>
      </Card>
      {edit && <StaffForm s={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); t.reload(); }} />}
    </>
  );
}

function StaffForm({ s, onClose, onSaved }: { s: Member; onClose: () => void; onSaved: () => void }) {
  const [handle, setHandle] = useState(s.handle || '');
  const [role, setRole] = useState<Role>(s.role);
  const [pub, setPub] = useState(s.can_publish);
  const [err, setErr] = useState('');
  const save = async (remove = false) => {
    try { await rpc('staff_team_set', { p_handle: handle.trim(), p_role: remove ? '' : role, p_can_publish: pub }); toast(remove ? 'Removed from staff.' : 'Saved.'); onSaved(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title={s.handle ? `Change ${s.handle}` : 'Add staff'} onClose={onClose} foot={<>
      {s.handle && <Btn kind="danger" icon="trash" onClick={() => save(true)}>Remove from staff</Btn>}
      <span className="grow" /><Btn kind="ghost" onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={() => save()} disabled={!handle.trim()}>Save</Btn></>}>
      <Field label="treehouse handle"><input value={handle} disabled={!!s.handle} onChange={(e) => setHandle(e.target.value)} placeholder="their handle in the app" /></Field>
      <Field label="Role" hint={ROLE_HELP[role]}>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      </Field>
      {['admin', 'editor'].includes(role) && <label className="check"><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} />Can publish announcements</label>}
      {err && <ErrorBox text={err} />}
    </Modal>
  );
}

type Entry = { at: string; actor: string | null; action: string; target_type: string | null; target_id: string | null; meta: Record<string, unknown>; source: string };
const SENSITIVE = new Set(['view_chat', 'view_reported_chat', 'list_member_chats', 'delete_account', 'block_sign_in', 'suspend', 'staff_set', 'staff_removed']);

export function AuditPage() {
  const go = useGo();
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [before, setBefore] = useState<string | null>(null);
  const [rows, setRows] = useState<Entry[]>([]);
  const l = useAsync(async () => {
    const r = await rpc<Entry[]>('staff_audit_log', { p_actor: actor || null, p_action: action || null, p_before: before, p_limit: 100 });
    setRows((old) => (before ? [...old, ...r] : r));
    return r;
  }, [actor, action, before]);
  const filter = (a: string) => { setBefore(null); setAction(a); };
  return (
    <>
      <PageHead title="Audit log" sub="Every staff change, and every time someone opened a member or a private chat." />
      <div className="toolbar">
        <form className="search inline" onSubmit={(e) => { e.preventDefault(); setBefore(null); setActor(String(new FormData(e.currentTarget).get('a') || '').trim()); }}>
          <Icon name="search" size={17} /><input name="a" placeholder="Staff handle…" defaultValue={actor} aria-label="Staff handle" />
        </form>
        <div className="chips">
          {[['', 'Everything'], ['view_chat', 'Chats opened'], ['view_reported_chat', 'Reported chats opened'], ['suspend', 'Suspensions'], ['room_ban', 'Room bans'], ['delete_account', 'Deletions'], ['signed_in', 'Sign-ins']].map(([k, label]) => (
            <button key={k} className={`chip ${action === k ? 'on' : ''}`} onClick={() => filter(k)}>{label}</button>
          ))}
        </div>
      </div>
      <Card pad={false}>
        {l.error && <ErrorBox text={l.error} />}
        {l.loading && !rows.length && <Spinner />}
        {!l.loading && !rows.length && <Empty text="Nothing recorded yet." icon="list" />}
        {rows.length > 0 && (
          <table className="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>On</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className={SENSITIVE.has(r.action) ? 'hl' : ''}>
                <td className="muted nowrap">{date(r.at)}</td>
                <td><b>{r.actor || '—'}</b></td>
                <td>{words(r.action)}{r.source === 'announcements' && <small className="muted"> · announcements</small>}</td>
                <td>{r.target_type === 'member' && r.target_id ? <button className="link" onClick={() => go(`/members/${encodeURIComponent(r.target_id!)}`)}>{r.target_id}</button>
                  : r.target_type === 'conversation' && r.target_id ? <span className="muted">chat {r.target_id.slice(0, 8)}</span> : r.target_id || '—'}</td>
                <td className="meta">{Object.entries(r.meta || {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => <span key={k}><em>{words(k)}:</em> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>)}</td>
              </tr>))}</tbody></table>
        )}
      </Card>
      {l.data && l.data.length === 100 && <div className="pager"><Btn small onClick={() => setBefore(rows[rows.length - 1].at)}>Older</Btn></div>}
    </>
  );
}
