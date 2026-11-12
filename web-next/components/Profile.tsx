'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Profile: your dating card, privacy, appearance and account (port of anon-inbox/public/hy-profile.js).
// Same rules: state changes once every 30 days, gender every 90, date of birth every 365 (the database
// enforces these; the screen explains them).
import { useState, type ReactNode } from 'react';
import * as api from '@/lib/api';
import { state, emit, useAppState, loadDating } from '@/lib/state';
import { GENDERS, INTENTS, INTERESTS, STATES, stateLabel, GENDER_LABEL, INTENT_LABEL } from '@/lib/options';
import { store, yearsOld, formatDob, fmtDate } from '@/lib/util';
import { cachedAvatar } from '@/lib/avatars';
import { Icon, Hero, Avatar, Chips, StateSelect, DobPicker, dobFrom, dobValue, Toggle, vars, type Dob } from './ui';
import { openSheet, confirmSheet, toast } from './overlay';
import { BellButton } from './Home';
import { applyTheme } from './App';
import { PushRow, InstallRow } from './PushInstall';
import * as push from '@/lib/push';

const LIVE = process.env.NEXT_PUBLIC_LIVE_APP || 'https://treehouse.ng';

function completion() {
  const p = state.profile;
  const items: [string, boolean][] = [
    ['Create your dating card', !!p],
    ['Customize your avatar', !!(p && cachedAvatar(p.handle))],
    ['Write a short bio', !!(p && p.bio)],
    ['Add your interests', !!(p && p.interests && p.interests.length)],
    ['Choose your state', !!(p && p.state)],
  ];
  const done = items.filter((i) => i[1]).length;
  return { items, pct: Math.round((done / items.length) * 100) };
}

