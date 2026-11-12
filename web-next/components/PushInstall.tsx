'use client';
// On-screen controls for push notifications and "Add to Home Screen" (ports of the card, rows and
// sheets in anon-inbox/public/hy-push.js and hy-install.js).
import { useEffect, useState, type ReactNode } from 'react';
import * as push from '@/lib/push';
import * as inst from '@/lib/install';
import { emit, useAppState } from '@/lib/state';
import { Icon, Toggle } from './ui';
import { openSheet, toast } from './overlay';

const refresh = () => emit('push');

// ---- Sheets --------------------------------------------------------------------------------------
function iphonePushSheet() {
  openSheet((close) => (
    <>
      <h2>🔔 Notifications on iPhone</h2>
      <p className="muted">iPhone only sends notifications to apps on your Home Screen. It takes a few seconds:</p>
      <ol className="steps-list">
        <li>Open treehouse in <b>Safari</b>.</li>
        <li>Tap the <b>Share</b> button (the square with an arrow).</li>
        <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        <li>Open treehouse from your Home Screen and turn on notifications in Profile.</li>
      </ol>
      <p className="tiny muted">Needs iOS 16.4 or newer.</p>
      <div className="sheet-actions"><button className="btn btn-primary btn-block" onClick={close}>Got it</button></div>
    </>
  ), { label: 'Notifications on iPhone' });
}

function blockedSheet() {
  openSheet((close) => (
    <>
      <h2>Notifications are blocked</h2>
      <p className="muted">{push.isIOS()
        ? 'Open your iPhone Settings → Notifications → treehouse, and turn on Allow Notifications.'
        : 'Open your phone Settings → Apps → your browser (or treehouse) → Notifications, and allow them for treehouse. In Chrome you can also tap the lock icon next to the address.'}</p>
      <div className="sheet-actions"><button className="btn btn-primary btn-block" onClick={close}>OK</button></div>
    </>
  ), { label: 'Notifications are blocked' });
}

async function turnOn() {
  try {
    const r = await push.enable();
    if (r === 'granted') toast('Notifications are on', 'bell');
    else if (r === 'denied') blockedSheet();
  } catch (e) { toast((e as Error).message || 'Couldn’t turn on notifications', 'x'); }
  refresh();
}

