/**
 * @file apps/dashboard/src/components/MetricCard.jsx
 * @description Reusable KPI metric card widget.
 *
 * Visual anatomy:
 *  ┌─────────────────────────────────────────┐
 *  │  [Icon]   Title              [Trend]    │
 *  │                                         │
 *  │  3,847                                  │
 *  │                                         │
 *  │  ↑ 12.4% from last hour                 │
 *  └─────────────────────────────────────────┘
 *
 * Props:
 *  - `title`       string         — metric label
 *  - `value`       string|number  — primary displayed value
 *  - `icon`        React element  — lucide-react icon (already sized by caller)
 *  - `iconColor`   string         — Tailwind text color class for the icon container
 *  - `trend`       object         — { direction: 'up'|'down'|'neutral', value: string, label: string }
 *  - `subtitle`    string         — secondary line below value (e.g., "of 14 total workers")
 *  - `isLoading`   boolean        — renders a shimmer skeleton
 *  - `isError`     boolean        — renders an error state
 *  - `onClick`     function       — makes the card interactive (navigates to detail page)
 *  - `highlight`   'success'|'warning'|'danger'|null — coloured accent border
 */

import clsx      from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

// ---------------------------------------------------------------------------
// Trend indicator
// ---------------------------------------------------------------------------

const TREND_CONFIG = {
  up: {
    Icon:  TrendingUp,
    // "up" is good for success rate and throughput; bad for error rate and DLQ.
    // Pass `invertTrend` to flip the colour semantics.
    color: (invert) => invert ? 'text-danger-text' : 'text-success-text',
  },
  down: {
    Icon:  TrendingDown,
    color: (invert) => invert ? 'text-success-text' : 'text-danger-text',
  },
  neutral: {
    Icon:  Minus,
    color: () => 'text-muted',
  },
};

function TrendIndicator({ trend, invertTrend }) {
  if (!trend) return null;

  const { direction = 'neutral', value, label } = trend;
  const cfg = TREND_CONFIG[direction] ?? TREND_CONFIG.neutral;
  const TrendIcon = cfg.Icon;
  const colorCls  = cfg.color(invertTrend);

  return (
    <div className={clsx('flex items-center gap-1 text-xs font-medium', colorCls)}>
      <TrendIcon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      {value && <span>{value}</span>}
      {label && <span className="text-muted font-normal">{label}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MetricCardSkeleton() {
  return (
    <div className="card p-5 flex flex-col gap-3 min-h-[120px]" aria-busy="true" aria-label="Loading metric">
      <div className="flex items-start justify-between">
        <div className="skeleton h-4 w-28 rounded-md" />
        <div className="skeleton h-9 w-9 rounded-xl" />
      </div>
      <div className="skeleton h-8 w-20 rounded-lg mt-1" />
      <div className="skeleton h-3 w-36 rounded-md" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function MetricCardError({ title }) {
  return (
    <div className="card p-5 flex flex-col justify-center items-start gap-2 min-h-[120px] border-danger/30">
      <p className="text-xs font-medium text-muted-subtle uppercase tracking-wider">{title}</p>
      <p className="text-danger-text text-sm">Failed to load</p>
      <p className="text-xs text-muted">Retrying…</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight border map
// ---------------------------------------------------------------------------

const HIGHLIGHT_BORDER = {
  success: 'border-success/40 shadow-glow-success',
  warning: 'border-warning-DEFAULT/40',
  danger:  'border-danger/40 shadow-glow-danger',
};

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

/**
 * @param {object}   props
 * @param {string}   props.title
 * @param {string|number} props.value
 * @param {React.ReactNode} props.icon
 * @param {string}   [props.iconColor='text-brand-400']
 * @param {string}   [props.iconBg='bg-brand-500/10']
 * @param {object}   [props.trend]
 * @param {boolean}  [props.invertTrend=false]
 * @param {string}   [props.subtitle]
 * @param {boolean}  [props.isLoading=false]
 * @param {boolean}  [props.isError=false]
 * @param {function} [props.onClick]
 * @param {'success'|'warning'|'danger'|null} [props.highlight]
 * @param {string}   [props.className]
 */
export default function MetricCard({
  title,
  value,
  icon,
  iconColor    = 'text-brand-400',
  iconBg       = 'bg-brand-500/10',
  trend,
  invertTrend  = false,
  subtitle,
  isLoading    = false,
  isError      = false,
  onClick,
  highlight    = null,
  className,
}) {
  if (isLoading) return <MetricCardSkeleton />;
  if (isError)   return <MetricCardError title={title} />;

  const isInteractive = Boolean(onClick);

  return (
    <div
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={isInteractive ? (e) => e.key === 'Enter' && onClick?.() : undefined}
      className={clsx(
        'card p-5 flex flex-col gap-3 min-h-[120px]',
        'transition-all duration-200',
        isInteractive && 'cursor-pointer hover:border-surface-border/80 hover:-translate-y-0.5 hover:shadow-card-lg focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none',
        highlight && HIGHLIGHT_BORDER[highlight],
        className,
      )}
    >
      {/* ── Header row: label + icon ──────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-muted-subtle uppercase tracking-wider leading-none mt-0.5">
          {title}
        </p>
        <div
          className={clsx(
            'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
            iconBg,
          )}
          aria-hidden="true"
        >
          <span className={iconColor}>{icon}</span>
        </div>
      </div>

      {/* ── Primary value ─────────────────────────────────────────────────── */}
      <div className="flex-1 flex items-end">
        <p className="text-3xl font-bold text-text-primary tracking-tight tabular-nums leading-none">
          {value ?? '—'}
        </p>
      </div>

      {/* ── Footer: trend + subtitle ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 min-h-[18px]">
        {trend ? (
          <TrendIndicator trend={trend} invertTrend={invertTrend} />
        ) : (
          <span className="text-xs text-muted">{subtitle ?? ''}</span>
        )}
        {trend && subtitle && (
          <span className="text-xs text-muted-subtle truncate">{subtitle}</span>
        )}
      </div>
    </div>
  );
}
