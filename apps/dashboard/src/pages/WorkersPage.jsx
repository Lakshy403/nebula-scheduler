import { formatDistanceToNow } from 'date-fns';
import StatusBadge from '@/components/StatusBadge';
import { useWorkers } from '@/hooks/useMetrics';

export default function WorkersPage() {
  const { data: workers = [], isLoading, isError } = useWorkers();

  return (
    <div className="p-6 lg:p-8 animate-fade-in space-y-5">
      <div className="section-header">
        <div>
          <h1 className="page-title">Workers</h1>
          <p className="page-subtitle">Heartbeat status and active job assignments</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Host</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Queues</th>
              <th className="px-4 py-3 text-left">Memory</th>
              <th className="px-4 py-3 text-left">Last heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Loading workers...</td></tr>}
            {isError && <tr><td colSpan={5} className="px-4 py-10 text-center text-danger-text">Unable to load workers.</td></tr>}
            {!isLoading && workers.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No workers have registered yet.</td></tr>}
            {workers.map((worker) => (
              <tr key={worker.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-text-primary">{worker.hostname}</div>
                  <div className="text-xs text-muted font-mono">{worker.ip_address ?? worker.id}</div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={worker.status} /></td>
                <td className="px-4 py-3 text-sm text-muted">{Array.isArray(worker.queues) ? worker.queues.join(', ') : 'default'}</td>
                <td className="px-4 py-3 text-sm text-muted tabular-nums">{worker.current_memory_mb ?? '-'} MB</td>
                <td className="px-4 py-3 text-sm text-muted">
                  {worker.last_heartbeat_at ? formatDistanceToNow(new Date(worker.last_heartbeat_at), { addSuffix: true }) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
