/**
 * @file services/api/routes/job.routes.js
 * @description Express router for the /api/v1/jobs resource.
 *
 * Middleware chain per route (left to right = execution order):
 *
 *   POST /
 *     authenticate â†’ validate(createJobSchema) â†’ JobController.create
 *
 *   GET /
 *     authenticate â†’ validate(listJobsSchema, 'query') â†’ JobController.list
 *
 *   PATCH /:id/cancel
 *     authenticate â†’ validate(cancelJobParamSchema, 'params') â†’ JobController.cancel
 *
 * Design notes:
 *  - `authenticate` is applied per-route (not router.use) so future public
 *    endpoints (e.g., a webhook status check) can be added to this file
 *    without the auth requirement.
 *  - Rate limiting (per-organization token bucket) will be inserted between
 *    `authenticate` and `validate` in Phase 5 once the Redis rate-limiter
 *    middleware is implemented.
 *  - All business errors thrown by the service layer propagate through
 *    `next(err)` in the controller to the global error boundary in app.js.
 *
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Mount this router in app.js:
 *
 *   import jobRoutes from './routes/job.routes.js';
 *   app.use('/api/v1/jobs', jobRoutes);
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

import { Router }       from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { validate }     from '../middlewares/validate.middleware.js';
import {
  createJobSchema,
  listJobsSchema,
  cancelJobParamSchema,
}                       from '../validators/job.schema.js';
import { JobController } from '../controllers/JobController.js';
import { opsService } from '../services/OpsService.js';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/jobs â€” Enqueue a new job
// ---------------------------------------------------------------------------
router.post(
  '/',
  authenticate,
  validate(createJobSchema),               // validates req.body
  JobController.create,
);

// ---------------------------------------------------------------------------
// GET /api/v1/jobs â€” List jobs (paginated, filtered)
// ---------------------------------------------------------------------------
router.get(
  '/',
  authenticate,
  validate(listJobsSchema, 'query'),       // validates req.query
  JobController.list,
);

// ---------------------------------------------------------------------------
// PATCH /api/v1/jobs/:id/cancel â€” Cancel a job
// ---------------------------------------------------------------------------
router.patch(
  '/:id/cancel',
  authenticate,
  validate(cancelJobParamSchema, 'params'), // validates req.params.id
  JobController.cancel,
);

// ---------------------------------------------------------------------------
// POST /api/v1/jobs/:id/retry - Manually retry a failed/cancelled job
// ---------------------------------------------------------------------------
router.post(
  '/:id/retry',
  authenticate,
  validate(cancelJobParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const job = await opsService.retryJob({ organizationId: req.tenantId, jobId: req.params.id });
      res.status(200).json({ status: 'success', requestId: req.id, data: job });
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// GET /api/v1/jobs/:id/executions - Execution history and logs
// ---------------------------------------------------------------------------
router.get(
  '/:id/executions',
  authenticate,
  validate(cancelJobParamSchema, 'params'),
  async (req, res, next) => {
    try {
      const executions = await opsService.getJobExecutions({ organizationId: req.tenantId, jobId: req.params.id });
      res.status(200).json({ status: 'success', requestId: req.id, data: executions });
    } catch (err) { next(err); }
  },
);
export default router;

