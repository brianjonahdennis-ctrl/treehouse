'use client';
// Swipe a message to the right to reply (like WhatsApp). Past ~60px it becomes a reply, with a tick
// of haptics on phones. Same feel as swipeToReply in anon-inbox/public/hy-dating.js and hy-rooms.js.
import { useRef } from 'react';
import type React from 'react';

export function useSwipeReply(onReply: () => void, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const t = useRef({ x0: 0, y0: 0, dx: 0, active: false, decided: false, horizontal: false });
  if (!enabled) return { ref, handlers: {} };
  const handlers = {
    onTouchStart: (e: React.TouchEvent) => { const p = e.touches[0]; t.current = { x0: p.clientX, y0: p.clientY, dx: 0, active: true, decided: false, horizontal: false }; },
    onTouchMove: (e: React.TouchEvent) => {
      const s = t.current; const el = ref.current; if (!s.active || !el) return;
      const p = e.touches[0]; const ddx = p.clientX - s.x0, ddy = p.clientY - s.y0;
      if (!s.decided && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) { s.decided = true; s.horizontal = Math.abs(ddx) > Math.abs(ddy) * 1.3 && ddx > 0; }
      if (!s.horizontal) return;
      s.dx = Math.max(0, Math.min(90, ddx));
      el.style.transform = `translateX(${s.dx}px)`;
      el.classList.toggle('swipe-ready', s.dx > 60);
    },
    onTouchEnd: () => {
      const s = t.current; const el = ref.current; if (!s.active || !el) return;
      s.active = false;
      if (s.horizontal && s.dx > 60) { onReply(); if (navigator.vibrate) navigator.vibrate(12); }
      el.classList.add('swipe-back'); el.style.transform = ''; el.classList.remove('swipe-ready');
      setTimeout(() => el.classList.remove('swipe-back'), 220);
    },
  };
  return { ref, handlers: { ...handlers, onTouchCancel: handlers.onTouchEnd } };
}
