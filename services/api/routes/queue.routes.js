import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { projectQueueService } from '../services/ProjectQueueService.js';

const router = Router();
const uuid = z.string().uuid();

const createQueueSchema = z.object({
  project_id: uuid,
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  priority: z.number().int().min(1).max(10).default(5),
  concurrency_limit: z.number().int().min(1).max(1000).default(5),
  rate_limit_per_minute: z.number().int().min(1).optional(),
  default_timeout_seconds: z.number().int().min(1).max(86400).default(300),
  default_max_retries: z.number().int().min(0).max(10).default(3),
  default_retry_strategy: z.enum(['FIXED', 'LINEAR', 'EXPONENTIAL']).default('EXPONENTIAL'),
  default_retry_backoff_base_ms: z.number().int().min(100).max(3600000).default(1000),
}).strict();

const updateQueueSchema = createQueueSchema.partial().omit({ project_id: true }).extend({ is_paused: z.boolean().optional() }).strict();
const idParams = z.object({ id: uuid }).strict();

router.get('/', authenticate, async (req, res, next) => {
  try { res.json({ status: 'success', data: await projectQueueService.listQueues({ organizationId: req.tenantId }) }); }
  catch (err) { next(err); }
});

router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'DEVELOPER'), validate(createQueueSchema), async (req, res, next) => {
  try { res.status(201).json({ status: 'success', data: await projectQueueService.createQueue({ organizationId: req.tenantId, data: req.body }) }); }
  catch (err) { next(err); }
});

router.patch('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'DEVELOPER'), validate(idParams, 'params'), validate(updateQueueSchema), async (req, res, next) => {
  try { res.json({ status: 'success', data: await projectQueueService.updateQueue({ organizationId: req.tenantId, queueId: req.params.id, data: req.body }) }); }
  catch (err) { next(err); }
});

router.patch('/:id/pause', authenticate, requireRole('OWNER', 'ADMIN', 'DEVELOPER'), validate(idParams, 'params'), async (req, res, next) => {
  try { res.json({ status: 'success', data: await projectQueueService.pauseQueue({ organizationId: req.tenantId, queueId: req.params.id, paused: true }) }); }
  catch (err) { next(err); }
});

router.patch('/:id/resume', authenticate, requireRole('OWNER', 'ADMIN', 'DEVELOPER'), validate(idParams, 'params'), async (req, res, next) => {
  try { res.json({ status: 'success', data: await projectQueueService.pauseQueue({ organizationId: req.tenantId, queueId: req.params.id, paused: false }) }); }
  catch (err) { next(err); }
});

router.get('/:id/stats', authenticate, validate(idParams, 'params'), async (req, res, next) => {
  try { res.json({ status: 'success', data: await projectQueueService.getQueueStats({ organizationId: req.tenantId, queueId: req.params.id }) }); }
  catch (err) { next(err); }
});

export default router;
