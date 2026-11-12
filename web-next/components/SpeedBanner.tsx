'use client';
// The Speed Dating banner on Discover (speedBanner() in components/speed.js draws it).
import { useEffect, useRef } from 'react';
import { speedBanner } from './speed';

export default function SpeedBanner() {
  const slot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = speedBanner();
    if (el && slot.current) slot.current.replaceChildren(el);
    return () => { slot.current?.replaceChildren(); };
  }, []);
  return <div ref={slot} style={{ display: 'contents' }} />;
}
