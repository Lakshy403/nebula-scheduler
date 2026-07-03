/**
 * @file services/scheduler/src/index.js
 * @description Scheduler service entry point.
 *
 * Architecture:
 *  This process runs a tight, continuous sweep loop. It does NOT expose an
 *  HTTP server â€” it is a pure background worker process that:
 *
 *   1. Initialises the MySQL connection pool (shared with the API service
 *      but via a separate pool instance scoped to this process).
 *   2. Initialises the Redis client for distributed lock operations.
 *   3. Runs an infinite while-loop that calls PromotionService.runSweep()
 *      on every tick. A configurable inter-sweep delay prevents the process
 *      from spinning at 100% CPU when there is nothing to promote.
 *
 * Multi-replica safety:
 *  Multiple Scheduler pods can run simultaneously for HA. Only the one that
 *  wins the Redis leader-election lock (SET NX PX) executes the sweep.
 *  The others skip and retry on the next tick. If the leader pod crashes,
 *  the lock TTL expires and a follower promotes itself to leader.
 *
 * Graceful shutdown:
 *  SIGTERM / SIGINT set the `running` flag to false, which causes the while
 *  loop to exit after the current sweep completes. The Redis and MySQL
 *  connections are then closed before the process exits with code 0.
 */

import { v4 as uuidv4 } from 'uuid';
import Redis            from 'ioredis';
import { connectDB, sequelize } from '../../../packages/database/index.js';
import { PromotionService }    from './promoter/PromotionService.js';
import logger                  from './utils/logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Delay between the end of one sweep and the start of the next (ms).
 * Lower values increase promotion freshness at the cost of more DB load.
 * Default: 1 000 ms (1 s). Tune via SCHEDULER_SWEEP_INTERVAL_MS env var.
 */
const SWEEP_INTERVAL_MS = parseInt(process.env.SCHEDULER_SWEEP_INTERVAL_MS ?? '1000', 10);

/**
 * If a sweep returns no work (promoted=0, recovered=0), apply a longer
 * idle delay to reduce DB load during quiet periods.
 * Default: 5 000 ms (5 s).
 */
const IDLE_DELAY_MS = parseInt(process.env.SCHEDULER_IDLE_DELAY_MS ?? '5000', 10);

/**
 * Maximum consecutive sweep errors before the process self-terminates.
 * A Kubernetes restart policy will bring it back up cleanly.
 * Default: 10.
 */
const MAX_CONSECUTIVE_ERRORS = parseInt(process.env.SCHEDULER_MAX_ERRORS ?? '10', 10);

// Unique identity for this pod. Used as the Redis lock value (fencing token)
// so we can safely release only our own lock.
const INSTANCE_ID = process.env.INSTANCE_ID ?? `scheduler-${uuidv4()}`;

/** Awaitable sleep helper. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap() {
  logger.info('Nebula Scheduler starting...', {
    instanceId:  INSTANCE_ID,
    nodeVersion: process.version,
    env:         process.env.NODE_ENV ?? 'development',
    pid:         process.pid,
    sweepIntervalMs: SWEEP_INTERVAL_MS,
    idleDelayMs:     IDLE_DELAY_MS,
  });

  // â”€â”€ 1. MySQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await connectDB({ sync: process.env.DB_SYNC === 'true' });
  logger.info('MySQL connection pool ready.', { instanceId: INSTANCE_ID });

  // â”€â”€ 2. Redis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const redis = new Redis({
    host:              process.env.REDIS_HOST     ?? 'localhost',
    port:              parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password:          process.env.REDIS_PASSWORD ?? undefined,
    db:                parseInt(process.env.REDIS_DB   ?? '0',    10),
    tls:               process.env.REDIS_TLS === 'true' ? {} : undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck:  true,
    lazyConnect:       false,
    // Emit structured log on Redis reconnect events for ops visibility.
    retryStrategy(times) {
      const delay = Math.min(times * 500, 5000); // cap at 5 s
      logger.warn('Redis reconnecting...', { instanceId: INSTANCE_ID, attempt: times, delayMs: delay });
      return delay;
    },
  });

  // Fail fast if Redis is unreachable at startup â€” the scheduler cannot
  // provide leader-election safety without it.
  await redis.ping().catch((err) => {
    logger.error('Redis PING failed at startup. Exiting.', { instanceId: INSTANCE_ID, error: err });
    process.exit(1);
  });
  logger.info('Redis connection ready.', { instanceId: INSTANCE_ID });

  // â”€â”€ 3. Promotion service â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const promoter = new PromotionService({ redis, instanceId: INSTANCE_ID });

  // â”€â”€ 4. Signal handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let running          = true;
  let consecutiveErrors = 0;

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Scheduler shutting down...`, { instanceId: INSTANCE_ID });
    running = false;
    // Give the current sweep up to 5 s to complete before force-closing connections.
    await sleep(Math.min(SWEEP_INTERVAL_MS + 1000, 5000));
    await redis.quit();
    await sequelize.close();
    logger.info('Scheduler shutdown complete.', { instanceId: INSTANCE_ID });
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  // â”€â”€ 5. Sweep loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  logger.info('Entering sweep loop.', { instanceId: INSTANCE_ID });

  while (running) {
    const sweepStart = Date.now();
    let result       = { swept: false, promoted: 0, recovered: 0 };

    try {
      result = await promoter.runSweep();
      consecutiveErrors = 0; // reset error counter on any successful call
    } catch (err) {
      // runSweep() is designed to not throw â€” but this catch guards against
      // any unforeseen runtime error escaping the promoter.
      consecutiveErrors++;

      logger.error('Sweep loop encountered an unexpected error.', {
        instanceId:       INSTANCE_ID,
        consecutiveErrors,
        maxAllowed:       MAX_CONSECUTIVE_ERRORS,
        error:            err,
      });

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        logger.error(
          `Consecutive error threshold (${MAX_CONSECUTIVE_ERRORS}) reached. Self-terminating.`,
          { instanceId: INSTANCE_ID },
        );
        // Allow the process manager / Kubernetes to restart the pod cleanly.
        process.exit(1);
      }
    }

    // Adaptive delay: sleep longer when there is nothing to do.
    const sweepDurationMs = Date.now() - sweepStart;
    const wasIdle         = result.swept && result.promoted === 0 && result.recovered === 0;
    const baseDelay       = wasIdle ? IDLE_DELAY_MS : SWEEP_INTERVAL_MS;

    // Subtract the sweep's own duration so we maintain a consistent cadence
    // even when sweeps take varying amounts of time.
    const remainingDelayMs = Math.max(0, baseDelay - sweepDurationMs);

    logger.debug('Sweep cycle complete.', {
      instanceId:   INSTANCE_ID,
      swept:        result.swept,
      promoted:     result.promoted,
      recovered:    result.recovered,
      durationMs:   sweepDurationMs,
      nextDelayMs:  remainingDelayMs,
    });

    if (remainingDelayMs > 0) {
      await sleep(remainingDelayMs);
    }
  }

  logger.info('Sweep loop exited.', { instanceId: INSTANCE_ID });
}

// ---------------------------------------------------------------------------
// Process-level safety net
// ---------------------------------------------------------------------------

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception in Scheduler â€” exiting.', { error: err });
  setTimeout(() => process.exit(1), 500);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in Scheduler â€” exiting.', {
    error: reason instanceof Error ? reason : new Error(String(reason)),
  });
  setTimeout(() => process.exit(1), 500);
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[scheduler/index.js] Fatal bootstrap error:', err);
  process.exit(1);
});

