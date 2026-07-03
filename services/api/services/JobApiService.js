/**
 * @file services/api/services/JobApiService.js
 * @description Service layer for the Job API.
 *
 * Architectural contract:
 *  - This class owns ALL database interactions for Job API operations.
 *  - Controllers call these methods and receive plain data objects or
 *    throw AppError instances â€” no Sequelize models escape this layer.
 *  - Raw ORM models are serialised via `.toJSON()` before being returned,
 *    preventing accidental Sequelize proxy leakage into HTTP responses.
 *
 * Error contract:
 *  - `AppError` (a structured Error subclass defined below) carries an HTTP
 *    status code and a machine-readable `code` string. The global Express
 *    error boundary in app.js maps these directly to HTTP responses.
 *  - Unexpected DB/ORM errors are allowed to propagate as-is; the error
 *    boundary handles them as 500s.
 *
 * Pagination strategy:
 *  Cursor-based pagination on `(created_at DESC, id DESC)` is used instead
 *  of OFFSET/LIMIT. On high-volume tables, OFFSET causes full index scans
 *  that grow O(offset) in cost. A cursor-based approach is always O(page_size).
 */

import { Op, QueryTypes } from 'sequelize';
import { v4 as uuidv4 }  from 'uuid';
import {
  sequelize,
  Job,
  Queue,
}                         from '../../../packages/database/index.js';
import { JobStatus }      from '../../../packages/database/models/Job.js';
import logger             from '../utils/logger.js';

// ---------------------------------------------------------------------------
// AppError â€” structured error with HTTP semantics
// ---------------------------------------------------------------------------

/**
 * An application-level error that carries an HTTP status code and a
 * machine-readable error code for structured client responses.
 *
 * The global error boundary in app.js detects `instanceof AppError` and
 * maps it to the appropriate HTTP status without leaking stack traces.
 */
export class AppError extends Error {
  /**
   * @param {string} message    - Human-readable error description.
   * @param {number} statusCode - HTTP status code (e.g., 404, 409, 422).
   * @param {string} code       - Machine-readable identifier (e.g., 'JOB_NOT_FOUND').
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name       = 'AppError';
    this.statusCode = statusCode;
    this.status     = statusCode;
    this.code       = code;
    // Capture a clean stack trace that starts from the call site,
    // not from inside this constructor.
    Error.captureStackTrace?.(this, this.constructor);
  }
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

/**
 * Encodes a cursor from the last row returned in a page.
 * Format: base64({ created_at, id })
 *
 * @param {object} row
 * @returns {string}
 */
function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, id: row.id })).toString('base64url');
}

/**
 * Decodes a cursor string back into { created_at, id }.
 * Returns null on any decoding failure (treated as "start from beginning").
 *
 * @param {string} cursor
 * @returns {{ created_at: string; id: string } | null}
 */
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.created_at || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JobApiService
// ---------------------------------------------------------------------------

export class JobApiService {
  // â”€â”€ enqueueJob â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Validates that the target queue exists and belongs to the requesting
   * tenant, then creates a Job row with the appropriate initial status.
   *
   * Status determination:
   *  - `scheduled_at` provided and in the future â†’ `SCHEDULED`
   *    (Scheduler's PromotionService will transition it to QUEUED at run time).
   *  - `cron_expression` provided                â†’ `SCHEDULED`
   *    (Scheduler's CronMaterializer will manage recurrence).
   *  - Neither provided                          â†’ `QUEUED`
   *    (immediately claimable by workers).
   *
   * Idempotency:
   *  If `idempotency_key` is supplied and a job with the same
   *  `(queue_id, idempotency_key)` already exists, returns the existing job
   *  rather than inserting a duplicate.
   *
   * @param {object} params
   * @param {object} params.data       - Validated request body (from createJobSchema).
   * @param {string} params.tenantId   - Organization UUID (from req.tenantId).
   * @param {string} params.createdBy  - User UUID (from req.user.id).
   * @param {string} [params.requestId]
   * @returns {Promise<object>} Serialised Job record.
   */
  async enqueueJob({ data, tenantId, createdBy, requestId }) {
    const log = logger.child({ requestId, method: 'enqueueJob' });

    // â”€â”€ 1. Resolve the target queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const queue = await Queue.findOne({
      where: { id: data.queue_id },
      // Include the project to verify tenant ownership.
      include: [
        {
          association: 'project',
          required:    true,
          include: [
            {
              association: 'organization',
              where:       { id: tenantId },
              required:    true,
            },
          ],
        },
      ],
      // Select only what we need â€” avoids loading the full project/org graph.
      attributes: ['id', 'slug', 'is_paused', 'default_timeout_seconds', 'default_max_retries'],
    });

    if (!queue) {
      throw new AppError(
        `Queue '${data.queue_id}' does not exist or is not accessible within your organization.`,
        404,
        'QUEUE_NOT_FOUND',
      );
    }

    if (queue.is_paused) {
      throw new AppError(
        `Queue '${queue.slug}' is currently paused. Resume it before enqueuing new jobs.`,
        409,
        'QUEUE_PAUSED',
      );
    }

    // â”€â”€ 2. Idempotency check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (data.idempotency_key) {
      const existing = await Job.findOne({
        where: { queue_id: data.queue_id, idempotency_key: data.idempotency_key },
        attributes: ['id', 'status', 'created_at', 'idempotency_key'],
      });

      if (existing) {
        log.info('Idempotent job request â€” returning existing record.', {
          jobId:          existing.id,
          idempotencyKey: data.idempotency_key,
        });
        return existing.toJSON();
      }
    }

