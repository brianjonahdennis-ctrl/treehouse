import type { NextConfig } from 'next';

// Everything this app doesn't handle itself is passed to the existing treehouse server
// (anon-inbox/server.js): /api/*, /terms, /privacy, /u/<name>, the landing page assets, and so on.
// That lets the two run side by side, and lets screens move over one at a time.
const LEGACY = (process.env.LEGACY_ORIGIN || 'https://treehouse.ng').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{
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
