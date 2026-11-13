'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Things you can do with a conversation, shared by the Inbox and the chat screen (ports of the
// matching functions in anon-inbox/public/hy-dating.js): accept, decline, block, unmatch, report,
// reveal, delete, view their dating card.
import { useState } from 'react';
import * as api from '@/lib/api';
import { state, emit, loadDating, closeChatLocal, statusOf, nameOf, isFriend, type Convo } from '@/lib/state';
import { GENDER_LABEL, INTENT_LABEL } from '@/lib/options';
import { go, openChat } from '@/lib/nav';
import { Icon, Avatar } from './ui';
import { openSheet, confirmSheet, toast } from './overlay';

export const REPORT_REASONS: [string, string][] = [['harassment', 'Harassment'], ['inappropriate', 'Sexual or inappropriate'], ['spam', 'Spam or scam'],
  ['fake', 'Fake profile'], ['underage', 'Seems under 18'], ['other', 'Something else']];
export const meta = (p: any) => [p.age, GENDER_LABEL[p.gender || p.other_gender], p.location || p.other_location].filter(Boolean).join(' · ');
export const activeText = (online: boolean, hours: number | null | undefined) => online ? 'Online'
  : hours == null ? null
  : hours < 1 ? 'Active less than an hour ago'
  : hours < 48 ? `Active ${hours} hour${hours === 1 ? '' : 's'} ago`
  : `Active ${Math.floor(hours / 24)} days ago`;
export const shortName = (handle: string) => handle.split(' ').slice(0, 2).join(' ');
export const backToInbox = () => go('matches', { replace: true });

export async function acceptRequest(c: Convo) {
  try {
    await api.acceptRequest(c.conversation_id);
    await loadDating({ force: true });
    toast(isFriend(c) ? `You and ${shortName(c.other_handle)} are friends now 👋` : `You can chat with ${shortName(c.other_handle)} now`, 'check');
  } catch (e) { toast(api.friendly(e), 'x'); }
}

