/**
 * @file apps/dashboard/src/pages/OverviewPage.jsx
 * @description Main command centre dashboard.
 *
 * Layout:
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  Page header (title + last-updated timestamp)                        │
 *  ├────────────┬───────────┬──────────────┬─────────────────────────────┤
 *  │ MetricCard │MetricCard │  MetricCard  │      MetricCard             │
 *  │ Success %  │ Queue     │  Workers     │      DLQ Count              │
 *  ├────────────┴───────────┴──────────────┴─────────────────────────────┤
 *  │  Throughput AreaChart (full width)                                   │
 *  ├──────────────────────────────────┬──────────────────────────────────┤
 *  │  Job Status Breakdown (PieChart) │  Execution Performance stats     │
 *  └──────────────────────────────────┴──────────────────────────────────┘
 */

import { useNavigate }   from 'react-router-dom';
import { useState }      from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
}                        from 'recharts';
import {
  CheckCircle2, LayersIcon, Server, Skull,
  Clock, Zap, AlertTriangle, RefreshCw,
}                        from 'lucide-react';
import clsx              from 'clsx';

import MetricCard              from '@/components/MetricCard';
import { useClusterMetrics, useThroughputSeries, useHistoricalThroughput } from '@/hooks/useMetrics';

// ---------------------------------------------------------------------------
// Design tokens (must match tailwind.config.js)
// ---------------------------------------------------------------------------

const COLORS = {
  brand:   '#F97316',
  success: '#10b981',
  danger:  '#ef4444',
  warning: '#f59e0b',
  slate:   '#2D241E',
  muted:   '#8A7C72',
  border:  '#EBE5DC',
  surface: '#FDFBF7',
};

// ---------------------------------------------------------------------------
// Custom Recharts components
// ---------------------------------------------------------------------------

/**
 * Dark-themed tooltip for the throughput AreaChart.
 */
function ThroughputTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="glass rounded-xl px-4 py-3 shadow-card-lg border border-surface-border min-w-[160px]">
      <p className="text-xs font-semibold text-muted-subtle mb-2 uppercase tracking-wider">
        {label}
      </p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted">{entry.dataKey === 'jobs' ? 'Succeeded' : 'Failed'}</span>
          </div>
          <span className="font-semibold text-text-primary tabular-nums">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Custom legend for the throughput chart.
 */
function ThroughputLegend() {
  return (
    <div className="flex items-center justify-end gap-5 pr-2 pb-1">
      {[
        { color: COLORS.brand,   label: 'Succeeded' },
        { color: COLORS.danger,  label: 'Failed' },
      ].map(({ color, label }) => (
        <div key={label} className="flex items-center gap-1.5 text-xs text-muted">
          <span className="w-2.5 h-0.5 rounded-full inline-block" style={{ backgroundColor: color }} />
          {label}
        </div>
      ))}
    </div>
  );
}

/**
 * Custom tooltip for the Pie chart.
 */
