// Audio/video calls: short-lived Cloudflare relay passwords, only for someone in a call that is ringing
// or live (the database checks the sign-in and the call). Same relay as Speed Dating. The Cloudflare key
// (CF_TURN_KEY_ID / CF_TURN_KEY_TOKEN) is set in Railway and never sent to phones. Without it, calls use
// direct connections only (works on most Wi-Fi, often not between two mobile networks).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const TURN_ID = /^[a-f0-9]{32}$/.test(process.env.CF_TURN_KEY_ID || '') ? process.env.CF_TURN_KEY_ID! : '';
const TURN_TOKEN = /^[A-Za-z0-9_-]{20,200}$/.test(process.env.CF_TURN_KEY_TOKEN || '') ? process.env.CF_TURN_KEY_TOKEN! : '';
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  const token = (/^Bearer ([\w.-]{20,4000})$/.exec(req.headers.get('authorization') || '') || [])[1];
  if (!token || !SB || !KEY) return json({ error: 'Sign in first.' }, 401);
  let callId = '';
  try { callId = String((await req.json()).call || ''); } catch { /* checked below */ }
  if (!/^[0-9a-f-]{36}$/.test(callId)) return json({ error: 'Call not found.' }, 400);
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/call_get`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_call: callId }), signal: AbortSignal.timeout(8000) });
    const call = r.ok ? await r.json() : null;
    if (!call || !['ringing', 'active'].includes(call.status)) return json({ error: 'No live call.' }, 403);
    if (!TURN_ID || !TURN_TOKEN) return json({ iceServers: STUN, relay: false });
    const c = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_ID}/credentials/generate-ice-servers`, {
      method: 'POST', headers: { Authorization: `Bearer ${TURN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(8000) });
    if (!c.ok) { console.log(`call relay: ${c.status}`); return json({ iceServers: STUN, relay: false }); }
    const j = await c.json();
    return json({ iceServers: j.iceServers || STUN, relay: true });
  } catch (e) {
    console.log(`call ice failed: ${(e as Error).message}`);
    return json({ error: 'Try again in a moment.' }, 502);
  }
}
