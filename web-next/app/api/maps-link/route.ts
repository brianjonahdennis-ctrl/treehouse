// Reads the pin out of a Google Maps link for hunt setup (Hydra, 18 Nov 2026). Short share links
// (maps.app.goo.gl/…) don't contain coordinates, so this follows the redirects to Google and reads
// them from the address Google sends back. The page itself is never read: for a place-name-only link it
// only holds a general map view, which would give the wrong spot. Only Google Maps hosts are ever
// fetched, only for signed-in staff, and nothing is stored.
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const GOOGLE = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]{2,6}|(www\.)?google\.[a-z.]{2,6}|consent\.google\.[a-z.]{2,6})$/i;
const limits = new Map<string, number[]>();

function okHost(u: URL) {
  if (u.protocol !== 'https:' || !GOOGLE.test(u.hostname)) return false;
  if (/^(goo\.gl|g\.co)$/i.test(u.hostname)) return u.pathname.startsWith('/maps') || u.hostname === 'g.co';
  if (/^(www\.)?google\./i.test(u.hostname)) return u.pathname.startsWith('/maps') || u.pathname === '/url' || u.pathname.startsWith('/search');
  return true;
}
const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** The pin first (!3d…!4d…), then q/ll/query/destination, then the map centre (@lat,lng). */
export function coordsIn(text: string): [number, number] | null {
  let t = text;
  try { t = decodeURIComponent(text); } catch { /* keep as is */ }
  const tries: [RegExp, boolean][] = [
    [/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/, false],
    [/[?&](?:q|ll|query|destination|center|daddr|sll)=(-?\d{1,2}\.\d+)\s*,\s*\+?(-?\d{1,3}\.\d+)/, false],
    [/\/(?:search|place|dir)\/[^/]*?(-?\d{1,2}\.\d{3,})\s*,\s*\+?(-?\d{1,3}\.\d{3,})/, false],
    [/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/, false],
  ];
  for (const [re, lngFirst] of tries) {
    const m = t.match(re);
    if (m) { const a = Number(m[1]), b = Number(m[2]); const [lat, lng] = lngFirst ? [b, a] : [a, b]; if (valid(lat, lng)) return [lat, lng]; }
  }
  return null;
}

export async function POST(request: Request) {
  const token = (/^Bearer ([A-Za-z0-9._~-]{12,4000})$/.exec(request.headers.get('authorization') || '') || [])[1];
  if (!token) return reply(401, { message: 'Sign in first.' });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '', key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  if (!url || !key) return reply(503, { message: 'Link reading is unavailable. Copy the coordinates from Google Maps.' });
  let who = '';
  try {
    const sb = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return reply(401, { message: 'Sign in again.' });
    who = data.user.id;
    const staff = await sb.rpc('staff_me');
    if (staff.error || !staff.data || !['super_admin', 'admin'].includes(staff.data.role)) return reply(403, { message: 'Only Admins can do this.' });
  } catch { return reply(401, { message: 'Sign in again.' }); }
  const now = Date.now(), recent = (limits.get(who) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) return reply(429, { message: 'Too many links at once. Wait a minute.' });
  recent.push(now); limits.set(who, recent);

  let body: { url?: unknown };
  try { body = await request.json(); } catch { return reply(400, { message: 'Paste a Google Maps link.' }); }
  const raw = typeof body.url === 'string' ? body.url.trim() : '';
  let at: URL;
  try { at = new URL(raw); } catch { return reply(400, { message: 'Paste a Google Maps link.' }); }
  if (raw.length > 2000 || !okHost(at)) return reply(400, { message: 'That isn’t a Google Maps link.' });

  const direct = coordsIn(at.href);
  if (direct) return reply(200, { latitude: direct[0], longitude: direct[1] });
  try {
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(at.href, { redirect: 'manual', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (treehouse hunt setup)', 'Accept-Language': 'en', Cookie: 'SOCS=CAI' } });   // SOCS=CAI: Google's "reject all" cookie choice, skips the consent page
      const next = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && next) {
        let to = new URL(next, at);
        const cont = to.searchParams.get('continue');   // Google's cookie page wraps the real address
        if (/^consent\./i.test(to.hostname) && cont) to = new URL(cont);
        if (!okHost(to)) break;
        const found = coordsIn(to.href);
        if (found) return reply(200, { latitude: found[0], longitude: found[1] });
        at = to; continue;
      }
      break;
    }
  } catch { /* fall through */ }
  return reply(422, { message: 'That link has no pin in it (a place name only). In Google Maps, press and hold the exact spot, then share or copy that link, or copy the numbers shown.' });
}
