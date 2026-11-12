'use client';
// treehouse UI kit in React (port of anon-inbox/public/hy-ui.js). The class names are the same as
// the live app, so hy.css (copied to app/hy.css) styles both identically.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { PATHS } from '@/lib/icons';
import { avatarBg, initials, lagosToday, MONTHS } from '@/lib/util';
import { useAvatarPicture } from '@/lib/avatars';
import { toast } from './overlay';

export function Icon({ name, cls = '' }: { name: string; cls?: string }) {
  // Our own fixed icon markup (never user text), as in the live app.
  return <svg className={`icon ${cls}`.trim()} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] || '' }} />;
}

export function Logo() {
  return (
    <Link className="logo" href="/home" aria-label="treehouse home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo-mark" src="/treehouse-mark.svg" alt="" width={36} height={36} />
      <span className="wordmark">treehouse<i className="dot" aria-hidden="true" /></span>
    </Link>
  );
}

// CSS custom properties can't be set as React style keys without a cast.
export const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function Avatar({ seed, label, cls = '' }: { seed: string; label?: string; cls?: string }) {
  const pic = useAvatarPicture(seed);
  return (
    <span className={`avatar ${cls} ${pic ? 'has-av' : ''}`.trim()} style={vars({ '--av': avatarBg(seed) })} aria-hidden="true">
      {pic ? (
        <span className={`av-svg av-modern av-bg-${pic.bg}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pic.src} alt="" loading="lazy" decoding="async" draggable={false} />
        </span>
      ) : initials(label || seed)}
    </span>
  );
}

export function Hero({ title, sub, top, actions, cls = '', children }: { title?: ReactNode; sub?: ReactNode; top?: ReactNode; actions?: ReactNode; cls?: string; children?: ReactNode }) {
  return (
    <header className={`hero ${cls}`.trim()}>
      {top || title || actions ? (
        <div className="hero-top">{top || <h1>{title}</h1>}{actions ? <div className="hero-actions">{actions}</div> : null}</div>
      ) : null}
      {top && title ? <h1>{title}</h1> : null}
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </header>
  );
}

export function HeroBtn({ icon, label, onClick, badge = 0 }: { icon: string; label: string; onClick: () => void; badge?: number }) {
  return (
    <button className="hero-btn" aria-label={label} onClick={onClick}>
      <Icon name={icon} />
      {badge ? <span className="badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function EmptyState({ emoji, title, text, children }: { emoji: string; title: string; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-art"><span>{emoji}</span></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function SkeletonList({ n = 3, cls = 'sk-card' }: { n?: number; cls?: string }) {
  return <div className="list" aria-busy="true" aria-label="Loading">{Array.from({ length: n }, (_, i) => <div key={i} className={`skeleton ${cls}`} />)}</div>;
}

// Single-select (radio) or multi-select chips.
export function Chips({ options, value, onChange, multi = false, max = Infinity }: {
  options: [string, string][]; value: string | string[] | null; onChange: (v: string & string[]) => void; multi?: boolean; max?: number;
}) {
  const picked = new Set(([] as (string | null)[]).concat(value ?? []));
  return (
    <div className="chips" role={multi ? 'group' : 'radiogroup'}>
      {options.map(([v, label]) => (
        <button key={v} type="button" className="chip" aria-pressed={picked.has(v)} onClick={() => {
          if (multi) {
            const next = new Set(picked);
            if (next.has(v)) next.delete(v);
            else if (next.size < max) next.add(v);
            else return toast(`Pick up to ${max}`, 'sparkles');
            onChange([...next].filter(Boolean) as never);
          } else onChange(v as never);
        }}>{label}</button>
      ))}
    </div>
  );
}

export function StateSelect({ states, value, onChange, anywhere = false, placeholder = 'Choose your state', label, disabled }: {
  states: string[]; value: string; onChange: (v: string) => void; anywhere?: boolean; placeholder?: string; label?: string; disabled?: boolean;
}) {
  return (
    <select className="select" aria-label={label || placeholder} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {anywhere ? <option value="">Anywhere in Nigeria</option> : <option value="" disabled>{placeholder}</option>}
      {states.map((st) => <option key={st} value={st}>{st === 'FCT' ? 'FCT (Abuja)' : st}</option>)}
    </select>
  );
}

// Day / Month / Year menus. dobValue() turns the three into 'YYYY-MM-DD', '' or 'invalid'.
export type Dob = { d: string; m: string; y: string };
export const dobFrom = (iso?: string | null): Dob => {
  if (!iso) return { d: '', m: '', y: '' };
  const [y, m, d] = iso.split('-').map(Number);
  return { d: String(d), m: String(m), y: String(y) };
};
export function dobValue({ d, m, y }: Dob) {
  if (!d || !m || !y) return '';
  const Y = Number(y), M = Number(m), D = Number(d);
  const dt = new Date(Date.UTC(Y, M - 1, D));
  if (dt.getUTCDate() !== D) return 'invalid';
  const iso = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  const [cy, cm, cd] = lagosToday();
  if (iso > `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`) return 'invalid';
  return iso;
}
export function DobPicker({ value, onChange, disabled }: { value: Dob; onChange: (v: Dob) => void; disabled?: boolean }) {
  const [ty] = lagosToday();
  const sel = (key: keyof Dob, label: string, opts: [string, string][]) => (
    <select className="select" aria-label={label} value={value[key]} disabled={disabled} onChange={(e) => onChange({ ...value, [key]: e.target.value })}>
      <option value="" disabled>{label}</option>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div className="dob-row">
      {sel('d', 'Day', Array.from({ length: 31 }, (_, i) => [String(i + 1), String(i + 1)]))}
      {sel('m', 'Month', MONTHS.map((m, i) => [String(i + 1), m]))}
      {sel('y', 'Year', Array.from({ length: 101 }, (_, i) => [String(ty - i), String(ty - i)]))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => Promise<void> | void; label: string }) {
  const [on, setOn] = useState(!!checked);
  useEffect(() => { setOn(!!checked); }, [checked]);
  return (
    <span className="toggle">
      <input type="checkbox" role="switch" aria-label={label} checked={on} onChange={async (e) => {
        const v = e.target.checked; setOn(v);
        try { await onChange(v); } catch { setOn(!v); }
      }} />
      <i />
    </span>
  );
}

/** Runs `fn` once a second while mounted. */
export function useTicker(ms = 1000) {
  const [, set] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { ref.current = setInterval(() => set((n) => n + 1), ms); return () => { if (ref.current) clearInterval(ref.current); }; }, [ms]);
}
