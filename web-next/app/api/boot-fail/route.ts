// POST /api/boot-fail: a phone where the app didn't start (see public/hy-boot.js). Only the browser
// version and the error text are logged (Railway logs, "[boot-fail]"), never who it was.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let count = 0, windowStart = Date.now();
export async function POST(req: Request) {
  if (Date.now() - windowStart > 60000) { windowStart = Date.now(); count = 0; }
  if (++count <= 120) {   // keep the logs readable under a flood
    const b = await req.text().catch(() => '');
    let j: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { j = JSON.parse(b.slice(0, 2000)); } catch { /* ignore */ }
    const clean = (s: unknown, n: number) => String(s || '').replace(/[\r\n]+/g, ' ').slice(0, n);
    console.log('[boot-fail]', clean(j.reason, 10), clean(j.t, 8), 'ms |', clean(j.ua, 220), '|', clean((j.errors || []).join(' ; '), 300));
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
