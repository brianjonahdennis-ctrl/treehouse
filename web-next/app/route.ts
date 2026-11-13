// treehouse.ng/ : the landing page, served by the existing server (anon-inbox/server.js).
// That server picks the page by the address the visitor used (treehouse.ng → landing page; its own
// Railway address → the owner's anonymous-message page), and the general pass-through in
// next.config.ts arrives with the Railway address. So this one page is fetched over Railway's private
// network with the treehouse.ng address attached. Nothing else changes.
import http from 'node:http';
import https from 'node:https';

export const dynamic = 'force-dynamic';
const LEGACY = (process.env.LEGACY_ORIGIN || 'https://treehouse.ng').replace(/\/$/, '');
const PASS = ['content-type', 'cache-control', 'content-security-policy', 'etag', 'last-modified', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];

function landing(req: Request): Promise<Response> {
  const target = new URL(`${LEGACY}/`);
  const priv = target.hostname.endsWith('.railway.internal');
  const headers: Record<string, string> = { accept: req.headers.get('accept') || 'text/html', 'user-agent': req.headers.get('user-agent') || '' };
  if (priv) headers.host = 'treehouse.ng';
  const fwd = req.headers.get('x-forwarded-for'); if (fwd) headers['x-forwarded-for'] = fwd;
  const inm = req.headers.get('if-none-match'); if (inm) headers['if-none-match'] = inm;
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const r = lib.request(target, { method: 'GET', headers, timeout: 15000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const out = new Headers();
        for (const k of PASS) { const v = res.headers[k]; if (typeof v === 'string') out.set(k, v); }
        const status = res.statusCode || 502;
        resolve(new Response(status === 304 ? null : Buffer.concat(chunks), { status, headers: out }));
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', () => resolve(new Response('treehouse is busy right now. Please try again.', { status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' } })));
    r.end();
  });
}

// app.treehouse.ng is the member app's own address: its front page opens the app.
const APP_HOSTS = new Set(['app.treehouse.ng']);
const appHost = (req: Request) => APP_HOSTS.has((req.headers.get('host') || '').split(':')[0].toLowerCase());
const toApp = () => new Response(null, { status: 302, headers: { Location: '/home', 'Cache-Control': 'no-store' } });

export function GET(req: Request) { return appHost(req) ? toApp() : landing(req); }
export async function HEAD(req: Request) { if (appHost(req)) return toApp(); const r = await landing(req); return new Response(null, { status: r.status, headers: r.headers }); }
