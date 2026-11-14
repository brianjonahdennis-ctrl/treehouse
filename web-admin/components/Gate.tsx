'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { sb, rpc, errText, MOCK } from '@/lib/sb';
import type { Me } from '@/lib/roles';
import { Btn, ErrorBox, Field, Spinner } from './ui';
import { Icon } from './Icon';

type Stage = 'loading' | 'signin' | 'notstaff' | 'enroll' | 'verify' | 'in' | 'broken';
const MeCtx = createContext<{ me: Me; signOut: () => void } | null>(null);
export const useMe = () => {
  const v = useContext(MeCtx);
  if (!v) throw new Error('Not signed in');
  return v;
};

export function Gate({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');

  const check = useCallback(async () => {
    setErr('');
    try {
      const c = await sb();
      const { data: { session } } = await c.auth.getSession();
      if (!session) { setStage('signin'); return; }
      setEmail(session.user.email || '');
      const m = await rpc<Me | null>('staff_me');
      if (!m) { setStage('notstaff'); return; }
      const { data: aal } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === 'aal2') {
        setMe({ ...m, mfa: true });
        if (!sessionStorage.getItem('th-admin-in')) {
          sessionStorage.setItem('th-admin-in', '1');
          rpc('staff_signed_in').catch(() => {});
        }
        setStage('in');
        return;
      }
      const { data: f } = await c.auth.mfa.listFactors();
      setStage((f?.totp || []).some((x) => x.status === 'verified') ? 'verify' : 'enroll');
    } catch (e) {
      setErr(errText(e));
      setStage('broken');
    }
  }, []);

  useEffect(() => {
    check();
    let off = () => {};
    sb().then((c) => {
      const { data } = c.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { setMe(null); setStage('signin'); } });
      off = () => data.subscription.unsubscribe();
    }).catch(() => {});
    return () => off();
  }, [check]);

  const signOut = useCallback(async () => {
    sessionStorage.removeItem('th-admin-in');
    try { await (await sb()).auth.signOut(); } catch { /* signed out locally anyway */ }
    setMe(null);
    setStage('signin');
  }, []);

  if (stage === 'in' && me) return <MeCtx.Provider value={{ me, signOut }}>{children}</MeCtx.Provider>;
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand"><img src="/treehouse-mark.svg" alt="" width={40} height={40} /><div><b>treehouse</b><span>Admin</span></div></div>
        {stage === 'loading' && <Spinner label="Checking your session…" />}
        {stage === 'broken' && <><ErrorBox text={err} retry={check} /></>}
        {stage === 'signin' && <SignIn />}
        {stage === 'notstaff' && (
          <>
            <h2>No staff access</h2>
            <p className="muted">{email || 'This account'} isn’t on the treehouse staff list. Ask a Super Admin to add your treehouse handle.</p>
            <Btn kind="soft" icon="logout" onClick={signOut}>Use another account</Btn>
          </>
        )}
        {stage === 'enroll' && <Enroll onDone={check} onSignOut={signOut} />}
        {stage === 'verify' && <Verify onDone={check} onSignOut={signOut} />}
        {MOCK && <p className="gate-mock">Preview mode: sample data, nothing is saved.</p>}
      </div>
    </div>
  );
}

function SignIn() {
  const [mode, setMode] = useState<'pick' | 'email'>('pick');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const google = async () => {
    setBusy(true); setErr('');
    try {
      const { error } = await (await sb()).auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/`, queryParams: { prompt: 'select_account' } } });
      if (error) throw error;
      if (MOCK) location.reload();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const withEmail = async () => {
    setBusy(true); setErr('');
    try {
      const { error } = await (await sb()).auth.signInWithPassword({ email: email.trim(), password: pw });
      if (error) throw error;
      location.reload();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <>
      <h2>Staff sign in</h2>
      <p className="muted">Use your treehouse account. You’ll then enter a code from your authenticator app.</p>
      {mode === 'pick' ? (
        <div className="gate-stack">
          <Btn kind="primary" onClick={google} disabled={busy}><GoogleG />Continue with Google</Btn>
          <Btn kind="ghost" onClick={() => setMode('email')}>Use email and password</Btn>
        </div>
      ) : (
        <form className="gate-stack" onSubmit={(e) => { e.preventDefault(); withEmail(); }}>
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
          <Btn kind="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
          <Btn kind="ghost" onClick={() => setMode('pick')}>Back</Btn>
        </form>
      )}
      {err && <ErrorBox text={err} />}
    </>
  );
}

function CodeInput({ onSubmit, busy }: { onSubmit: (code: string) => void; busy: boolean }) {
  const [code, setCode] = useState('');
  return (
    <form className="gate-stack" onSubmit={(e) => { e.preventDefault(); if (code.length === 6) onSubmit(code); }}>
      <input className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} autoFocus
        onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) onSubmit(v); }} aria-label="6-digit code" />
      <Btn kind="primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Continue'}</Btn>
    </form>
  );
}

function Enroll({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [f, setF] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const c = await sb();
        const { data: list } = await c.auth.mfa.listFactors();
        for (const old of (list?.all || []).filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) {
          await c.auth.mfa.unenroll({ factorId: old.id }).catch(() => {});
        }
        const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: `treehouse admin ${new Date().toISOString().slice(0, 10)}`, issuer: 'treehouse admin' });
        if (error) throw error;
        setF({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      } catch (e) { setErr(errText(e)); }
    })();
  }, []);
  const verify = async (code: string) => {
    if (!f) return;
    setBusy(true); setErr('');
    try {
      const { error } = await (await sb()).auth.mfa.challengeAndVerify({ factorId: f.id, code });
      if (error) throw error;
      onDone();
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <>
      <h2>Set up your authenticator</h2>
      <p className="muted">Staff accounts need a second step. Scan this with Google Authenticator (or any authenticator app), then type the 6-digit code it shows.</p>
      {f ? (
        <div className="enroll">
          <img src={f.qr} alt="QR code for your authenticator app" width={180} height={180} />
          <details><summary>Can’t scan? Enter this key</summary><code>{f.secret}</code></details>
        </div>
      ) : !err && <Spinner label="Preparing…" />}
      {f && <CodeInput onSubmit={verify} busy={busy} />}
      {err && <ErrorBox text={err} />}
      <Btn kind="ghost" icon="logout" onClick={onSignOut}>Sign out</Btn>
    </>
  );
}

function Verify({ onDone, onSignOut }: { onDone: () => void; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const verify = async (code: string) => {
    setBusy(true); setErr('');
    try {
      const c = await sb();
      const { data: list } = await c.auth.mfa.listFactors();
      const factor = (list?.totp || []).find((x) => x.status === 'verified');
      if (!factor) throw new Error('No authenticator found. Sign out and in again.');
      const { error } = await c.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) throw error;
      onDone();
    } catch (e) { setErr(/invalid|expired/i.test(errText(e)) ? 'That code didn’t work. Check the time on your phone and try the newest code.' : errText(e)); setBusy(false); }
  };
  return (
    <>
      <div className="gate-ico"><Icon name="key" size={22} /></div>
      <h2>Enter your code</h2>
      <p className="muted">Open your authenticator app and type the 6-digit code for treehouse admin.</p>
      <CodeInput onSubmit={verify} busy={busy} />
      {err && <ErrorBox text={err} />}
      <Btn kind="ghost" icon="logout" onClick={onSignOut}>Sign out</Btn>
      <p className="gate-foot">Lost your phone? A Super Admin can reset your authenticator in Supabase (Authentication → Users → your account → MFA).</p>
    </>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
