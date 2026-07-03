import { formatDistanceToNow } from 'date-fns';
import { RotateCcw } from 'lucide-react';
import { useDlq, useJobMutations } from '@/hooks/useMetrics';

export default function DLQPage() {
  const { data: entries = [], isLoading, isError } = useDlq();
  const { replayDlq } = useJobMutations();

  return (
    <div className="p-6 lg:p-8 animate-fade-in space-y-5">
      <div className="section-header">
        <div>
          <h1 className="page-title">Dead Letter Queue</h1>
          <p className="page-subtitle">Permanent failures, replay controls, and AI summaries</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left">Job</th>
              <th className="px-4 py-3 text-left">Error</th>
              <th className="px-4 py-3 text-left">Attempts</th>
              <th className="px-4 py-3 text-left">Promoted</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">Loading DLQ...</td></tr>}
            {isError && <tr><td colSpan={5} className="px-4 py-10 text-center text-danger-text">Unable to load DLQ.</td></tr>}
            {!isLoading && entries.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No dead-lettered jobs.</td></tr>}
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-text-primary">{entry.job_name}</div>
                  <div className="text-xs text-muted font-mono">{entry.original_job_id}</div>
                </td>
                <td className="px-4 py-3 text-sm text-muted max-w-xl truncate" title={entry.last_error_message}>{entry.last_error_message}</td>
                <td className="px-4 py-3 text-sm text-muted tabular-nums">{entry.total_attempts}</td>
                <td className="px-4 py-3 text-sm text-muted">
                  {entry.promoted_at ? formatDistanceToNow(new Date(entry.promoted_at), { addSuffix: true }) : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="btn-secondary text-xs gap-1.5" onClick={() => replayDlq.mutate(entry.id)} disabled={Boolean(entry.replayed_at)}>
                    <RotateCcw className="w-3.5 h-3.5" />
                    {entry.replayed_at ? 'Replayed' : 'Replay'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
