/**
 * @file services/api/controllers/JobController.js
 * @description HTTP controller for the Job resource.
 *
 * Responsibility contract (strict):
 *  Controllers are responsible ONLY for:
 *   1. Extracting validated inputs from `req` (body, query, params, user context).
 *   2. Invoking the appropriate `JobApiService` method.
 *   3. Formatting a consistent, versioned JSON response envelope.
 *   4. Forwarding any thrown error to the global error boundary via `next(error)`.
 *
 *  Controllers must NOT:
 *   - Import Sequelize models, operators, or query builders.
 *   - Contain conditional business logic (that belongs in the service layer).
 *   - Directly access `process.env` for business decisions.
 *
 * Response envelope:
 *  All successful responses follow the shape:
 *  {
 *    "status":    "success",
 *    "requestId": "<uuid>",
 *    "data":      <payload>,      // single object or array
 *    "meta":      <pagination?>   // present on list responses only
 *  }
 *
 * HTTP status conventions:
 *  - 201 Created   — resource successfully inserted (enqueue).
 *  - 200 OK        — read or state-change (list, cancel).
 *  - 4xx/5xx       — delegated to global error boundary via next(error).
 */

import { jobApiService } from '../services/JobApiService.js';
import logger            from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

/**
 * Constructs the standard success envelope.
 *
 * @param {object}  opts
 * @param {*}       opts.data       - Primary response payload.
 * @param {object}  [opts.meta]     - Pagination / auxiliary metadata.
 * @param {string}  [opts.requestId]
 * @returns {object}
 */
function successResponse({ data, meta, requestId }) {
  return {
    status:    'success',
    requestId: requestId ?? null,
    data,
    ...(meta !== undefined && { meta }),
  };
}

// ---------------------------------------------------------------------------
// JobController
// ---------------------------------------------------------------------------

export const JobController = {
  // ── POST /api/v1/jobs ──────────────────────────────────────────────────

  /**
   * Enqueues a new job.
   *
   * Request body is pre-validated by the Zod middleware before this handler
   * is reached — `req.body` contains only clean, typed, defaulted values.
   *
   * @type {import('express').RequestHandler}
   */
  async create(req, res, next) {
    try {
      const job = await jobApiService.enqueueJob({
        data:      req.body,
        tenantId:  req.tenantId,
        createdBy: req.user.id,
        requestId: req.id,
      });

      logger.info('POST /jobs — job enqueued.', {
        requestId: req.id,
        userId:    req.user.id,
        jobId:     job.id,
        status:    job.status,
      });

      return res.status(201).json(
        successResponse({ data: job, requestId: req.id }),
      );
    } catch (err) {
      return next(err);
    }
  },

  // ── GET /api/v1/jobs ───────────────────────────────────────────────────

  /**
   * Returns a cursor-paginated list of jobs filtered by query parameters.
   *
   * Query params are pre-validated and coerced by the Zod middleware.
   * `req.query.limit` arrives as a `number` (not a string) due to Zod's
   * `.transform()` applied in `listJobsSchema`.
   *
   * @type {import('express').RequestHandler}
   */
  async list(req, res, next) {
    try {
      const result = await jobApiService.getJobs({
        filters:   req.query,
        tenantId:  req.tenantId,
        requestId: req.id,
      });

      logger.debug('GET /jobs — list returned.', {
        requestId: req.id,
        count:     result.data.length,
        hasMore:   result.hasMore,
      });

      return res.status(200).json(
        successResponse({
          data:      result.data,
          requestId: req.id,
          meta: {
            limit:      req.query.limit,
            hasMore:    result.hasMore,
            nextCursor: result.nextCursor,
          },
        }),
      );
    } catch (err) {
      return next(err);
    }
  },

  // ── PATCH /api/v1/jobs/:id/cancel ─────────────────────────────────────

  /**
   * Cancels a PENDING, QUEUED, or SCHEDULED job.
   *
   * The `:id` param is pre-validated by the Zod param middleware to be a
   * valid UUID v4, so no manual format check is needed here.
   *
   * @type {import('express').RequestHandler}
   */
  async cancel(req, res, next) {
    try {
      const job = await jobApiService.cancelJob({
        jobId:     req.params.id,
        tenantId:  req.tenantId,
        userId:    req.user.id,
        requestId: req.id,
      });

      logger.info('PATCH /jobs/:id/cancel — job cancelled.', {
        requestId: req.id,
        userId:    req.user.id,
        jobId:     job.id,
      });

      return res.status(200).json(
        successResponse({ data: job, requestId: req.id }),
      );
    } catch (err) {
      return next(err);
    }
  },
};
