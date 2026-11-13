'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Birthdays (opt-in, day only). Nobody ever sees a member's date: only "Today is their birthday 🎂",
// on the day, if they switched on "Show my birthday". The database decides (birthday_today()).
// Birthday cards are ordinary chat messages that start with "[bday:<design>]", drawn as a card.
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { state } from '@/lib/state';
import { store } from '@/lib/util';
import { openSheet, toast } from './overlay';
import { useConvoBadges } from './Reputation';

export const CARDS = [
  { id: 'cake', emoji: '🎂', label: 'Cake', c1: '#ff6fb4', c2: '#7b2ff7' },
  { id: 'balloons', emoji: '🎈', label: 'Balloons', c1: '#a46bff', c2: '#3b2bd9' },
  { id: 'gift', emoji: '🎁', label: 'Gift', c1: '#ffb347', c2: '#ff3f9b' },
  { id: 'sparkle', emoji: '🎆', label: 'Sparkle', c1: '#ffd166', c2: '#e2362b' },
];
const CARD_RE = /^\[bday:(cake|balloons|gift|sparkle)\]\s*/;
export function parseBirthdayCard(body: string) {
  const m = CARD_RE.exec(body || '');
  return m ? { design: CARDS.find((c) => c.id === m[1])!, text: body.slice(m[0].length) } : null;
}
/** Chat-list previews: a card shows as "🎂 Birthday card" instead of its code. */
export const previewOf = (body?: string | null) => (body && CARD_RE.test(body) ? '🎂 Birthday card' : body || '');
const cardBody = (design: string, name: string) => `[bday:${design}] Happy Birthday, ${name}! 🎉 Wishing you a wonderful year ahead.`;

export { isMyBirthday } from '@/lib/birthday';

export function BirthdayCardBubble({ body, mine }: { body: string; mine: boolean }) {
  const c = parseBirthdayCard(body);
  if (!c) return null;
  return (
    <span className="bday-card" style={{ ['--b1' as any]: c.design.c1, ['--b2' as any]: c.design.c2 }}>
      <span className="bday-art" aria-hidden="true">{c.design.emoji}</span>
      <span className="bday-title">Happy Birthday!</span>
      <span className="bday-text">{c.text}</span>
      <span className="bday-from">{mine ? 'You sent a birthday card' : 'A birthday card for you'}</span>
    </span>
  );
}

/** Pick one of four cards, then send it into the chat. */
export function openCardPicker(name: string, send: (body: string) => Promise<void> | void) {
  openSheet((close) => <CardPicker name={name} close={close} send={send} />, { label: 'Send a birthday card' });
}
function CardPicker({ name, close, send }: { name: string; close: () => void; send: (body: string) => Promise<void> | void }) {
  const [pick, setPick] = useState('cake');
  const [busy, setBusy] = useState(false);
  const d = CARDS.find((c) => c.id === pick)!;
  return (
    <>
      <h2>Send a Birthday Card</h2>
      <div className="bday-preview" style={{ ['--b1' as any]: d.c1, ['--b2' as any]: d.c2 }}>
        <span className="bday-art big" aria-hidden="true">{d.emoji}</span>
        <span className="bday-title">{`Happy Birthday ${name}!`}</span>
      </div>
      <p className="small muted center">{`Send ${name} a birthday card to wish them a happy birthday.`}</p>
      <div className="bday-picks" role="radiogroup" aria-label="Card design">
        {CARDS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} aria-label={c.label}
            className={`bday-pick ${pick === c.id ? 'on' : ''}`} style={{ ['--b1' as any]: c.c1, ['--b2' as any]: c.c2 }} onClick={() => setPick(c.id)}>{c.emoji}</button>
        ))}
      </div>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={async () => { setBusy(true); try { await send(cardBody(pick, name)); close(); } finally { setBusy(false); } }}>Send Card</button>
        <button className="btn btn-soft btn-block" onClick={close}>Cancel</button>
      </div>
    </>
  );
}

/** Top of a chat on their birthday: banner + quick card. */
export function ChatBirthdayBanner({ convoId, name, onCard }: { convoId: string; name: string; onCard: () => void }) {
  const b = useConvoBadges([convoId])(convoId);
  if (!b || !b.birthday) return null;
  return (
    <div className="bday-banner" role="status">
      <span>{`🎂 Today is ${name}’s birthday! 🎉`}</span>
      <button className="btn btn-sm btn-primary" onClick={onCard}>Send a Birthday Card</button>
    </div>
  );
}

/** Top of a chatroom: who here has a birthday today (dismissible for the day). */
export function RoomBirthdayBanner({ room }: { room: string }) {
  const [names, setNames] = useState<string[]>([]);
  const day = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const key = `hy-bday-room-${room}-${day}`;
  const [hidden, setHidden] = useState(() => !!store.get(key, false));
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    const load = () => api.roomBirthdays().then((r: any[]) => { if (alive) setNames(r.map((x) => x.handle)); }).catch(() => {});
    load();
    const t = setInterval(load, 10 * 60000);
    return () => { alive = false; clearInterval(t); };
  }, [room, hidden]);
  if (hidden || !names.length) return null;
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  return (
    <div className="bday-banner room" role="status">
      <span><b>{`🎂 It’s ${who}’s birthday today! 🎉`}</b><br />Join us in wishing {names.length === 1 ? 'them' : 'them all'} a happy birthday.</span>
      <button className="plain-btn" aria-label="Dismiss" onClick={() => { store.set(key, true); setHidden(true); }}>✕</button>
    </div>
  );
}

/** Profile › Privacy: the opt-in switch. */
export async function setBirthdayPublic(on: boolean) {
  const p = state.profile;
  if (!p) return;
  if (on && !p.birth_date) { toast('Add your date of birth first (Edit dating profile)', 'x'); throw new Error('no dob'); }
  await api.updateProfile(p.handle, { birthday_public: on });
  p.birthday_public = on;
}
