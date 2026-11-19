'use client';
// Staff "Continue with Google" through admin.treehouse.ng itself (same idea as the member app's
// web-next/app/auth/google): Google's chooser names our address, not the database's supabase.co one,
// and supabase.co no longer has to be an authorised domain in Google Cloud (needed for branding).
// Two-step sign-in (authenticator code) still follows on the admin home page as before.
import { useEffect, useState } from 'react';
import { sb, MOCK } from '@/lib/sb';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '1001557819645-k9nqd4f4ahojktm4vtc6rruvhbo2g1m5.apps.googleusercontent.com';
const KEY = 'th-admin-google-signin';

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function AdminGoogleSignIn() {
  const [msg, setMsg] = useState('Opening Google…');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fail = (text: string) => { try { sessionStorage.removeItem(KEY); } catch {} setMsg(text); setFailed(true); };
    (async () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      if (!hash.get('id_token') && !hash.get('error')) {
        if (MOCK) { location.replace('/'); return; }
        const p = { state: randomId(), nonce: randomId() };
        sessionStorage.setItem(KEY, JSON.stringify(p));
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID, redirect_uri: `${location.origin}/auth/google`, response_type: 'id_token',
          scope: 'openid email profile', nonce: await sha256Hex(p.nonce), state: p.state, prompt: 'select_account',
        }).toString();
        location.replace(url.toString());
        return;
      }
      history.replaceState(null, '', location.pathname);
      let p: { state: string; nonce: string } | null = null;
      try { p = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch {}
      if (hash.get('error')) return fail('Google sign-in was cancelled or didn’t finish.');
      if (!p || hash.get('state') !== p.state) return fail('Google sign-in took too long or was opened twice. Please try again.');
      setMsg('Signing you in…');
      const { error } = await (await sb()).auth.signInWithIdToken({ provider: 'google', token: hash.get('id_token') || '', nonce: p.nonce });
      sessionStorage.removeItem(KEY);
      if (error) return fail('Google sign-in didn’t finish. Please try again.');
      location.replace('/');
    })().catch(() => fail('Google sign-in didn’t finish. Please try again.'));
  }, []);

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
      <div>
        <p>{msg}</p>
        {failed ? <p><a href="/">Back to sign in</a></p> : null}
      </div>
    </main>
  );
}
