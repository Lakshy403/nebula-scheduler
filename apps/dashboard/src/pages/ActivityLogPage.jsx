import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Briefcase, Clock3, Filter, RefreshCw, Server, Skull, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import StatusBadge from '@/components/StatusBadge';
import { QUERY_KEYS, useDlq, useJobs, useWorkers } from '@/hooks/useMetrics';
import { useAuthStore } from '@/store/useAuthStore';

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Jobs', value: 'jobs' },
  { label: 'Workers', value: 'workers' },
  { label: 'DLQ', value: 'dlq' },
];

function EventIcon({ kind }) {
  if (kind === 'jobs') return <Briefcase className="w-4 h-4" />;
  if (kind === 'workers') return <Server className="w-4 h-4" />;
  if (kind === 'dlq') return <Skull className="w-4 h-4" />;
  return <Clock3 className="w-4 h-4" />;
}

export default function ActivityLogPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const orgId = useAuthStore((s) => s.user?.organizationId);
  const [filter, setFilter] = useState('all');

  const { data: jobsResponse, isLoading: jobsLoading } = useJobs({ limit: 20 });
  const { data: workers = [], isLoading: workersLoading } = useWorkers();
  const { data: dlqEntries = [], isLoading: dlqLoading } = useDlq();

  const jobItems = jobsResponse?.data ?? [];

  const events = useMemo(() => {
    const jobEvents = jobItems.map((job) => ({
      id: `job-${job.id}`,
      kind: 'jobs',
      title: job.name ?? 'Untitled job',
      detail: `${job.queue?.slug ?? 'default'} · ${job.status ?? 'UNKNOWN'}`,
      status: job.status,
      timestamp: job.updated_at ?? job.created_at,
    }));

    const workerEvents = workers.map((worker) => ({
      id: `worker-${worker.id}`,
      kind: 'workers',
      title: worker.hostname ?? worker.id,
      detail: `${worker.status ?? 'UNKNOWN'} · ${Array.isArray(worker.queues) ? worker.queues.length : 0} queues`,
      status: worker.status,
      timestamp: worker.last_heartbeat_at ?? worker.updated_at ?? worker.created_at,
    }));

    const dlqEvents = dlqEntries.map((entry) => ({
      id: `dlq-${entry.id}`,
      kind: 'dlq',
      title: entry.job_name ?? 'Failed job',
      detail: entry.last_error_message ?? 'Dead-lettered execution',
      status: 'FAILED',
      timestamp: entry.promoted_at ?? entry.created_at,
    }));

    return [...jobEvents, ...workerEvents, ...dlqEvents]
      .filter((event) => Boolean(event.timestamp))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [jobItems, workers, dlqEntries]);

  const visibleEvents = filter === 'all'
    ? events
    : events.filter((event) => event.kind === filter);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['jobs', orgId] });
    await queryClient.invalidateQueries({ queryKey: ['workers', orgId] });
    await queryClient.invalidateQueries({ queryKey: ['dlq', orgId] });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.metrics(orgId) });
  };

  const loading = jobsLoading || workersLoading || dlqLoading;

  return (
    <div className="p-6 lg:p-8 animate-fade-in space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Activity Log</h1>
          <p className="page-subtitle">Recent job, worker, and DLQ events from the live scheduler</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-sm gap-1.5" onClick={refresh}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button className="btn-primary text-sm gap-1.5" onClick={() => navigate('/jobs')}>
            <Briefcase className="w-4 h-4" />
            Open Jobs
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={
              filter === item.value
                ? 'px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-500/15 text-brand-300 border border-brand-500/30'
                : 'px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-text-primary hover:bg-surface-border/50 border border-transparent'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-subtle">Events</p>
          <p className="mt-2 text-2xl font-semibold text-text-primary tabular-nums">{events.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-subtle">Failed jobs</p>
          <p className="mt-2 text-2xl font-semibold text-text-primary tabular-nums">{dlqEntries.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase tracking-wider text-muted-subtle">Workers seen</p>
          <p className="mt-2 text-2xl font-semibold text-text-primary tabular-nums">{workers.length}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-semibold text-text-primary">Timeline</h2>
          </div>
          <span className="text-xs text-muted-subtle">{loading ? 'Loading live data...' : `${visibleEvents.length} entries`}</span>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        ) : visibleEvents.length === 0 ? (
          <div className="p-10 text-center space-y-3 dot-grid">
            <Zap className="w-10 h-10 mx-auto text-muted" />
            <p className="text-sm font-medium text-text-secondary">No activity for this filter yet.</p>
            <button className="btn-secondary text-sm" onClick={() => navigate('/jobs')}>
              Go to Jobs
            </button>
          </div>
        ) : (
          <div className="divide-y divide-surface-border">
            {visibleEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-4 px-5 py-4 hover:bg-surface-border/30 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-surface-overlay border border-surface-border flex items-center justify-center text-muted">
                  <EventIcon kind={event.kind} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-text-primary truncate">{event.title}</p>
                    <StatusBadge status={event.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted break-words">{event.detail}</p>
                </div>
                <div className="text-xs text-muted-subtle whitespace-nowrap">
                  {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