function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const { name, value } = payload[0];
  return (
    <div className="glass rounded-lg px-3 py-2 text-xs shadow-card-lg border border-surface-border">
      <span className="text-muted-subtle">{name}: </span>
      <span className="font-semibold text-text-primary">{value.toLocaleString()}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status pie chart colours
// ---------------------------------------------------------------------------

const PIE_COLORS = {
  QUEUED:    COLORS.muted,
  RUNNING:   COLORS.brand,
  SUCCEEDED: COLORS.success,
  FAILED:    COLORS.danger,
  CANCELLED: '#475569',
  SCHEDULED: COLORS.warning,
  PENDING:   '#334155',
  DEAD:      '#7f1d1d',
};

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance stat row
// ---------------------------------------------------------------------------

function PerfStat({ label, value, unit = 'ms', color = 'text-text-primary' }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-surface-border/60 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={clsx('text-sm font-semibold tabular-nums', color)}>
        {value != null ? `${Number(value).toLocaleString()} ${unit}` : '—'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverviewPage
// ---------------------------------------------------------------------------

export default function OverviewPage() {
  const navigate = useNavigate();
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const {
    data:      metrics,
    isLoading: metricsLoading,
    isError:   metricsError,
    dataUpdatedAt,
    refetch,
    isFetching,
  } = useClusterMetrics();

  const {
    data:      throughput,
    isLoading: throughputLoading,
  } = useThroughputSeries();

  // ── Derived values ────────────────────────────────────────────────────────
  const jobs    = metrics?.jobs;
  const workers = metrics?.workers;
  const dlq     = metrics?.dead_letter_queue;
  const perf    = metrics?.execution_performance;

  const successRate  = jobs?.success_rate_percentage;
  const queueDepth   = (jobs?.by_status?.QUEUED ?? 0) + (jobs?.by_status?.RUNNING ?? 0);
  const activeWorkers = workers?.active ?? 0;
  const dlqTotal      = dlq?.total ?? 0;

  // Pie data: filter out zero-value statuses for a cleaner chart
  const pieData = jobs?.by_status
    ? Object.entries(jobs.by_status)
        .filter(([, v]) => v > 0)
        .map(([name, value]) => ({ name, value }))
    : [];

  const updatedLabel = dataUpdatedAt
    ? formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })
    : null;

  return (
    <div className="p-5 lg:p-7 space-y-6 max-w-[1600px] mx-auto animate-fade-in">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">
            Cluster health · live polling every 10 s
          </p>
        </div>
      </div>

      {/* ── KPI metric cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Success Rate */}
        <MetricCard
          title="Success Rate"
          value={successRate != null ? `${successRate}%` : '—'}
          icon={<CheckCircle2 className="w-4.5 h-4.5" />}
          iconColor="text-success"
          iconBg="bg-success/10"
          isLoading={metricsLoading}
          isError={metricsError}
          highlight={
            successRate == null ? null
            : successRate >= 95 ? 'success'
            : successRate >= 85 ? 'warning'
            : 'danger'
          }
          trend={{
            direction: successRate >= 95 ? 'up' : 'down',
            value:     successRate >= 95 ? '+0.3%' : '-1.2%',
            label:     'vs. last hour',
          }}
          onClick={() => navigate('/jobs?status=FAILED')}
        />

        {/* Live Queue Depth */}
        <MetricCard
          title="Live Queue Depth"
          value={queueDepth.toLocaleString()}
          icon={<LayersIcon className="w-4.5 h-4.5" />}
          iconColor="text-brand-400"
          iconBg="bg-brand-500/10"
          isLoading={metricsLoading}
          isError={metricsError}
          subtitle={`${jobs?.by_status?.RUNNING ?? 0} running · ${jobs?.by_status?.QUEUED ?? 0} queued`}
          trend={{
            direction: 'neutral',
            value:     null,
            label:     'stable',
          }}
          onClick={() => navigate('/jobs')}
        />

        {/* Active Workers */}
        <MetricCard
          title="Active Workers"
          value={`${activeWorkers} / ${workers?.total ?? '—'}`}
          icon={<Server className="w-4.5 h-4.5" />}
          iconColor="text-indigo-400"
          iconBg="bg-indigo-500/10"
          isLoading={metricsLoading}
          isError={metricsError}
          subtitle={`${workers?.offline ?? 0} offline`}
          highlight={workers?.offline > 0 ? 'warning' : null}
          trend={{
            direction: (workers?.offline ?? 0) > 2 ? 'down' : 'neutral',
            value:     (workers?.offline ?? 0) > 2 ? `${workers.offline} offline` : null,
            label:     (workers?.offline ?? 0) > 2 ? '— check heartbeats' : 'all healthy',
          }}
          invertTrend
          onClick={() => navigate('/workers')}
        />

        {/* DLQ Count */}
        <MetricCard
          title="Dead Letter Queue"
          value={dlqTotal.toLocaleString()}
          icon={<Skull className="w-4.5 h-4.5" />}
          iconColor="text-danger-text"
          iconBg="bg-danger-muted"
          isLoading={metricsLoading}
          isError={metricsError}
          highlight={dlqTotal > 0 ? 'danger' : null}
          subtitle={`${dlq?.unresolved ?? 0} unresolved`}
          trend={
            dlqTotal > 0
              ? { direction: 'up', value: `${dlq?.unresolved ?? 0} unresolved`, label: '' }
              : { direction: 'neutral', value: null, label: 'no failures' }
          }
          invertTrend
          onClick={() => navigate('/dlq')}
        />
      </div>

      {/* ── Throughput AreaChart ──────────────────────────────────────────── */}
      <div 
        className="card p-5 cursor-pointer transition-all duration-200 hover:scale-[1.01] hover:shadow-card-lg group"
        onClick={() => setIsHistoryModalOpen(true)}
      >
        <SectionHeader
          title={<span className="group-hover:text-brand-500 transition-colors">Job Throughput</span>}
          subtitle="Jobs completed per minute — last 60 minutes"
          action={
            <div className="flex items-center gap-1.5 text-xs text-success-text bg-success-muted px-2.5 py-1 rounded-full border border-success-text/20">
              <span className="w-1.5 h-1.5 rounded-full bg-success inline-block animate-pulse-slow" />
              Live
            </div>
          }
        />

        {throughputLoading ? (
          <div className="skeleton h-56 rounded-xl" />
        ) : (
          <>
            <ThroughputLegend />
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={throughput}
                margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
              >
                <defs>
                  {/* Brand gradient fill */}
                  <linearGradient id="gradJobs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COLORS.brand}   stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COLORS.brand}   stopOpacity={0.02} />
                  </linearGradient>
                  {/* Danger gradient fill */}
                  <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COLORS.danger}  stopOpacity={0.25} />
                    <stop offset="95%" stopColor={COLORS.danger}  stopOpacity={0.02} />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={COLORS.border}
                  vertical={false}
                />

                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: COLORS.muted }}
                  tickLine={false}
                  axisLine={false}
                  // Show only every 10th tick to avoid crowding
                  interval={9}
                />

                <YAxis
                  tick={{ fontSize: 11, fill: COLORS.muted }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />

                <Tooltip
                  content={<ThroughputTooltip />}
                  cursor={{ stroke: COLORS.border, strokeWidth: 1 }}
                />

                {/* Succeeded area */}
                <Area
                  type="monotone"
                  dataKey="jobs"
                  stroke={COLORS.brand}
                  strokeWidth={2}
                  fill="url(#gradJobs)"
                  dot={false}
                  activeDot={{
                    r:           4,
                    fill:        COLORS.brand,
                    strokeWidth: 0,
                  }}
                />

                {/* Failed area */}
                <Area
                  type="monotone"
                  dataKey="failed"
                  stroke={COLORS.danger}
                  strokeWidth={1.5}
                  fill="url(#gradFailed)"
                  dot={false}
                  activeDot={{
                    r:           4,
                    fill:        COLORS.danger,
                    strokeWidth: 0,
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {/* ── Bottom row: Pie + Performance ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Job status breakdown pie */}
        <div className="card p-5">
          <SectionHeader
            title="Job Status Breakdown"
            subtitle="Distribution across all statuses"
          />

          {metricsLoading ? (
            <div className="skeleton h-52 rounded-xl" />
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {pieData.map(({ name }) => (
                      <Cell key={name} fill={PIE_COLORS[name] ?? COLORS.muted} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              {/* Legend */}
              <div className="flex-1 space-y-2">
                {pieData.map(({ name, value }) => (
                  <div key={name} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: PIE_COLORS[name] ?? COLORS.muted }}
                      />
                      <span className="text-muted truncate capitalize">
                        {name.toLowerCase()}
                      </span>
                    </div>
                    <span className="font-semibold text-text-secondary tabular-nums">
                      {value.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Execution performance */}
        <div className="card p-5">
          <SectionHeader
            title="Execution Performance"
            subtitle={`Based on ${perf?.sample_size?.toLocaleString() ?? '…'} SUCCEEDED executions (last 24 h)`}
          />

          {metricsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton h-10 rounded-lg" />
              ))}
            </div>
          ) : (
            <div>
              <PerfStat
                label="Average duration"
                value={perf?.avg_duration_ms}
                color="text-text-primary"
              />
              <PerfStat
                label="P95 duration"
                value={perf?.p95_duration_ms}
                color={
                  perf?.p95_duration_ms > 10_000 ? 'text-warning-text' : 'text-text-primary'
                }
              />
              <PerfStat
                label="Max duration"
                value={perf?.max_duration_ms}
                color={
                  perf?.max_duration_ms > 20_000 ? 'text-danger-text' : 'text-text-primary'
                }
              />
              <PerfStat
                label="Completed last hour"
                value={metrics?.throughput?.completed_last_hour}
                unit="jobs"
                color="text-success-text"
              />
            </div>
          )}
        </div>
      </div>
      
      <ThroughputHistoryModal isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} />
    </div>
  );
}

import { createPortal } from 'react-dom';

function ThroughputHistoryModal({ isOpen, onClose }) {
  const [timeframe, setTimeframe] = useState('24h');
  const { data, isLoading } = useHistoricalThroughput(timeframe);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fade-in">
      <div className="absolute inset-0 bg-text-primary/10 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl flex flex-col shadow-2xl bg-surface-raised/90 border border-white/60">
        
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">Throughput History</h2>
          
          <div className="flex items-center gap-2">
            {['1h', '24h', '7d'].map(tf => (
              <button 
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
                  timeframe === tf ? 'bg-brand-50 text-brand-700 border border-brand-200 shadow-sm' : 'text-text-secondary hover:bg-surface-border/50 border border-transparent'
                )}
              >
                {tf === '1h' ? 'Last Hour' : tf === '24h' ? 'Last 24h' : 'Last 7 Days'}
              </button>
            ))}
            <button onClick={onClose} className="ml-2 p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-border/50 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
          </div>
        </div>

        <div className="p-6 flex-1 min-h-[400px]">
          {isLoading ? (
            <div className="w-full h-[320px] flex items-center justify-center">
              <div className="skeleton w-full h-full rounded-xl" />
            </div>
          ) : (
            <>
              <ThroughputLegend />
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradJobsHistory" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.brand} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={COLORS.brand} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradFailedHistory" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.danger} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={COLORS.danger} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: COLORS.muted }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ThroughputTooltip />} cursor={{ stroke: COLORS.border, strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="jobs" stroke={COLORS.brand} strokeWidth={2} fill="url(#gradJobsHistory)" dot={false} activeDot={{ r: 4, fill: COLORS.brand, strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="failed" stroke={COLORS.danger} strokeWidth={1.5} fill="url(#gradFailedHistory)" dot={false} activeDot={{ r: 4, fill: COLORS.danger, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
