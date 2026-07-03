/**
 * @file services/api/services/MetricsService.js
 * @description System-wide cluster health metrics aggregation service.
 *
 * Design principles:
 *  - All queries are raw SQL (not ORM). ORM abstractions add overhead and
 *    hide the exact indexes being used. For dashboard aggregations that run
 *    on every poll, query transparency and performance are paramount.
 *  - Queries are scoped to a single tenant (organizationId) by default.
 *    Passing `organizationId = null` enables a super-admin global view.
 *  - All queries run concurrently via Promise.all — total latency equals the
 *    slowest single query, not the sum of all queries.
 *  - Results are assembled into a single, flat metrics payload compatible
 *    with Datadog-style time-series dashboards and JSON API consumers.
 *
 * Metric definitions:
 *  ┌────────────────────────┬──────────────────────────────────────────────┐
 *  │ Metric                 │ Definition                                   │
 *  ├────────────────────────┼──────────────────────────────────────────────┤
 *  │ jobs_by_status         │ COUNT(*) GROUP BY status from `jobs`         │
 *  │ workers_active         │ workers with heartbeat within 60 s           │
 *  │ workers_offline        │ workers with heartbeat older than 60 s       │
 *  │ dlq_total              │ COUNT(*) from `dead_letter_queue`            │
 *  │ dlq_unresolved         │ DLQ rows where replayed_at IS NULL           │
 *  │ success_rate_pct       │ SUCCEEDED / (SUCCEEDED + FAILED) × 100       │
 *  │ avg_duration_ms        │ AVG(duration_ms) from job_executions (SUCC.) │
 *  │ p95_duration_ms        │ 95th-percentile via window function          │
 *  │ throughput_last_hour   │ Jobs completed in the last 60 minutes        │
 *  └────────────────────────┴──────────────────────────────────────────────┘
 */

import { QueryTypes } from 'sequelize';
import { sequelize }  from '../../../packages/database/index.js';
import logger         from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A worker is considered OFFLINE if its heartbeat is older than this. */
const DEAD_WORKER_TTL_S = parseInt(process.env.DEAD_WORKER_TTL_S ?? '60', 10);

// ---------------------------------------------------------------------------
// MetricsService
// ---------------------------------------------------------------------------