export async function declineRequest(convo: Convo) {
  if (!(await confirmSheet({ title: 'Decline this request?', yes: 'Decline', danger: true,
    text: 'The chat disappears for you and they can’t send you more messages here. They aren’t told. To stop them for good, block them.' }))) return;
  try { await api.declineRequest(convo.conversation_id); await loadDating({ force: true }); toast('Request declined'); go('matches/requests', { replace: true }); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

export async function blockConvo(convo: Convo, { leave = true } = {}) {
  if (!(await confirmSheet({ title: `Block ${convo.other_handle}?`, text: 'They can’t message you or see you in Discover. They aren’t told.', yes: 'Block', danger: true }))) return;
  const undo = closeChatLocal(convo.conversation_id);
  if (leave) backToInbox();
  toast('Blocked', 'shield');
  api.blockPartner(convo.conversation_id).catch((e: any) => { undo(); toast(api.friendly(e), 'x'); });
}

export async function cancelSent(c: Convo) {
  const friend = isFriend(c);
  if (!(await confirmSheet({ title: `Cancel your ${friend ? 'friend' : 'message'} request?`, yes: 'Cancel request', danger: true,
    text: `It disappears for ${c.other_handle} too, with anything you sent with it.` }))) return;
  try { await api.cancelRequest(c.conversation_id); await loadDating({ force: true }); toast('Request cancelled', 'x'); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

export async function askFriend(convo: Convo, on: boolean) {
  const id = convo.conversation_id;
  try {
    const res: any = await api.askFriend(id, on);
    if (res === 'friends') { toast('You’re now friends 🎉', 'userplus'); await loadDating({ force: true }); return; }
    loadDating({ force: true }).catch(() => {});
    if (on && res === 'asked') {
      // A short note in the chat, so they see it (and get notified) even if they don't open the menu.
      api.sendMessage(id, '👋 I sent you a friend request. Tap the add-friend icon at the top of this chat to accept.').catch(() => {});
      toast('Friend request sent', 'userplus');
    } else if (!on) toast('Friend request cancelled', 'x');
  } catch (e) { toast(api.friendly(e), 'x'); }
}
export async function cancelMatchAsk(c: Convo) {
  if (!(await confirmSheet({ title: 'Cancel your friend request?', yes: 'Cancel request', danger: true,
    text: `${nameOf(c)} won’t see it any more. Your chat stays as it is.` }))) return;
  try { await api.askFriend(c.conversation_id, false); await loadDating({ force: true }); toast('Friend request cancelled', 'x'); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

export async function doReveal(convo: Convo, on: boolean) {
  if (on && !(await confirmSheet({ title: 'Reveal your identity?', yes: 'Yes, reveal',
    text: 'Your first name is shown to them only if they also choose to reveal. Until then nothing changes, and you can undo.' }))) return;
  try {
    await api.reveal(convo.conversation_id, on);
    convo.i_revealed = on;
    await loadDating({ force: true });
    const fresh = state.convos.find((c) => c.conversation_id === convo.conversation_id) || convo;
    toast(on ? (fresh.they_revealed ? 'You’ve both revealed 🎉' : 'Reveal request sent') : 'Reveal cancelled', 'eye');
  } catch (e) { toast(api.friendly(e), 'x'); }
}

export async function deleteChat(convo: Convo) {
  if (!(await confirmSheet({ title: 'Delete this chat?', yes: 'Delete', danger: true,
    text: `The chat and its messages are removed for you. ${convo.other_handle} keeps their copy and isn’t told. If they message you again, the chat comes back with only the new messages.` }))) return;
  try {
    await api.deleteConversation(convo.conversation_id);
    state.convos = state.convos.filter((c) => c.conversation_id !== convo.conversation_id);
    emit('dating');
    toast('Chat deleted', 'trash');
    backToInbox();
  } catch (e) { toast(api.friendly(e), 'x'); }
}

export function chatMenu(convo: Convo) {
  openSheet((close) => (
    <>
      <h2>{nameOf(convo)}</h2>
      <p className="small muted">Everything here stays between you two. Identities only show when you both reveal.</p>
      <div className="menu-list" style={{ marginTop: '10px' }}>
        {!convo.blocked && !convo.i_revealed && statusOf(convo) === 'chat' ? <button className="menu-item" onClick={() => { close(); doReveal(convo, true); }}><Icon name="eye" />Reveal my identity</button> : null}
        {convo.i_revealed && !convo.they_revealed ? <button className="menu-item" onClick={() => { close(); doReveal(convo, false); }}><Icon name="eye" />Undo reveal request</button> : null}
        {statusOf(convo) === 'request' ? <button className="menu-item" onClick={() => { close(); declineRequest(convo); }}><Icon name="x" />Decline request</button> : null}
        {!convo.blocked && api.features.matching && statusOf(convo) === 'chat' ? <button className="menu-item" onClick={async () => {
          close();
          if (!(await confirmSheet({ title: 'Unmatch?', text: 'The chat closes for both of you and they won’t see you in Discover again.', yes: 'Unmatch', danger: true }))) return;
          const undo = closeChatLocal(convo.conversation_id);
          backToInbox(); toast('Unmatched');
          api.unmatch(convo.conversation_id).catch((e: any) => { undo(); toast(api.friendly(e), 'x'); });
        }}><Icon name="x" />Unmatch</button> : null}
        {!convo.blocked ? <button className="menu-item danger" onClick={() => { close(); blockConvo(convo); }}><Icon name="shield" />Block</button> : null}
        <button className="menu-item" onClick={() => { close(); partnerProfile(convo); }}><Icon name="user" />View profile</button>
        <button className="menu-item danger" onClick={() => { close(); deleteChat(convo); }}><Icon name="trash" />Delete chat</button>
        <button className="menu-item danger" onClick={() => { close(); reportSheet(convo); }}><Icon name="flag" />Report</button>
      </div>
    </>
  ), { label: 'Chat options' });
}

export function requestMenu(c: Convo) {
  openSheet((close) => (
    <>
      <h2>{c.other_handle}</h2>
      <div className="menu-list" style={{ marginTop: '10px' }}>
        <button className="menu-item" onClick={() => { close(); partnerProfile(c); }}><Icon name="user" />View profile</button>
        <button className="menu-item" onClick={() => { close(); openChat(c.conversation_id); }}><Icon name="chat" />Open request</button>
        <button className="menu-item danger" onClick={() => { close(); blockConvo(c, { leave: false }); }}><Icon name="shield" />Block</button>
        <button className="menu-item danger" onClick={() => { close(); reportSheet(c); }}><Icon name="flag" />Report</button>
      </div>
    </>
  ), { label: 'Request options' });
}

export async function partnerProfile(convo: Convo) {
  let p: any = null;
  try { p = await api.chatPartnerProfile(convo.conversation_id); } catch (e) { return toast(api.friendly(e), 'x'); }
  if (!p) return toast('This profile isn’t available anymore', 'x');
  const active = p.available ? activeText(p.online, p.active_hours) : null;
  const ints: string[] = p.interests || [];
  const fs = state.friendStatus[convo.conversation_id];
  openSheet((close) => (
    <>
      <div className="pc">
        <div className="pc-av"><Avatar seed={p.handle} label={nameOf(convo)} cls="xl" />{p.online ? <i /> : null}</div>
        {nameOf(convo) !== convo.other_handle ? <h2>{nameOf(convo)}<small className="pc-handle">{` · ${p.handle}`}</small></h2> : <h2>{p.handle}</h2>}
        <p className="pc-sub">{[p.age ? `${p.age} years` : null, GENDER_LABEL[p.gender], p.location].filter(Boolean).join(' · ')}</p>
        {active ? <span className={`pc-status ${p.online ? 'on' : ''}`}>{active}</span> : null}
        {isFriend(convo) && fs ? <p className="pc-friend-status">{`“${fs.body}”`}</p> : null}
        {convo.i_revealed && convo.they_revealed ? <span className="pc-revealed"><Icon name="check" cls="sm" />Revealed · you both shared first names</span> : null}
        {p.available ? null : <p className="tiny muted">This chat is closed.</p>}
      </div>
      <div className="pc-about">
        <h3>About</h3>
        <p className="muted">{p.bio || 'No bio yet.'}</p>
        <div className="pc-facts">
          {p.location ? <span><Icon name="pin" cls="sm" />{p.location}</span> : null}
          {p.intent ? <span><Icon name="heart" cls="sm" />{INTENT_LABEL[p.intent]}</span> : null}
        </div>
        {ints.length ? <div className="chips">{ints.map((i) => <span key={i} className="chip static">{i}</span>)}</div> : null}
        {convo.i_revealed && convo.they_revealed ? null : <p className="tiny muted" style={{ marginTop: '10px' }}>🎭 Their real name stays hidden until you both reveal.</p>}
      </div>
      <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div>
    </>
  ), { label: `${p.handle}’s profile` });
}

export function reportSheet(convo: Convo) {
  openSheet((close) => <ReportForm convo={convo} close={close} />, { label: 'Report' });
}
function ReportForm({ convo, close }: { convo: Convo; close: () => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(!convo.blocked);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h2>Report</h2>
      <p className="small muted">Reports are reviewed by treehouse. They aren’t told who reported them.</p>
      <div className="chips">{REPORT_REASONS.map(([v, label]) => <button key={v} type="button" className="chip" aria-pressed={reason === v} onClick={() => setReason(v)}>{label}</button>)}</div>
      <textarea className="textarea" maxLength={1000} placeholder="What happened? (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
      {convo.blocked ? null : <label className="check"><input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /><span>Also block them</span></label>}
      <p className="error" role="alert">{err}</p>
      <div className="sheet-actions">
        <button className="btn btn-danger btn-block" disabled={!reason || busy} onClick={async () => {
          setBusy(true);
          try {
            await api.reportPartner(convo.conversation_id, reason!, details.trim());
            if (block && !convo.blocked) await api.blockPartner(convo.conversation_id);
            close();
            toast('Report sent. Thank you for keeping treehouse safe.', 'flag');
            if (block) { closeChatLocal(convo.conversation_id); backToInbox(); }
          } catch (e) { setErr(api.friendly(e)); setBusy(false); }
        }}>Send report</button>
        <button className="btn btn-soft btn-block" onClick={close}>Cancel</button>
      </div>
    </>
  );
}
