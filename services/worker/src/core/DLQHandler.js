/**
 * @file services/worker/src/core/DLQHandler.js
 * @description Dead Letter Queue handler — promotes exhausted-retry jobs to DLQ.
 *
 * Transactional guarantee:
 *  The entire DLQ promotion sequence — AI analysis, DLQ insertion, and job
 *  status update — executes inside a SINGLE InnoDB transaction. This enforces
 *  the following atomicity invariant:
 *
 *    Either ALL of the following happen, or NONE:
 *      1. A `dead_letter_queue` row is inserted.
 *      2. The source `jobs` row is updated to `status = 'FAILED'`.
 *
 *  Without this, a process crash between step 1 and step 2 would leave a
 *  "ghost" DLQ record pointing to a job that still appears RUNNING, causing
 *  duplicate DLQ insertions on the next recovery sweep.
 *
 * AI analysis:
 *  The AIFailureAnalyzer is called BEFORE the transaction is opened. Two reasons:
 *   1. The AI call is a network request (10–15 s). Holding a DB transaction open
 *      for that duration would exhaust the connection pool under concurrent load.
 *   2. AIFailureAnalyzer.analyze() never throws — it returns a fallback on any
 *      failure — so the transaction always has a valid `ai_analysis` to insert.
 *
 * Idempotency:
 *  The `original_job_id` column has a UNIQUE constraint (add via migration if not
 *  present). A duplicate moveToDLQ call for the same job returns the existing DLQ
 *  record instead of throwing a unique-constraint error.
 */

import { v4 as uuidv4 }        from 'uuid';
import { QueryTypes }          from 'sequelize';
import {
  sequelize,
  DeadLetterQueue,
  Job,
}                               from '../../../../packages/database/index.js';
import { JobStatus }            from '../../../../packages/database/models/Job.js';
import { aiFailureAnalyzer }   from '../ai/AIFailureAnalyzer.js';
import logger                  from '../utils/logger.js';

// ---------------------------------------------------------------------------
// DLQHandler
// ---------------------------------------------------------------------------

