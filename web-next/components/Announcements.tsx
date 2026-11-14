'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
// Inbox → Announcements: official messages from treehouse (not chats). The list loads only when this
// tab is open (20 at a time); the unread count comes with the normal Inbox load. Read, archive and
// button taps are saved in the database, so every device shows the same thing.
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import * as api from '@/lib/api';
import { state, useAppState } from '@/lib/state';
import { go } from '@/lib/nav';
import { CATS, parseBody, parseInline, safeLink, safeImage, annDate, annShortDate, setAnnUnread, type Ann, type Inline } from '@/lib/announcements';
import { Icon, EmptyState, SkeletonList } from './ui';
import { toast } from './overlay';

type Filter = 'all' | 'unread' | 'read' | 'archived';
let lastFilter: Filter = 'all';
const cache: Partial<Record<Filter, { items: Ann[]; more: boolean }>> = {};

export function CatTag({ cat }: { cat: string }) {
  const c = CATS[cat] || CATS.product_update;
  return <span className={`ann-tag tone-${c.tone}`}><Icon name={c.icon} cls="sm" />{c.label}</span>;
}
export function OfficialSender({ sub }: { sub?: ReactNode }) {
  return (
    <span className="ann-sender">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <span className="ann-sender-mark"><img src="/treehouse-mark.svg" alt="" width={22} height={22} /></span>
      <span className="grow"><b>Treehouse Official <span className="ann-verified" aria-label="Verified"><Icon name="check" cls="sm" /></span></b>{sub ? <span className="tiny muted">{sub}</span> : null}</span>
    </span>
  );
}

