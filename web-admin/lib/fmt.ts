const TZ = 'Africa/Lagos';

export const n = (v: number | string | null | undefined) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-NG'));

export function compact(v: number | null | undefined) {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return v.toLocaleString('en-NG');
}

export const pct = (a: number, b: number) => (b ? `${(Math.round((a / b) * 1000) / 10).toFixed(1)}%` : '—');

export function date(iso: string | null | undefined, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-NG', { timeZone: TZ, day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit', hour12: true } : {}) });
}

export function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.max(1, Math.round(f / 60))} min`;
    if (f < 86400) return `in ${Math.round(f / 3600)} h`;
    return `in ${Math.round(f / 86400)} d`;
  }
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return date(iso, false);
}

export const dayLabel = (d: string) => new Date(`${d}T12:00:00+01:00`).toLocaleDateString('en-NG', { timeZone: TZ, day: 'numeric', month: 'short' });

export const lagosInputToIso = (v: string) => (v ? new Date(`${v}:00+01:00`).toISOString() : null);
export function isoToLagosInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

export const words = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
