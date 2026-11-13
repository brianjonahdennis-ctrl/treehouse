'use client';
// Toasts and sheets (bottom sheet on phones, centred dialog on wide screens), callable from anywhere:
//   toast('Saved', 'check')
//   openSheet((close) => <>...</>, { label: 'Edit' })
//   if (await confirmSheet({ title: 'Delete?', danger: true })) ...
// Same markup and classes as anon-inbox/public/hy-ui.js.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { PATHS } from '@/lib/icons';

type Sheet = { id: number; build: (close: () => void) => ReactNode; label: string; onClose?: () => void; raw?: boolean };
let sheets: Sheet[] = [];
let toastNow: { id: number; text: string; icon: string } | null = null;
let nextId = 1;
let version = 0;
const subs = new Set<() => void>();
const bump = () => { version++; subs.forEach((f) => f()); };

export function toast(text: string, icon = 'check') {
  const id = nextId++;
  toastNow = { id, text, icon };
  bump();
  setTimeout(() => { if (toastNow && toastNow.id === id) { toastNow = null; bump(); } }, 2600);
}

// raw: draw build() as-is (full-screen overlays such as the match moment), without the sheet frame.
export function openSheet(build: (close: () => void) => ReactNode, { label = 'Dialog', onClose, raw = false }: { label?: string; onClose?: () => void; raw?: boolean } = {}) {
  const id = nextId++;
  sheets = [...sheets, { id, build, label, onClose, raw }];
  bump();
  return { close: () => closeSheet(id) };
}
function closeSheet(id: number) {
  const s = sheets.find((x) => x.id === id);
  if (!s) return;
  sheets = sheets.filter((x) => x.id !== id);
  bump();
  if (s.onClose) s.onClose();
}

export function confirmSheet({ title, text, yes = 'Confirm', danger = false }: { title: string; text?: string; yes?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => {
    let answered = false;
    openSheet((close) => (
      <>
        <h2>{title}</h2>
        {text ? <p className="muted">{text}</p> : null}
        <div className="sheet-actions">
          <button className={`btn ${danger ? 'btn-danger' : 'btn-dark'} btn-block`} onClick={() => { answered = true; close(); resolve(true); }}>{yes}</button>
          <button className="btn btn-soft btn-block" onClick={() => close()}>Cancel</button>
        </div>
      </>
    ), { label: title, onClose: () => { if (!answered) resolve(false); } });
  });
}

function SheetView({ s }: { s: Sheet }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sheets[sheets.length - 1]?.id === s.id) closeSheet(s.id); };
    document.addEventListener('keydown', onKey);
    const first = box.current?.querySelector<HTMLElement>('input, textarea, button, select');
    const t = setTimeout(() => first?.focus({ preventScroll: true }), 50);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [s.id]);
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) closeSheet(s.id); }}>
      <div ref={box} className="sheet" role="dialog" aria-modal="true" aria-label={s.label}>{s.build(() => closeSheet(s.id))}</div>
    </div>
  );
}

/** Mount once (in the /home layout). */
export function OverlayHost() {
  useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => version, () => 0);
  return (
    <>
      {sheets.map((s) => (s.raw ? <div key={s.id} style={{ display: 'contents' }}>{s.build(() => closeSheet(s.id))}</div> : <SheetView key={s.id} s={s} />))}
      {toastNow ? (
        <div className="toast-wrap" role="status" aria-live="polite">
          <div className="toast" key={toastNow.id}>
            <svg className="icon sm" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[toastNow.icon] || '' }} />
            {toastNow.text}
          </div>
        </div>
      ) : <div className="toast-wrap" role="status" aria-live="polite" />}
    </>
  );
}
