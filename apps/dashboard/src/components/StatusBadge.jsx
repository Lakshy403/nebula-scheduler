/**
 * @file apps/dashboard/src/components/StatusBadge.jsx
 * @description Coloured status pill for JobStatus and WorkerStatus values.
 *
 * Maps every possible backend status string to a Tailwind badge class
 * (defined in index.css) and an optional animated indicator dot.
 *
 * Usage:
 *   <StatusBadge status="RUNNING" />
 *   <StatusBadge status="SUCCEEDED" showDot />
 */

import clsx from 'clsx';

// ---------------------------------------------------------------------------
// Status → visual config map
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  // Job statuses
  PENDING:   { label: 'Pending',   cls: 'badge-pending',   dot: false, pulse: false },
  SCHEDULED: { label: 'Scheduled', cls: 'badge-scheduled', dot: false, pulse: false },
  QUEUED:    { label: 'Queued',    cls: 'badge-queued',    dot: true,  pulse: false },
  RUNNING:   { label: 'Running',   cls: 'badge-running',   dot: true,  pulse: true  },
  SUCCEEDED: { label: 'Succeeded', cls: 'badge-succeeded', dot: true,  pulse: false },
  COMPLETED: { label: 'Completed', cls: 'badge-succeeded', dot: true,  pulse: false },
  FAILED:    { label: 'Failed',    cls: 'badge-failed',    dot: true,  pulse: false },
  CANCELLED: { label: 'Cancelled', cls: 'badge-cancelled', dot: false, pulse: false },
  DEAD:      { label: 'Dead',      cls: 'badge-dead',      dot: true,  pulse: false },

  // Worker statuses
  IDLE:      { label: 'Idle',      cls: 'badge-queued',    dot: true,  pulse: false },
  BUSY:      { label: 'Busy',      cls: 'badge-running',   dot: true,  pulse: true  },
  DRAINING:  { label: 'Draining',  cls: 'badge-scheduled', dot: true,  pulse: true  },
  OFFLINE:   { label: 'Offline',   cls: 'badge-dead',      dot: false, pulse: false },
};

const FALLBACK = { label: 'Unknown', cls: 'badge-cancelled', dot: false, pulse: false };

// ---------------------------------------------------------------------------
// Dot colours (must match badge class background logic)
// ---------------------------------------------------------------------------

const DOT_COLOUR = {
  'badge-queued':    'bg-slate-400',
  'badge-running':   'bg-brand-400',
  'badge-succeeded': 'bg-success',
  'badge-failed':    'bg-danger',
  'badge-cancelled': 'bg-slate-500',
  'badge-dead':      'bg-danger',
  'badge-scheduled': 'bg-warning-DEFAULT',
  'badge-pending':   'bg-slate-500',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @param {object}  props
 * @param {string}  props.status   - Backend status string (e.g. "RUNNING").
 * @param {boolean} [props.showDot=true]  - Whether to show the indicator dot.
 * @param {string}  [props.className]
 */
export default function StatusBadge({ status, showDot = true, className }) {
  const config  = STATUS_CONFIG[status?.toUpperCase()] ?? FALLBACK;
  const dotCls  = DOT_COLOUR[config.cls] ?? 'bg-slate-400';

  return (
    <span className={clsx(config.cls, className)}>
      {showDot && (
        <span
          className={clsx(
            'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
            dotCls,
            config.pulse && 'animate-pulse-slow',
          )}
          aria-hidden="true"
        />
      )}
      {config.label}
    </span>
  );
}
