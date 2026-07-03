/**
 * @file services/worker/src/core/Worker.js
 * @description WorkerService â€” lifecycle orchestrator for a single worker pod.
 *
 * Responsibilities:
 *  1. Self-registration:   Inserts a row into `workers` on startup with the pod's
 *                          hostname, IP, and version, acquiring a persistent worker ID.
 *  2. Heartbeat loop:      Periodically updates `last_heartbeat_at` and current memory
 *                          usage so the Scheduler can detect stale/dead pods.
 *  3. Poll loop:           Continuously calls JobExecutor.claimAndExecute(). Applies
 *                          randomised exponential backoff when the queue is empty to
 *                          prevent database thrashing under low load.
 *  4. Graceful shutdown:   Catches SIGTERM / SIGINT, drains the current execution,
 *                          clears timers, marks the worker OFFLINE, and exits cleanly.
 *
 * Concurrency model:
 *  The poll loop is intentionally single-threaded per WorkerService instance.
 *  Horizontal scale is achieved by deploying multiple pods; each pod runs one
 *  WorkerService. The atomic claim in JobExecutor guarantees no two pods execute
 *  the same job.
 */

import os              from 'node:os';
import { Worker as WorkerModel } from '../../../../packages/database/index.js';
import { JobExecutor } from '../executor/JobExecutor.js';
import logger          from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Worker status values â€” kept in sync with the DDL ENUM. */
export const WorkerStatus = Object.freeze({
  IDLE:      'IDLE',
  BUSY:      'BUSY',
  DRAINING:  'DRAINING',
  OFFLINE:   'OFFLINE',
});

const HEARTBEAT_INTERVAL_MS  = parseInt(process.env.HEARTBEAT_INTERVAL_MS  ?? '15000', 10); // 15 s
const POLL_INTERVAL_MS       = parseInt(process.env.POLL_INTERVAL_MS       ?? '500',   10); // base delay
const BACKOFF_MAX_MS         = parseInt(process.env.BACKOFF_MAX_MS         ?? '30000', 10); // 30 s cap
const BACKOFF_JITTER_FACTOR  = 0.2; // Â±20% jitter applied to every backoff window
const WORKER_VERSION         = process.env.npm_package_version              ?? '0.0.0';
const SERVICE_NAME           = process.env.SERVICE_NAME                     ?? 'nebula-worker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the primary non-loopback IPv4 address of the current host.
 * Falls back to '127.0.0.1' if no external interface is found.
 * @returns {string}
 */
function resolveLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Computes a backoff delay with Â±jitter to prevent thundering-herd
 * from multiple pods waking up simultaneously after an empty-queue period.
 *
 * Formula: min(base * 2^emptyCount, cap) Ã— (1 Â± jitter)
 *
 * @param {number} emptyStreak - Consecutive poll cycles that returned no job.
 * @returns {number} Delay in milliseconds.
 */
function computeBackoff(emptyStreak) {
  const exponential = POLL_INTERVAL_MS * Math.pow(2, Math.min(emptyStreak, 6)); // cap exponent at 2^6 = 64
  const capped      = Math.min(exponential, BACKOFF_MAX_MS);
  const jitter      = capped * BACKOFF_JITTER_FACTOR * (Math.random() * 2 - 1); // [-jitter, +jitter]
  return Math.max(POLL_INTERVAL_MS, Math.round(capped + jitter));
}

