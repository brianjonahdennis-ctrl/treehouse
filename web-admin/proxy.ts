import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  const sb = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' https://fonts.googleapis.com ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    `font-src https://fonts.gstatic.com${dev ? " 'self'" : ''}`,
    `img-src 'self' data: blob: https://img.treehouse.ng ${sb}`.trim(),
    `connect-src 'self' ${sb} ${sb.replace('https://', 'wss://')}${dev ? ' ws:' : ''}`.trim(),
    "frame-src 'none'",
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
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export const config = {
  matcher: [{
    source: '/((?!_next/static|_next/image|icon.svg|icon-180.png|treehouse-mark.svg).*)',
    missing: [
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ],
  }],
};
