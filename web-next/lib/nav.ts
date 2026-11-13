'use client';
// Navigation helpers that screens and sheets can call outside React (the app shell plugs in the
// Next.js router). Paths are relative to /home, like the live app: go('matches/likes').
type Router = { push: (url: string) => void; replace: (url: string) => void };
let router: Router | null = null;
export const setRouter = (r: Router) => { router = r; };

export const homeUrl = (path = '') => '/home' + (path && path !== 'home' ? `/${path}` : '');
export function go(path: string, { replace = false } = {}) {
  if (path === 'discover/requests') path = 'matches/likes';
  const url = homeUrl(path);
  if (!router) { location.href = url; return; }
  if (replace) router.replace(url); else router.push(url);
}
export const openChat = (id: string) => go(`matches/${id}`);
