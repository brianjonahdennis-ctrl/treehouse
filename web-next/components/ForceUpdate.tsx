'use client';
// Old Android app builds (below 1.6) lack the plugin that makes the back button work, so they must be
// updated. On those builds only, this covers everything (signed in or not) with no way past it.
// The Update button is a plain link to app.treehouse.ng: the old apps open any address other than
// treehouse.ng / www.treehouse.ng / tell.brianjonahdennis.com in the phone's browser, which can
// download and install the APK (inside the app the download would silently do nothing).
import { useEffect, useState } from 'react';

const DOWNLOAD = 'https://app.treehouse.ng/download/android';
const MIN: [number, number] = [1, 6];

export function needsAndroidUpdate(ua: string) {
  if (!/Android/i.test(ua)) return false;   // the iPhone app also says TreehouseApp/1.4: not for it
  const m = /TreehouseApp\/(\d+)\.(\d+)/.exec(ua);
  if (!m) return false;                       // a normal browser
  const major = Number(m[1]), minor = Number(m[2]);
  return major < MIN[0] || (major === MIN[0] && minor < MIN[1]);
}

export default function ForceUpdate({ preview = false }: { preview?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(preview || needsAndroidUpdate(navigator.userAgent || '')); }, [preview]);
  useEffect(() => {
    if (!show) return;
    document.body.style.overflow = 'hidden';
    // Everything behind it is switched off, so nothing can be tapped or focused there.
    document.querySelectorAll('#app > :not(.force-update), body > :not(#app):not(script)').forEach((el) => {
      if (!el.querySelector('.force-update')) el.setAttribute('inert', '');
    });
  }, [show]);
  if (!show) return null;
  return (
    <section className="force-update" role="alertdialog" aria-modal="true" aria-labelledby="fu-title">
      <div className="fu-card">
        <div className="install-art"><img src="/icon-192.png" alt="" width={72} height={72} /></div>
        <h1 id="fu-title">Update treehouse</h1>
        <p>A new version of treehouse is ready. Update to keep using it. The back button now works properly.</p>
        <p className="fu-steps">Tap Update, open the downloaded file and tap Install. You’ll stay signed in.</p>
        <a className="btn btn-primary btn-block" href={DOWNLOAD}>Update</a>
        <p className="fu-link">app.treehouse.ng/download/android</p>
      </div>
    </section>
  );
}
