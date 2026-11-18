'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { rpc } from '@/lib/sb';
import { allows, ROLE_LABEL, SECTIONS } from '@/lib/roles';
import { useMe } from './Gate';
import { Icon } from './Icon';
import { Avatar } from './ui';

export function useGo() {
  const router = useRouter();
  return (path: string) => router.push(path.startsWith('/') ? path : `/${path}`);
}

const SHORT: Record<string, string> = { '': 'Home', rooms: 'Rooms', announcements: 'Posts' };

export function Shell({ children }: { children: ReactNode }) {
  const { me, signOut } = useMe();
  const path = usePathname() || '/';
  const go = useGo();
  const section = path.split('/')[1] || '';
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<{ chat: number; room: number; link: number } | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('th-admin-theme');
    const d = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(d);
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
  }, []);
  const flip = () => {
    const d = !dark;
    setDark(d);
    localStorage.setItem('th-admin-theme', d ? 'dark' : 'light');
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
  };

  useEffect(() => {
    let live = true;
    const load = () => rpc<{ chat: number; room: number; link: number }>('staff_report_counts').then((c) => { if (live) setCounts(c); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, [path]);
  useEffect(() => { setOpen(false); setMenu(false); }, [path]);

  // On phones, tables turn into stacked cards; each value needs its column name next to it.
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    const label = () => {
      raf = 0;
      el.querySelectorAll<HTMLTableElement>('table.tbl').forEach((t) => {
        const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent?.trim() || '');
        t.querySelectorAll('tbody tr').forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            const l = heads[i] || '';
            if (td.getAttribute('data-label') !== l) td.setAttribute('data-label', l);
          });
        });
      });
    };
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(label); });
    mo.observe(el, { childList: true, subtree: true });
    label();
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const open_reports = counts ? counts.chat + counts.room + counts.link : 0;
  const groups: [string, string][] = [['main', 'Main menu'], ['grow', 'Grow'], ['admin', 'Admin']];
  // Phone bottom bar: the four most-used pages this role can open, then "More" for the full menu.
  const quick = ['', 'reports', 'members', 'rooms', 'announcements', 'calls']
    .map((id) => SECTIONS.find((x) => x.id === id)!)
    .filter((x) => allows(me.role, x.need))
    .slice(0, 4);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="side">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); go('/'); }}>
          <img src="/treehouse-mark.svg" alt="" width={34} height={34} />
          <span><b>treehouse</b><small>Admin</small></span>
        </a>
        <nav>
          {groups.map(([g, label]) => {
            const items = SECTIONS.filter((s) => s.group === g && allows(me.role, s.need));
            if (!items.length) return null;
            return (
              <div key={g} className="nav-g">
                <p className="nav-l">{label}</p>
                {items.map((s) => (
                  <a key={s.id} href={`/${s.id}`} className={`nav-i ${section === s.id ? 'on' : ''}`}
                    onClick={(e) => { e.preventDefault(); go(`/${s.id}`); }}>
                    <Icon name={s.icon} />{s.label}
                    {s.id === 'reports' && open_reports > 0 && <em className="badge">{open_reports > 99 ? '99+' : open_reports}</em>}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-card">
          <div className="side-card-i"><Icon name="shield" size={22} /></div>
          <b>Protected session</b>
          <p>Authenticator verified. Every change and every chat you open is recorded in the audit log.</p>
          <button className="btn pink sm" onClick={signOut}><Icon name="logout" size={15} />Sign out</button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="top">
          <button className="icon-btn only-m" onClick={() => setOpen(true)} aria-label="Menu"><Icon name="menu" /></button>
          {allows(me.role, 'moderate') ? (
            <form className="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(`/members?q=${encodeURIComponent(q.trim())}`); }}>
              <Icon name="search" size={17} />
              <input placeholder={allows(me.role, 'manage') ? 'Find a member by handle, @username or email…' : 'Find a member by handle or @username…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a member" />
              <kbd>Enter</kbd>
            </form>
          ) : <div className="search-spacer" />}
          <div className="top-r">
            <button className="icon-btn" onClick={flip} aria-label={dark ? 'Light theme' : 'Dark theme'}><Icon name={dark ? 'sun' : 'moon'} /></button>
            {allows(me.role, 'moderate') && (
              <button className="icon-btn bell" onClick={() => go('/reports')} aria-label={`${open_reports} open reports`}>
                <Icon name="bell" />{open_reports > 0 && <i />}
              </button>
            )}
            <div className="who" onClick={() => setMenu((m) => !m)} role="button" tabIndex={0}>
              <Avatar name={me.handle} size={38} />
              <div><b>{me.handle}</b><span>{ROLE_LABEL[me.role]}</span></div>
              <Icon name="down" size={16} />
              {menu && (
                <div className="menu" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => go('/staff')}><Icon name="shield" size={16} />Staff & roles</button>
                  <button onClick={signOut}><Icon name="logout" size={16} />Sign out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content" ref={contentRef}>{children}</main>
      </div>
      <nav className="bnav" aria-label="Main">
        {quick.map((x) => (
          <a key={x.id} href={`/${x.id}`} className={section === x.id && !open ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(`/${x.id}`); }}>
            <span className="bnav-i"><Icon name={x.icon} size={21} />
              {x.id === 'reports' && open_reports > 0 && <em className="badge">{open_reports > 99 ? '99+' : open_reports}</em>}</span>
            {SHORT[x.id] || x.label}
          </a>
        ))}
        <button type="button" className={open ? 'on' : ''} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="bnav-i"><Icon name="menu" size={21} /></span>More
        </button>
      </nav>
    </div>
  );
}
