'use client';
// The short onboarding after sign-up (port of the second half of anon-inbox/public/hy-onboard.js):
// dating card (18+, date of birth checked twice) → a bit more about you → done.
// The 18+ rule is enforced by the database (create_my_profile + table check); this is the friendly side.
import { useState } from 'react';
import * as api from '@/lib/api';
import { state, emit } from '@/lib/state';
import { GENDERS, INTENTS, INTERESTS, STATES } from '@/lib/options';
import { go } from '@/lib/nav';
import { store, yearsOld, formatDob } from '@/lib/util';
import { Icon, Logo, Chips, StateSelect, DobPicker, dobFrom, dobValue, EmptyState, type Dob } from './ui';
import { confirmSheet } from './overlay';

type Step = 'date-basics' | 'date-more' | 'done';
const STEP_ORDER: Step[] = ['date-basics', 'date-more', 'done'];
const draft = { gender: null as string | null, birth: '', confirmedBirth: '', location: '', intent: null as string | null, name: '', interested: ['male', 'female', 'other'], bio: '', interests: [] as string[], age: 0 };

export default function Onboarding() {
  const [step, setStepRaw] = useState<Step>(state.profile ? 'done' : 'date-basics');
  const setStep = (s: Step) => { setStepRaw(s); state.onboarding = true; window.scrollTo(0, 0); };
  const page = step === 'date-more' ? <More setStep={setStep} /> : step === 'done' ? <Done /> : <Basics setStep={setStep} />;
  return <div className="auth-page">{page}</div>;
}

