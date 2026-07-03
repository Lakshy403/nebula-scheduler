import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ChevronDown, ChevronUp, ChevronsUpDown, Eye, Filter, Loader2,
  Plus, PlayCircle, RefreshCw, RotateCcw, Search, X, XCircle,
} from 'lucide-react';
import clsx from 'clsx';

import StatusBadge from '@/components/StatusBadge';
import { useJobExecutions, useJobMutations, useJobs, useQueues } from '@/hooks/useMetrics';

const STATUS_FILTERS = [
  { label: 'All', value: undefined },
  { label: 'Queued', value: 'QUEUED' },
  { label: 'Running', value: 'RUNNING' },
  { label: 'Succeeded', value: 'SUCCEEDED' },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

function SortIcon({ field, sort }) {
  if (sort.field !== field) return <ChevronsUpDown className="w-3.5 h-3.5 text-surface-border" />;
  return sort.dir === 'asc'
    ? <ChevronUp className="w-3.5 h-3.5 text-brand-400" />
    : <ChevronDown className="w-3.5 h-3.5 text-brand-400" />;
}

function PriorityBadge({ value = 5 }) {
  const color = value >= 9 ? 'text-danger-text bg-danger-muted'
    : value >= 7 ? 'text-warning-text bg-warning-muted'
    : value >= 4 ? 'text-text-secondary bg-surface-border'
    : 'text-muted bg-surface-overlay';

  return <span className={clsx('inline-flex items-center justify-center w-6 h-6 rounded text-xs font-bold tabular-nums', color)}>{value}</span>;
}

function EmptyState({ filtered }) {
  return (
    <tr>
      <td colSpan={8}>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center dot-grid rounded-b-xl">
          <div className="w-12 h-12 rounded-xl bg-surface-overlay border border-surface-border flex items-center justify-center">
            <Filter className="w-5 h-5 text-muted" />
          </div>
          <div>
            <p className="text-sm font-medium text-text-secondary">{filtered ? 'No jobs match your filter' : 'No jobs found'}</p>
            <p className="text-xs text-muted mt-1">{filtered ? 'Try a different status or search term.' : 'Enqueue a job to get started.'}</p>
          </div>
        </div>
      </td>
    </tr>
  );
}

function JobActions({ job, onRetry, onCancel, onView }) {
  const btn = (cb, Icon, label, colorCls = 'hover:text-brand-400') => (
    <button key={label} onClick={() => cb(job)} className={clsx('btn-icon btn-ghost w-8 h-8 transition-colors', colorCls)} title={label} aria-label={`${label} job ${job.id}`}>
      <Icon className="w-4 h-4" />
    </button>
  );

  if (job.status === 'QUEUED' || job.status === 'SCHEDULED') {
    return <div className="flex items-center gap-0.5">{btn(onView, Eye, 'View details')}{btn(onCancel, XCircle, 'Cancel job', 'hover:text-danger-text')}</div>;
  }
  if (job.status === 'RUNNING') {
    return <div className="flex items-center gap-0.5">{btn(onView, Eye, 'View logs')}<button className="btn-icon btn-ghost w-8 h-8 opacity-30 cursor-not-allowed" disabled title="Cannot cancel a running job"><XCircle className="w-4 h-4" /></button></div>;
  }
  if (job.status === 'FAILED') {
    return <div className="flex items-center gap-0.5">{btn(onView, Eye, 'View error')}{btn(onRetry, RotateCcw, 'Retry job', 'hover:text-warning-text')}</div>;
  }
  if (job.status === 'CANCELLED') {
    return <div className="flex items-center gap-0.5">{btn(onView, Eye, 'View details')}{btn(onRetry, PlayCircle, 'Re-enqueue', 'hover:text-success')}</div>;
  }
  return <div className="flex items-center gap-0.5">{btn(onView, Eye, 'View details')}</div>;
}

function JobRow({ job, onRetry, onCancel, onView, isSelected, onSelect }) {
  const created = job.created_at ? new Date(job.created_at) : null;
  return (
    <tr className={clsx('group transition-colors duration-100', isSelected ? 'bg-brand-500/5 border-l-2 border-l-brand-500' : 'hover:bg-surface-border/50/50')}>
      <td className="pl-4 pr-2 py-3.5 w-8">
        <input type="checkbox" checked={isSelected} onChange={() => onSelect(job.id)} className="w-3.5 h-3.5 rounded border-surface-border bg-surface accent-brand-500 cursor-pointer" aria-label={`Select job ${job.id}`} />
      </td>
      <td className="px-4 py-3.5 min-w-[220px]">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-text-primary truncate max-w-[260px]" title={job.name}>{job.name}</span>
          <span className="text-[11px] font-mono text-muted-subtle truncate max-w-[260px]">{job.id}</span>
        </div>
      </td>
      <td className="px-4 py-3.5 text-sm text-muted"><span className="px-2 py-0.5 rounded bg-surface-overlay text-xs font-mono">{job.queue?.slug ?? '-'}</span></td>
      <td className="px-4 py-3.5"><StatusBadge status={job.status} /></td>
      <td className="px-4 py-3.5"><PriorityBadge value={job.priority} /></td>
      <td className="px-4 py-3.5 text-sm tabular-nums">{job.status === 'FAILED' || job.retry_count > 0 ? <span className={job.retry_count >= job.max_retries ? 'text-danger-text font-medium' : 'text-muted'}>{job.retry_count}/{job.max_retries}</span> : <span className="text-muted-subtle">-</span>}</td>
      <td className="px-4 py-3.5 text-sm text-muted whitespace-nowrap">{created ? <span title={format(created, 'yyyy-MM-dd HH:mm:ss')}>{formatDistanceToNow(created, { addSuffix: true })}</span> : '-'}</td>
      <td className="px-3 py-2.5"><div className="opacity-60 group-hover:opacity-100 transition-opacity"><JobActions job={job} onRetry={onRetry} onCancel={onCancel} onView={onView} /></div></td>
    </tr>
  );
}

import { createPortal } from 'react-dom';

function Modal({ title, children, onClose }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="glass w-full max-w-2xl rounded-xl shadow-card-lg border border-surface-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <button className="btn-icon btn-ghost" onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 max-h-[72vh] overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function EnqueueJobModal({ queues, onSubmit, onClose, isPending, apiError }) {
  const [form, setForm] = useState({
    queue_id: queues[0]?.id ?? '',
    name: 'manual-noop-job',
    payload: '{"type":"NOOP"}',
    priority: 5,
    max_retries: 3,
    retry_strategy: 'EXPONENTIAL',
    retry_backoff_base_ms: 1000,
    timeout_seconds: 300,
    scheduled_at: '',
  });
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = JSON.parse(form.payload);
      onSubmit({
        queue_id: form.queue_id || queues[0]?.id,
        name: form.name,
        payload,
        priority: Number(form.priority),
        max_retries: Number(form.max_retries),
        retry_strategy: form.retry_strategy,
        retry_backoff_base_ms: Number(form.retry_backoff_base_ms),
        timeout_seconds: Number(form.timeout_seconds),
        ...(form.scheduled_at ? { scheduled_at: new Date(form.scheduled_at).toISOString() } : {}),
      });
    } catch {
      setError('Payload must be valid JSON. Example: {"type":"NOOP"}');
    }
  };

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Modal title="Enqueue Job" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {(error || apiError) && <div className="rounded-lg bg-danger-muted border border-danger/20 px-4 py-3 text-sm text-danger-text">{error || apiError?.message}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-xs text-muted-subtle uppercase tracking-wider">Queue<select className="input mt-1" value={form.queue_id} onChange={set('queue_id')} required>{queues.map((q) => <option key={q.id} value={q.id}>{q.slug}</option>)}</select></label>
          <label className="block text-xs text-muted-subtle uppercase tracking-wider">Name<input className="input mt-1" value={form.name} onChange={set('name')} required /></label>
          <label className="block text-xs text-muted-subtle uppercase tracking-wider">Priority<input type="number" min="1" max="10" className="input mt-1" value={form.priority} onChange={set('priority')} /></label>
          <label className="block text-xs text-muted-subtle uppercase tracking-wider">Retries<input type="number" min="0" max="10" className="input mt-1" value={form.max_retries} onChange={set('max_retries')} /></label>
          <label className="block text-xs text-muted-subtle uppercase tracking-wider">Retry Strategy<select className="input mt-1" value={form.retry_strategy} onChange={set('retry_strategy')}><option>EXPONENTIAL</option><option>LINEAR</option><option>FIXED</option></select></label>
          <label className="block text-xs text-muted-subtle uppercase tracking-wider">Run Later<input type="datetime-local" className="input mt-1" value={form.scheduled_at} onChange={set('scheduled_at')} /></label>
        </div>
        <label className="block text-xs text-muted-subtle uppercase tracking-wider">Payload<textarea className="input mt-1 min-h-[120px] font-mono text-xs" value={form.payload} onChange={set('payload')} /></label>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button type="submit" className="btn-primary" disabled={isPending || !queues.length}>{isPending ? 'Enqueuing...' : 'Enqueue'}</button></div>
      </form>
    </Modal>
  );
}

