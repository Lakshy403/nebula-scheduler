/**
 * @file services/api/routes/metrics.routes.js
 * @description Express router for the /api/v1/metrics resource.
 *
 * Routes:
 *  GET /api/v1/metrics/health
 *    Returns cluster health metrics scoped to the authenticated organization.
 *    Accepts `?scope=global` for OWNER-role super-admin cross-org view.
 *
 * Middleware chain:
 *  authenticate → MetricsController.getHealth
 *
 * Note: No Zod validation middleware is applied here because this is a
 * read-only endpoint with a single optional query parameter (`scope`) whose
 * validation is handled inside the controller (role-based business logic,
 * not structural schema validation).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Mount this router in app.js:
 *
 *   import metricsRoutes from './routes/metrics.routes.js';
 *   app.use('/api/v1/metrics', metricsRoutes);
 * ─────────────────────────────────────────────────────────────────────────
 */

import { Router }           from 'express';
import { authenticate }     from '../middlewares/auth.middleware.js';
import { MetricsController } from '../controllers/MetricsController.js';

const router = Router();

// GET /api/v1/metrics/health
router.get('/health', authenticate, MetricsController.getHealth);

// GET /api/v1/metrics/throughput
router.get('/throughput', authenticate, MetricsController.getThroughput);

export default router;
