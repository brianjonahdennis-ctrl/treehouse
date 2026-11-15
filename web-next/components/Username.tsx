'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// treehouse usernames (database: 20261115000110_usernames.sql).
// * 3 to 14 letters, or letters and numbers (at least one letter). Unique. Set once, then changeable
//   once every 365 days. Private: only you (Profile) and people you've both revealed with see it.
// * Needed before inviting friends: the invite link is treehouse.ng/r/<username>.
// * Add a friend by username: sends the usual friend request.
import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { loadDating } from '@/lib/state';
import { openChat } from '@/lib/nav';
import { Icon } from './ui';
import { openSheet, toast } from './overlay';

export type MyUsername = { username: string; set_at: string; next_change_at: string; can_change: boolean } | null;

let mineP: Promise<MyUsername> | null = null;
const listeners = new Set<(u: MyUsername) => void>();
export function loadMyUsername(force = false): Promise<MyUsername> {
  if (force || !mineP) mineP = api.myUsername().catch(() => null);
  return mineP;
}
function announce(u: MyUsername) { mineP = Promise.resolve(u); listeners.forEach((f) => f(u)); }
export function useMyUsername(): MyUsername | undefined {
  const [u, setU] = useState<MyUsername | undefined>(undefined);
  useEffect(() => { loadMyUsername().then(setU); listeners.add(setU); return () => { listeners.delete(setU); }; }, []);
  return u;
}

const RULE = /^[a-z0-9]{3,14}$/;
const clean = (v: string) => v.trim().replace(/^@/, '').toLowerCase();
function localProblem(v: string) {
  if (!v) return '';
  if (/[^a-z0-9]/.test(v)) return 'Only letters and numbers: no spaces, dots or symbols.';
  if (v.length > 14) return 'At most 14 characters.';
  if (v.length < 3) return 'At least 3 characters.';
  if (!/[a-z]/.test(v)) return 'Include at least one letter.';
  return '';
}
const REASON: Record<string, string> = {
  format: 'Use 3 to 14 letters, or letters and numbers.', reserved: 'That username isn’t available. Try another.', taken: 'That username is taken. Try another.',
};
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

