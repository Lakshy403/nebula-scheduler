/**
 * @file services/scheduler/src/promoter/PromotionService.js
 * @description Distributed promotion sweep with Redis leader election.
 *
 * The Scheduler is deployed as multiple replicas for HA, but only ONE instance
 * must run the promotion sweep at any given time. Without coordination, two
 * Scheduler pods could concurrently promote the same SCHEDULED job to QUEUED,
 * causing duplicate executions even with worker-side SKIP LOCKED (which only
 * protects the claim step, not the promotion step).
 *
 * Leader Election mechanism: Redis SET NX PX (atomic set-if-not-exists with TTL).
 *   - Only the instance that wins the SET NX acquires the lock.
 *   - TTL (default: 5 s) ensures the lock is released even if the leader crashes
 *     mid-sweep, preventing permanent lock-out of all other replicas.
 *   - The lock is explicitly released after every sweep (DEL with Lua script
 *     to prevent releasing another instance's lock â€” the "fencing token" pattern).
 *
 * Sweep operations (inside the lock):
 *   1. Promotion:          SCHEDULED â†’ QUEUED for jobs whose scheduled_at <= NOW().
 *   2. Dead-Worker Recovery: RUNNING/CLAIMED â†’ QUEUED for jobs held by stale workers.
 *
 * All DB operations use raw Sequelize queries for predictable, auditable SQL.
 */

import { QueryTypes }  from 'sequelize';
import {
  sequelize,
  Job,
  Worker as WorkerModel,
}                      from '../../../../packages/database/index.js';
import logger          from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis key prefix for the promotion sweep lock. */
const LOCK_KEY           = 'nebula:scheduler:promotion:lock';

/** Lock TTL in milliseconds. Must exceed max expected sweep duration. */
const LOCK_TTL_MS        = parseInt(process.env.SCHEDULER_LOCK_TTL_MS    ?? '5000',  10);

/** A worker is considered dead if its heartbeat is older than this threshold. */
const DEAD_WORKER_TTL_S  = parseInt(process.env.DEAD_WORKER_TTL_S        ?? '60',    10);

/**
 * Lua script for safe lock release.
 *
 * Atomically checks that the lock value matches our instance token before
 * deleting it. This prevents a slow leader from deleting a lock that was
 * legitimately acquired by a new leader after the original TTL expired.
 *
 * Returns 1 if the lock was released, 0 if it was not ours to release.
 */
const RELEASE_LOCK_LUA = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

// ---------------------------------------------------------------------------
// PromotionService
// ---------------------------------------------------------------------------

export class PromotionService {
  /**
   * @param {object} opts
   * @param {import('ioredis').Redis} opts.redis     - Connected ioredis client.
   * @param {string}                 opts.instanceId - Unique ID for this Scheduler pod.
   *                                                   Used as the Redis lock value (fencing token).
   */
  constructor({ redis, instanceId }) {
    if (!redis)      throw new Error('[PromotionService] redis client is required.');
    if (!instanceId) throw new Error('[PromotionService] instanceId is required.');

    this.redis      = redis;
    this.instanceId = instanceId;
  }

  // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Attempts to acquire the distributed lock and, if successful, runs the
   * full promotion sweep (promotion + dead-worker recovery).
   *
   * This method is designed to be called in a tight loop from the scheduler
   * entry point. It silently yields (returns without sweeping) if another
   * instance holds the lock.
   *
   * @returns {Promise<{ swept: boolean; promoted: number; recovered: number }>}
   *   `swept`     â€” whether this instance ran the sweep (i.e., won the lock).
   *   `promoted`  â€” number of jobs promoted SCHEDULED â†’ QUEUED.
   *   `recovered` â€” number of jobs reset to QUEUED from dead workers.
   */
  async runSweep() {
    const lockAcquired = await this.#acquireLock();

    if (!lockAcquired) {
      // Another replica holds the lock. This is the normal case in a healthy
      // multi-replica deployment. Log at trace level to avoid log spam.
      logger.debug('Scheduler lock not acquired â€” another instance is the leader.', {
        instanceId: this.instanceId,
        lockKey:    LOCK_KEY,
      });
      return { swept: false, promoted: 0, recovered: 0 };
    }

    let promoted  = 0;
    let recovered = 0;

    try {
      logger.debug('Scheduler lock acquired. Running sweep.', {
        instanceId: this.instanceId,
        lockTtlMs:  LOCK_TTL_MS,
      });

      // Run both sweeps concurrently â€” they operate on disjoint job status sets
      // (SCHEDULED vs. RUNNING/CLAIMED), so there is no row-level conflict.
      [promoted, recovered] = await Promise.all([
        this.#promoteScheduledJobs(),
        this.#recoverDeadWorkerJobs(),
      ]);

      if (promoted > 0 || recovered > 0) {
        logger.info('Sweep completed.', {
          instanceId: this.instanceId,
          promoted,
          recovered,
        });
      }
    } catch (err) {
      logger.error('Sweep encountered an error.', {
        instanceId: this.instanceId,
        error:      err,
      });
      // Do not rethrow â€” the caller's loop must continue.
    } finally {
      // Always release the lock, even if the sweep threw an error.
      // Failing to release forces a full TTL wait before the next leader can emerge.
      await this.#releaseLock();
    }

    return { swept: true, promoted, recovered };
  }

