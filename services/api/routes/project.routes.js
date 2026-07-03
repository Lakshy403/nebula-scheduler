import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { projectQueueService } from '../services/ProjectQueueService.js';

const router = Router();
const uuid = z.string().uuid();

const createProjectSchema = z.object({
  name: z.string().min(1).max(160),
  slug: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
}).strict();

router.get('/', authenticate, async (req, res, next) => {
  try { res.json({ status: 'success', data: await projectQueueService.listProjects({ organizationId: req.tenantId }) }); }
  catch (err) { next(err); }
});

router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'DEVELOPER'), validate(createProjectSchema), async (req, res, next) => {
  try { res.status(201).json({ status: 'success', data: await projectQueueService.createProject({ organizationId: req.tenantId, userId: req.user.id, data: req.body }) }); }
  catch (err) { next(err); }
});

router.get('/:projectId/queues', authenticate, validate(z.object({ projectId: uuid }).strict(), 'params'), async (req, res, next) => {
  try { res.json({ status: 'success', data: await projectQueueService.listQueues({ organizationId: req.tenantId, projectId: req.params.projectId }) }); }
  catch (err) { next(err); }
});

export default router;
