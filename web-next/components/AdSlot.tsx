'use client';
// A sponsored card set up by staff in admin.treehouse.ng. Shows nothing when there's no ad for this
// member and place (or the database doesn't have ads yet). One view and one tap are counted per day.
import { useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';

type Ad = { id: string; title: string; body: string; image_url: string | null; cta_label: string; cta_url: string; advertiser: string };
const cache = new Map<string, { at: number; ad: Ad | null }>();
const seen = new Set<string>();

export default function AdSlot({ placement }: { placement: 'home' | 'rooms' | 'discover' | 'inbox' }) {
  const [ad, setAd] = useState<Ad | null>(() => cache.get(placement)?.ad ?? null);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    const c = cache.get(placement);
    if (c && Date.now() - c.at < 5 * 60e3) { setAd(c.ad); return; }
    let live = true;
    api.adFor(placement).then((a: Ad | null) => { cache.set(placement, { at: Date.now(), ad: a || null }); if (live) setAd(a || null); })
      .catch(() => cache.set(placement, { at: Date.now(), ad: null }));
    return () => { live = false; };
  }, [placement]);

  useEffect(() => {
    const el = box.current;
    if (!ad || !el || seen.has(`${ad.id}:${placement}`) || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        timer = setTimeout(() => { seen.add(`${ad.id}:${placement}`); api.adEvent(ad.id, placement, 'view').catch(() => {}); io.disconnect(); }, 1000);
      } else if (timer) clearTimeout(timer);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => { io.disconnect(); if (timer) clearTimeout(timer); };
  }, [ad, placement]);

  if (!ad || !/^https:\/\//.test(ad.cta_url)) return null;
  return (
    <section ref={box} className="ad-slot" aria-label="Sponsored">
      <span className="ad-tag">Sponsored{ad.advertiser ? ` · ${ad.advertiser}` : ''}</span>
      <a href={ad.cta_url} target="_blank" rel="noopener noreferrer nofollow sponsored" onClick={() => { api.adEvent(ad.id, placement, 'tap').catch(() => {}); }}>
        {ad.image_url ? <img src={ad.image_url} alt="" loading="lazy" /> : null}
        <span className="ad-txt"><b>{ad.title}</b>{ad.body ? <span>{ad.body}</span> : null}</span>
        <span className="btn btn-primary btn-sm">{ad.cta_label}</span>
      </a>
    </section>
  );
}