export default function Profile() {
  const s = useAppState();
  const profile = s.profile;
  if (!profile) return null;
  const c = completion();
  const blocked = s.convos.filter((x) => x.i_blocked);
  const facts = [profile.age ? `${profile.age}` : null, GENDER_LABEL[profile.gender], profile.state ? stateLabel(profile.state) : profile.location].filter(Boolean);
  const openAvatar = () => { location.href = `${LIVE}/home/profile`; };
  return (
    <div className="stack-lg profile">
      <Hero cls="profile-hero" actions={<BellButton />}>
        <div className="pf-head">
          <button className="av-hero-btn" aria-label="Customize your avatar" onClick={openAvatar}><Avatar seed={profile.handle} cls="xl" /><span className="av-pencil"><Icon name="edit" cls="sm" /></span></button>
          <div className="grow">
            <h1>{profile.handle}</h1>
            <p className="pf-facts">{facts.join(' · ')}</p>
            <div className="pf-chips">
              <span className="pf-chip date">{INTENT_LABEL[profile.intent]}</span>
              <span className={`pf-chip ${profile.is_active && !profile.suspended ? 'on' : ''}`}>{profile.suspended ? 'Suspended' : profile.is_active ? 'Visible in Discover' : 'Hidden from Discover'}</span>
            </div>
          </div>
        </div>
        {profile.bio ? <p className="pf-bio">{profile.bio}</p> : <button className="pf-bio empty" onClick={editDating}>+ Add a short bio so people know your vibe</button>}
      </Hero>

      {c.pct < 100 ? (
        <div className="card pf-complete below-hero">
          <div className="completion"><div className="ring" style={vars({ '--p': c.pct })}><span>{c.pct}%</span></div>
            <div><h3>Complete your profile</h3><p className="small muted">Complete profiles get more likes and message requests.</p></div></div>
          <div className="pf-todos">{c.items.map(([label, ok]) => <div key={label} className={`todo ${ok ? 'done' : ''}`}><span className="dot">{ok ? <Icon name="check" cls="sm" /> : ''}</span>{label}</div>)}</div>
        </div>
      ) : null}

      <Group title="Your profile">
        <Row ico="sparkles" title="Customize avatar" sub="Skin tone, hair, outfit, accessories and background (opens the current app)" onClick={openAvatar} />
        <Row ico="edit" title="Edit dating profile" sub={'Age, gender, state' + (api.features.matching ? ', bio' : '')} onClick={editDating} />
        {api.features.matching ? <Row ico="heart" title="Interests & intentions" sub={`${INTENT_LABEL[profile.intent]}${(profile.interests || []).length ? ` · ${(profile.interests || []).slice(0, 3).join(', ')}` : ''}`} onClick={editDating} /> : null}
        {api.features.matching ? <Row ico="sliders" title="Discovery preferences" sub={prefsSummary(profile)} onClick={editPrefs} /> : null}
        <div className="settings-row" style={{ cursor: 'default' }}><Icon name="eye" />
          <span className="grow">Show me in Discover<span className="sub">{profile.suspended ? 'Suspended after reports' : profile.is_active ? 'People can find and like you' : 'Paused: you’re hidden from Discover'}</span></span>
          <Toggle checked={profile.is_active} label="Show me in Discover" onChange={async (on) => {
            try { await api.updateProfile(profile.handle, { is_active: on }); profile.is_active = on; emit('profile'); }
            catch (e) { toast(api.friendly(e), 'x'); throw e; }
          }} />
        </div>
      </Group>

      <Group title="Privacy & safety">
        <Info emoji="🎭" title="You’re anonymous" sub="People see your nickname and avatar, never your email or real name. Chatrooms use your room nickname." />
        <Info emoji="🔓" title="Identity reveal needs both of you" sub="Your first name is only shown when you and the other person both choose to reveal. Nobody can reveal you alone." />
        <Info emoji="📩" title="Who can send you message requests" sub="Anyone with a dating card. Requests wait in your Inbox until you accept; decline or block any time." />
        <Row ico="pin" title="Nearby & location" sub="Off by default. Approximate area only (opens the current app)" onClick={() => { location.href = `${LIVE}/home/profile`; }} />
        <Row ico="ban" title="Blocked people" sub={blocked.length ? `${blocked.length} blocked` : 'No one blocked'} onClick={() => blockedSheet(blocked)} />
        <Info emoji="🚩" title="Reporting" sub="Report anyone from a chat’s ⋯ menu, a request, or a chatroom message. Reported messages are hidden for you straight away, and we act on reports within 24 hours." />
        <a className="settings-row" href="mailto:support@treehouse.ng?subject=treehouse%20report"><Icon name="flag" /><span className="grow">Report a problem by email<span className="sub">support@treehouse.ng</span></span><span className="chev"><Icon name="chev" cls="sm" /></span></a>
      </Group>

      <Group title="Notifications"><PushRow /><InstallRow /></Group>

      <Group title="Appearance">
        <div className="settings-row" style={{ cursor: 'default' }}><Icon name="moon" /><span className="grow">Theme</span><ThemePicker /></div>
      </Group>

      <Group title="Account">
        <div className="settings-row" style={{ cursor: 'default' }}><Icon name="mail" /><span className="grow">Email<span className="sub">{`${s.user.email} · never shown to anyone`}</span></span></div>
        <Row ico="lock" title="Change password" sub="We’ll email you a secure link" onClick={changePassword} />
        <a className="settings-row" href="mailto:support@treehouse.ng?subject=treehouse%20report"><Icon name="info" /><span className="grow">Contact us & report a problem<span className="sub">support@treehouse.ng</span></span><span className="chev"><Icon name="chev" cls="sm" /></span></a>
        <a className="settings-row" href="/privacy"><Icon name="shield" /><span className="grow">Privacy policy</span><span className="chev"><Icon name="chev" cls="sm" /></span></a>
        <a className="settings-row" href="/terms"><Icon name="shield" /><span className="grow">Terms of Use</span><span className="chev"><Icon name="chev" cls="sm" /></span></a>
        <button className="settings-row" onClick={async () => { await push.forget(); api.signOut(); }}><Icon name="logout" />Sign out</button>
        <button className="settings-row danger" onClick={deleteAccount}><Icon name="trash" />Delete my account</button>
      </Group>

      <p className="tiny muted center">treehouse · Anonymous users. Real connections.</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section><div className="section-head"><h2>{title}</h2></div><div className="settings-group">{children}</div></section>;
}
function Row({ ico, title, sub, onClick }: { ico: string; title: string; sub: string; onClick: () => void }) {
  return <button className="settings-row" onClick={onClick}><Icon name={ico} /><span className="grow">{title}<span className="sub ellipsis">{sub}</span></span><span className="chev"><Icon name="chev" cls="sm" /></span></button>;
}
function Info({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return <div className="settings-row" style={{ cursor: 'default', alignItems: 'flex-start' }}><span style={{ fontSize: '20px' }}>{emoji}</span><span className="grow">{title}<span className="sub">{sub}</span></span></div>;
}
function prefsSummary(p: any) {
  const who = (p.interested_in || []).length >= 3 ? 'Everyone' : (p.interested_in || []).map((g: string) => GENDER_LABEL[g]).join(', ');
  return `${who} · ${p.min_age}–${p.max_age >= 99 ? '99+' : p.max_age}${api.features.states ? ` · ${stateLabel(p.pref_state)}` : ''}`;
}
function ThemePicker() {
  const [cur, setCur] = useState<string>(() => store.get('hy-theme', 'system') || 'system');
  return (
    <div className="segmented" style={{ width: '210px' }}>
      {([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([v, label]) => (
        <button key={v} aria-selected={cur === v} onClick={() => { store.set('hy-theme', v); applyTheme(v); setCur(v); }}>{label}</button>
      ))}
    </div>
  );
}

function blockedSheet(list: any[]) {
  openSheet((close) => (
    <>
      <h2>Blocked people</h2>
      <p className="small muted">They can’t message you or see you in Discover. They aren’t told.</p>
      {list.length ? (
        <div className="menu-list" style={{ marginTop: '10px' }}>{list.map((c) => (
          <div key={c.conversation_id} className="blocked-row"><Avatar seed={c.other_handle} cls="sm" /><span className="grow ellipsis">{c.other_handle}</span>
            <button className="btn btn-soft btn-sm" onClick={async (e) => {
              const b = e.currentTarget; b.disabled = true;
              try { await api.unblockPartner(c.conversation_id); toast(`${c.other_handle} is unblocked`); close(); await loadDating({ force: true }); }
              catch (err) { toast(api.friendly(err), 'x'); b.disabled = false; }
            }}>Unblock</button>
          </div>
        ))}</div>
      ) : <p className="muted" style={{ margin: '14px 0' }}>You haven’t blocked anyone.</p>}
      <p className="tiny muted">People blocked in chatrooms are kept on this device and can be unblocked from their room profile.</p>
      <div className="sheet-actions"><button className="btn btn-soft btn-block" onClick={close}>Close</button></div>
    </>
  ), { label: 'Blocked people' });
}

async function changePassword() {
  if (!(await confirmSheet({ title: 'Change your password?', yes: 'Email me a link', text: `We’ll send a secure link to ${state.user.email}. Open it on this device to choose a new password.` }))) return;
  try { await api.resetPassword(state.user.email); toast('Check your email for the link', 'mail'); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

async function deleteAccount() {
  if (!(await confirmSheet({ title: 'Delete your account?', danger: true, yes: 'Delete everything',
    text: 'This permanently deletes your account, your dating card, matches, chats and chatroom messages. It can’t be undone.' }))) return;
  try { await api.deleteAccount(); await api.signOut(); toast('Your account was deleted', 'trash'); }
  catch (e) { toast(api.friendly(e), 'x'); }
}

// ---- Edit sheets --------------------------------------------------------------------------------
function editDating() { openSheet((close) => <EditDating close={close} />, { label: 'Edit dating profile' }); }
function EditDating({ close }: { close: () => void }) {
  const p = state.profile;
  const [name, setName] = useState<string>(p.name || '');
  const [dob, setDob] = useState<Dob>(dobFrom(p.birth_date || null));
  const nextAge = p.age_changed_at ? new Date(new Date(p.age_changed_at).getTime() + 365 * 864e5) : null;
  const ageLocked = !!(p.birth_date && nextAge && nextAge > new Date());
  const [loc, setLoc] = useState<string>(api.features.states ? (p.state || '') : (p.location || ''));
  const nextChange = p.state && p.state_changed_at ? new Date(new Date(p.state_changed_at).getTime() + 30 * 864e5) : null;
  const stateLocked = !!(api.features.states && nextChange && nextChange > new Date());
  const nextGender = p.gender_changed_at ? new Date(new Date(p.gender_changed_at).getTime() + 90 * 864e5) : null;
  const genderLocked = !!(nextGender && nextGender > new Date());
  const [gender, setGender] = useState<string>(p.gender);
  const [intent, setIntent] = useState<string>(p.intent);
  const [bio, setBio] = useState<string>(p.bio || '');
  const [interests, setInterests] = useState<string[]>(p.interests || []);
  const [err, setErr] = useState('');
  const save = async () => {
    const birth = ageLocked ? p.birth_date : dobValue(dob);
    if (!birth) return setErr('Enter your date of birth.');
    if (birth === 'invalid') return setErr('That date doesn’t exist. Check your date of birth.');
    const fields: Record<string, any> = { name: name.trim(), location: loc.trim(), gender: genderLocked ? p.gender : gender, intent };
    if (api.features.states) {
      if (!loc) return setErr('Choose your state.');
      if (!stateLocked) fields.state = loc;
      if (!p.state && !p.pref_state) fields.pref_state = loc;
      if (p.state && fields.state && fields.state !== p.state
        && !(await confirmSheet({ title: `Move to ${fields.state === 'FCT' ? 'Abuja (FCT)' : fields.state}?`, text: 'You’ll switch to that state’s chatroom, and you won’t be able to change your state again for 30 days.', yes: 'Change state' }))) return;
    }
    if (!fields.name) return setErr('Add your first name.');
    if (yearsOld(birth) < 18) return setErr('treehouse is only for people 18 and over.');
    if (birth !== p.birth_date) fields.birth_date = birth;
    if (api.features.matching) { fields.bio = bio.trim(); fields.interests = interests; }
    try {
      const moved = fields.state && fields.state !== p.state && p.state;
      const genderMoved = fields.gender !== p.gender;
      const ageMoved = !!fields.birth_date;
      if (ageMoved && !(await confirmSheet({ title: `Change your date of birth to ${formatDob(birth)}?`, yes: 'Change it',
        text: 'Your age decides which age chatroom you can join. You won’t be able to change it again for 365 days.' }))) return;
      await api.updateProfile(p.handle, fields); Object.assign(p, fields);
      if (moved) p.state_changed_at = new Date().toISOString();
      if (genderMoved) p.gender_changed_at = new Date().toISOString();
      if (ageMoved) Object.assign(p, await api.myProfile());
      close(); emit('profile'); toast('Dating card saved');
    } catch (e) { setErr(api.friendly(e)); }
  };
  return (
    <>
      <h2>Edit dating profile</h2>
      <div className="stack">
        <label className="field"><span>First name (hidden until you both reveal)</span><input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="field"><span>Date of birth</span><DobPicker value={dob} onChange={setDob} disabled={ageLocked} />
          <small className="muted">{ageLocked && nextAge ? `You’re ${p.age}. You can change your date of birth again on ${fmtDate(nextAge)}. Nobody else sees it.` : `You’re ${p.age}. Nobody else sees your date of birth. It can change once every 365 days.`}</small></div>
        <label className="field"><span>{api.features.states ? 'State' : 'Area'}</span>
          {api.features.states ? <StateSelect states={STATES} value={loc} onChange={setLoc} label="State" disabled={stateLocked} /> : <input className="input" maxLength={80} value={loc} onChange={(e) => setLoc(e.target.value)} />}
          {api.features.states ? <small className="muted">{stateLocked && nextChange ? `You can change your state again on ${fmtDate(nextChange)}. Your state decides your state chatroom.` : 'Your state decides your state chatroom. You can change it once every 30 days.'}</small> : null}
        </label>
        <div className="field"><span>I am</span>
          <Chips options={GENDERS} value={gender} onChange={(v) => {
            if (genderLocked && v !== p.gender && nextGender) toast(`You can change your gender again on ${nextGender.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, 'lock');
            setGender(v);
          }} />
          <small className="muted">{genderLocked && nextGender ? `You can change this again on ${fmtDate(nextGender)}.` : 'You can change this once every 90 days.'}</small></div>
        <div className="field"><span>Looking for</span><Chips options={INTENTS} value={intent} onChange={(v) => setIntent(v)} /></div>
        {api.features.matching ? <label className="field"><span>Bio</span><textarea className="textarea" maxLength={300} placeholder="A line or two about you. No names, numbers or socials." value={bio} onChange={(e) => setBio(e.target.value)} /></label> : null}
        {api.features.matching ? <div className="field"><span>Interests (up to 8)</span><Chips multi max={8} options={INTERESTS.map((x) => [x, x] as [string, string])} value={interests} onChange={(v) => setInterests(v)} /></div> : null}
        <p className="error">{err}</p>
      </div>
      <div className="sheet-actions"><button className="btn btn-dark btn-block" onClick={save}>Save</button></div>
    </>
  );
}

export function editPrefs() { openSheet((close) => <EditPrefs close={close} />, { label: 'Preferences' }); }
function EditPrefs({ close }: { close: () => void }) {
  const p = state.profile;
  const [who, setWho] = useState<string[]>(p.interested_in || ['male', 'female', 'other']);
  const [min, setMin] = useState(String(p.min_age));
  const [max, setMax] = useState(String(Math.min(p.max_age, 99)));
  const [where, setWhere] = useState<string>(p.pref_state || '');
  const [err, setErr] = useState('');
  return (
    <>
      <h2>Discovery preferences</h2>
      <p className="small muted">Discover only shows people who fit your preferences, and who you fit too.</p>
      <div className="field"><span>Show me</span><Chips multi options={GENDERS} value={who} onChange={(v) => setWho(v)} /></div>
      <div className="row">
        <label className="field grow"><span>From age</span><input className="input" type="number" min={18} max={99} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label className="field grow"><span>To age</span><input className="input" type="number" min={18} max={120} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      {api.features.states ? <label className="field"><span>Location</span><StateSelect anywhere states={STATES} value={where} onChange={setWhere} label="Location" />{p.state ? <p className="hint">Your state: {stateLabel(p.state)}</p> : null}</label> : null}
      <p className="error">{err}</p>
      <div className="sheet-actions"><button className="btn btn-dark btn-block" onClick={async () => {
        const a = Number(min), b = Number(max);
        if (!who.length) return setErr('Pick at least one.');
        if (!(a >= 18 && b >= a)) return setErr('Ages start at 18, and “to” must be at least “from”.');
        const fields: Record<string, any> = { interested_in: who, min_age: a, max_age: b >= 99 ? 120 : b };
        if (api.features.states) fields.pref_state = where || null;
        try { await api.updateProfile(p.handle, fields); Object.assign(p, fields); close(); emit('profile'); toast('Preferences saved'); }
        catch (e) { setErr(api.friendly(e)); }
      }}>Save</button></div>
    </>
  );
}
