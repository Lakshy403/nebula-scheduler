/**
 * @file services/api/server.js
 * @description HTTP server entry point and orchestration.
 *
 * Startup sequence:
 *  1. Create the Express app.
 *  2. Connect to MySQL (with retry budget).
 *  3. Bind the HTTP server to the configured port.
 *  4. Mark the app as ready (unblocks /ready probe).
 *
 * Shutdown sequence (triggered by SIGTERM or SIGINT):
 *  1. Stop accepting new connections (server.close()).
 *  2. Close the Sequelize connection pool (drain in-flight queries).
 *  3. Exit cleanly with code 0.
 *
 * If shutdown does not complete within SHUTDOWN_TIMEOUT_MS, the process
 * is forcibly terminated with exit code 1 to prevent zombie pods.
 *
 * Node.js process-level error handlers ensure that uncaught exceptions
 * and unhandled promise rejections always produce a structured log entry
 * and a clean shutdown rather than a silent crash.
 */

import http            from 'node:http';
import { createApp }   from './app.js';
import { connectDB }   from '../../packages/database/index.js';
import logger          from './utils/logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT                = parseInt(process.env.PORT               ?? '3000', 10);
const HOST                = process.env.HOST                        ?? '0.0.0.0';
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT   ?? '10000', 10); // 10 s
const DB_RETRY_ATTEMPTS   = parseInt(process.env.DB_RETRY_ATTEMPTS  ?? '5',     10);
const DB_RETRY_DELAY_MS   = parseInt(process.env.DB_RETRY_DELAY_MS  ?? '3000',  10); // 3 s

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleeps for the specified number of milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attempts to connect to the database with a fixed retry budget.
 * Exits with code 1 if all attempts are exhausted, so the container
 * orchestrator (Kubernetes) will restart the pod.
 *
 * @returns {Promise<void>}
 */
async function connectWithRetry() {
  for (let attempt = 1; attempt <= DB_RETRY_ATTEMPTS; attempt++) {
    try {
      await connectDB({
        // Never sync schema in production; rely on migration pipeline.
        sync:  process.env.NODE_ENV !== 'production' && process.env.DB_SYNC === 'true',
        force: false,
      });
      return; // success — exit retry loop
    } catch (err) {
      logger.error(`Database connection attempt ${attempt}/${DB_RETRY_ATTEMPTS} failed.`, {
        error:    err,
        retryIn:  attempt < DB_RETRY_ATTEMPTS ? `${DB_RETRY_DELAY_MS}ms` : 'no more retries',
      });

      if (attempt === DB_RETRY_ATTEMPTS) {
        logger.error('All database connection attempts exhausted. Exiting.');
        process.exit(1);
      }

      await sleep(DB_RETRY_DELAY_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

/**
 * Orchestrates a clean shutdown:
 *  - Stops accepting HTTP connections.
 *  - Drains the Sequelize connection pool.
 *  - Exits the process.
 *
 * A hard-kill timer is set so that a stalled DB drain cannot block forever.
 *
 * @param {http.Server} server         - The active HTTP server instance.
 * @param {import('sequelize').Sequelize} sequelize - The Sequelize instance to close.
 * @param {string} signal              - The OS signal that triggered shutdown.
 */
async function gracefulShutdown(server, sequelize, signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Hard-kill timer: if the shutdown hangs for longer than SHUTDOWN_TIMEOUT_MS,
  // exit forcibly to avoid zombie pods that block rolling deployments.
  const hardKillTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.', {
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Ensure the timer does not keep the event loop alive unnecessarily.
  hardKillTimer.unref();

  try {
    // 1. Stop accepting new HTTP connections.
    //    Existing in-flight requests continue to completion.
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    logger.info('HTTP server closed. No new connections will be accepted.');

    // 2. Drain the Sequelize connection pool.
    //    This waits for all active queries to finish before closing sockets.
    await sequelize.close();
    logger.info('Database connection pool closed.');

    clearTimeout(hardKillTimer);
    logger.info('Graceful shutdown complete. Exiting with code 0.');
    process.exit(0);
  } catch (err) {
    logger.error('Error during graceful shutdown.', { error: err });
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Main bootstrap function.
 * Wraps the entire startup sequence in a try/catch so that any synchronous
 * initialisation error is logged before the process exits.
 */
async function bootstrap() {
  logger.info('Nebula API Service starting...', {
    nodeVersion: process.version,
    env:         process.env.NODE_ENV ?? 'development',
    pid:         process.pid,
  });

  // ── 1. Create Express application ────────────────────────────────────────
  const app = createApp();

  // ── 2. Connect to MySQL (with retry) ─────────────────────────────────────
  await connectWithRetry();

  // ── 3. Mark application as ready ─────────────────────────────────────────
  // The /ready probe will now return 200, signalling to the load balancer that
  // this pod can receive traffic.
  app.locals.isReady = true;

  // ── 4. Create and start the HTTP server ───────────────────────────────────
  const server = http.createServer(app);

  // Limit maximum time a keep-alive connection can sit idle.
  // Prevents connection exhaustion from long-lived idle clients.
  server.keepAliveTimeout  = 65_000; // slightly above typical LB idle timeout (60 s)
  server.headersTimeout    = 66_000; // must be > keepAliveTimeout

  // Retrieve the Sequelize instance from the database package for shutdown.
  const { sequelize } = await import('../../packages/database/index.js');

  // Register OS signal handlers BEFORE binding so that a ctrl-C during
  // the DB connection phase is still handled cleanly.
  const shutdownHandler = (signal) => gracefulShutdown(server, sequelize, signal);
  process.once('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.once('SIGINT',  () => shutdownHandler('SIGINT'));

  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, resolve);
    server.once('error', reject);
  });

  logger.info('Nebula API Service is listening.', { host: HOST, port: PORT });
}

// ---------------------------------------------------------------------------
// Process-level error handlers
// ---------------------------------------------------------------------------
// These are last-resort handlers for errors that escape all other error
// boundaries. They ensure a structured log entry is always produced.

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — process will exit.', { error: err });
  // Give the logger transports time to flush before exiting.
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection — process will exit.', {
    error: reason instanceof Error ? reason : new Error(String(reason)),
  });
  setTimeout(() => process.exit(1), 500);
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
bootstrap().catch((err) => {
  // Catches synchronous or early-async errors that occur before the logger
  // is fully configured (e.g., missing required env vars).
  // eslint-disable-next-line no-console
  console.error('[server.js] Fatal error during bootstrap:', err);
  process.exit(1);
});