function Frame({ step, title, sub, back, children }: { step: Step; title: string; sub?: string; back?: () => void; children: React.ReactNode }) {
    const i = STEP_ORDER.indexOf(step);
    return (
      <div className="auth" style={{ alignContent: 'start', paddingTop: '28px' }}>
        <div className="row-between">
          {back ? <button className="icon-btn" aria-label="Back" onClick={back}><Icon name="back" /></button> : <Logo />}
          <button className="link-btn small" onClick={() => api.signOut()}>Sign out</button>
        </div>
        <div className="steps" aria-hidden="true">{STEP_ORDER.map((_, j) => <i key={j} className={j <= i ? 'on' : ''} />)}</div>
        <div className="onb-head"><h1>{title}</h1>{sub ? <p>{sub}</p> : null}</div>
        {children}
      </div>
    );
  }

  function Basics({ setStep }: { setStep: (s: Step) => void }) {
    const [name, setName] = useState(draft.name);
    const [dob, setDob] = useState<Dob>(dobFrom(draft.birth || null));
    const [loc, setLoc] = useState(draft.location);
    const [gender, setGender] = useState(draft.gender);
    const [intent, setIntent] = useState(draft.intent);
    const [adult, setAdult] = useState(false);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const next = async () => {
      const birth = dobValue(dob);
      Object.assign(draft, { name: name.trim(), birth: birth === 'invalid' ? '' : birth, location: loc, gender, intent });
      setErr('');
      if (store.get('hy-underage')) return setErr('treehouse is only for people 18 and over.');
      if (!draft.name) return setErr('Add your first name. It stays hidden until you reveal it.');
      if (!birth) return setErr('Enter your date of birth.');
      if (birth === 'invalid') return setErr('That date doesn’t exist. Check your date of birth.');
      draft.age = yearsOld(birth);
      if (draft.age < 18) { store.set('hy-underage', 1); return setErr('treehouse is only for people 18 and over.'); }
      if (draft.confirmedBirth !== birth) {
        if (!(await confirmSheet({ title: `Born on ${formatDob(birth)}?`, yes: 'Yes, that’s right', text: 'Please check it carefully. You can only change your date of birth after 365 days.' }))) return;
        draft.confirmedBirth = birth;
      }
      if (!draft.location) return setErr('Choose your state.');
      if (!draft.gender || !draft.intent) return setErr('Pick your gender and what you’re looking for.');
      if (!adult) return setErr('Please confirm you’re 18 or older.');
      if (api.features.matching) return setStep('date-more');
      setBusy(true);
      try { await saveDating(); setStep('done'); } catch (e) { setErr(api.friendly(e)); setBusy(false); }
    };
    return (
      <Frame step="date-basics" title="Create your card" sub="You stay anonymous: people see a nickname like “Velvet Owl 342”. Your first name is shown to a match only after you both reveal.">
        <div className="stack-lg">
          <label className="field"><span>First name (hidden)</span><input className="input" maxLength={60} placeholder="Your first name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="field"><span>Date of birth</span><DobPicker value={dob} onChange={setDob} /><p className="hint">Required. Private: nobody else sees it. Check it carefully: you can only change your date of birth after 365 days.</p></div>
          <label className="field"><span>State</span><StateSelect states={STATES} value={loc} onChange={setLoc} label="State" /><p className="hint">Discover shows people in your state first. You can change that any time.</p></label>
          <div className="field"><span>I am</span><Chips options={GENDERS} value={gender} onChange={(v) => setGender(v)} /></div>
          <div className="field"><span>Looking for</span><Chips options={INTENTS} value={intent} onChange={(v) => setIntent(v)} /></div>
          <label className="check"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /><span>I confirm I’m 18 or older. Accounts found to be under 18 are removed.</span></label>
          <p className="error" role="alert">{err}</p>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={next}>{api.features.matching ? 'Continue' : 'Create dating profile'}</button>
        </div>
      </Frame>
    );
  }

  function More({ setStep }: { setStep: (s: Step) => void }) {
    const [interested, setInterested] = useState(draft.interested);
    const [bio, setBio] = useState(draft.bio);
    const [interests, setInterests] = useState(draft.interests);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    return (
      <Frame step="date-more" title="A bit more about you" sub="This helps the right people find you." back={() => setStep('date-basics')}>
        <div className="stack-lg">
          <div className="field"><span>Show me</span><Chips multi options={GENDERS} value={interested} onChange={(v) => { setInterested(v); draft.interested = v; }} /></div>
          <label className="field"><span className="row-between">Bio <span className="tiny muted">{bio.length}/300</span></span>
            <textarea className="textarea" maxLength={300} placeholder="A line or two about you. No names, numbers or socials." value={bio} onChange={(e) => { setBio(e.target.value); draft.bio = e.target.value; }} /></label>
          <div className="field"><span>Interests (up to 8)</span><Chips multi max={8} options={INTERESTS.map((i) => [i, i] as [string, string])} value={interests} onChange={(v) => { setInterests(v); draft.interests = v; }} /></div>
          <p className="error" role="alert">{err}</p>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={async () => {
            setErr('');
            if (!draft.interested.length) return setErr('Pick at least one.');
            setBusy(true);
            try { await saveDating(); setStep('done'); } catch (e) { setErr(api.friendly(e)); setBusy(false); }
          }}>Create dating profile</button>
        </div>
      </Frame>
    );
  }

async function saveDating() {
  if (!state.profile) await api.createProfile(draft);
  state.profile = await api.myProfile();
  if (!state.profile) return;
  const extra: Record<string, unknown> = {};
  if (draft.birth && !state.profile.birth_date) extra.birth_date = draft.birth;
  if (api.features.states) Object.assign(extra, { state: draft.location, pref_state: draft.location });
  if (api.features.matching) Object.assign(extra, { interested_in: draft.interested, bio: draft.bio.trim(), interests: draft.interests });
  if (Object.keys(extra).length) {
    await api.updateProfile(state.profile.handle, extra);
    state.profile = await api.myProfile();
  }
}

function Done() {
  const finish = (where: string) => { state.onboarding = false; go(where, { replace: true }); emit('all'); };
  return (
    <div className="auth center">
      <EmptyState emoji="🎉" title="You’re all set!" text={<>You’re <b>{state.profile ? state.profile.handle : 'in'}</b> on treehouse. Start meeting people.</>} />
      <button className="btn btn-white btn-block" onClick={() => finish('discover')}>🔥 Start discovering</button>
      <button className="btn btn-glass btn-block" onClick={() => finish(state.profile && state.profile.state ? `rooms/${encodeURIComponent(state.profile.state)}` : 'rooms')}>💬 Join your state’s chatroom</button>
      <button className="btn btn-soft btn-block" onClick={() => finish('home')}>Go home</button>
    </div>
  );
}
