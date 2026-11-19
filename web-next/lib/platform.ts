'use client';
// The iPhone app (App Store) leads with community: Chatrooms in the centre, Games and My Treehouse
// first on Home, and meeting people as one feature among many. Android and the website are unchanged.
// Preview (mock mode): sessionStorage.setItem('mock-ios-app', '1') (or ?ios-app=1 on any page but /home) shows the iPhone layout.
import { useEffect, useState } from 'react';
import { isNativeApp } from './api';

export function iosApp(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_TH_MOCK === '1') {
    try {
      const q = new URLSearchParams(location.search).get('ios-app');
      if (q === '1' || q === '0') sessionStorage.setItem('mock-ios-app', q);
      if (sessionStorage.getItem('mock-ios-app') === '1') return true;
    } catch {}
  }
  return isNativeApp() && !/Android/i.test(navigator.userAgent || '');
}

// After the first render, so the server-rendered page and the first app render match.
export function useIosApp(): boolean {
  const [ios, setIos] = useState(false);
  useEffect(() => { setIos(iosApp()); }, []);
  return ios;
}
