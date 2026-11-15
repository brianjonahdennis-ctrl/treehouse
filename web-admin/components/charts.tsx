'use client';
import { useId, useState } from 'react';
import { compact } from '@/lib/fmt';

export function Spark({ values, color = 'var(--blue)', height = 54 }: { values: number[]; color?: string; height?: number }) {
  const id = useId().replace(/:/g, '');
  const v = values.length > 1 ? values : [0, ...(values.length ? values : [0])];
  const max = Math.max(...v, 1);
  const min = Math.min(...v, 0);
  const w = 200;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * w, height - 4 - ((y - min) / (max - min || 1)) * (height - 10)]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#g${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export type Series = { name: string; color: string; values: number[] };

export function Bars({ labels, series, height = 260 }: { labels: string[]; series: Series[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const top = niceMax(Math.max(...totals, 1));
  const W = 720, H = height, L = 44, B = 28, T = 10;
  const iw = W - L - 8, ih = H - B - T;
  const step = iw / Math.max(labels.length, 1);
  const bw = Math.min(30, step * 0.58);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const every = Math.ceil(labels.length / 12);
  return (
    <div className="bars">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        {ticks.map((t) => {
          const y = T + ih - (t / top) * ih;
          return <g key={t}><line x1={L} x2={W - 8} y1={y} y2={y} className="grid" /><text x={L - 8} y={y + 4} className="axis" textAnchor="end">{compact(Math.round(t))}</text></g>;
        })}
        {labels.map((lab, i) => {
          let acc = 0;
          const x = L + i * step + (step - bw) / 2;
          return (
            <g key={lab + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * step} y={T} width={step} height={ih} fill="transparent" />
              {series.map((s, k) => {
                const v = s.values[i] || 0;
                const h = (v / top) * ih;
                const y = T + ih - acc - h;
                acc += h;
                const last = k === series.length - 1 || series.slice(k + 1).every((z) => !(z.values[i] || 0));
                return v > 0 ? <rect key={s.name} x={x} y={y} width={bw} height={Math.max(h - (last ? 0 : 2), 1)} rx={last ? 6 : 2} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} /> : null;
              })}
              {i % every === 0 && <text x={x + bw / 2} y={H - 8} className="axis" textAnchor="middle">{lab}</text>}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="bars-tip" style={{ left: `${((L + hover * step + step / 2) / W) * 100}%` }}>
          <b>{labels[hover]}</b>
          {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}: {(s.values[hover] || 0).toLocaleString('en-NG')}</span>)}
        </div>
      )}
    </div>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function Legend({ series }: { series: { name: string; color: string }[] }) {
  return <div className="legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>;
}

export function Ring({ value, max, color = 'var(--blue)', label, size = 74 }: { value: number; max: number; color?: string; label?: string; size?: number }) {
  const r = 30, c = 2 * Math.PI * r;
  const f = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <svg className="ring" width={size} height={size} viewBox="0 0 74 74" aria-hidden="true">
      <circle cx="37" cy="37" r={r} className="ring-bg" />
      <circle cx="37" cy="37" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 37 37)" />
      <text x="37" y="41" textAnchor="middle" className="ring-t" fill={color}>{label ?? Math.round(f * 100)}</text>
    </svg>
  );
}

export function Donut({ parts, size = 168, center, sub }: { parts: { name: string; value: number; color: string }[]; size?: number; center: string; sub: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 64, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" className="donut" role="img" aria-label={sub}>
      <circle cx="84" cy="84" r={r} className="ring-bg" strokeWidth="18" />
      {parts.map((p) => {
        const len = (p.value / total) * c;
        const el = <circle key={p.name} cx="84" cy="84" r={r} fill="none" stroke={p.color} strokeWidth="18"
          strokeDasharray={`${Math.max(len - 3, 0)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 84 84)" strokeLinecap="round" />;
        acc += len;
        return el;
      })}
      <text x="84" y="80" textAnchor="middle" className="donut-n">{center}</text>
      <text x="84" y="101" textAnchor="middle" className="donut-s">{sub}</text>
    </svg>
  );
}
