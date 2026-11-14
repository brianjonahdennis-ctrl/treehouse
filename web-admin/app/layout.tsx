import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './admin.css';

export const metadata: Metadata = {
  title: 'treehouse admin',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg', apple: '/icon-180.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#090d2b' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" nonce={nonce} href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
