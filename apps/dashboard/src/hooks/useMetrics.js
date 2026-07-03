import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { subMinutes, format } from 'date-fns';

export const QUERY_KEYS = {
  metrics: (orgId) => ['metrics', 'cluster', orgId],
  throughput: (orgId) => ['metrics', 'throughput', orgId],
  historicalThroughput: (orgId, timeframe) => ['metrics', 'throughput', orgId, timeframe],
  jobs: (orgId, filters) => ['jobs', orgId, filters],
  queues: (orgId) => ['queues', orgId],
  projects: (orgId) => ['projects', orgId],
  workers: (orgId) => ['workers', orgId],
  dlq: (orgId) => ['dlq', orgId],
};

export function useClusterMetrics() {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.metrics(orgId),
    queryFn: async () => (await api.get('/metrics/health')).data.data,
    refetchInterval: 10_000,
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });
}

export function useThroughputSeries() {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.throughput(orgId),
    queryFn: async () => (await api.get('/metrics/throughput')).data.data,
    refetchInterval: 30_000,
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });
}

export function useHistoricalThroughput(timeframe) {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.historicalThroughput(orgId, timeframe),
    queryFn: async () => (await api.get(`/metrics/throughput?timeframe=${timeframe}`)).data.data,
    refetchInterval: timeframe === '1h' ? 30_000 : 300_000,
    enabled: Boolean(orgId) && Boolean(timeframe),
    placeholderData: (prev) => prev,
  });
}

export function useJobs(filters = {}) {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.jobs(orgId, filters),
    queryFn: async () => {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([k, v]) => k !== 'search' && v !== undefined && v !== ''),
      );
      const { data } = await api.get('/jobs', { params });
      return { data: data.data, hasMore: data.meta?.hasMore, nextCursor: data.meta?.nextCursor, meta: data.meta };
    },
    refetchInterval: 15_000,
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });
}

export function useProjects() {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.projects(orgId),
    queryFn: async () => (await api.get('/projects')).data.data,
    enabled: Boolean(orgId),
  });
}

export function useQueues() {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.queues(orgId),
    queryFn: async () => (await api.get('/queues')).data.data,
    enabled: Boolean(orgId),
  });
}

export function useWorkers() {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.workers(orgId),
    queryFn: async () => (await api.get('/workers')).data.data,
    refetchInterval: 10_000,
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });
}

export function useDlq() {
  const orgId = useAuthStore((s) => s.user?.organizationId);
  return useQuery({
    queryKey: QUERY_KEYS.dlq(orgId),
    queryFn: async () => (await api.get('/dlq')).data.data,
    refetchInterval: 15_000,
    enabled: Boolean(orgId),
    placeholderData: (prev) => prev,
  });
}

export function useJobExecutions(jobId) {
  return useQuery({
    queryKey: ['job-executions', jobId],
    queryFn: async () => (await api.get(`/jobs/${jobId}/executions`)).data.data,
    enabled: Boolean(jobId),
  });
}

export function useJobMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['jobs'] });
    qc.invalidateQueries({ queryKey: ['metrics'] });
    qc.invalidateQueries({ queryKey: ['dlq'] });
    qc.invalidateQueries({ queryKey: ['queues'] });
  };
  return {
    createJob: useMutation({ mutationFn: (payload) => api.post('/jobs', payload), onSuccess: invalidate }),
    cancelJob: useMutation({ mutationFn: (jobId) => api.patch(`/jobs/${jobId}/cancel`), onSuccess: invalidate }),
    retryJob: useMutation({ mutationFn: (jobId) => api.post(`/jobs/${jobId}/retry`), onSuccess: invalidate }),
    replayDlq: useMutation({ mutationFn: (dlqId) => api.post(`/dlq/${dlqId}/replay`), onSuccess: invalidate }),
  };
}

export function useQueueMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['queues'] });
    qc.invalidateQueries({ queryKey: ['metrics'] });
  };
  return {
    createQueue: useMutation({ mutationFn: (payload) => api.post('/queues', payload), onSuccess: invalidate }),
    updateQueue: useMutation({ mutationFn: ({ id, payload }) => api.patch(`/queues/${id}`, payload), onSuccess: invalidate }),
    pauseQueue: useMutation({ mutationFn: (id) => api.patch(`/queues/${id}/pause`), onSuccess: invalidate }),
    resumeQueue: useMutation({ mutationFn: (id) => api.patch(`/queues/${id}/resume`), onSuccess: invalidate }),
  };
}

export async function cancelJobRequest(jobId) {
  const { data } = await api.patch(`/jobs/${jobId}/cancel`);
  return data;
}
