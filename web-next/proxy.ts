import { NextRequest, NextResponse } from 'next/server';

// Content Security Policy, the same rules as the live server's DATING_CSP, plus a fresh "nonce" per
// page view so Next.js's own start-up scripts may run and nothing else can.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const sb = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  // Games are Kickrs pages shown in a frame, and the games list comes from the Kickrs server.
  const kickrs = (process.env.NEXT_PUBLIC_KICKRS_ORIGIN || 'https://kickrs.app').replace(/\/$/, '');
  const kickrsApi = (process.env.NEXT_PUBLIC_KICKRS_API || 'https://play.kickrs.app').replace(/\/$/, '');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Dev tools (error overlay) need inline styles; production does not.
    `style-src 'self' https://fonts.googleapis.com ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `font-src https://fonts.gstatic.com${dev ? " 'self'" : ''}`,
    `img-src 'self' data: blob: https://img.treehouse.ng https://tile.openstreetmap.org ${sb}`.trim(),
    "media-src 'self' https://img.treehouse.ng",
    `connect-src 'self' ${sb} ${sb.replace('https://', 'wss://')} ${kickrsApi}${dev ? ' ws:' : ''}`.trim(),
    `frame-src ${kickrs}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: [{
    source: '/home/:path*',
    missing: [
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ],
  }, { source: '/home' }],
};