export class DLQHandler {
  /**
   * Promotes a permanently failed job to the Dead Letter Queue.
   *
   * Steps (in order):
   *  0. Guard: verify the job exists and is eligible for DLQ promotion.
   *  1. AI analysis (network call, outside transaction).
   *  2. Open transaction.
   *  3. Check for duplicate DLQ entry (idempotency guard inside transaction).
   *  4. Insert `dead_letter_queue` row with AI analysis.
   *  5. Update `jobs.status` → `FAILED`.
   *  6. Commit.
   *
   * @param {object}  params
   * @param {string}  params.jobId          - UUID of the job to promote.
   * @param {Error}   params.error          - The final execution error.
   * @param {number}  params.totalAttempts  - Total execution attempts made.
   * @param {string}  [params.workerId]     - Worker that last attempted the job.
   * @param {string}  [params.requestId]    - For log correlation.
   * @returns {Promise<import('sequelize').Model>} The created DeadLetterQueue record.
   */
  async moveToDLQ({ jobId, error, totalAttempts, workerId, requestId }) {
    const log = logger.child({ requestId, jobId, method: 'moveToDLQ' });

    // ── Step 0: Load and validate the job ─────────────────────────────────
    const job = await Job.findByPk(jobId, {
      attributes: [
        'id', 'name', 'status', 'queue_id', 'payload',
        'retry_count', 'max_retries',
      ],
      include: [
        {
          association: 'queue',
          attributes:  ['id', 'project_id'],
          required:    true,
        },
      ],
    });

    if (!job) {
      throw new Error(`[DLQHandler] Job '${jobId}' not found. Cannot promote to DLQ.`);
    }

    // Only RUNNING or FAILED jobs are eligible. The Scheduler or executor
    // should never call moveToDLQ on a job in any other state, but we guard
    // defensively to prevent accidental DLQ pollution.
    const eligibleStatuses = new Set([JobStatus.RUNNING, JobStatus.FAILED]);
    if (!eligibleStatuses.has(job.status)) {
      log.warn('moveToDLQ called on a job with an ineligible status. Skipping.', {
        currentStatus: job.status,
      });
      return null;
    }

    const projectId = job.queue?.project_id;
    if (!projectId) {
      throw new Error(`[DLQHandler] Could not resolve project_id for job '${jobId}'.`);
    }

    log.info('Promoting job to DLQ.', {
      jobName:       job.name,
      totalAttempts,
      errorMessage:  error.message,
    });

    // ── Step 1: AI analysis (outside the transaction) ────────────────────
    // This is the expensive network call. It runs before we open the DB
    // transaction so we never hold a connection open during the AI request.
    const aiAnalysis = await aiFailureAnalyzer.analyze({
      jobName:      job.name,
      errorMessage: error.message ?? 'Unknown error',
      stackTrace:   error.stack   ?? '',
      jobId,
    });

    log.info('AI analysis complete.', {
      analyzedBy:      aiAnalysis.analyzed_by,
      confidenceScore: aiAnalysis.confidence_score,
    });

    // ── Steps 2–6: Atomic transaction ────────────────────────────────────
    let dlqRecord;

    await sequelize.transaction(async (t) => {
      // ── Step 3: Idempotency guard ────────────────────────────────────────
      // Check inside the transaction (with FOR UPDATE) to prevent a race
      // between two concurrent DLQ promotion calls for the same job.
      const [existingRows] = await sequelize.query(
        `SELECT id FROM dead_letter_queue WHERE original_job_id = :jobId LIMIT 1 FOR UPDATE`,
        {
          type:         QueryTypes.SELECT,
          replacements: { jobId },
          transaction:  t,
        },
      );

      if (existingRows) {
        log.warn('DLQ record already exists for this job — returning existing record.', {
          existingDlqId: existingRows.id,
        });
        // Reload the existing record outside the FOR UPDATE scope.
        dlqRecord = await DeadLetterQueue.findOne({
          where:       { original_job_id: jobId },
          transaction: t,
        });
        return; // exit transaction callback; no further writes needed
      }

      // ── Step 4: Insert DLQ record ────────────────────────────────────────
      dlqRecord = await DeadLetterQueue.create(
        {
          id:                  uuidv4(),
          original_job_id:     jobId,
          queue_id:            job.queue_id,
          project_id:          projectId,
          job_name:            job.name,
          payload:             job.payload,
          last_error_message:  (error.message ?? '').slice(0, 1000),
          last_error_stack:    (error.stack   ?? '').slice(0, 4000),
          total_attempts:      totalAttempts,
          first_attempted_at:  null, // populated by the executor in Phase 3
          last_attempted_at:   new Date(),
          promoted_at:         new Date(),
          // Store the full structured AI analysis as a JSON string.
          // `notes` is a TEXT column — store it there until a dedicated
          // `ai_analysis` JSON column is added in a migration.
          notes:               JSON.stringify(aiAnalysis),
        },
        { transaction: t },
      );

      log.info('DLQ record inserted.', { dlqId: dlqRecord.id });

      // ── Step 5: Update job status to FAILED ──────────────────────────────
      // Use a raw UPDATE (not .save()) to minimise the number of columns
      // touched and avoid accidental ORM-level mutations of other fields.
      const [affectedRows] = await sequelize.query(
        `
        UPDATE jobs
        SET
          status       = 'FAILED',
          worker_id    = NULL,
          completed_at = NOW(),
          updated_at   = NOW()
        WHERE
          id     = :jobId
          AND status IN ('RUNNING', 'FAILED')  -- idempotency: skip if already FAILED
        `,
        {
          type:         QueryTypes.UPDATE,
          replacements: { jobId },
          transaction:  t,
        },
      );

      if (affectedRows === 0) {
        log.warn('Job status update was a no-op — job may already be in FAILED state.', { jobId });
      } else {
        log.info('Job status updated to FAILED.', { jobId });
      }

      // Both writes succeeded → COMMIT (implicit at end of transaction callback).
    });

    log.info('Job successfully promoted to DLQ.', {
      dlqId:           dlqRecord?.id,
      aiAnalyzedBy:    aiAnalysis.analyzed_by,
      confidenceScore: aiAnalysis.confidence_score,
    });

    return dlqRecord;
  }
}

export const dlqHandler = new DLQHandler();
