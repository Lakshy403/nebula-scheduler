import { QueryTypes } from 'sequelize';
import { sequelize, Job } from '../../../../packages/database/index.js';
import { JobStatus, RetryStrategy } from '../../../../packages/database/models/Job.js';
import { dlqHandler } from '../core/DLQHandler.js';
import logger from '../utils/logger.js';

const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const EXECUTOR_DEFAULT_TIMEOUT_MS = parseInt(process.env.EXECUTOR_TIMEOUT_MS ?? '30000', 10);

export function computeNextScheduledAt(job) {
  const base = job.retry_backoff_base_ms ?? 1000;
  const attempt = job.retry_count ?? 0;
  let delayMs = base;

  if (job.retry_strategy === RetryStrategy.EXPONENTIAL) delayMs = base * Math.pow(2, attempt);
  if (job.retry_strategy === RetryStrategy.LINEAR) delayMs = base * (attempt + 1);

  return new Date(Date.now() + Math.min(delayMs, MAX_RETRY_DELAY_MS));
}

export class JobExecutor {
  constructor({ workerId, queueSlugs }) {
    if (!workerId) throw new Error('[JobExecutor] workerId is required.');
    if (!Array.isArray(queueSlugs) || !queueSlugs.length) throw new Error('[JobExecutor] queueSlugs must be non-empty.');
    this.workerId = workerId;
    this.queueSlugs = queueSlugs;
  }

  async claimAndExecute() {
    const job = await this.claimNextJob();
    if (!job) return false;
    await this.execute(job);
    return true;
  }