/** Choose (or, once a year, change) your username. Resolves with the saved username, or null if closed. */
export function chooseUsername(opts: { why?: string } = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    openSheet((close) => <UsernameForm why={opts.why} close={(u) => { done = true; resolve(u); close(); }} />, {
      label: 'Choose your username', onClose: () => { if (!done) resolve(null); },
    });
  });
}
function UsernameForm({ why, close }: { why?: string; close: (u: string | null) => void }) {
  const [cur, setCur] = useState<MyUsername | undefined>(undefined);
  const [text, setText] = useState('');
  const [check, setCheck] = useState<{ name: string; ok: boolean; msg: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { loadMyUsername(true).then(setCur); }, []);
  const v = clean(text);
  const local = localProblem(v);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!v || local || (cur && cur.username === v)) { setCheck(null); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api.checkUsername(v);
        if (clean(text) === v) setCheck({ name: v, ok: !!r.ok, msg: r.ok ? 'Available' : REASON[r.reason] || 'Not available' });
      } catch { /* checked again on save */ }
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, local, cur]);
  if (cur === undefined) return <p className="small muted">Loading…</p>;
  const locked = !!cur && !cur.can_change;
  const save = async () => {
    if (!v) return setErr('Type a username first.');
    if (local) return setErr(local);
    if (check && check.name === v && !check.ok) return setErr(check.msg);
    setBusy(true); setErr('');
    try { const r = await api.setUsername(v); announce(r); toast(`Your username is @${r.username}`, 'check'); close(r.username); }
    catch (e) { setErr(api.friendly(e)); setBusy(false); }
  };
  return (
    <>
      <h2>{cur ? 'Your username' : 'Choose your username'}</h2>
      {why ? <p className="small">{why}</p> : null}
      {cur ? <p className="un-current">@{cur.username}</p> : null}
      {locked ? (
        <>
          <p className="small muted">{`You can change your username once a year. Next change: ${fmtDay(cur!.next_change_at)}.`}</p>
          <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={() => close(cur!.username)}>Close</button></div>
        </>
      ) : (
        <>
          <p className="small muted">3 to 14 letters, or letters and numbers. Only you and people you’ve both revealed with can see it. Friends can add you with it, and it’s your invite link.</p>
          <label className="field un-field">
            <span className="un-at" aria-hidden="true">@</span>
            <input className="input" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={15} inputMode="text"
              placeholder="yourname" aria-label="Username" value={text} onChange={(e) => { setText(e.target.value); setErr(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
          </label>
          <p className={`small un-check ${local || (check && !check.ok) ? 'bad' : check?.ok ? 'good' : ''}`} role="status">
            {local || (check && check.name === v ? check.msg : v && RULE.test(v) ? 'Checking…' : '')}
          </p>
          <p className="tiny muted">{cur ? 'After this change you can change it again in a year. Your invite link changes too.' : 'You can change it once a year, so choose well.'}</p>
          <p className="error" role="alert">{err}</p>
          <div className="sheet-actions">
            <button className="btn btn-primary btn-block" disabled={busy || !v || !!local || (!!check && check.name === v && !check.ok)} onClick={save}>{cur ? 'Change username' : 'Save username'}</button>
          </div>
        </>
      )}
    </>
  );
}

/** Profile row: your username (or a prompt to choose one). */
export function UsernameRow() {
  const u = useMyUsername();
  if (u === undefined) return null;
  return (
    <button className="settings-row" onClick={() => chooseUsername()}><Icon name="user" />
      <span className="grow">{u ? `@${u.username}` : 'Choose your username'}
        <span className="sub ellipsis">{u ? 'Your username · only you and people you’ve revealed with see it' : 'Needed to invite friends. Friends can add you with it'}</span></span>
      <span className="chev"><Icon name="chev" cls="sm" /></span></button>
  );
}

/** Add a friend by their username: sends a friend request. */
export function addFriendSheet() {
  openSheet((close) => <AddFriendForm close={close} />, { label: 'Add a friend by username' });
}
function AddFriendForm({ close }: { close: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = useMyUsername();
  const v = clean(text);
  const send = async () => {
    const local = localProblem(v);
    if (!v) return setErr('Type their username.');
    if (local) return setErr('No one on treehouse has that username.');
    setBusy(true); setErr('');
    try {
      const r = await api.addFriendByUsername(v);
      await loadDating({ force: true }).catch(() => {});
      close();
      if (r.status === 'friends') { toast(`You’re already friends with ${r.handle}`, 'userplus'); openChat(r.conversation_id); }
      else if (r.status === 'chatting') { toast(`You already have a chat with ${r.handle}`, 'chat'); openChat(r.conversation_id); }
      else if (r.status === 'they_asked') { toast(`${r.handle} already sent you a friend request. Check Requests.`, 'userplus'); }
      else toast(`Friend request sent to ${r.handle}`, 'userplus');
    } catch (e) { setErr(api.friendly(e)); setBusy(false); }
  };
  return (
    <>
      <h2>Add a friend</h2>
      <p className="small muted">Type your friend’s treehouse username. They’ll get a friend request and can chat once they accept.</p>
      <label className="field un-field">
        <span className="un-at" aria-hidden="true">@</span>
        <input className="input" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={15}
          placeholder="theirname" aria-label="Their username" value={text} onChange={(e) => { setText(e.target.value); setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
      </label>
      <p className="error" role="alert">{err}</p>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" disabled={busy || !v} onClick={send}><Icon name="userplus" cls="sm" />Send friend request</button>
      </div>
      <p className="tiny muted center">
        {mine ? `Your username is @${mine.username}. Share it so friends can add you.` : mine === null ? <button className="link-btn" onClick={() => { close(); chooseUsername(); }}>Choose your own username so friends can add you</button> : null}
      </p>
    </>
  );
}
