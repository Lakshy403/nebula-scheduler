/**
 * @file services/api/controllers/MetricsController.js
 * @description HTTP controller for the system metrics endpoint.
 *
 * Responsibility contract:
 *  - Extracts the tenant scope from `req.tenantId` (set by auth middleware).
 *  - Delegates aggregation entirely to `MetricsService.getClusterMetrics()`.
 *  - Formats and returns the consistent success envelope.
 *  - Forwards any thrown error to the global error boundary via `next(err)`.
 *
 * Super-admin mode:
 *  Users with role `OWNER` at the platform level can pass `?scope=global`
 *  to receive cross-organization aggregate metrics. All other callers are
 *  scoped to their own organization regardless of the query parameter.
 *
 * Caching note (Phase 6):
 *  This endpoint is a read-only aggregation with ~200–500 ms query time.
 *  A short-lived cache (e.g., Redis `SET EX 10`) on the response is planned
 *  for Phase 6 to handle high-frequency dashboard polling (10 req/s+).
 */

import { metricsService } from '../services/MetricsService.js';
import logger             from '../utils/logger.js';

export const MetricsController = {
  /**
   * GET /api/v1/metrics/health
   *
   * Returns a Datadog-style cluster health payload for the requesting tenant.
   *
   * @type {import('express').RequestHandler}
   */
  async getHealth(req, res, next) {
    try {
      // Determine scope: OWNER users may request global metrics; all others
      // are restricted to their own organization.
      const isOwner    = req.user?.role === 'OWNER';
      const wantsGlobal = req.query?.scope === 'global';
      const organizationId = (isOwner && wantsGlobal)
        ? null            // null = no tenant filter (all orgs)
        : req.tenantId;   // scoped to the authenticated org

      const metrics = await metricsService.getClusterMetrics({
        organizationId,
        requestId: req.id,
      });

      logger.info('GET /metrics/health — metrics returned.', {
        requestId:       req.id,
        organizationId:  metrics.organization_id,
        queryDurationMs: metrics.query_duration_ms,
      });

      return res.status(200).json({
        status:    'success',
        requestId: req.id,
        data:      metrics,
      });
    } catch (err) {
      return next(err);
    }
  },

  /**
   * GET /api/v1/metrics/throughput
   *
   * Returns timeseries data for the throughput chart for the requesting tenant.
   *
   * @type {import('express').RequestHandler}
   */
  async getThroughput(req, res, next) {
    try {
      const isOwner    = req.user?.role === 'OWNER';
      const wantsGlobal = req.query?.scope === 'global';
      const timeframe  = req.query?.timeframe || '1h';
      const organizationId = (isOwner && wantsGlobal)
        ? null
        : req.tenantId;

      const throughput = await metricsService.getThroughputSeries({
        organizationId,
        requestId: req.id,
        timeframe,
      });

      return res.status(200).json({
        status:    'success',
        requestId: req.id,
        data:      throughput,
      });
    } catch (err) {
      return next(err);
    }
  },
};
