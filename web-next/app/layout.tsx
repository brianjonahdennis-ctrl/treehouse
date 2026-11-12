import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { headers } from 'next/headers';
import './hy.css';

export const metadata: Metadata = {
  title: 'treehouse',
  description: 'treehouse: anonymous dating and state chatrooms. Anonymous users. Real connections.',
  icons: { icon: '/icon.svg', apple: '/icon-180.png' },
  appleWebApp: { title: 'treehouse' },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-visual',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#090d2b' }, { media: '(prefers-color-scheme: dark)', color: '#060920' }],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The page security policy (proxy.ts) only lets scripts with this per-request nonce run.
  const nonce = (await headers()).get('x-nonce') || undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Nunito:wght@800;900&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,800&family=Inter:ital,wght@0,400;0,600;0,700;0,800;0,900;1,800;1,900&display=swap" />
        {/* Saved light/dark theme before first paint (no flash). */}
        <Script src="/hy-theme.js" strategy="beforeInteractive" nonce={nonce} />
      </head>
      <body>
        {/* Gradient used by the active nav icon */}
        <svg className="svg-defs" width="0" height="0" aria-hidden="true">
          <defs><linearGradient id="aurora-stroke" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff3f9b" /><stop offset="1" stopColor="#12b9f5" /></linearGradient></defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
