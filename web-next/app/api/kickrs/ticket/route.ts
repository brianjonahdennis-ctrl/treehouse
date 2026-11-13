// POST /api/kickrs/ticket { nonce } with the member's Supabase access token.
// Asks the database who this member is for Kickrs (kickrs_identity(), which also checks they've tapped
// Allow, have a profile and aren't suspended), then signs a one-minute pass for the Kickrs frame.
import { createClient } from '@supabase/supabase-js';
import { isNonce, kickrsTicket, mockPlayer } from '@/lib/server/kickrs-ticket';
import { pictureOf } from '@/lib/avatar-core.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const recent = new Map<string, number[]>();
const limited = (who: string) => {
  const now = Date.now();
  const times = (recent.get(who) || []).filter((t) => now - t < 60000);
  times.push(now);
  recent.set(who, times);
  if (recent.size > 5000) recent.clear();
  return times.length > 30;
};
const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1];
  const body = await req.json().catch(() => null);
  const nonce = body?.nonce;
  if (!token) return reply(401, { error: 'signed_out', message: 'Sign in to treehouse first.' });
  if (!isNonce(nonce)) return reply(400, { error: 'bad_request', message: 'Invalid request.' });
  if (limited(token.slice(-24))) return reply(429, { error: 'too_many', message: 'Too many tries. Wait a minute.' });
  try {
    if (process.env.NEXT_PUBLIC_TH_MOCK === '1' && process.env.KICKRS_MOCK_TICKETS === '1' && token.startsWith('mock.')) {
      return reply(200, { ticket: kickrsTicket(mockPlayer(token), nonce) });
    }
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await sb.rpc('kickrs_identity');
    if (error) {
      if (/Allow Kickrs first/.test(error.message)) return reply(409, { error: 'not_connected', message: 'Allow Kickrs first.' });
      if (error.code === '28000' || /JWT|token/i.test(error.message)) return reply(401, { error: 'signed_out', message: 'Sign in to treehouse again.' });
      return reply(403, { error: 'not_allowed', message: error.message });
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return reply(403, { error: 'not_allowed', message: 'Games aren’t available for this account.' });
    return reply(200, { ticket: kickrsTicket({ kickrsId: row.kickrs_id, handle: row.handle, avatarUrl: row.avatar ? pictureOf(row.avatar, 256) : null }, nonce) });
  } catch (e) {
    console.error('[kickrs ticket]', e);
    return reply(500, { error: 'unavailable', message: 'Games are not available right now.' });
  }
}
