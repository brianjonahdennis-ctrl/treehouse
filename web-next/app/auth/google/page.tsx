'use client';
// "Continue with Google" through our own address, so Google's account chooser says "to continue to
// treehouse.ng" instead of the database's supabase.co address.
//
// 1. /auth/google[?app=1][&next=/home] makes a one-time code (nonce), remembers it in this tab, and sends
//    the person to Google with this page as the return address.
// 2. Google returns here with a signed ID token in the address fragment (never sent to our server).
// 3. Supabase checks the token (same Google client, same accounts as before) and signs the person in.
//    - Website: the session is saved in this browser and the person goes to `next`.
//    - Android app (?app=1, opened in Chrome): the session is handed back to the app through
//      com.brianjonahdennis.treehouse://auth#access_token=…&refresh_token=…, the same return the app
//      already understands (lib/api.ts finishAppSignIn), so installed apps need no update.
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY, MOCK } from '@/lib/supabase';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '1001557819645-k9nqd4f4ahojktm4vtc6rruvhbo2g1m5.apps.googleusercontent.com';
const APP_RETURN = 'com.brianjonahdennis.treehouse://auth';
const KEY = 'th-google-signin';

type Pending = { state: string; nonce: string; app: boolean; next: string };

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
// Only our own pages, never another site.
const safeNext = (n: string | null) => (n && /^\/(?!\/)[\w\-/?=&%.#]*$/.test(n) ? n : '/home');

export default function GoogleSignIn() {
  const [msg, setMsg] = useState('Opening Google…');

  useEffect(() => {
    const fail = (pending: Pending | null, text: string) => {
      try { sessionStorage.removeItem(KEY); } catch {}
      if (pending?.app) { location.replace(`${APP_RETURN}?error_description=${encodeURIComponent(text)}`); return; }
      try { localStorage.setItem('hy-auth-error', JSON.stringify(text)); } catch {}
      location.replace('/home');
    };

    (async () => {
      const hash = new URLSearchParams(location.hash.slice(1));
      const query = new URLSearchParams(location.search);
      let pending: Pending | null = null;
      try { pending = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch {}

      // Step 1: leave for Google.
      if (!hash.get('id_token') && !hash.get('error')) {
        if (MOCK) { location.replace(safeNext(query.get('next'))); return; }
        const p: Pending = { state: randomId(), nonce: randomId(), app: query.get('app') === '1', next: safeNext(query.get('next')) };
        sessionStorage.setItem(KEY, JSON.stringify(p));
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: `${location.origin}/auth/google`,
          response_type: 'id_token',
          scope: 'openid email profile',
          nonce: await sha256Hex(p.nonce),
          state: p.state,
          prompt: 'select_account',
        }).toString();
        location.replace(url.toString());
        return;
      }

      // Step 2: back from Google.
      history.replaceState(null, '', location.pathname);   // don't leave the token in the address bar
      if (hash.get('error')) {
        fail(pending, hash.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in didn’t finish. Please try again.');
        return;
      }
      if (!pending || hash.get('state') !== pending.state) {
        fail(pending, 'Google sign-in took too long or was opened twice. Please try again.');
        return;
      }
      setMsg('Signing you in…');
      // The app's session lives in the app, so Chrome keeps nothing; the website keeps it as usual.
      const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: !pending.app, autoRefreshToken: !pending.app, detectSessionInUrl: false, flowType: 'implicit' } });
      const { data, error } = await sb.auth.signInWithIdToken({ provider: 'google', token: hash.get('id_token') || '', nonce: pending.nonce });
      sessionStorage.removeItem(KEY);
      if (error || !data.session) { fail(pending, 'Google sign-in didn’t finish. Please try again.'); return; }
      if (pending.app) {
        const s = data.session;
        location.replace(`${APP_RETURN}#access_token=${encodeURIComponent(s.access_token)}&refresh_token=${encodeURIComponent(s.refresh_token)}&expires_in=${s.expires_in}&token_type=bearer`);
        setMsg('Done! Returning to treehouse…');
        return;
      }
      location.replace(pending.next);
    })().catch(() => { setMsg('Google sign-in didn’t finish. Please go back and try again.'); });
  }, []);

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#05051f', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24, textAlign: 'center' }}>
      <div>
        <div className="spinner" style={{ margin: '0 auto 16px' }} />
        <p>{msg}</p>
      </div>
    </main>
  );
}
