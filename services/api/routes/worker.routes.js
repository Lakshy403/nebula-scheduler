import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware.js';
import { opsService } from '../services/OpsService.js';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try { res.json({ status: 'success', data: await opsService.listWorkers({ organizationId: req.tenantId }) }); }
  catch (err) { next(err); }
});

export default router;
