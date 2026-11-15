'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type Toast = { id: number; text: string; bad?: boolean };
let pushToast: (t: Toast) => void = () => {};
let seq = 0;
export function toast(text: string, bad = false) { pushToast({ id: ++seq, text, bad }); }

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setList((l) => [...l, t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 4200);
    };
    return () => { pushToast = () => {}; };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} className={`toast ${t.bad ? 'bad' : ''}`}><Icon name={t.bad ? 'x' : 'check'} size={16} />{t.text}</div>)}
    </div>
  );
}

export function Btn({ children, onClick, kind = 'soft', icon, disabled, small, type = 'button', title }: {
  children?: ReactNode; onClick?: () => void; kind?: 'primary' | 'soft' | 'ghost' | 'danger' | 'pink'; icon?: string;
  disabled?: boolean; small?: boolean; type?: 'button' | 'submit'; title?: string;
}) {
  return (
    <button type={type} title={title} className={`btn ${kind} ${small ? 'sm' : ''}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={small ? 15 : 17} />}{children}
    </button>
  );
}

export function Card({ title, sub, action, children, className = '', pad = true }: {
  title?: ReactNode; sub?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-h">
          <div>{title && <h3>{title}</h3>}{sub && <p className="muted">{sub}</p>}</div>
          {action && <div className="card-a">{action}</div>}
        </header>
      )}
      <div className={pad ? 'card-b' : ''}>{children}</div>
    </section>
  );
}

export function Pill({ children, tone = 'grey' }: { children: ReactNode; tone?: 'green' | 'pink' | 'blue' | 'amber' | 'red' | 'grey' | 'violet' }) {
  return <span className={`pill ${tone}`}><i />{children}</span>;
}

export function Empty({ text, icon = 'check' }: { text: string; icon?: string }) {
  return <div className="empty"><Icon name={icon} size={26} /><p>{text}</p></div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="spin-wrap" aria-busy="true"><span className="spin" />{label}</div>;
}

export function ErrorBox({ text, retry }: { text: string; retry?: () => void }) {
  return <div className="errbox"><Icon name="x" size={18} /><span>{text}</span>{retry && <Btn small onClick={retry} icon="refresh">Try again</Btn>}</div>;
}

export function Modal({ title, onClose, children, wide, foot }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; foot?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <header><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></header>
        <div className="modal-b">{children}</div>
        {foot && <footer>{foot}</footer>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="field"><span className="field-l">{label}</span>{children}{hint && <span className="field-h">{hint}</span>}</label>;
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function Tabs({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, ReactNode][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const parts = (name || '?').replace(/[_\d]+/g, ' ').trim().split(/\s+|(?=[A-Z])/).filter(Boolean);
  const ini = ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  let h = 0;
  for (const ch of name || '') h = (h * 31 + ch.charCodeAt(0)) % 360;
  return <span className="av" style={{ width: size, height: size, background: `hsl(${h} 85% 94%)`, color: `hsl(${h} 60% 38%)` }}>{ini}</span>;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-h">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {actions && <div className="page-a">{actions}</div>}
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    fn().then((d) => { if (live) { setData(d); setLoading(false); } })
      .catch((e) => { if (live) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setLoading(false); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

export function Ask({ title, text, confirm, danger, reason, reasonLabel = 'Reason', options, onDone, onClose }: {
  title: string; text?: ReactNode; confirm: string; danger?: boolean; reason?: boolean; reasonLabel?: string;
  options?: [string, string][]; onDone: (reason: string, option: string) => Promise<void>; onClose: () => void;
}) {
  const [r, setR] = useState('');
  const [opt, setOpt] = useState(options?.[0]?.[0] || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { await onDone(r.trim(), opt); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} foot={<>
      <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
      <Btn kind={danger ? 'danger' : 'primary'} disabled={busy || (reason && r.trim().length < 3)} onClick={go}>{busy ? 'Working…' : confirm}</Btn>
    </>}>
      {text && <div className="ask-t">{text}</div>}
      {options && (
        <Field label="Length">
          <select value={opt} onChange={(e) => setOpt(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
      )}
      {reason && (
        <Field label={reasonLabel} hint="Saved in the audit log.">
          <textarea rows={3} value={r} onChange={(e) => setR(e.target.value)} maxLength={500} autoFocus />
        </Field>
      )}
      {err && <ErrorBox text={err} />}
    </Modal>
  );
}
