import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { opsService } from '../services/OpsService.js';

const router = Router();
const idParams = z.object({ id: z.string().uuid() }).strict();

router.get('/', authenticate, async (req, res, next) => {
  try { res.json({ status: 'success', data: await opsService.listDlq({ organizationId: req.tenantId }) }); }
  catch (err) { next(err); }
});

router.post('/:id/replay', authenticate, requireRole('OWNER', 'ADMIN', 'DEVELOPER'), validate(idParams, 'params'), async (req, res, next) => {
  try { res.status(201).json({ status: 'success', data: await opsService.replayDlq({ organizationId: req.tenantId, dlqId: req.params.id, userId: req.user.id }) }); }
  catch (err) { next(err); }
});

export default router;
