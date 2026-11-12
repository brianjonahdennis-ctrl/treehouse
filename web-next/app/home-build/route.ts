// Which version of the app is live (open phones compare it with their own and reload when it changes).
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD || null }, { headers: { 'Cache-Control': 'no-store' } });
}
