import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { TrendingDown, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { faNum } from '../lib/format';

/**
 * Shared building blocks of the staff/admin panels (تک پیشخوان design):
 * glossy pastel stat cards, donut/ring gauges, smooth RTL line charts and
 * image heroes. Every value rendered here comes from the real API — these
 * components only draw.
 */

/** Glossy pastel bubble holding one icon — the mock's signature art chip. */
export function IconBubble({ color = '#2563eb', children, className }: {
  color?: string; children: ReactNode; className?: string;
}) {
  return (
    <span className={clsx('relative grid shrink-0 place-items-center', className ?? 'size-14')} aria-hidden="true">
      <span
        className="absolute inset-0 rounded-[1.15rem]"
        style={{
          background: `radial-gradient(120% 120% at 30% 16%, color-mix(in oklab, ${color} 26%, #fff) 0%, color-mix(in oklab, ${color} 12%, var(--surface)) 55%, color-mix(in oklab, ${color} 30%, var(--surface)) 100%)`,
          boxShadow: `inset 0 2px 3px rgb(255 255 255 / .7), inset 0 -6px 12px color-mix(in oklab, ${color} 22%, transparent), 0 12px 20px -12px color-mix(in oklab, ${color} 60%, transparent)`,
        }}
      />
      <span className="relative" style={{ color }}>{children}</span>
    </span>
  );
}

/** Percent-change pill (↑ green / ↓ red) used beside big numbers. */
export function DeltaPill({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const good = invert ? value <= 0 : value >= 0;
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
      good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
      {value >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
      {faNum(Math.abs(value))}٪
    </span>
  );
}

/** White stat card with a glossy art chip; becomes a link when `to` is set. */
export function GlossyStat({ color = '#2563eb', icon, label, value, sub, delta, deltaInvert, to, children }: {
  color?: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  deltaInvert?: boolean;
  to?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-navy-500">{label}</p>
          <p className="mt-1.5 text-lg font-black leading-7 tracking-tight text-navy-900 sm:text-[1.45rem] sm:leading-8">{value}</p>
        </div>
        <IconBubble color={color} className="size-11 sm:size-14">{icon}</IconBubble>
      </div>
      {(sub || delta !== undefined) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <DeltaPill value={delta} invert={deltaInvert} />
          {sub && <span className="text-[11px] leading-5 text-navy-400">{sub}</span>}
        </div>
      )}
      {children}
    </>
  );
  const cls = 'card card-pad lift block h-full';
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Card with the panel section header (title + optional action link). */
export function PanelCard({ title, action, children, className, pad = true }: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={clsx('card', pad && 'card-pad', className)}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-black text-navy-900">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** «مشاهده همه» style header link. */
export function MoreLink({ to, children = 'مشاهده همه' }: { to: string; children?: ReactNode }) {
  return <Link to={to} className="text-xs font-bold text-accent transition hover:underline">{children}</Link>;
}

/* ------------------------------- gauges --------------------------------- */

export interface DonutSegment { value: number; color: string; label?: string }

/** Multi-segment donut with free center content. Zero-total renders a track. */
export function Donut({ segments, size = 150, thickness = 16, center }: {
  segments: DonutSegment[]; size?: number; thickness?: number; center?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  let acc = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        {total > 0 && segments.map((seg, i) => {
          const frac = Math.max(0, seg.value) / total;
          const dash = `${(frac * c).toFixed(2)} ${c.toFixed(2)}`;
          const offset = -(acc * c);
          acc += frac;
          return (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={dash} strokeDashoffset={offset} strokeLinecap="butt">
              {seg.label && <title>{seg.label}</title>}
            </circle>
          );
        })}
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

/** Single-value progress ring with rounded cap. */
export function Ring({ percent, size = 120, thickness = 12, color = '#2563eb', center }: {
  percent: number; size?: number; thickness?: number; color?: string; center?: ReactNode;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round"
          strokeDasharray={`${((p / 100) * c).toFixed(2)} ${c.toFixed(2)}`} />
      </svg>
      {center && <div className="absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}

/* ------------------------------- charts --------------------------------- */

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Tiny trend line for stat cards. */
export function Sparkline({ values, color = '#2563eb', className }: { values: number[]; color?: string; className?: string }) {
  const w = 120, h = 34, pad = 3;
  if (values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => ({ x: w - pad - i * step, y: pad + (1 - (v - min) / Math.max(1, max - min)) * (h - pad * 2) }));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={clsx('h-8 w-28', className)} aria-hidden="true">
      <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

export interface LinePoint { label: string; value: number }

/** Smooth RTL area/line chart with optional background bars (mock style). */
export function LineChart({ points, color = '#2563eb', bars, format = (v: number) => faNum(v), height = 230 }: {
  points: LinePoint[];
  color?: string;
  bars?: LinePoint[];
  format?: (v: number) => string;
  height?: number;
}) {
  const w = 660, padX = 14, padTop = 26, padBottom = 30;
  const innerW = w - padX * 2, innerH = height - padTop - padBottom;
  const all = [...points.map((p) => p.value), ...(bars ?? []).map((b) => b.value)];
  const max = Math.max(1, ...all) * 1.12;
  const n = Math.max(points.length, bars?.length ?? 0, 1);
  const step = n > 1 ? innerW / (n - 1) : innerW;
  const X = (i: number) => w - padX - i * step;
  const Y = (v: number) => padTop + (1 - v / max) * innerH;
  const pts = points.map((p, i) => ({ x: X(i), y: Y(p.value) }));
  const line = smoothPath(pts);
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x},${padTop + innerH} L${pts[0].x},${padTop + innerH} Z` : '';
  const gid = `lc${color.replace('#', '')}`;
  const barW = Math.min(26, step * 0.52);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="نمودار">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={padX} x2={w - padX} y1={padTop + innerH * f} y2={padTop + innerH * f} stroke="var(--line)" strokeDasharray="4 5" />
      ))}
      {bars?.map((b, i) => (
        <rect key={i} x={X(i) - barW / 2} y={Y(b.value)} width={barW} height={Math.max(3, padTop + innerH - Y(b.value))}
          rx={Math.min(7, barW / 2)} fill={color} opacity="0.16">
          <title>{b.label}: {format(b.value)}</title>
        </rect>
      ))}
      {area && <path d={area} fill={`url(#${gid})`} />}
      {pts.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill="#fff" stroke={color} strokeWidth="2.5">
            <title>{points[i].label}: {format(points[i].value)}</title>
          </circle>
          {i === pts.length - 1 && (
            <text x={p.x} y={Math.max(14, p.y - 12)} textAnchor="middle" fontSize="12" fontWeight="700" fill={color}>{format(points[i].value)}</text>
          )}
          <text x={p.x} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--navy-400)">{points[i].label}</text>
        </g>
      ))}
      {pts.length === 0 && <text x={w / 2} y={height / 2} textAnchor="middle" fontSize="13" fill="var(--navy-400)">داده‌ای برای نمایش نیست</text>}
    </svg>
  );
}

/** Rounded soft bars with an optional highlighted (current) bar. */
export function SoftBars({ data, format = (v: number) => faNum(v), color = '#2563eb' }: {
  data: { label: string; value: number; highlight?: boolean }[];
  format?: (v: number) => string;
  color?: string;
}) {
  if (!data.length) return <p className="text-sm text-navy-400">داده‌ای برای نمایش نیست.</p>;
  const top = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-44 items-end gap-2">
      {data.map((d, i) => (
        <div key={i} className="group flex flex-1 flex-col items-center justify-end gap-1.5" title={`${d.label}: ${format(d.value)}`}>
          <span className="text-[10px] font-bold text-navy-500 opacity-0 transition group-hover:opacity-100">{format(d.value)}</span>
          <div
            className="w-full max-w-10 rounded-t-xl transition-all"
            style={{
              height: `${Math.max(5, (d.value / top) * 100)}%`,
              background: d.highlight
                ? `linear-gradient(to top, color-mix(in oklab, ${color} 45%, #fff), color-mix(in oklab, ${color} 22%, #fff))`
                : `linear-gradient(to top, ${color}, color-mix(in oklab, ${color} 62%, #fff))`,
            }}
          />
          <span className="max-w-full truncate text-[10px] text-navy-400">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- hero ---------------------------------- */

/** Image hero band of the panel home pages; art sits left, text right (RTL). */
export function HeroShell({ image, dark = false, children, className, aside }: {
  image: string; dark?: boolean; children: ReactNode; className?: string; aside?: ReactNode;
}) {
  return (
    <section className={clsx('relative isolate mb-6 overflow-hidden rounded-[1.6rem] shadow-soft ring-1 ring-navy-900/5', className)}>
      <img src={image} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover object-left" />
      <div aria-hidden="true" className={clsx('absolute inset-0 -z-10',
        dark
          ? 'bg-gradient-to-l from-[#0a1d47]/85 via-[#0a1d47]/45 to-transparent'
          : 'bg-gradient-to-l from-white/85 via-white/45 to-transparent')} />
      <div className="relative flex min-h-44 flex-wrap items-center justify-between gap-5 p-5 sm:p-7">
        <div className="min-w-0 max-w-2xl">{children}</div>
        {aside}
      </div>
    </section>
  );
}

/** Quick-access tile: pastel icon on top, label below (mock style). */
export function QuickTile({ color = '#2563eb', icon, label, to, onClick }: {
  color?: string; icon: ReactNode; label: string; to?: string; onClick?: () => void;
}) {
  const cls = 'lift flex flex-col items-center gap-2.5 rounded-[1.3rem] bg-surface px-3 py-5 text-center ring-1 ring-navy-900/5 transition hover:ring-brand-200';
  const inner = (
    <>
      <IconBubble color={color} className="size-14">{icon}</IconBubble>
      <span className="text-[13px] font-bold leading-5 text-navy-800">{label}</span>
    </>
  );
  return to
    ? <Link to={to} className={cls}>{inner}</Link>
    : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}
