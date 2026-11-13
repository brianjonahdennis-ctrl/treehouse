import type { NextConfig } from 'next';

// Everything this app doesn't handle itself is passed to the existing treehouse server
// (anon-inbox/server.js): /api/*, /terms, /privacy, /u/<name>, the landing page assets, and so on.
// That lets the two run side by side, and lets screens move over one at a time.
const LEGACY = (process.env.LEGACY_ORIGIN || 'https://treehouse.ng').replace(/\/$/, '');

// One id per build: open phones compare it with /home-build and reload when a newer version is live.
const BUILD = (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 12) || Date.now().toString(36);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD: BUILD },
  poweredByHeader: false,
  async headers() {
    return [{
      // The push-notification worker must always be re-checked, so updates reach phones.
      source: '/home-sw.js',
      headers: [{ key: 'Cache-Control', value: 'no-cache' }],
    }, {
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      // Only used when no page or file here matches.
      fallback: [{ source: '/:path*', destination: `${LEGACY}/:path*` }],
    };
  },
};

export default nextConfig;