export class MetricsService {
  /**
   * Aggregates cluster health metrics for a single organization (or globally).
   *
   * @param {object}        params
   * @param {string | null} params.organizationId - Tenant scope. Null = all orgs (super-admin).
   * @param {string}        [params.requestId]
   * @returns {Promise<ClusterMetrics>}
   */
  async getClusterMetrics({ organizationId, requestId }) {
    const log = logger.child({ requestId, method: 'getClusterMetrics', organizationId });
    const start = Date.now();

    // ── Tenant filter fragment ─────────────────────────────────────────────
    // All job/worker/DLQ queries are scoped to the tenant through a JOIN chain:
    //   jobs → queues → projects → organizations
    // When organizationId is null (super-admin), the JOIN and WHERE are dropped.
    const orgFilter = organizationId
      ? `INNER JOIN queues     q  ON j.queue_id   = q.id
         INNER JOIN projects   p  ON q.project_id = p.id
         INNER JOIN organizations o ON p.organization_id = o.id
         WHERE o.id = '${organizationId}'`
      : '';

    const workerOrgFilter = organizationId
      ? `INNER JOIN projects   p  ON w.project_id = p.id
         INNER JOIN organizations o ON p.organization_id = o.id
         WHERE o.id = '${organizationId}'`
      : '';

    const dlqOrgFilter = organizationId
      ? `INNER JOIN queues     q  ON d.queue_id   = q.id
         INNER JOIN projects   p  ON q.project_id = p.id
         INNER JOIN organizations o ON p.organization_id = o.id
         WHERE o.id = '${organizationId}'`
      : '';

    // ── Execute all queries concurrently ──────────────────────────────────
    log.debug('Fetching cluster metrics...');

    const [
      jobStatusRows,
      workerRows,
      dlqRows,
      executionPerfRows,
      throughputRows,
    ] = await Promise.all([
      this.#queryJobStats(orgFilter),
      this.#queryWorkerStats(workerOrgFilter),
      this.#queryDlqStats(dlqOrgFilter),
      this.#queryExecutionPerf(organizationId),
      this.#queryThroughput(organizationId),
    ]);

    // ── Assemble job status map ────────────────────────────────────────────
    const jobsByStatus = {
      PENDING:   0,
      QUEUED:    0,
      RUNNING:   0,
      SCHEDULED: 0,
      SUCCEEDED: 0,
      FAILED:    0,
      CANCELLED: 0,
      DEAD:      0,
    };

    for (const row of jobStatusRows) {
      if (row.status in jobsByStatus) {
        jobsByStatus[row.status] = Number(row.count);
      }
    }

    const totalJobs        = Object.values(jobsByStatus).reduce((a, b) => a + b, 0);
    const terminalJobs     = jobsByStatus.SUCCEEDED + jobsByStatus.FAILED;
    const successRatePct   = terminalJobs > 0
      ? parseFloat(((jobsByStatus.SUCCEEDED / terminalJobs) * 100).toFixed(2))
      : null; // null = insufficient data (no terminal jobs yet)

    // ── Assemble worker stats ─────────────────────────────────────────────
    const workerActive  = Number(workerRows.find((r) => r.bucket === 'active')?.count  ?? 0);
    const workerOffline = Number(workerRows.find((r) => r.bucket === 'offline')?.count ?? 0);

    // ── Assemble DLQ stats ────────────────────────────────────────────────
    const dlqTotal      = Number(dlqRows.find((r) => r.bucket === 'total')?.count      ?? 0);
    const dlqUnresolved = Number(dlqRows.find((r) => r.bucket === 'unresolved')?.count ?? 0);

    // ── Assemble execution performance ────────────────────────────────────
    const perf = executionPerfRows[0] ?? {};

    // ── Assemble throughput ───────────────────────────────────────────────
    const throughputLastHour = Number(throughputRows[0]?.count ?? 0);

    const durationMs = Date.now() - start;
    log.info('Cluster metrics assembled.', { durationMs, totalJobs });

    /** @type {ClusterMetrics} */
    return {
      collected_at:         new Date().toISOString(),
      query_duration_ms:    durationMs,
      organization_id:      organizationId ?? 'ALL',

      jobs: {
        total:         totalJobs,
        by_status:     jobsByStatus,
        success_rate_percentage: successRatePct,
      },

      workers: {
        active:        workerActive,
        offline:       workerOffline,
        total:         workerActive + workerOffline,
        heartbeat_threshold_seconds: DEAD_WORKER_TTL_S,
      },

      dead_letter_queue: {
        total:         dlqTotal,
        unresolved:    dlqUnresolved,
        resolved:      dlqTotal - dlqUnresolved,
      },

      execution_performance: {
        avg_duration_ms:          perf.avg_ms   ? parseFloat(Number(perf.avg_ms).toFixed(2))  : null,
        p95_duration_ms:          perf.p95_ms   ? parseFloat(Number(perf.p95_ms).toFixed(2))  : null,
        max_duration_ms:          perf.max_ms   ? Number(perf.max_ms)                          : null,
        sample_size:              perf.sample   ? Number(perf.sample)                          : 0,
      },

      throughput: {
        completed_last_hour: throughputLastHour,
      },
    };
  }

