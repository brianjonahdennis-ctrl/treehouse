'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Chatroom bans (the database decides: my_room_ban()). A link in a chatroom = 24 hours out of every
// room, no warning. While banned, the Chatrooms screen shows the reason and a live countdown instead of
// the rooms; when the countdown ends the rooms come back by themselves.
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { useTicker } from './ui';

let ban: any = null;
const subs = new Set<(b: any) => void>();
const set = (b: any) => { ban = b; subs.forEach((f) => f(b)); };
export const roomBanNow = () => (ban && (!ban.until || new Date(ban.until).getTime() > Date.now()) ? ban : null);
/** Ask the database whether I'm banned from chatrooms (call after a refused join/send). */
export async function loadRoomBan() {
  try {
    const b = await api.myRoomBan();
    // Line the countdown up with the server clock.
    set(b ? { ...b, skew: b.now ? Date.now() - new Date(b.now).getTime() : 0 } : null);
  } catch { /* keep what we had */ }
  return roomBanNow();
}
export const isRoomBanError = (e: any) => /chatroom ban/i.test(String((e && e.message) || ''));
export function useRoomBan() {
  const [b, setB] = useState<any>(roomBanNow());
  useEffect(() => { subs.add(setB); loadRoomBan(); return () => { subs.delete(setB); }; }, []);
  return b;
}

const two = (n: number) => String(n).padStart(2, '0');
export function RoomBanCard({ b }: { b: any }) {
  useTicker(1000);
  const left = b.until ? Math.max(0, new Date(b.until).getTime() + (b.skew || 0) - Date.now()) : null;
  useEffect(() => { if (left === 0) set(null); }, [left]);
  const h = left == null ? 0 : Math.floor(left / 3600000), m = left == null ? 0 : Math.floor((left % 3600000) / 60000), s = left == null ? 0 : Math.floor((left % 60000) / 1000);
  return (
    <div className="room-ban" role="alert">
      <span className="rb-ico" aria-hidden="true">⛔</span>
      <h2>You’re banned from chatrooms</h2>
      <p className="rb-reason">{String(b.reason || '').replace(/^Chatroom ban:\s*/i, '')}</p>
      {left != null ? (
        <>
          <div className="rb-timer" aria-label={`${h} hours ${m} minutes ${s} seconds left`}>
            <span><b>{two(h)}</b><small>hours</small></span><i>:</i><span><b>{two(m)}</b><small>min</small></span><i>:</i><span><b>{two(s)}</b><small>sec</small></span>
          </div>
          <p className="small muted">This covers every chatroom. You can come back when the timer runs out. Chats, Discover and the rest of treehouse still work.</p>
        </>
      ) : <p className="small muted">Contact support@treehouse.ng if you think this is a mistake.</p>}
    </div>
  );
}
