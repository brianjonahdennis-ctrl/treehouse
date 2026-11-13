// The OLD member app (anon-inbox/public/hy-app.js) asks this address which version is live, and
// reloads itself when the answer differs from its own. Answering with the new app's version makes
// every phone still running the old app reload into this one (unless someone is typing).
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ build: `next-${process.env.NEXT_PUBLIC_BUILD || 'live'}` }, { headers: { 'Cache-Control': 'no-store' } });
}