    // â”€â”€ 3. Determine initial status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const isDeferred = Boolean(data.scheduled_at || data.cron_expression);
    const initialStatus = isDeferred ? JobStatus.SCHEDULED : JobStatus.QUEUED;

    // `run_at` drives PromotionService's promotion sweep.
    const runAt = data.scheduled_at
      ?? (isDeferred ? null : new Date()); // immediate jobs get run_at = now

    // â”€â”€ 4. Insert the job â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const jobId = uuidv4();

    const job = await Job.create({
      id:                   jobId,
      queue_id:             data.queue_id,
      name:                 data.name,
      payload:              data.payload,
      status:               initialStatus,
      priority:             data.priority,
      cron_expression:      data.cron_expression ?? null,
      scheduled_at:         runAt,
      timeout_seconds:      data.timeout_seconds  ?? queue.default_timeout_seconds,
      max_retries:          data.max_retries       ?? queue.default_max_retries,
      retry_strategy:       data.retry_strategy,
      retry_backoff_base_ms: data.retry_backoff_base_ms,
      idempotency_key:      data.idempotency_key ?? null,
      tags:                 data.tags ?? null,
      created_by:           createdBy,
    });

    log.info('Job enqueued.', {
      jobId:     job.id,
      queueId:   data.queue_id,
      status:    initialStatus,
      scheduled: isDeferred,
    });