  /**
   * Retrieves the 60-minute throughput series for the dashboard chart.
   *
   * @param {object}        params
   * @param {string | null} params.organizationId
   * @param {string}        [params.requestId]
   * @returns {Promise<Array<{time: string, jobs: number, failed: number}>>}
   */
  async getThroughputSeries({ organizationId, requestId, timeframe = '1h' }) {
    const tenantJoin = organizationId
      ? `INNER JOIN queues   q ON j.queue_id   = q.id
         INNER JOIN projects p ON q.project_id = p.id
         INNER JOIN organizations org ON p.organization_id = org.id AND org.id = :orgId`
      : '';

    const replacements = organizationId ? { orgId: organizationId } : {};

    let dateFormat, intervalSql, numPoints, stepMs, formatTime;
    
    if (timeframe === '7d') {
      dateFormat = `'%m-%d'`;
      intervalSql = `INTERVAL 7 DAY`;
      numPoints = 7;
      stepMs = 24 * 60 * 60 * 1000;
      formatTime = (d) => {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${mm}-${dd}`;
      };
    } else if (timeframe === '24h') {
      dateFormat = `'%m-%d %H:00'`;
      intervalSql = `INTERVAL 24 HOUR`;
      numPoints = 24;
      stepMs = 60 * 60 * 1000;
      formatTime = (d) => {
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        return `${mm}-${dd} ${hh}:00`;
      };
    } else {
      // 1h default
      dateFormat = `'%H:%i'`;
      intervalSql = `INTERVAL 60 MINUTE`;
      numPoints = 60;
      stepMs = 60 * 1000;
      formatTime = (d) => {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      };
    }

    try {
      const rows = await sequelize.query(
        `
        SELECT
          DATE_FORMAT(j.completed_at, ${dateFormat}) AS time,
          SUM(CASE WHEN j.status = 'SUCCEEDED' THEN 1 ELSE 0 END) AS jobs,
          SUM(CASE WHEN j.status = 'FAILED' THEN 1 ELSE 0 END) AS failed
        FROM jobs j
        ${tenantJoin}
        WHERE
          j.status IN ('SUCCEEDED', 'FAILED')
          AND j.completed_at >= DATE_SUB(NOW(), ${intervalSql})
        GROUP BY time
        ORDER BY time ASC
        `,
        {
          type: QueryTypes.SELECT,
          replacements,
        }
      );

      // Fill in any gaps
      const series = [];
      const now = new Date();
      for (let i = numPoints - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * stepMs);
        const timeStr = formatTime(d);
        
        const row = rows.find(r => r.time === timeStr);
        series.push({
          time: timeStr,
          jobs: row ? Number(row.jobs) : 0,
          failed: row ? Number(row.failed) : 0,
        });
      }
      return series;
    } catch (err) {
      logger.error('MetricsService: getThroughputSeries query failed.', { error: err, requestId });
      return [];
    }
  }

  // ── Private: Query methods ─────────────────────────────────────────────────

  /**
   * Job counts grouped by status.
   * Uses the `idx_jobs_queue_status_created` index for efficiency.
   *
   * @param {string} orgFilter - Tenant-scoped JOIN + WHERE fragment.
   * @returns {Promise<Array<{status: string, count: string}>>}
   */
  async #queryJobStats(orgFilter) {
    try {
      return await sequelize.query(
        `
        SELECT
          j.status,
          COUNT(*) AS count
        FROM jobs j
        ${orgFilter}
        GROUP BY j.status
        `,
        { type: QueryTypes.SELECT },
      );
    } catch (err) {
      logger.error('MetricsService: jobStats query failed.', { error: err });
      return [];
    }
  }

  /**
   * Worker counts split into "active" (heartbeat within TTL) and "offline".
   * A single query with CASE WHEN avoids two separate round-trips.
   *
   * @param {string} workerOrgFilter
   * @returns {Promise<Array<{bucket: string, count: string}>>}
   */
  async #queryWorkerStats(workerOrgFilter) {
    try {
      return await sequelize.query(
        `
        SELECT
          CASE
            WHEN w.last_heartbeat_at >= DATE_SUB(NOW(), INTERVAL :ttl SECOND)
              THEN 'active'
            ELSE 'offline'
          END AS bucket,
          COUNT(*) AS count
        FROM workers w
        ${workerOrgFilter}
        GROUP BY bucket
        `,
        {
          type:         QueryTypes.SELECT,
          replacements: { ttl: DEAD_WORKER_TTL_S },
        },
      );
    } catch (err) {
      logger.error('MetricsService: workerStats query failed.', { error: err });
      return [];
    }
  }

  /**
   * DLQ total and unresolved counts.
   * "Unresolved" = DLQ entries where `replayed_at IS NULL` (never replayed).
   *
   * @param {string} dlqOrgFilter
   * @returns {Promise<Array<{bucket: string, count: string}>>}
   */
  async #queryDlqStats(dlqOrgFilter) {
    try {
      return await sequelize.query(
        `
        SELECT 'total'      AS bucket, COUNT(*)                              AS count FROM dead_letter_queue d ${dlqOrgFilter}
        UNION ALL
        SELECT 'unresolved' AS bucket, COUNT(CASE WHEN d.replayed_at IS NULL THEN 1 END) AS count FROM dead_letter_queue d ${dlqOrgFilter}
        `,
        { type: QueryTypes.SELECT },
      );
    } catch (err) {
      logger.error('MetricsService: dlqStats query failed.', { error: err });
      return [];
    }
  }

  /**
   * Execution performance: AVG, P95, and MAX duration from SUCCEEDED executions.
   *
   * P95 is computed using a subquery with ROW_NUMBER window function rather
   * than the PERCENTILE_CONT aggregate (which is not available in MySQL 8.0).
   * Strategy: order all durations ASC, take the row at position CEIL(0.95 × N).
   *
   * @param {string | null} organizationId
   * @returns {Promise<Array<{avg_ms, p95_ms, max_ms, sample}>>}
   */
  async #queryExecutionPerf(organizationId) {
    const tenantJoin = organizationId
      ? `INNER JOIN jobs     j   ON e.job_id    = j.id
         INNER JOIN queues   q   ON j.queue_id  = q.id
         INNER JOIN projects p   ON q.project_id = p.id
         INNER JOIN organizations org ON p.organization_id = org.id AND org.id = :orgId`
      : '';

    const replacements = organizationId ? { orgId: organizationId } : {};

    try {
      return await sequelize.query(
        `
        SELECT
          AVG(duration_ms)                                              AS avg_ms,
          MAX(duration_ms)                                              AS max_ms,
          COUNT(*)                                                      AS sample,
          -- P95 via window function approximation
          SUBSTRING_INDEX(
            GROUP_CONCAT(duration_ms ORDER BY duration_ms ASC SEPARATOR ','),
            ',',
            CEIL(0.95 * COUNT(*))
          ) AS p95_ms_concat          -- last element = P95 value; extracted below
        FROM job_executions e
        ${tenantJoin}
        WHERE
          e.status     = 'SUCCEEDED'
          AND e.duration_ms IS NOT NULL
          AND e.started_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `,
        {
          type:         QueryTypes.SELECT,
          replacements,
        },
      ).then((rows) =>
        rows.map((row) => ({
          avg_ms: row.avg_ms,
          max_ms: row.max_ms,
          sample: row.sample,
          // GROUP_CONCAT returns a CSV; the last element is P95.
          p95_ms: row.p95_ms_concat
            ? row.p95_ms_concat.toString().split(',').at(-1)
            : null,
        })),
      );
    } catch (err) {
      logger.error('MetricsService: executionPerf query failed.', { error: err });
      return [];
    }
  }

  /**
   * Count of jobs that completed (SUCCEEDED or FAILED) in the last 60 minutes.
   * Used as a throughput/rate signal on real-time dashboards.
   *
   * @param {string | null} organizationId
   * @returns {Promise<Array<{count: string}>>}
   */
  async #queryThroughput(organizationId) {
    const tenantJoin = organizationId
      ? `INNER JOIN queues   q ON j.queue_id   = q.id
         INNER JOIN projects p ON q.project_id = p.id
         INNER JOIN organizations org ON p.organization_id = org.id AND org.id = :orgId`
      : '';

    const replacements = organizationId ? { orgId: organizationId } : {};

    try {
      return await sequelize.query(
        `
        SELECT COUNT(*) AS count
        FROM jobs j
        ${tenantJoin}
        WHERE
          j.status     IN ('SUCCEEDED', 'FAILED')
          AND j.completed_at >= DATE_SUB(NOW(), INTERVAL 60 MINUTE)
        `,
        {
          type:         QueryTypes.SELECT,
          replacements,
        },
      );
    } catch (err) {
      logger.error('MetricsService: throughput query failed.', { error: err });
      return [];
    }
  }
}

/**
 * @typedef {object} ClusterMetrics
 * @property {string}      collected_at
 * @property {number}      query_duration_ms
 * @property {string}      organization_id
 * @property {object}      jobs
 * @property {object}      workers
 * @property {object}      dead_letter_queue
 * @property {object}      execution_performance
 * @property {object}      throughput
 */

export const metricsService = new MetricsService();