function JobDetailsModal({ job, onClose }) {
  const { data: executions = [], isLoading } = useJobExecutions(job?.id);
  return (
    <Modal title="Job Details" onClose={onClose}>
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-muted-subtle uppercase">Name</p><p className="text-text-primary">{job.name}</p></div>
          <div><p className="text-xs text-muted-subtle uppercase">Status</p><StatusBadge status={job.status} /></div>
          <div><p className="text-xs text-muted-subtle uppercase">Queue</p><p className="text-text-primary">{job.queue?.slug ?? '-'}</p></div>
          <div><p className="text-xs text-muted-subtle uppercase">Retries</p><p className="text-text-primary">{job.retry_count}/{job.max_retries}</p></div>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text-primary mb-2">Executions</h3>
          {isLoading ? <p className="text-sm text-muted">Loading executions...</p> : executions.length === 0 ? <p className="text-sm text-muted">No execution attempts yet.</p> : (
            <div className="space-y-2">
              {executions.map((execution) => (
                <div key={execution.id} className="rounded-lg border border-surface-border bg-surface-overlay/60 p-3">
                  <div className="flex items-center justify-between gap-3"><StatusBadge status={execution.status} /><span className="text-xs text-muted tabular-nums">Attempt {execution.attempt_number} | {execution.duration_ms ? `${Math.round(execution.duration_ms)} ms` : '-'}</span></div>
                  {execution.error_message && <p className="mt-2 text-xs text-danger-text whitespace-pre-wrap">{execution.error_message}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function JobsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(undefined);
  const [selected, setSelected] = useState(new Set());
  const [sort, setSort] = useState({ field: 'created_at', dir: 'desc' });
  const [cursor, setCursor] = useState(undefined);
  const [cursorStack, setCursorStack] = useState([]);
  const [showEnqueue, setShowEnqueue] = useState(false);
  const [detailJob, setDetailJob] = useState(null);

  const deferredSearch = useDeferredValue(search);
  const { data, isLoading, isFetching, refetch } = useJobs({ status: statusFilter, cursor });
  const { data: queues = [] } = useQueues();
  const { createJob, retryJob, cancelJob } = useJobMutations();

  const rawJobs = data?.data ?? [];
  const jobs = rawJobs.filter((j) => !deferredSearch || j.name?.toLowerCase().includes(deferredSearch.toLowerCase()) || j.id?.toLowerCase().includes(deferredSearch.toLowerCase()));
  const filtered = Boolean(statusFilter) || Boolean(deferredSearch);

  const sorted = useMemo(() => [...jobs].sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    if (sort.field === 'name') return dir * String(a.name).localeCompare(String(b.name));
    if (sort.field === 'status') return dir * String(a.status).localeCompare(String(b.status));
    if (sort.field === 'priority') return dir * ((a.priority ?? 0) - (b.priority ?? 0));
    return dir * (new Date(a.created_at) - new Date(b.created_at));
  }), [jobs, sort]);

  const toggleSelect = useCallback((id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }), []);

  const toggleSelectAll = useCallback(() => setSelected((prev) => prev.size === jobs.length ? new Set() : new Set(jobs.map((j) => j.id))), [jobs]);
  const toggleSort = useCallback((field) => setSort((prev) => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'desc' }), []);
  const handleRetry = useCallback((job) => retryJob.mutate(job.id), [retryJob]);
  const handleCancel = useCallback((job) => cancelJob.mutate(job.id), [cancelJob]);
  const cancelSelected = useCallback(() => {
    for (const id of selected) cancelJob.mutate(id);
    setSelected(new Set());
  }, [cancelJob, selected]);

  const ColHeader = ({ field, label, className }) => (
    <th className={clsx('px-4 py-3 select-none', className)} onClick={() => toggleSort(field)}>
      <button className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-subtle hover:text-text-secondary transition-colors">{label}<SortIcon field={field} sort={sort} /></button>
    </th>
  );

  return (
    <>
      <div className="p-5 lg:p-7 space-y-5 max-w-[1600px] mx-auto animate-fade-in">
        <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Job Explorer</h1>
          <p className="page-subtitle">Browse, filter and manage all job executions {isFetching && !isLoading && <span className="inline-flex items-center gap-1 ml-2 text-muted-subtle"><Loader2 className="w-3 h-3 animate-spin" /> Refreshing...</span>}</p>
        </div>
        <button className="btn-primary text-sm gap-2 flex-shrink-0" onClick={() => setShowEnqueue(true)}><Plus className="w-4 h-4" />Enqueue Job</button>
      </div>

      <div className="card p-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0 max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-subtle pointer-events-none" /><input type="search" placeholder="Search by name or job ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-9 text-sm h-9" /></div>
          <div className="flex items-center gap-1 flex-wrap">{STATUS_FILTERS.map(({ label, value }) => <button key={label} onClick={() => { setStatusFilter(value); setCursor(undefined); setCursorStack([]); }} className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150', statusFilter === value ? 'bg-brand-500/15 text-brand-300 border border-brand-500/30' : 'text-muted hover:text-text-primary hover:bg-surface-border/50 border border-transparent')}>{label}</button>)}</div>
          <button onClick={() => refetch()} className="btn-ghost btn-icon ml-auto flex-shrink-0" aria-label="Refresh jobs"><RefreshCw className={clsx('w-4 h-4', isFetching && 'animate-spin')} /></button>
        </div>
        {selected.size > 0 && <div className="mt-3 pt-3 border-t border-surface-border flex items-center gap-3 animate-fade-in"><span className="text-xs text-muted-subtle">{selected.size} selected</span><button className="btn-secondary text-xs py-1 px-3" onClick={cancelSelected}>Cancel selected</button><button className="btn-ghost text-xs py-1 px-3 text-muted" onClick={() => setSelected(new Set())}>Clear</button></div>}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table" aria-label="Jobs table">
            <thead><tr><th className="pl-4 pr-2 py-3 w-8"><input type="checkbox" checked={jobs.length > 0 && selected.size === jobs.length} onChange={toggleSelectAll} className="w-3.5 h-3.5 rounded border-surface-border bg-surface accent-brand-500 cursor-pointer" /></th><ColHeader field="name" label="Job" /><th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-subtle">Queue</th><ColHeader field="status" label="Status" /><ColHeader field="priority" label="Priority" /><th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-subtle">Retries</th><ColHeader field="created_at" label="Created" /><th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-muted-subtle text-right">Actions</th></tr></thead>
            <tbody>
              {isLoading ? Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-4"><div className="skeleton h-8 rounded-lg" /></td></tr>)
                : sorted.length === 0 ? <EmptyState filtered={filtered} />
                : sorted.map((job) => <JobRow key={job.id} job={job} isSelected={selected.has(job.id)} onSelect={toggleSelect} onRetry={handleRetry} onCancel={handleCancel} onView={setDetailJob} />)}
            </tbody>
          </table>
        </div>
        {!isLoading && <div className="flex items-center justify-between px-4 py-3 border-t border-surface-border"><p className="text-xs text-muted-subtle">Showing <span className="font-medium text-text-secondary">{sorted.length}</span> jobs{filtered && ' (filtered)'}</p><div className="flex items-center gap-2"><button className="btn-secondary text-xs py-1.5 px-3" disabled={!cursorStack.length} onClick={() => { const next = [...cursorStack]; setCursor(next.pop()); setCursorStack(next); }}>Prev</button><button className="btn-secondary text-xs py-1.5 px-3" disabled={!data?.hasMore} onClick={() => { setCursorStack((prev) => [...prev, cursor]); setCursor(data?.nextCursor); }}>Next</button></div></div>}
      </div>

      </div>

      {showEnqueue && <EnqueueJobModal queues={queues} isPending={createJob.isPending} apiError={createJob.error} onClose={() => { setShowEnqueue(false); createJob.reset(); }} onSubmit={(payload) => createJob.mutate(payload, { onSuccess: () => setShowEnqueue(false) })} />}
      {detailJob && <JobDetailsModal job={detailJob} onClose={() => setDetailJob(null)} />}
    </>
  );
}
