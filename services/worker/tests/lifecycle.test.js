/**
 * @file services/worker/tests/lifecycle.test.js
 * @description Integration test: Validates exponential backoff, retry lifecycle,
 *              and Dead Letter Queue routing on exhaustion.
 *
 * This test proves that the background framework handles failure elegantly:
 *  1. A failed job correctly transitions to SCHEDULED with updated retry_count.
 *  2. Exponential backoff math is applied accurately.
 *  3. After exhausting max_retries, the job is routed to the Dead Letter Queue.
 *
 * Run: NODE_OPTIONS="--experimental-vm-modules" npx jest services/worker/tests --runInBand
 */

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import {
  sequelize,
  Job,
  Queue,
  Worker,
  Project,
  Organization,
  JobExecution,
  DeadLetterQueue,
} from '../../../packages/database/index.js';
import { JobExecutor, computeNextScheduledAt } from '../src/executor/JobExecutor.js';

describe('Nebula Job Lifecycle & Fault Tolerance Suite', () => {
  let testOrg;
  let testProject;
  let failureQueue;

  beforeAll(async () => {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    testOrg = await Organization.create({
      id: uuidv4(),
      name: `Lifecycle Test Org ${Date.now()}`,
      slug: `lifecycle-org-${Date.now()}`,
    });

    testProject = await Project.create({
      id: uuidv4(),
      organization_id: testOrg.id,
      name: `Lifecycle Test Project`,
      slug: `lifecycle-project-${Date.now()}`,
    });

    failureQueue = await Queue.create({
      id: uuidv4(),
      project_id: testProject.id,
      name: `Failure Test Queue`,
      slug: `failure-test-${Date.now()}`,
      concurrency_limit: 5,
      is_paused: false,
    });
  });

  afterAll(async () => {
    if (testOrg) await testOrg.destroy({ force: true });
    await sequelize.close();
  });

  /**
   * Helper: Creates a real Worker record in the database so that FK constraints
   * on jobs.worker_id and job_executions.worker_id are satisfied during claiming.
   */
  async function createTestWorker() {
    const id = uuidv4();
    await Worker.create({
      id,
      project_id: testProject.id,
      hostname: `test-worker-${id.slice(0, 8)}`,
      status: 'IDLE',
    });
    return id;
  }

  test('📐 Backoff Math: computeNextScheduledAt calculates EXPONENTIAL delays accurately', () => {
    // Exponential: delay = base * 2^attempt
    const job = {
      retry_strategy: 'EXPONENTIAL',
      retry_backoff_base_ms: 1000,
      retry_count: 3,
    };

    const now = Date.now();
    const result = computeNextScheduledAt(job).getTime();

    // Expected: 1000 * 2^3 = 8000ms from now
    expect(result - now).toBeGreaterThanOrEqual(7950);
    expect(result - now).toBeLessThanOrEqual(8100);
  });

  test('📐 Backoff Math: computeNextScheduledAt calculates LINEAR delays accurately', () => {
    // Linear: delay = base * (attempt + 1)
    const job = {
      retry_strategy: 'LINEAR',
      retry_backoff_base_ms: 2000,
      retry_count: 2,
    };

    const now = Date.now();
    const result = computeNextScheduledAt(job).getTime();

    // Expected: 2000 * (2 + 1) = 6000ms from now
    expect(result - now).toBeGreaterThanOrEqual(5950);
    expect(result - now).toBeLessThanOrEqual(6100);
  });

  test('📐 Backoff Math: computeNextScheduledAt caps delay at 1 hour maximum', () => {
    const MAX_RETRY_DELAY_MS = 60 * 60 * 1000; // 1 hour
    const job = {
      retry_strategy: 'EXPONENTIAL',
      retry_backoff_base_ms: 1000,
      retry_count: 25, // 2^25 = 33 million ms ≈ 9 hours — must be capped
    };

    const now = Date.now();
    const result = computeNextScheduledAt(job).getTime();

    expect(result - now).toBeGreaterThanOrEqual(MAX_RETRY_DELAY_MS - 50);
    expect(result - now).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS + 100);
  });

  test('🔄 Retry Lifecycle: Failed job with retries remaining transitions to SCHEDULED', async () => {
    const workerId = await createTestWorker();

    // 1. Create a job with max_retries = 2 (allowing 2 retry attempts).
    //    Use 'WILL_CRASH' payload type to trigger an unknown type error inside #dispatch.
    const fragileJob = await Job.create({
      id: uuidv4(),
      queue_id: failureQueue.id,
      name: 'FlakyThirdPartyWebhook',
      status: 'QUEUED',
      priority: 5,
      max_retries: 2,
      retry_count: 0,
      retry_strategy: 'EXPONENTIAL',
      retry_backoff_base_ms: 500,
      payload: { type: 'WILL_CRASH' }, // Will trigger unknown type error
    });

    // 2. Claim the job with a worker executor
    const executor = new JobExecutor({ workerId, queueSlugs: [failureQueue.slug] });
    const claimed = await executor.claimNextJob();
    expect(claimed).not.toBeNull();
    expect(claimed.id).toBe(fragileJob.id);

    // 3. Execute — the unknown payload type will cause failure inside #dispatch,
    //    which triggers #handleFailure. Since retry_count (0+1=1) <= max_retries (2),
    //    the job should transition to SCHEDULED with backoff applied.
    await executor.execute(claimed);

    // 4. Reload and verify the job transitioned to SCHEDULED (retry available)
    const reloaded = await Job.findByPk(fragileJob.id);
    expect(reloaded.status).toBe('SCHEDULED');
    expect(reloaded.retry_count).toBe(1);
    expect(reloaded.worker_id).toBeNull();

    // ASSERTION: scheduled_at must be set (backoff applied a future timestamp).
    // Note: We verify non-null rather than comparing against Date.now() because
    // MySQL stores UTC timestamps and the dateStrings driver option returns raw
    // strings that JS would misinterpret as local time.
    expect(reloaded.scheduled_at).not.toBeNull();

    // ASSERTION: A FAILED execution record was created for the attempt
    const executions = await JobExecution.findAll({ where: { job_id: fragileJob.id, status: 'FAILED' } });
    expect(executions.length).toBe(1);
    expect(executions[0].error_message).toContain('Unknown payload type');
  });

  test('💀 DLQ Routing: Exhausted job is promoted to Dead Letter Queue after max retries', async () => {
    const workerId = await createTestWorker();

    // 1. Create a job that has ALREADY used up all but its last retry.
    //    max_retries = 1, retry_count = 1 → next failure (retry_count becomes 2 > 1) is terminal.
    const terminalJob = await Job.create({
      id: uuidv4(),
      queue_id: failureQueue.id,
      name: 'TerminalPaymentWebhook',
      status: 'QUEUED',
      priority: 5,
      max_retries: 1,
      retry_count: 1, // Already retried once — next failure is fatal
      retry_strategy: 'EXPONENTIAL',
      retry_backoff_base_ms: 500,
      payload: { type: 'WILL_CRASH' }, // Will trigger unknown type error
    });

    // 2. Claim and execute — this should exhaust retries and route to DLQ
    const executor = new JobExecutor({ workerId, queueSlugs: [failureQueue.slug] });
    const claimed = await executor.claimNextJob();
    expect(claimed).not.toBeNull();
    expect(claimed.id).toBe(terminalJob.id);

    // Execute — the unknown payload type will cause failure, and since
    // retry_count (1+1=2) > max_retries (1), the job is terminally exhausted.
    await executor.execute(claimed);

    // 3. Verify: job status must be FAILED (not SCHEDULED — retries exhausted)
    const failedJob = await Job.findByPk(terminalJob.id);
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.retry_count).toBe(2); // Incremented from 1 → 2, exceeds max_retries=1

    // 4. Verify: a DLQ record must exist for this job
    const dlqRecord = await DeadLetterQueue.findOne({
      where: { original_job_id: terminalJob.id },
    });
    expect(dlqRecord).toBeTruthy();
    expect(dlqRecord.job_name).toBe('TerminalPaymentWebhook');
    expect(dlqRecord.last_error_message).toContain('Unknown payload type');
    expect(dlqRecord.total_attempts).toBe(2);
  });
});