    return job.toJSON();
  }

  // â”€â”€ getJobs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Returns a cursor-paginated list of jobs, scoped to the requesting tenant.
   *
   * Filtering:
   *  - `status`   â€” exact match on job status ENUM.
   *  - `queue_id` â€” scope to a specific queue.
   *
   * Cursor format (opaque to the client):
   *  base64url({ created_at, id }) â€” encodes the last row of the previous page.
   *  The next page query adds `WHERE (created_at, id) < (cursor.created_at, cursor.id)`
   *  for a stable, index-friendly seek.
   *
   * @param {object} params
   * @param {object} params.filters     - Validated query params (from listJobsSchema).
   * @param {string} params.tenantId    - Organization UUID.
   * @param {string} [params.requestId]
   * @returns {Promise<{ data: object[]; nextCursor: string | null; hasMore: boolean }>}
   */
  async getJobs({ filters, tenantId, requestId }) {
    const log    = logger.child({ requestId, method: 'getJobs' });
    const { status, queue_id, cursor, limit, order } = filters;

    // â”€â”€ Build WHERE clause â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const where = {};

    if (status)   where.status   = status;
    if (queue_id) where.queue_id = queue_id;

    // Cursor-based seek: (created_at, id) comparison for stable pagination.
    const decoded = decodeCursor(cursor);
    if (decoded) {
      if (order === 'asc') {
        where[Op.or] = [
          { created_at: { [Op.gt]: decoded.created_at } },
          { created_at: decoded.created_at, id: { [Op.gt]: decoded.id } },
        ];
      } else {
        where[Op.or] = [
          { created_at: { [Op.lt]: decoded.created_at } },
          { created_at: decoded.created_at, id: { [Op.lt]: decoded.id } },
        ];
      }
    }

    // â”€â”€ Tenant scope via JOIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Jobs are scoped to the tenant by joining through Queue â†’ Project â†’ Org.
    // This prevents cross-tenant data leakage if a malicious actor passes a
    // queue_id from another organization.
    const jobs = await Job.findAll({
      where,
      include: [
        {
          association: 'queue',
          required:    true,
          attributes:  ['id', 'slug'],
          include: [
            {
              association: 'project',
              required:    true,
              attributes:  ['id', 'slug'],
              include: [
                {
                  association: 'organization',
                  where:       { id: tenantId },
                  required:    true,
                  attributes:  [],   // org data is not included in the response
                },
              ],
            },
          ],
        },
      ],
      // Retrieve limit + 1 rows to determine if a next page exists without
      // a separate COUNT(*) query (which is expensive on large tables).
      limit:   limit + 1,
      order:   [
        ['created_at', order.toUpperCase()],
        ['id',         order.toUpperCase()],
      ],
      // Select only fields relevant to the list view â€” avoids loading
      // large payload/error_stack columns on every list request.
      attributes: [
        'id', 'name', 'status', 'priority', 'retry_count', 'max_retries',
        'retry_strategy', 'scheduled_at', 'started_at', 'completed_at',
        'created_at', 'updated_at', 'queue_id', 'worker_id',
      ],
    });

    const hasMore   = jobs.length > limit;
    const pageItems = hasMore ? jobs.slice(0, limit) : jobs;
    const nextCursor = hasMore ? encodeCursor(pageItems[pageItems.length - 1].toJSON()) : null;

    log.debug('Jobs listed.', { count: pageItems.length, hasMore, tenantId });

    return {
      data:       pageItems.map((j) => j.toJSON()),
      nextCursor,
      hasMore,
    };
  }

  // â”€â”€ cancelJob â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Transitions a job to CANCELLED.
   *
   * Guard conditions (jobs that cannot be cancelled):
   *  - `RUNNING`   â€” a worker has already claimed it; aborting mid-execution is
   *                  unsafe without a worker-side interrupt mechanism (Phase 5).
   *  - `SUCCEEDED` / `FAILED` / `CANCELLED` / `DEAD` â€” terminal states.
   *
   * The update uses a conditional WHERE clause instead of a select-then-update
   * pattern to eliminate the TOCTOU (time-of-check/time-of-use) race condition
   * where a job transitions to RUNNING between our SELECT and UPDATE.
   *
   * @param {object} params
   * @param {string} params.jobId      - UUID of the job to cancel.
   * @param {string} params.tenantId   - Organization UUID for ownership verification.
   * @param {string} params.userId     - User performing the cancellation.
   * @param {string} [params.requestId]
   * @returns {Promise<object>} Updated Job record.
   */
  async cancelJob({ jobId, tenantId, userId, requestId }) {
    const log = logger.child({ requestId, method: 'cancelJob' });

    // â”€â”€ 1. Verify ownership â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Load the job with its queueâ†’projectâ†’org chain to assert tenant access.
    const job = await Job.findOne({
      where: { id: jobId },
      include: [
        {
          association: 'queue',
          required:    true,
          attributes:  ['id'],
          include: [
            {
              association: 'project',
              required:    true,
              attributes:  ['id'],
              include: [
                {
                  association: 'organization',
                  where:       { id: tenantId },
                  required:    true,
                  attributes:  [],
                },
              ],
            },
          ],
        },
      ],
      attributes: ['id', 'status', 'name'],
    });

    if (!job) {
      throw new AppError(
        `Job '${jobId}' does not exist or is not accessible within your organization.`,
        404,
        'JOB_NOT_FOUND',
      );
    }

    // â”€â”€ 2. Guard terminal and in-progress states â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const nonCancellableStatuses = new Set([
      JobStatus.RUNNING,
      JobStatus.SUCCEEDED,
      JobStatus.FAILED,
      JobStatus.CANCELLED,
      JobStatus.DEAD,
    ]);

    if (nonCancellableStatuses.has(job.status)) {
      const reason =
        job.status === JobStatus.RUNNING
          ? `Job '${jobId}' is currently RUNNING and cannot be cancelled. Wait for it to complete or implement worker-side interrupts.`
          : `Job '${jobId}' is in a terminal state (${job.status}) and cannot be cancelled.`;

      throw new AppError(reason, 409, 'JOB_NOT_CANCELLABLE');
    }

    // â”€â”€ 3. Atomic conditional update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // `WHERE status IN (cancellable_statuses)` ensures that even if the job
    // transitions to RUNNING between our check above and this update
    // (a narrow but possible race), the update is a no-op and we detect
    // the race via `affectedRows === 0`.
    const cancellableStatuses = [JobStatus.PENDING, JobStatus.QUEUED, JobStatus.SCHEDULED];

    const [affectedRows] = await Job.update(
      { status: JobStatus.CANCELLED, updated_at: new Date() },
      {
        where: {
          id:     jobId,
          status: { [Op.in]: cancellableStatuses },
        },
      },
    );

    if (affectedRows === 0) {
      // The race condition occurred: the job transitioned to RUNNING (or another
      // terminal state) between the guard check and the UPDATE.
      throw new AppError(
        `Job '${jobId}' could not be cancelled â€” it may have been claimed by a worker concurrently.`,
        409,
        'JOB_CANCEL_RACE',
      );
    }

    // Reload to return the freshest state with updated_at.
    const updated = await Job.findByPk(jobId, {
      attributes: ['id', 'name', 'status', 'updated_at', 'queue_id'],
    });

    log.info('Job cancelled.', { jobId, cancelledBy: userId });

    return updated.toJSON();
  }
}

// Export a singleton instance â€” there is no per-request state in this class.
export const jobApiService = new JobApiService();