const ShareIcon = () => <span className="kbd-icon" aria-label="Share"><Icon name="share" cls="sm" /></span>;
function installSteps(): { title: string; intro: string; steps: ReactNode[]; note?: string } {
  const ios = inst.isIOS();
  if (inst.inAppBrowser()) return {
    title: 'Open treehouse in your browser first',
    intro: 'You’re inside another app’s browser, which can’t add treehouse to your Home Screen.',
    steps: [
      <>Tap the <b>⋯</b> or <b>⋮</b> menu at the top of this screen.</>,
      <>Choose <b>{ios ? 'Open in Safari' : 'Open in browser'}</b> (or <b>Open in Chrome</b>).</>,
      <>Then come back here and tap <b>Add to Home Screen</b> again.</>],
  };
  if (ios) {
    const other = inst.iosOtherBrowser();
    return {
      title: 'Add treehouse to your Home Screen',
      intro: other ? 'This works best in Safari, but you can do it here too:' : 'It takes a few seconds:',
      steps: [
        <>Tap the <ShareIcon /> <b>Share</b> button{other ? ' (in the address bar or menu).' : ' at the bottom of Safari.'}</>,
        <>Scroll down and tap <b>Add to Home Screen</b>.</>,
        <>Tap <b>Add</b>. Then open treehouse from your Home Screen.</>],
      note: 'Don’t see the Share button? Tap the address bar once and it appears.',
    };
  }
  if (inst.samsung()) return {
    title: 'Add treehouse to your Home screen',
    intro: 'In Samsung Internet:',
    steps: [
      <>Tap the <b>☰</b> menu at the bottom right.</>,
      <>Tap <b>Add page to</b>, then <b>Home screen</b>.</>,
      <>Tap <b>Add</b>. Then open treehouse from your Home screen.</>],
  };
  return {
    title: 'Add treehouse to your Home screen',
    intro: 'In Chrome:',
    steps: [
      <>Tap the <b>⋮</b> menu at the top right.</>,
      <>Tap <b>Add to Home screen</b> or <b>Install app</b>.</>,
      <>Tap <b>Install</b> (or <b>Add</b>). Then open treehouse from your Home screen.</>],
  };
}
function installSheet() {
  const s = installSteps();
  openSheet((close) => (
    <>
      <div className="install-art"><img src="/icon-192.png" alt="" width={64} height={64} /></div>
      <h2 className="center">{s.title}</h2>
      <p className="muted center">{s.intro}</p>
      <ol className="steps-list">{s.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
      {s.note ? <p className="tiny muted">{s.note}</p> : null}
      <p className="small muted">You’ll get the full-screen app with its own icon, and you can turn on notifications for new messages and matches.</p>
      <div className="sheet-actions"><button className="btn btn-primary btn-block" onClick={close}>Got it</button></div>
    </>
  ), { label: s.title });
}
async function install() {
  const r = await inst.prompt();
  if (r === null) installSheet();
  else if (r === 'accepted') toast('treehouse is on your Home screen', 'check');
  refresh();
}

// Client-only checks (they read the browser), so render nothing until mounted.
function useMounted() { const [m, setM] = useState(false); useEffect(() => setM(true), []); return m; }

// ---- Home card: "Get the app" if not installed, otherwise "Turn on notifications" ----------------
export function HomeAppCard() {
  useAppState();
  if (!useMounted()) return null;
  if (inst.showCard()) return (
    <div className="card install-card">
      <img className="install-icon" src="/icon-192.png" alt="" width={48} height={48} />
      <div className="grow"><b>Get the treehouse app</b><p className="small muted">Add it to your Home Screen: it opens full screen, like a real app, and can notify you about new messages.</p></div>
      <div className="push-actions">
        <button className="btn btn-primary btn-sm" onClick={install}><Icon name="plus" cls="sm" />Add to Home Screen</button>
        <button className="btn btn-soft btn-sm" onClick={() => { inst.dismiss(); refresh(); }}>Not now</button>
      </div>
    </div>
  );
  if (push.dismissedRecently() || push.needsInstall() || !push.supported() || !push.ready() || push.isOn() || push.permission() === 'denied') return null;
  return (
    <div className="card push-card">
      <span className="push-icon"><Icon name="bell" /></span>
      <div className="grow"><b>Never miss a message</b><p className="small muted">Get a notification when someone messages, likes or matches with you.</p></div>
      <div className="push-actions">
        <button className="btn btn-primary btn-sm" onClick={turnOn}>Turn on</button>
        <button className="btn btn-soft btn-sm" onClick={() => { push.dismiss(); refresh(); }}>Not now</button>
      </div>
    </div>
  );
}

// ---- Profile → Notifications rows ---------------------------------------------------------------
function SettingsRow({ sub, control, onClick }: { sub: string; control?: ReactNode; onClick?: () => void }) {
  const inner = <><Icon name="bell" /><span className="grow">Push notifications<span className="sub">{sub}</span></span>{control}</>;
  return onClick ? <button className="settings-row" onClick={onClick}>{inner}</button> : <div className="settings-row" style={{ cursor: 'default' }}>{inner}</div>;
}
const Chev = () => <span className="chev"><Icon name="chev" cls="sm" /></span>;
export function PushRow() {
  useAppState();
  if (!useMounted()) return null;
  if (push.needsInstall()) return <SettingsRow sub="Add treehouse to your Home Screen first" control={<Chev />} onClick={iphonePushSheet} />;
  if (push.isNative()) return <SettingsRow sub="Coming soon in the app. For now, use treehouse from your Home Screen" />;
  if (!push.supported()) return <SettingsRow sub="Not available in this browser" />;
  if (!push.ready()) return <SettingsRow sub="Not available right now" />;
  if (push.permission() === 'denied') return <SettingsRow sub="Blocked in your phone settings. Tap to see how to allow them" control={<Chev />} onClick={blockedSheet} />;
  const on = push.isOn();
  return <SettingsRow sub={on ? 'On for this device. They never show names or messages' : 'Get notified about messages, likes and matches'}
    control={<Toggle key={String(on)} checked={on} label="Push notifications" onChange={async (want) => {
      if (want) { await turnOn(); if (!push.isOn()) throw new Error('off'); }
      else { await push.disable(); toast('Notifications are off', 'bell'); refresh(); }
    }} />} />;
}
export function InstallRow() {
  useAppState();
  if (!useMounted() || !inst.canSuggest()) return null;
  return <button className="settings-row" onClick={install}><Icon name="plus" /><span className="grow">Add to Home Screen<span className="sub">Use treehouse like an app, with its own icon</span></span><Chev /></button>;
}