/** Awaitable sleep. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// WorkerService
// ---------------------------------------------------------------------------

export class WorkerService {
  /** @type {string | null} Assigned after registration. */
  #workerId = null;

  /** @type {import('sequelize').Model | null} */
  #workerRecord = null;

  /** @type {NodeJS.Timeout | null} */
  #heartbeatTimer = null;

  /** @type {boolean} Set to true when a shutdown signal is received. */
  #shuttingDown = false;

  /** @type {boolean} True when the poll loop is in the middle of an execution. */
  #executing = false;

  /** @type {JobExecutor} */
  #executor;

  /**
   * @param {object}  opts
   * @param {string[]} opts.queueSlugs - Queue slugs this worker subscribes to.
   */
  constructor({ queueSlugs }) {
    if (!Array.isArray(queueSlugs) || queueSlugs.length === 0) {
      throw new Error('[WorkerService] queueSlugs must be a non-empty array.');
    }
    this.queueSlugs = queueSlugs;
  }

  // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Starts the worker: registers in DB, starts heartbeat, begins the poll loop.
   * @returns {Promise<void>}
   */
  async start() {
    await this.#register();
    this.#startHeartbeat();
    this.#registerSignalHandlers();

    logger.info('WorkerService started. Entering poll loop.', {
      workerId: this.#workerId,
      queues:   this.queueSlugs,
    });

    await this.#pollLoop();
  }

  // â”€â”€ Private: Registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Inserts or upserts a worker row in MySQL. Uses the hostname + pid as a
   * deterministic identity so restarts of the same pod don't orphan old rows.
   */
  async #register() {
    const hostname  = os.hostname();
    const ipAddress = resolveLocalIp();

    logger.info('Registering worker...', { hostname, ipAddress, version: WORKER_VERSION });

    // Upsert by (hostname) â€” safe for pod restarts within the same node.
    // A full replacement strategy (delete + insert) would lose historical FK references.
    const [record] = await WorkerModel.upsert(
      {
        hostname,
        ip_address:    ipAddress,
        version:       WORKER_VERSION,
        status:        WorkerStatus.IDLE,
        last_heartbeat_at: new Date(),
        queues: this.queueSlugs,
      },
      {
        // Return the created/updated instance.
        returning: true,
        // Conflict resolution: update these fields on duplicate hostname.
        conflictFields: ['hostname'],
        updateOnDuplicate: ['ip_address', 'version', 'status', 'last_heartbeat_at'],
      },
    );

    this.#workerRecord = record?.id ? record : await WorkerModel.findOne({ where: { hostname } });
    this.#workerId     = this.#workerRecord.id;
    this.#executor     = new JobExecutor({ workerId: this.#workerId, queueSlugs: this.queueSlugs });

    logger.info('Worker registered.', {
      workerId:  this.#workerId,
      hostname,
    });
  }

  // â”€â”€ Private: Heartbeat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Starts a recurring timer that keeps `last_heartbeat_at` fresh in the DB. */
  #startHeartbeat() {
    this.#heartbeatTimer = setInterval(async () => {
      try {
        await this.#sendHeartbeat();
      } catch (err) {
        // Log but do not crash. A single missed heartbeat is tolerated.
        // The Scheduler considers a worker dead only after >60 s of silence.
        logger.warn('Heartbeat update failed.', { workerId: this.#workerId, error: err });
      }
    }, HEARTBEAT_INTERVAL_MS);

    // unref() prevents the timer from keeping the Node.js event loop alive
    // during graceful shutdown once all other async work has completed.
    this.#heartbeatTimer.unref();
  }

  /**
   * Writes the current heartbeat and memory snapshot to the `workers` table.
   * @private
   */
  async #sendHeartbeat() {
    const memUsageMb = Math.round(process.memoryUsage().rss / 1024 / 1024);

    await WorkerModel.update(
      {
        last_heartbeat_at: new Date(),
        // Store current memory usage for ops dashboards.
        // Requires a `current_memory_mb` INT column on the workers table (add in migration).
        current_memory_mb: memUsageMb,
        status: this.#executing ? WorkerStatus.BUSY : WorkerStatus.IDLE,
      },
      { where: { id: this.#workerId } },
    );

    logger.debug('Heartbeat sent.', { workerId: this.#workerId, memUsageMb });
  }

  // â”€â”€ Private: Poll Loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Continuously attempts to claim and execute jobs.
   *
   * Empty-queue behaviour: applies exponential backoff (capped, with jitter)
   * to avoid hammering MySQL when there is no work to do.
   *
   * The loop exits only when `this.#shuttingDown` is true AND the current
   * execution (if any) has completed.
   */
  async #pollLoop() {
    let emptyStreak = 0;

    while (!this.#shuttingDown) {
      try {
        this.#executing = true;
        const claimed = await this.#executor.claimAndExecute();

        if (claimed) {
          emptyStreak = 0; // reset backoff â€” queue has work
        } else {
          emptyStreak++;
          const backoffMs = computeBackoff(emptyStreak);
          logger.debug('No job found. Backing off.', {
            workerId:    this.#workerId,
            emptyStreak,
            backoffMs,
          });
          this.#executing = false;
          await sleep(backoffMs);
        }
      } catch (err) {
        // An unexpected error escaped the executor. Log and continue; do not
        // crash the entire worker pod for a single failed claim attempt.
        logger.error('Unexpected error in poll loop.', { workerId: this.#workerId, error: err });
        this.#executing = false;
        await sleep(computeBackoff(emptyStreak));
      } finally {
        this.#executing = false;
      }
    }

    logger.info('Poll loop exited cleanly.', { workerId: this.#workerId });
  }

  // â”€â”€ Private: Shutdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Registers OS signal handlers for clean pod termination. */
  #registerSignalHandlers() {
    const handler = (signal) => {
      logger.info(`Received ${signal}. Initiating graceful shutdown...`, {
        workerId: this.#workerId,
      });
      this.#shutdown(signal);
    };

    process.once('SIGTERM', () => handler('SIGTERM'));
    process.once('SIGINT',  () => handler('SIGINT'));
  }

  /**
   * Graceful shutdown sequence:
   *  1. Set the shutdown flag â€” the poll loop will exit after the current execution.
   *  2. Clear the heartbeat timer.
   *  3. Wait for the active execution to complete (poll `#executing` with timeout).
   *  4. Mark the worker OFFLINE in the DB.
   *  5. Exit the process.
   *
   * @param {string} signal
   */
  async #shutdown(signal) {
    this.#shuttingDown = true;

    // 1. Stop heartbeats.
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }

    // 2. Wait for the active execution to finish (max 30 s drain window).
    const DRAIN_TIMEOUT_MS = 30_000;
    const drainStart       = Date.now();

    logger.info('Draining active execution...', { workerId: this.#workerId });

    while (this.#executing && Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
      await sleep(200);
    }

    if (this.#executing) {
      logger.warn('Drain timeout reached. Marking worker OFFLINE with an in-flight job.', {
        workerId: this.#workerId,
      });
    } else {
      logger.info('Drain complete. No active execution.', { workerId: this.#workerId });
    }

    // 3. Mark worker OFFLINE so the Scheduler does not try to recover its jobs
    //    (they were either completed or will be recovered by the dead-worker sweep).
    try {
      await WorkerModel.update(
        { status: WorkerStatus.OFFLINE, deregistered_at: new Date() },
        { where: { id: this.#workerId } },
      );
      logger.info('Worker marked OFFLINE.', { workerId: this.#workerId });
    } catch (err) {
      logger.error('Failed to mark worker OFFLINE. DB may already be unreachable.', {
        workerId: this.#workerId,
        error:    err,
      });
    }

    logger.info(`Shutdown complete (${signal}). Exiting.`, { workerId: this.#workerId });
    process.exit(0);
  }
}