  async claimNextJob() {
    let claimed = null;

    await sequelize.transaction(async (transaction) => {
      const rows = await sequelize.query(
        `SELECT j.id
         FROM jobs j
         INNER JOIN queues q ON j.queue_id = q.id
         WHERE j.status = 'QUEUED'
           AND (j.scheduled_at IS NULL OR j.scheduled_at <= NOW())
           AND q.slug IN (:queueSlugs)
           AND q.is_paused = 0
           AND (
             SELECT COUNT(*) FROM jobs r
             WHERE r.queue_id = q.id AND r.status = 'RUNNING'
           ) < q.concurrency_limit
         ORDER BY j.priority DESC, j.scheduled_at ASC, j.created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        { type: QueryTypes.SELECT, replacements: { queueSlugs: this.queueSlugs }, transaction },
      );

      if (!rows.length) return;
      const jobId = rows[0].id;

      await sequelize.query(
        `UPDATE jobs
         SET status = 'RUNNING', worker_id = :workerId, started_at = NOW(), updated_at = NOW()
         WHERE id = :jobId AND status = 'QUEUED'`,
        { type: QueryTypes.UPDATE, replacements: { jobId, workerId: this.workerId }, transaction },
      );

      const countRows = await sequelize.query(
        'SELECT COUNT(*) AS cnt FROM job_executions WHERE job_id = :jobId',
        { type: QueryTypes.SELECT, replacements: { jobId }, transaction },
      );
      const attemptNumber = (Number(countRows[0]?.cnt) || 0) + 1;

      await sequelize.query(
        `INSERT INTO job_executions
           (id, job_id, worker_id, attempt_number, status, started_at, created_at, updated_at)
         VALUES
           (UUID(), :jobId, :workerId, :attemptNumber, 'RUNNING', NOW(), NOW(), NOW())`,
        { type: QueryTypes.INSERT, replacements: { jobId, workerId: this.workerId, attemptNumber }, transaction },
      );

      claimed = await Job.findByPk(jobId, { transaction });
    });

    if (claimed) logger.info('Job claimed.', { workerId: this.workerId, jobId: claimed.id, jobName: claimed.name });
    return claimed;
  }

  async execute(job) {
    const jobId = job.id;
    const timeoutMs = Math.min((job.timeout_seconds ?? 300) * 1000, EXECUTOR_DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const output = await Promise.race([
        this.#dispatch(job.payload, { signal: controller.signal }),
        new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error(`Job timed out after ${timeoutMs}ms`)))),
      ]);
      clearTimeout(timeoutHandle);
      await this.#markCompleted(jobId, output);
      logger.info('Job completed successfully.', { workerId: this.workerId, jobId });
    } catch (err) {
      clearTimeout(timeoutHandle);
      logger.error('Job execution failed.', { workerId: this.workerId, jobId, error: err });
      await this.#handleFailure(job, err);
    }
  }

  async #dispatch(payload, { signal }) {
    const { type, ...data } = payload ?? {};
    if (type === 'NOOP') return { ok: true };
    if (type === 'HTTP_CALLBACK') return this.#executeHttpCallback(data, { signal });
    throw new Error(`Unknown payload type: '${type}'.`);
  }

  async #executeHttpCallback({ url, method = 'POST', headers = {}, body }, { signal }) {
    if (!url) throw new Error('HTTP_CALLBACK payload must include a url field.');
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Nebula-Scheduler/1.0', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const responseBody = await response.text().catch(() => '');
    if (!response.ok) {
      const err = new Error(`HTTP executor received status ${response.status} from ${url}`);
      err.statusCode = response.status;
      err.responseBody = responseBody.slice(0, 512);
      throw err;
    }
    return { statusCode: response.status, body: responseBody.slice(0, 4096) };
  }

  async #markCompleted(jobId, output) {
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `UPDATE jobs
         SET status = 'SUCCEEDED', completed_at = NOW(), updated_at = NOW()
         WHERE id = :jobId`,
        { type: QueryTypes.UPDATE, replacements: { jobId }, transaction },
      );
      await sequelize.query(
        `UPDATE job_executions
         SET status = 'SUCCEEDED', completed_at = NOW(),
             duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) / 1000,
             output = :output, updated_at = NOW()
         WHERE job_id = :jobId AND status = 'RUNNING'
         ORDER BY started_at DESC
         LIMIT 1`,
        { type: QueryTypes.UPDATE, replacements: { jobId, output: JSON.stringify(output ?? null) }, transaction },
      );
    });
  }

  async #handleFailure(job, err) {
    const jobId = job.id;
    const newRetryCount = (job.retry_count ?? 0) + 1;
    const exhausted = newRetryCount > (job.max_retries ?? 3);

    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `UPDATE job_executions
         SET status = 'FAILED', completed_at = NOW(),
             duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) / 1000,
             error_message = :errorMessage, error_stack = :errorStack, updated_at = NOW()
         WHERE job_id = :jobId AND status = 'RUNNING'
         ORDER BY started_at DESC
         LIMIT 1`,
        {
          type: QueryTypes.UPDATE,
          replacements: {
            jobId,
            errorMessage: (err.message ?? '').slice(0, 1000),
            errorStack: (err.stack ?? '').slice(0, 4000),
          },
          transaction,
        },
      );

      if (exhausted) {
        await sequelize.query(
          `UPDATE jobs
           SET status = 'FAILED', retry_count = :newRetryCount,
               completed_at = NOW(), updated_at = NOW()
           WHERE id = :jobId`,
          { type: QueryTypes.UPDATE, replacements: { jobId, newRetryCount }, transaction },
        );
      } else {
        const nextScheduledAt = computeNextScheduledAt({ ...job.dataValues, retry_count: newRetryCount - 1 });
        await sequelize.query(
          `UPDATE jobs
           SET status = 'SCHEDULED', retry_count = :newRetryCount,
               scheduled_at = :nextScheduledAt, worker_id = NULL,
               started_at = NULL, updated_at = NOW()
           WHERE id = :jobId`,
          {
            type: QueryTypes.UPDATE,
            replacements: {
              jobId,
              newRetryCount,
              nextScheduledAt: nextScheduledAt.toISOString().slice(0, 19).replace('T', ' '),
            },
            transaction,
          },
        );
      }
    });

    if (exhausted) {
      await dlqHandler.moveToDLQ({ jobId, error: err, totalAttempts: newRetryCount, workerId: this.workerId });
    }
  }
}