// ---- The tab --------------------------------------------------------------------------------------------
export function AnnouncementsTab() {
  const s = useAppState();
  const [filter, setFilter] = useState<Filter>(lastFilter);
  const [data, setData] = useState(cache[filter] || null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async (f: Filter, more = false) => {
    setBusy(true); setFailed(false);
    try {
      const prev = more ? cache[f]?.items || [] : [];
      const before = more && prev.length ? prev[prev.length - 1].delivered_at || null : null;
      const rows: Ann[] = await api.myAnnouncements(f, before, 20);
      cache[f] = { items: [...prev, ...rows], more: rows.length === 20 };
      setData(cache[f]!);
    } catch { setFailed(true); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f: Filter) => { lastFilter = f; setFilter(f); setData(cache[f] || null); };
  const markAll = async () => {
    try {
      await api.markAllAnnouncementsRead();
      setAnnUnread(0);
      for (const k of Object.keys(cache) as Filter[]) delete cache[k];
      load(filter);
      toast('All announcements marked as read');
    } catch (e) { toast(api.friendly(e), 'x'); }
  };
  const chip = (id: Filter, label: string, n?: number) => (
    <button className={`chip ${filter === id ? 'on' : ''}`} onClick={() => pick(id)} aria-pressed={filter === id}>{label}{n ? <span className="badge talk">{n}</span> : null}</button>
  );
  const items = data ? data.items : [];
  return (
    <div className="stack-lg">
      <div className="ann-bar">
        <div className="chips" role="group" aria-label="Show">{chip('all', 'All')}{chip('unread', 'Unread', s.annUnread)}{chip('read', 'Read')}{chip('archived', 'Archived')}</div>
        {s.annUnread ? <button className="btn btn-ghost btn-sm" onClick={markAll}><Icon name="check" cls="sm" />Mark all read</button> : null}
      </div>
      {!data && busy ? <SkeletonList n={3} />
        : failed && !items.length ? <div className="card ib-empty"><p>Couldn’t load announcements.</p><button className="btn btn-soft btn-sm" onClick={() => load(filter)}>Try again</button></div>
        : !items.length ? <EmptyState emoji={filter === 'archived' ? '🗂️' : '📣'} title={filter === 'unread' ? 'You’re all caught up' : filter === 'archived' ? 'Nothing archived' : 'No announcements yet'}
            text={filter === 'archived' ? 'Announcements you archive appear here.' : 'News from treehouse (new features, events and important notices) will appear here.'} />
        : (
          <div className="ann-list">
            {items.map((a) => <AnnCard key={a.id} a={a} />)}
            {data && data.more ? <button className="btn btn-soft btn-block" disabled={busy} onClick={() => load(filter, true)}>{busy ? 'Loading…' : 'Show older'}</button> : null}
          </div>
        )}
    </div>
  );
}

function AnnCard({ a }: { a: Ann }) {
  const unread = !a.read_at;
  const cover = safeImage(a.cover_url);
  const c = CATS[a.category] || CATS.product_update;
  const cta = safeLink(a.cta_url);
  return (
    <article className={`ann-card ${unread ? 'unread' : ''}`}>
      <button className="ann-card-main" onClick={() => go(`matches/announcements/${a.id}`)} aria-label={`${unread ? 'Unread: ' : ''}${a.title}`}>
        <span className={`ann-thumb tone-${c.tone}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name={c.icon} />}
        </span>
        <span className="grow">
          <span className="ann-kicker">TREEHOUSE OFFICIAL</span>
          <span className="row-between"><b className="ann-title">{a.title}</b>{unread ? <i className="ann-dot" aria-hidden="true" /> : null}</span>
          <span className="ann-preview">{a.preview}</span>
          <span className="row-between ann-foot"><CatTag cat={a.category} /><span className="when">{annShortDate(a.published_at)}{unread ? ' · New' : ''}</span></span>
        </span>
      </button>
      {cta && a.cta_label ? <div className="ann-card-cta"><CtaButton a={a} small /></div> : null}
    </article>
  );
}

export function CtaButton({ a, small = false, preview = false }: { a: Pick<Ann, 'id' | 'cta_label' | 'cta_url'>; small?: boolean; preview?: boolean }) {
  const l = safeLink(a.cta_url);
  if (!l || !a.cta_label) return null;
  const cls = `btn btn-coral ${small ? 'btn-sm' : 'btn-block btn-lg'} ann-cta`;
  const ico = l.internal ? (/nearby/.test(l.href) ? 'pin' : 'chev') : 'link';
  if (preview) return <span className={cls}><Icon name={ico} cls="sm" />{a.cta_label}</span>;
  const track = () => { api.markAnnouncement(a.id, 'click').catch(() => {}); };
  if (l.internal) return <Link className={cls} href={l.href} onClick={track}><Icon name={ico} cls="sm" />{a.cta_label}</Link>;
  return <a className={cls} href={l.href} target="_blank" rel="noopener noreferrer nofollow" onClick={track}><Icon name={ico} cls="sm" />{a.cta_label}</a>;
}

// ---- Rich content (Markdown-lite → React; no HTML) ------------------------------------------------------
function Inl({ parts, preview }: { parts: Inline[]; preview?: boolean }) {
  return <>{parts.map((p, i) => p.t === 'b' ? <strong key={i}>{p.v}</strong>
    : p.t === 'a' ? (preview ? <span key={i} className="ann-link">{p.v}</span>
      : p.internal ? <Link key={i} className="ann-link" href={p.href}>{p.v}</Link>
      : <a key={i} className="ann-link" href={p.href} target="_blank" rel="noopener noreferrer nofollow">{p.v}</a>)
    : <span key={i}>{p.v}</span>)}</>;
}
export function AnnBody({ text, preview = false }: { text: string; preview?: boolean }) {
  const blocks = parseBody(text);
  return (
    <div className="ann-body">
      {blocks.map((b, i) => {
        if (b.t === 'h') return b.level === 2 ? <h2 key={i}><Inl parts={parseInline(b.text)} preview={preview} /></h2> : <h3 key={i}><Inl parts={parseInline(b.text)} preview={preview} /></h3>;
        if (b.t === 'p') return <p key={i}><Inl parts={parseInline(b.text)} preview={preview} /></p>;
        if (b.t === 'ul') return <ul key={i} className="ann-checks">{b.items.map((it, j) => <li key={j}><span className="ann-check"><Icon name="check" cls="sm" /></span><span><Inl parts={parseInline(it)} preview={preview} /></span></li>)}</ul>;
        if (b.t === 'ol') return <ol key={i}>{b.items.map((it, j) => <li key={j}><Inl parts={parseInline(it)} preview={preview} /></li>)}</ol>;
        // eslint-disable-next-line @next/next/no-img-element
        if (b.t === 'img') return <img key={i} className="ann-inline-img" src={b.src} alt={b.alt} loading="lazy" />;
        if (b.t !== 'btn') return null;
        const l = safeLink(b.href)!;
        if (preview) return <span key={i} className="btn btn-soft btn-block">{b.label}</span>;
        return l.internal ? <Link key={i} className="btn btn-soft btn-block" href={l.href}>{b.label}</Link>
          : <a key={i} className="btn btn-soft btn-block" href={l.href} target="_blank" rel="noopener noreferrer nofollow">{b.label}<Icon name="link" cls="sm" /></a>;
      })}
    </div>
  );
}

/** The full announcement, as members see it. Also used by the admin preview (preview = true). */
export function AnnView({ a, preview = false, actions }: { a: Ann; preview?: boolean; actions?: ReactNode }) {
  const cover = safeImage(a.cover_url);
  return (
    <article className="ann-detail">
      <div className="ann-detail-head"><OfficialSender sub="Announcement" /></div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {cover ? <img className="ann-cover" src={cover} alt="" /> : <div className={`ann-cover ann-cover-plain tone-${(CATS[a.category] || CATS.product_update).tone}`}><Icon name={(CATS[a.category] || CATS.product_update).icon} /></div>}
      <div className="ann-detail-body">
        <CatTag cat={a.category} />
        <h1 className="ann-h1">{a.title}</h1>
        <p className="ann-lede">{a.preview}</p>
        <AnnBody text={a.body || ''} preview={preview} />
        <CtaButton a={a} preview={preview} />
        <p className="ann-published"><Icon name="calendar" cls="sm" />{a.published_at ? `Published: ${annDate(a.published_at, true)}` : 'Not published yet'}</p>
        {actions}
      </div>
    </article>
  );
}

export function AnnDetail({ id }: { id: string }) {
  const [a, setA] = useState<Ann | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api.openAnnouncement(id).then((x: Ann) => {
      if (!live) return;
      setA(x);
      // Opening marks it read: update the badge and any cached list without another request.
      let counted = false;
      for (const k of Object.keys(cache) as Filter[]) {
        const it = cache[k]!.items.find((y) => y.id === id);
        if (it && !it.read_at) { it.read_at = new Date().toISOString(); if (!it.archived_at && !counted) { counted = true; setAnnUnread(state.annUnread - 1); } }
      }
      delete cache.unread; delete cache.read;
      if (!Object.values(cache).some((c) => c && c.items.some((y) => y.id === id))) api.announcementsUnread().then(setAnnUnread).catch(() => {});
    }).catch((e) => { if (live) setErr(/not found/i.test(String(e && e.message)) ? 'This announcement isn’t available.' : api.friendly(e)); });
    return () => { live = false; };
  }, [id]);
  const back = () => go('matches/announcements');
  const toggleArchive = async () => {
    if (!a) return;
    const on = !a.archived_at;
    try {
      await api.markAnnouncement(a.id, on ? 'archive' : 'unarchive');
      for (const k of Object.keys(cache) as Filter[]) delete cache[k];
      toast(on ? 'Archived. Find it under Archived.' : 'Moved back to your announcements', on ? 'archive' : 'check');
      back();
    } catch (e) { toast(api.friendly(e), 'x'); }
  };
  return (
    <div className="ann-page">
      <div className="ann-topbar">
        <button className="btn btn-ghost btn-icon" onClick={back} aria-label="Back to announcements"><Icon name="back" /></button>
        <span className="grow" />
        {a ? <button className="btn btn-ghost btn-sm" onClick={toggleArchive}><Icon name="archive" cls="sm" />{a.archived_at ? 'Unarchive' : 'Archive'}</button> : null}
      </div>
      {err ? <EmptyState emoji="📭" title="Not available" text={err}><button className="btn btn-primary" onClick={back}>Back to announcements</button></EmptyState>
        : !a ? <SkeletonList n={2} />
        : <AnnView a={a} actions={<>
            {a.revised_by ? <button className="ann-note" onClick={() => go(`matches/announcements/${a.revised_by}`)}><Icon name="info" cls="sm" />There’s an updated version of this announcement. Tap to read it.</button> : null}
            {a.revises ? <button className="ann-note" onClick={() => go(`matches/announcements/${a.revises}`)}><Icon name="info" cls="sm" />This updates an earlier announcement. Tap to see the original.</button> : null}
          </>} />}
    </div>
  );
}