  // â”€â”€ Private: Distributed Lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Attempts to acquire the Redis lock using SET NX PX.
   *
   * SET NX (set-if-not-exists) is atomic in Redis â€” no WATCH/MULTI needed.
   * PX sets the TTL in milliseconds, acting as an automatic release if the
   * leader crashes before calling #releaseLock().
   *
   * @returns {Promise<boolean>} True if the lock was acquired.
   */
  async #acquireLock() {
    try {
      // ioredis returns 'OK' on success, null if the key already exists.
      const result = await this.redis.set(
        LOCK_KEY,
        this.instanceId,    // lock value = our unique identity (fencing token)
        'NX',               // only set if key does not exist
        'PX',               // expiry unit = milliseconds
        LOCK_TTL_MS,
      );
      return result === 'OK';
    } catch (err) {
      // Redis connectivity issue. Log and treat as "lock not acquired" so the
      // caller can retry on the next sweep cycle rather than crashing.
      logger.error('Redis error during lock acquisition.', {
        instanceId: this.instanceId,
        error:      err,
      });
      return false;
    }
  }

  /**
   * Releases the Redis lock using a Lua script to prevent releasing
   * another instance's lock (safe even if our TTL has already expired).
   *
   * @returns {Promise<void>}
   */
  async #releaseLock() {
    try {
      const released = await this.redis.eval(
        RELEASE_LOCK_LUA,
        1,                  // KEYS count
        LOCK_KEY,           // KEYS[1]
        this.instanceId,    // ARGV[1] â€” fencing token
      );

      if (released === 0) {
        // Our lock TTL expired and another instance already claimed the key.
        // This is a warning â€” it means the sweep took longer than LOCK_TTL_MS.
        logger.warn('Scheduler lock was not ours to release â€” TTL may have expired.', {
          instanceId:   this.instanceId,
          lockTtlMs:    LOCK_TTL_MS,
        });
      }
    } catch (err) {
      logger.error('Redis error during lock release.', { instanceId: this.instanceId, error: err });
    }
  }

  // â”€â”€ Private: Sweep Operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Sweep 1 â€” Job Promotion.
   *
   * Transitions all SCHEDULED jobs whose `scheduled_at` has elapsed to QUEUED so
   * that worker pods can claim them in the next poll cycle.
   *
   * Uses a raw UPDATE query (not findAll + save) for a single round-trip,
   * which is critical for throughput when large batches become due at once
   * (e.g., midnight cron bursts).
   *
   * @returns {Promise<number>} Number of rows updated.
   */
  async #promoteScheduledJobs() {
    try {
      const [affectedRows] = await sequelize.query(
        `
        UPDATE jobs
        SET
          status     = 'QUEUED',
          updated_at = NOW()
        WHERE
          status     = 'SCHEDULED'
          AND scheduled_at <= NOW()
        LIMIT 500
        `,
        // Process at most 500 rows per sweep cycle to bound lock-hold duration.
        // High-volume batches will be fully promoted across successive sweep cycles.
        { type: QueryTypes.UPDATE },
      );

      if (affectedRows > 0) {
        logger.info('Promoted SCHEDULED â†’ QUEUED.', {
          instanceId: this.instanceId,
          count:      affectedRows,
        });

        // If we hit the LIMIT, there may be more rows due â€” log a warning
        // so the ops team can tune LOCK_TTL_MS or the sweep frequency.
        if (affectedRows === 500) {
          logger.warn('Promotion batch limit reached. Some jobs deferred to next cycle.', {
            instanceId: this.instanceId,
            batchLimit: 500,
          });
        }
      }

      return affectedRows ?? 0;
    } catch (err) {
      logger.error('Job promotion sweep failed.', { instanceId: this.instanceId, error: err });
      return 0;
    }
  }

  /**
   * Sweep 2 â€” Dead Worker Recovery.
   *
   * Identifies workers whose `last_heartbeat_at` is older than DEAD_WORKER_TTL_S
   * and resets any RUNNING or CLAIMED jobs they held back to QUEUED so they can
   * be re-claimed by a healthy worker.
   *
   * Execution order:
   *  a. Find dead worker IDs (subquery).
   *  b. Reset their jobs to QUEUED.
   *  c. Mark the dead workers OFFLINE.
   *
   * Steps (b) and (c) are not in a single transaction intentionally: if (b)
   * succeeds but (c) fails, the next sweep cycle will re-detect the same workers
   * (their jobs are already QUEUED and will be ignored by the WHERE clause), so
   * idempotency is preserved.
   *
   * @returns {Promise<number>} Number of jobs recovered.
   */
  async #recoverDeadWorkerJobs() {
    try {
      // Step a + b: Reset jobs held by stale workers in one query to minimise
      // the window between detection and recovery.
      const [affectedJobs] = await sequelize.query(
        `
        UPDATE jobs j
        INNER JOIN workers w ON j.worker_id = w.id
        SET
          j.status     = 'QUEUED',
          j.worker_id  = NULL,
          j.started_at = NULL,
          j.updated_at = NOW()
        WHERE
          j.status IN ('RUNNING', 'CLAIMED')
          AND w.status != 'OFFLINE'
          AND w.last_heartbeat_at < DATE_SUB(NOW(), INTERVAL :deadWorkerTtl SECOND)
        `,
        {
          type:        QueryTypes.UPDATE,
          replacements: { deadWorkerTtl: DEAD_WORKER_TTL_S },
        },
      );

      if (affectedJobs > 0) {
        logger.warn('Recovered jobs from dead workers.', {
          instanceId: this.instanceId,
          count:      affectedJobs,
        });
      }

      // Step c: Mark dead workers OFFLINE so future queries skip them.
      // This is best-effort â€” a failure here is non-critical due to idempotency.
      const [affectedWorkers] = await sequelize.query(
        `
        UPDATE workers
        SET
          status     = 'OFFLINE',
          updated_at = NOW()
        WHERE
          status != 'OFFLINE'
          AND last_heartbeat_at < DATE_SUB(NOW(), INTERVAL :deadWorkerTtl SECOND)
        `,
        {
          type:         QueryTypes.UPDATE,
          replacements: { deadWorkerTtl: DEAD_WORKER_TTL_S },
        },
      );

      if (affectedWorkers > 0) {
        logger.warn('Marked stale workers as OFFLINE.', {
          instanceId:     this.instanceId,
          workersOfflined: affectedWorkers,
        });
      }

      return affectedJobs ?? 0;
    } catch (err) {
      logger.error('Dead worker recovery sweep failed.', { instanceId: this.instanceId, error: err });
      return 0;
    }
  }
}

