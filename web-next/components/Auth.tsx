'use client';
// Signed-out screens (port of the first half of anon-inbox/public/hy-onboard.js): landing, sign up,
// sign in (email or Google), "check your email", forgot password, new password, under-18 stop.
import { useEffect, useState, type FormEvent } from 'react';
import * as api from '@/lib/api';
import { state, emit } from '@/lib/state';
import { store } from '@/lib/util';
import { Icon, Logo, EmptyState } from './ui';
import { toast } from './overlay';
import { afterSignIn } from './App';

type View = 'landing' | 'signup' | 'signin' | 'verify' | 'forgot';
const redirect = () => `${api.SITE}/home`;

export function Landing() {
  const [authError] = useState(() => { const e = store.get<string>('hy-auth-error'); if (e) store.del('hy-auth-error'); return e; });
  const [view, setViewRaw] = useState<View>(authError ? 'signin' : 'landing');
  const [email, setEmail] = useState('');
  const [googleOn, setGoogleOn] = useState(false);
  const setView = (v: View) => { setViewRaw(v); window.scrollTo(0, 0); };
  useEffect(() => { api.googleReady.then((on) => setGoogleOn(!!on)); }, []);
  useEffect(() => {
    const onFail = (e: Event) => toast(String((e as CustomEvent).detail), 'x');
    window.addEventListener('hy-google-failed', onFail);
    return () => window.removeEventListener('hy-google-failed', onFail);
  }, []);
  // The phone apps hide Google, except the Android app 1.6+ which opens it in Chrome.
  const google = googleOn && !(api.isNativeApp() && !api.appGoogle());

  let page;
  if (view === 'landing') page = <LandingHero setView={setView} />;
  else if (view === 'verify') page = <Verify email={email} setView={setView} />;
  else if (view === 'forgot') page = <Forgot email={email} setView={setView} />;
  else if (view === 'signup' && google) page = <GoogleSignup setView={setView} />;
  else page = <AuthForm mode={view} google={google} email={email} setEmail={setEmail} setView={setView} initialError={authError} />;
  return <div className="auth-page">{page}</div>;
}

function LandingHero({ setView }: { setView: (v: View) => void }) {
  return (
    <div className="auth">
      <div className="brand-head"><Logo /><p className="tagline-caps">Meet without the pressure.</p></div>
      <div className="hero-land" style={{ position: 'relative' }}>
        <span className="floaty" style={{ left: 0, top: '-8px' }}>💘</span>
        <span className="floaty" style={{ right: '2%', top: '34px', animationDelay: '-1.5s' }}>🎭</span>
        <h1>Anonymous users. <em>Real connections.</em></h1>
        <p className="lead">Meet new people across Nigeria without showing who you are. Chat, match and reveal your name only when you both say yes.</p>
      </div>
      <div className="feature-tiles">
        <div className="feature-tile"><span className="ft-icon date"><Icon name="heart" cls="fill" /></span><b>Anonymous Dating</b><p><span>Like, match and chat. Names show only when you both agree.</span></p></div>
        <div className="feature-tile"><span className="ft-icon msg"><Icon name="rooms" /></span><b>State Chatrooms</b><p><span>Join your state’s chatroom and meet people near you.</span></p></div>
      </div>
      <div className="stack">
        <button className="btn btn-white btn-block" onClick={() => setView('signup')}>Join treehouse</button>
        <button className="btn btn-glass btn-block" onClick={() => setView('signin')}>I already have an account</button>
      </div>
      <p className="tiny muted center">For adults 18+. <a href="/terms" style={{ color: '#d8b4fe' }}>Terms</a> · <a href="/privacy" style={{ color: '#d8b4fe' }}>Privacy policy</a></p>
    </div>
  );
}

const GOOGLE_G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.3-.4-3.5z"/></svg>';
function GoogleButton({ label, before }: { label: string; before?: () => boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-google btn-block" disabled={busy} onClick={async () => {
      if (before && !before()) return;
      setBusy(true);
      try {
        await api.signInWithGoogle(redirect());
        if (api.appGoogle()) setTimeout(() => setBusy(false), 3000);
      } catch (e) { setBusy(false); toast(api.friendly(e), 'x'); }
    }}>
      <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: GOOGLE_G }} />{label}
    </button>
  );
}

function TermsCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>. No abusive or objectionable content: it gets removed, and so do the people who post it.</span>
    </label>
  );
}
function AgeCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>I’m 18 or older. treehouse is for adults only.</span></label>;
}

