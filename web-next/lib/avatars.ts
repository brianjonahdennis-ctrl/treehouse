'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Custom avatars for nicknames on screen (port of the cache in anon-inbox/public/hy-avatar.js).
// Each <Avatar> asks for its handle; requests are batched (up to 100 handles, one get_avatars call).
import { useSyncExternalStore } from 'react';
import * as api from './api';
import { normalize, pictureOf } from './avatar-core.js';

const cache = new Map<string, any>();   // handle -> config | null
const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((f) => f()); };

async function fetchPending() {
  timer = null;
  const handles = [...pending].slice(0, 100);
  handles.forEach((x) => pending.delete(x));
  if (!handles.length || !api.sb) return;
  try {
    const rows = await api.getAvatars(handles);
    handles.forEach((x) => cache.set(x, null));
    rows.forEach((r: any) => cache.set(r.handle, r.config));
  } catch { handles.forEach((x) => cache.set(x, null)); }
  bump();
  if (pending.size) timer = setTimeout(fetchPending, 60);
}
function want(handle: string) {
  if (!handle || cache.has(handle) || pending.has(handle)) return;
  pending.add(handle);
  if (!timer) timer = setTimeout(fetchPending, 60);
}
export const cachedAvatar = (handle: string) => cache.get(handle);
export function setCachedAvatar(handle: string, cfg: any) { cache.set(handle, cfg || null); bump(); }

/** The picture address for this handle's custom avatar, or null (use initials). */
export function useAvatarPicture(handle: string, size = 96): { src: string; bg: string } | null {
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => version, () => 0);
  if (typeof window === 'undefined') return null;
  want(handle);
  const cfg = cache.get(handle);
  if (!cfg) return null;
  const c = normalize(cfg);
  return { src: pictureOf(c, size), bg: c.b };
}
