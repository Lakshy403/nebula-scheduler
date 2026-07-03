/**
 * @file services/api/validators/job.schema.js
 * @description Zod schemas for all Job-related HTTP endpoints.
 *
 * Schema responsibilities:
 *  - `createJobSchema`  — validates POST /api/v1/jobs request body.
 *  - `listJobsSchema`   — validates GET  /api/v1/jobs query string parameters.
 *  - `cancelJobSchema`  — validates PATCH /api/v1/jobs/:id/cancel path param.
 *
 * Design conventions:
 *  - All UUIDs are validated with a regex rather than z.string().uuid() so the
 *    error message is explicit ("Must be a valid UUID v4") rather than Zod's
 *    generic "Invalid uuid".
 *  - Enum values are derived from the JobStatus / RetryStrategy constants
 *    defined in the database package — single source of truth, no duplication.
 *  - `.transform()` is used to apply defaults and normalisations (e.g.,
 *    lowercasing tags) rather than polluting controllers with pre-processing.
 *  - `.strict()` rejects unknown keys so clients cannot inject undocumented
 *    fields that silently pass through to the ORM.
 */

import { z }              from 'zod';
import { JobStatus, RetryStrategy } from '../../../packages/database/models/Job.js';

// ---------------------------------------------------------------------------
// Reusable primitives
// ---------------------------------------------------------------------------

/** UUID v4 regex validator with a clean error message. */
const uuidSchema = z
  .string({ required_error: 'Must be a valid UUID v4.' })
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Must be a valid UUID v4.',
  );

/**
 * ISO 8601 datetime string that coerces to a JS Date and validates it is in
 * the future. Used for one-shot scheduled jobs (run_at).
 */
const futureDateSchema = z
  .string()
  .datetime({ message: 'Must be a valid ISO 8601 datetime string (e.g., "2026-07-02T10:00:00Z").' })
  .transform((val) => new Date(val))
  .refine((date) => date > new Date(), {
    message: 'scheduled_at must be a future datetime.',
  });

// ---------------------------------------------------------------------------
// POST /api/v1/jobs — Create / Enqueue Job
// ---------------------------------------------------------------------------

export const createJobSchema = z
  .object({
    // ── Required ────────────────────────────────────────────────────────────
    queue_id: uuidSchema.describe('UUID of the target queue.'),

    name: z
      .string({ required_error: 'Job name is required.' })
      .min(1,   'Job name must not be empty.')
      .max(200, 'Job name must be at most 200 characters.')
      .trim(),

    // `payload` must be a non-null object — the executor type is dispatched
    // from `payload.type`, so it is required here.
    payload: z
      .object(
        {
          type: z
            .string({ required_error: 'payload.type is required.' })
            .min(1, 'payload.type must not be empty.')
            .max(100, 'payload.type must be at most 100 characters.'),
        },
        { required_error: 'payload is required and must be a JSON object.' },
      )
      // Allow (and preserve) any additional payload fields beyond `type`.
      .passthrough(),

    // ── Optional with defaults ───────────────────────────────────────────────
    priority: z
      .number()
      .int('priority must be an integer.')
      .min(1,  'priority must be between 1 (lowest) and 10 (critical).')
      .max(10, 'priority must be between 1 (lowest) and 10 (critical).')
      .default(5),

    max_retries: z
      .number()
      .int('max_retries must be an integer.')
      .min(0, 'max_retries must be ≥ 0.')
      .max(10, 'max_retries must be ≤ 10.')
      .default(3),

    retry_strategy: z
      .enum(Object.values(RetryStrategy), {
        errorMap: () => ({
          message: `retry_strategy must be one of: ${Object.values(RetryStrategy).join(', ')}.`,
        }),
      })
      .default(RetryStrategy.EXPONENTIAL),

    retry_backoff_base_ms: z
      .number()
      .int('retry_backoff_base_ms must be an integer.')
      .min(100,    'retry_backoff_base_ms must be ≥ 100 ms.')
      .max(3_600_000, 'retry_backoff_base_ms must be ≤ 3 600 000 ms (1 hour).')
      .default(1000),

    timeout_seconds: z
      .number()
      .int('timeout_seconds must be an integer.')
      .min(1,     'timeout_seconds must be ≥ 1.')
      .max(86_400, 'timeout_seconds must be ≤ 86 400 (24 hours).')
      .default(300),

    // ── Scheduling ─────────────────────────────────────────────────────────
    // If omitted, the job is enqueued immediately (status = QUEUED).
    // If provided, the job is created as SCHEDULED and promoted by the Scheduler.
    scheduled_at: futureDateSchema.optional(),

    // ── Cron ───────────────────────────────────────────────────────────────
    cron_expression: z
      .string()
      .regex(
        // Basic cron regex: 5 or 6 fields separated by whitespace.
        /^(\S+\s){4}\S+(\s\S+)?$/,
        'cron_expression must be a valid cron string (5 or 6 fields).',
      )
      .optional(),

    // ── Deduplication ──────────────────────────────────────────────────────
    idempotency_key: z
      .string()
      .min(1)
      .max(500, 'idempotency_key must be ≤ 500 characters.')
      .optional(),

    // ── Metadata ──────────────────────────────────────────────────────────
    tags: z
      .array(
        z.string().max(100, 'Each tag must be ≤ 100 characters.'),
        { invalid_type_error: 'tags must be an array of strings.' },
      )
      .max(20, 'A job may have at most 20 tags.')
      .optional()
      .transform((tags) => tags?.map((t) => t.toLowerCase().trim()) ?? undefined),
  })
  // Reject unknown keys — prevents clients from injecting `status`, `retry_count`,
  // or other server-managed fields through the create endpoint.
  .strict({ message: 'Request body contains unexpected fields.' })
  // Cross-field validation: a job cannot be both scheduled_at and a cron job.
  .refine(
    (data) => !(data.scheduled_at && data.cron_expression),
    {
      message: 'A job cannot have both scheduled_at and cron_expression set simultaneously.',
      path:    ['scheduled_at'],
    },
  );

// ---------------------------------------------------------------------------
// GET /api/v1/jobs — List Jobs (query string)
// ---------------------------------------------------------------------------

export const listJobsSchema = z
  .object({
    // Filtering
    status: z
      .enum(Object.values(JobStatus), {
        errorMap: () => ({
          message: `status must be one of: ${Object.values(JobStatus).join(', ')}.`,
        }),
      })
      .optional(),

    queue_id: uuidSchema.optional(),

    // Cursor-based pagination — using created_at + id as the cursor.
    // Safer than offset/limit for high-volume tables (no row-skip scans).
    cursor: z.string().max(500).optional(),

    // Page-size cap: max 100 per request to prevent runaway queries.
    limit: z
      .string()
      .optional()
      .transform((val) => (val !== undefined ? parseInt(val, 10) : 25))
      .pipe(
        z.number()
          .int()
          .min(1,   'limit must be ≥ 1.')
          .max(100, 'limit must be ≤ 100.'),
      ),

    // Sort direction for created_at.
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .default('desc'),
  })
  .strict({ message: 'Query string contains unsupported parameters.' });

// ---------------------------------------------------------------------------
// PATCH /api/v1/jobs/:id/cancel — Cancel Job (path param)
// ---------------------------------------------------------------------------

export const cancelJobParamSchema = z
  .object({
    id: uuidSchema.describe('UUID of the job to cancel.'),
  })
  .strict();
