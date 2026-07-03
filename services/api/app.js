/**
 * @file services/api/app.js
 * @description Express application factory.
 *
 * This file is deliberately separated from server.js (the HTTP server
 * instantiation) so that the app object can be imported by integration
 * test suites without binding a real TCP port.
 *
 * Middleware stack (in execution order):
 *  1. Request ID injection           â€” trace every request end-to-end
 *  2. Helmet                         â€” HTTP security headers
 *  3. CORS                           â€” origin allow-list from env
 *  4. Body parsers                   â€” JSON + URL-encoded
 *  5. Request logger (Morgan â†’ Winston) â€” structured access log
 *  6. Health check                   â€” bypasses auth; used by load balancers
 *  7. API routes (v1)                â€” mounted at /api/v1
 *  8. 404 handler                    â€” catches unmatched routes
 *  9. Global error boundary          â€” catches all thrown errors + next(err)
 */

import express              from 'express';
import helmet               from 'helmet';
import cors                 from 'cors';
import morgan               from 'morgan';
import { v4 as uuidv4 }    from 'uuid';
import logger               from './utils/logger.js';
import { setupSwagger }     from './src/docs/swagger.js';
import jobRoutes            from './routes/job.routes.js';
import authRoutes           from './routes/auth.routes.js';
import projectRoutes        from './routes/project.routes.js';
import queueRoutes          from './routes/queue.routes.js';
import workerRoutes         from './routes/worker.routes.js';
import dlqRoutes            from './routes/dlq.routes.js';
import metricsRoutes        from './routes/metrics.routes.js';

// ---------------------------------------------------------------------------
// CORS configuration
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server requests (no Origin header) in non-production.
    if (!origin || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS policy: origin '${origin}' is not permitted.`));
  },
  methods:            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:     ['Authorization', 'Content-Type', 'X-Request-ID'],
  exposedHeaders:     ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  credentials:        true,
  maxAge:             86400, // pre-flight cache: 24 hours
};

// ---------------------------------------------------------------------------
// Morgan â†’ Winston stream adapter
// ---------------------------------------------------------------------------
/**
 * Pipes Morgan's access-log output into Winston so that access logs share
 * the same structured JSON transport as application logs.
 */
const morganStream = {
  write(message) {
    // Morgan appends a trailing newline; strip it before handing to Winston.
    logger.info(message.trimEnd(), { type: 'access' });
  },
};

/**
 * Custom Morgan token: emit the request ID injected by our middleware.
 */
morgan.token('request-id', (req) => req.id ?? '-');

const morganFormat =
  process.env.NODE_ENV === 'production'
    ? ':request-id :method :url :status :res[content-length] - :response-time ms'
    : 'dev';

// ---------------------------------------------------------------------------
// Application factory
// ---------------------------------------------------------------------------

/**
 * Creates and configures the Express application instance.
 * Intentionally does NOT call `app.listen()` â€” that is `server.js`'s concern.
 *
 * @returns {import('express').Application}
 */
export function createApp() {
  const app = express();

  // â”€â”€ 1. Request ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Honour a client-supplied `X-Request-ID` header (e.g., from an upstream
  // proxy or API gateway) or generate a fresh UUID. This ID propagates through
  // all log entries and is echoed back in the response header.
  app.use((req, res, next) => {
    const clientId = req.headers['x-request-id'];
    req.id = (typeof clientId === 'string' && clientId.length <= 128)
      ? clientId
      : uuidv4();
    res.setHeader('X-Request-ID', req.id);
    next();
  });

  // â”€â”€ 2. Helmet â€” HTTP security headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc:  ["'self'"],
          objectSrc:  ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginEmbedderPolicy: true,
      hsts: {
        maxAge:            31536000, // 1 year
        includeSubDomains: true,
        preload:           true,
      },
    }),
  );

  // â”€â”€ 3. CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.use(cors(corsOptions));

  // â”€â”€ 4. Body parsers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.use(
    express.json({
      limit:  '1mb',     // reject payloads over 1 MB to prevent DoS
      strict: true,      // only accept arrays and objects at the top level
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  // â”€â”€ 5. Access logger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.use(morgan(morganFormat, { stream: morganStream }));

  // â”€â”€ 6. Health check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Must be registered BEFORE authentication middleware so that load balancers
  // and Kubernetes liveness probes can reach it without a token.
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status:    'ok',
      service:   process.env.SERVICE_NAME ?? 'nebula-api',
      timestamp: new Date().toISOString(),
      uptime:    Math.floor(process.uptime()),
    });
  });

  // Ready probe â€” returns 503 while the service is still initialising.
  app.get('/ready', (req, res) => {
    // The server.js bootstrap sets this flag once `connectDB()` resolves.
    if (app.locals.isReady) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }
  });

  // â”€â”€ 6.5. API Documentation (Swagger) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setupSwagger(app);

  // â”€â”€ 7. API routes (v1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Each resource router is self-contained: it imports its own authentication,
  // validation, and controller middleware. Mount only the path prefix here.

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/projects', projectRoutes);
  app.use('/api/v1/queues', queueRoutes);
  app.use('/api/v1/jobs', jobRoutes);
  app.use('/api/v1/workers', workerRoutes);
  app.use('/api/v1/dlq', dlqRoutes);

  // Metrics resource â€” GET /health
  app.use('/api/v1/metrics', metricsRoutes);

  // â”€â”€ 8. 404 handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.use((req, res) => {
    logger.warn('Route not found', { requestId: req.id, method: req.method, path: req.path });
    res.status(404).json({
      status:  'error',
      code:    'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
    });
  });

  // â”€â”€ 9. Global error boundary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Express identifies error-handling middleware by its 4-argument signature.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const statusCode = err.status ?? err.statusCode ?? 500;

    // Log at WARN for client errors (4xx), ERROR for server errors (5xx).
    const logFn = statusCode < 500 ? logger.warn.bind(logger) : logger.error.bind(logger);

    logFn('Request error', {
      requestId:  req.id,
      method:     req.method,
      path:       req.path,
      statusCode,
      error:      err,
    });

    // Never expose internal stack traces or Sequelize error details to clients.
    const isProduction = process.env.NODE_ENV === 'production';

    res.status(statusCode).json({
      status:    'error',
      code:      err.code  ?? (statusCode < 500 ? 'CLIENT_ERROR' : 'INTERNAL_SERVER_ERROR'),
      message:   statusCode < 500
        ? err.message
        : 'An unexpected error occurred. Please try again later.',
      // Include developer details only in non-production environments.
      ...((!isProduction && statusCode >= 500) && {
        detail: err.message,
        stack:  err.stack,
      }),
    });
  });

  return app;
}