function GoogleSignup({ setView }: { setView: (v: View) => void }) {
  const [age, setAge] = useState(false), [terms, setTerms] = useState(false), [err, setErr] = useState('');
  const check = () => {
    setErr('');
    if (!age) { setErr('treehouse is only for people 18 and over.'); return false; }
    if (!terms) { setErr('Please agree to the Terms of Use to continue.'); return false; }
    store.set('hy-google-terms', Date.now());
    return true;
  };
  return (
    <div className="auth">
      <button className="icon-btn" aria-label="Back" onClick={() => setView('landing')}><Icon name="back" /></button>
      <div className="onb-head"><h1>Create your account</h1><p>Join in one tap with your Google account. Your name and email are never shown to anyone on treehouse.</p></div>
      <div className="stack">
        <AgeCheck checked={age} onChange={setAge} />
        <TermsCheck checked={terms} onChange={setTerms} />
        <p className="error" role="alert">{err}</p>
        <GoogleButton label="Continue with Google" before={check} />
      </div>
      <p className="small muted center">Already have an account? <button className="link-btn" type="button" onClick={() => setView('signin')}>Sign in</button></p>
    </div>
  );
}

function AuthForm({ mode, google, email, setEmail, setView, initialError }: {
  mode: 'signup' | 'signin'; google: boolean; email: string; setEmail: (v: string) => void; setView: (v: View) => void; initialError: string | null;
}) {
  const isUp = mode === 'signup';
  const [pass, setPass] = useState(''), [age, setAge] = useState(false), [terms, setTerms] = useState(false), [busy, setBusy] = useState(false);
  const [err, setErr] = useState<React.ReactNode>(initialError ? (/expired|invalid/i.test(initialError) ? 'That link has expired or was already used. Sign in to get a new one.' : initialError) : '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const addr = email.trim();
    setEmail(addr);
    if (!/^\S+@\S+\.\S+$/.test(addr)) return setErr('Enter a valid email address.');
    if (pass.length < 8) return setErr('Use a password with at least 8 characters.');
    if (isUp && !age) return setErr('treehouse is only for people 18 and over.');
    if (isUp && !terms) return setErr('Please agree to the Terms of Use to continue.');
    setBusy(true);
    try {
      if (isUp) {
        const chk = await api.emailCheck(addr);
        if (!chk.ok) {
          if (chk.reason === 'typo' && chk.suggestion) {
            const sug = chk.suggestion;
            setErr(<>Did you mean {sug}? <button type="button" className="link-btn" onClick={() => { setEmail(sug); setErr(''); }}>Use this</button></>);
          } else setErr('That email address can’t receive emails. Check it for typos.');
          return;
        }
        const data = await api.signUp(addr, pass, redirect());
        if (data.session) return afterSignIn();
        noteEmailSent(addr);
        return setView('verify');
      }
      await api.signIn(addr, pass);
      await afterSignIn();
    } catch (e2) {
      const m = api.friendly(e2);
      setErr(m);
      if (/verify your email/i.test(m)) setTimeout(() => setView('verify'), 1200);
    } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <button className="icon-btn" aria-label="Back" onClick={() => setView('landing')}><Icon name="back" /></button>
      <div className="onb-head"><h1>{isUp ? 'Create your account' : 'Welcome back'}</h1>
        <p>{isUp ? 'We’ll send you an email to confirm it’s you. Your email is never shown to anyone.' : 'Sign in to see your chats and matches.'}</p></div>
      {!isUp && google ? <div className="stack"><GoogleButton label="Continue with Google" /><p className="or-line"><span>or sign in with email</span></p></div> : null}
      <form className="stack" noValidate onSubmit={submit}>
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete={isUp ? 'new-password' : 'current-password'} required minLength={8} placeholder={isUp ? 'At least 8 characters' : 'Your password'} value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        {isUp ? <AgeCheck checked={age} onChange={setAge} /> : null}
        {isUp ? <TermsCheck checked={terms} onChange={setTerms} /> : null}
        <p className="error" role="alert">{err}</p>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{isUp ? 'Create account' : 'Sign in'}</button>
        {isUp ? null : <button type="button" className="link-btn" onClick={() => setView('forgot')}>Forgot password?</button>}
      </form>
      <p className="small muted center">{isUp ? 'Already have an account? ' : 'New here? '}
        <button className="link-btn" type="button" onClick={() => setView(isUp ? 'signin' : 'signup')}>{isUp ? 'Sign in' : 'Create one'}</button></p>
    </div>
  );
}

