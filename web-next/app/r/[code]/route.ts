// treehouse.ng/r/<code>: an invite link. Counts the visit, remembers the code for 30 days, opens the app.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SB = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toLowerCase();
  const headers = new Headers({ Location: '/home', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (/^[a-z0-9]{4,24}$/.test(code)) {
    headers.append('Set-Cookie', `th_ref=${code}; Max-Age=${30 * 86400}; Path=/; SameSite=Lax; Secure`);
    if (SB && KEY) {
      await fetch(`${SB}/rest/v1/rpc/referral_click`, {
        method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_code: code }), signal: AbortSignal.timeout(2500),
      }).catch(() => {});
    }
  }
  return new Response(null, { status: 302, headers });
}
