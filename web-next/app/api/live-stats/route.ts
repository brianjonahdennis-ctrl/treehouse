// Message-timing check (see lib/livestats.ts). GET = the server clock (so phones can line theirs up).
// POST = one phone's anonymous totals. Every 5 minutes a summary per platform is logged as "[live]"
// in the Railway logs: phones, minutes on screen, delay percentiles, connection events, missed messages.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* eslint-disable @typescript-eslint/no-explicit-any */

type Agg = { phones: number; vis: number; d: number[]; c: Record<string, number>; oldWv: number };
let aggs: Record<string, Agg> = {};
let since = Date.now();
const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : null);

function report() {
  if (Date.now() - since < 5 * 60000) return;
  for (const [p, a] of Object.entries(aggs)) {
    const s = a.d.sort((x, y) => x - y);
    console.log('[live]', JSON.stringify({
      p, mins: Math.round((Date.now() - since) / 60000), phones: a.phones, onScreenMin: Math.round(a.vis / 60), oldWebview: a.oldWv,
      msgs: s.length, p50: pct(s, 50), p90: pct(s, 90), p99: pct(s, 99), max: s.length ? s[s.length - 1] : null,
      over5s: s.filter((x) => x > 5000).length, ...a.c,
    }));
  }
  aggs = {}; since = Date.now();
}

export async function GET() {
  return Response.json({ now: Date.now() }, { headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: Request) {
  try {
    const j: any = JSON.parse((await req.text()).slice(0, 8000));
    const p = /^[a-z-]{3,20}$/.test(j.p) ? j.p : 'unknown';
    const a = (aggs[p] ||= { phones: 0, vis: 0, d: [], c: {}, oldWv: 0 });
    a.phones++;
    a.vis += Math.min(Number(j.vis) || 0, 3600);
    if (Number(j.cv) > 0 && Number(j.cv) < 110) a.oldWv++;
    if (Array.isArray(j.d) && a.d.length < 50000) for (const x of j.d.slice(0, 400)) { const n = Number(x); if (isFinite(n) && n >= 0 && n <= 600000) a.d.push(n); }
    if (j.c && typeof j.c === 'object') for (const [k, v] of Object.entries(j.c).slice(0, 40)) { if (/^[a-z_A-Z0-9]{1,40}$/.test(k)) a.c[k] = (a.c[k] || 0) + Math.min(Number(v) || 0, 10000); }
  } catch { /* ignore bad reports */ }
  report();
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