// Verification emails: the wait before "Resend" grows (2, 5, 10 min); at most 4 emails an hour.
const SENT_KEY = 'hy-verify-sent';
const WAITS = [120, 300, 600];
function sendsFor(addr: string) {
  const all = store.get<Record<string, number[]>>(SENT_KEY, {}) || {};
  const hourAgo = Date.now() - 3600 * 1000;
  return (all[(addr || '').toLowerCase()] || []).filter((t) => t > hourAgo);
}
function noteEmailSent(addr: string) {
  const all = store.get<Record<string, number[]>>(SENT_KEY, {}) || {};
  all[(addr || '').toLowerCase()] = [...sendsFor(addr), Date.now()];
  store.set(SENT_KEY, all);
}
function waitLeft(addr: string) {
  const sends = sendsFor(addr);
  if (!sends.length) return 0;
  if (sends.length >= 4) return Math.ceil((sends[0] + 3600 * 1000 - Date.now()) / 1000);
  const wait = WAITS[Math.min(sends.length - 1, WAITS.length - 1)];
  return Math.max(0, Math.ceil((sends[sends.length - 1] + wait * 1000 - Date.now()) / 1000));
}
const mmss = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}s`);

function Verify({ email, setView }: { email: string; setView: (v: View) => void }) {
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const left = waitLeft(email);
  return (
    <div className="auth center">
      <EmptyState emoji="📬" title="Check your email" text={<>We sent a confirmation link to <b>{email || 'your email'}</b>. Open it on this device to continue.</>}>
        <p className="small muted">It can take a few minutes to arrive. Please wait for it rather than resending: extra emails can slow everything down.</p>
      </EmptyState>
      <button className="btn btn-soft btn-block" disabled={left > 0 || busy} onClick={async () => {
        if (waitLeft(email) > 0) return;
        setBusy(true);
        try { await api.resendVerify(email, redirect()); noteEmailSent(email); toast('Email sent again. It can take a few minutes to arrive.'); }
        catch (e) { toast(api.friendly(e), 'x'); }
        finally { setBusy(false); }
      }}>{left > 0 ? `Resend in ${mmss(left)}` : 'Resend email'}</button>
      <button className="btn btn-ghost btn-block" onClick={() => setView('signin')}>I’ve confirmed, sign in</button>
      <p className="tiny muted">Can’t find it? Check your spam and promotions folders.</p>
    </div>
  );
}

function Forgot({ email: initial, setView }: { email: string; setView: (v: View) => void }) {
  const [email, setEmail] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="auth">
      <button className="icon-btn" aria-label="Back" onClick={() => setView('signin')}><Icon name="back" /></button>
      <div className="onb-head"><h1>Reset password</h1><p>We’ll email you a link to choose a new one.</p></div>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        try { await api.resetPassword(email.trim()); setMsg({ ok: true, text: 'Check your email for the reset link.' }); }
        catch (e2) { setMsg({ ok: false, text: api.friendly(e2) }); }
      }}>
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <p className={msg ? (msg.ok ? 'small hint ok' : 'error') : 'small'} role="status">{msg?.text}</p>
        <button className="btn btn-dark btn-block">Send reset link</button>
      </form>
    </div>
  );
}

export function NewPassword() {
  const [p1, setP1] = useState(''), [p2, setP2] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return (
    <div className="auth-page"><div className="auth">
      <div className="row" style={{ justifyContent: 'center' }}><Logo /></div>
      <div className="onb-head"><h1>Choose a new password</h1><p>You’ll use it to sign in from now on.</p></div>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        if (p1.length < 8) return setErr('Use at least 8 characters.');
        if (p1 !== p2) return setErr('The passwords don’t match.');
        setBusy(true);
        try { await api.setPassword(p1); state.recovering = false; toast('Password saved'); emit('all'); await afterSignIn(); }
        catch (e2) { setErr(api.friendly(e2)); setBusy(false); }
      }}>
        <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" minLength={8} placeholder="At least 8 characters" value={p1} onChange={(e) => setP1(e.target.value)} /></label>
        <label className="field"><span>Confirm</span><input className="input" type="password" autoComplete="new-password" placeholder="Type it again" value={p2} onChange={(e) => setP2(e.target.value)} /></label>
        <p className="error" role="alert">{err}</p>
        <button className="btn btn-white btn-block" disabled={busy}>Save new password</button>
      </form>
    </div></div>
  );
}

export function Underage() {
  return (
    <div className="auth-page"><div className="auth center">
      <EmptyState emoji="🔞" title="treehouse is only for people 18 and over" text="Your account can’t be used. If you entered your date of birth by mistake, email support@treehouse.ng from the email address on your account.">
        <button className="btn btn-soft" onClick={() => api.signOut()}>Sign out</button>
      </EmptyState>
    </div></div>
  );
}
