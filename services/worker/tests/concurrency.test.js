/**
 * @file services/worker/tests/concurrency.test.js
 * @description Integration test: Validates atomic job claiming under concurrent load.
 *
 * This test replicates the hardest problem in distributed task queues:
 * multiple worker processes hitting the database at the exact same millisecond
 * to claim the same job. It proves that the SELECT ... FOR UPDATE SKIP LOCKED
 * mechanism operates flawlessly under concurrent pressure.
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
} from '../../../packages/database/index.js';
import { JobExecutor } from '../src/executor/JobExecutor.js';

describe('Nebula Distributed Concurrency & Locking Integration Suite', () => {
  let testOrg;
  let testProject;
  let testQueue;

  beforeAll(async () => {
    // Ensure database connection is initialized
    await sequelize.authenticate();
    await sequelize.sync({ alter: true });

    // Provision an isolated organizational hierarchy for testing
    testOrg = await Organization.create({
      id: uuidv4(),
      name: `Test Org ${Date.now()}`,
      slug: `test-org-${Date.now()}`,
    });

    testProject = await Project.create({
      id: uuidv4(),
      organization_id: testOrg.id,
      name: `Test Project ${Date.now()}`,
      slug: `test-project-${Date.now()}`,
    });

    testQueue = await Queue.create({
      id: uuidv4(),
      project_id: testProject.id,
      name: `Concurrency Test Queue`,
      slug: `concurrency-test-${Date.now()}`,
      concurrency_limit: 10,
      is_paused: false,
    });
  });

  afterAll(async () => {
    // Cleanup test data — cascade deletes handle child records
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

  test('🛡️ Race Condition Mitigation: Multiple concurrent workers must never claim the same job', async () => {
    // 1. Seed exactly ONE high-priority job into our test queue
    const targetJob = await Job.create({
      id: uuidv4(),
      queue_id: testQueue.id,
      name: 'CriticalPaymentTransaction',
      status: 'QUEUED',
      priority: 10,
      payload: { amount: 500, currency: 'USD' },
    });

    // 2. Create three REAL worker records to satisfy FK constraints,
    //    then instantiate three independent JobExecutor instances —
    //    just like a real horizontally-scaled Kubernetes deployment.
    const workerIdA = await createTestWorker();
    const workerIdB = await createTestWorker();
    const workerIdC = await createTestWorker();

    const workerA = new JobExecutor({ workerId: workerIdA, queueSlugs: [testQueue.slug] });
    const workerB = new JobExecutor({ workerId: workerIdB, queueSlugs: [testQueue.slug] });
    const workerC = new JobExecutor({ workerId: workerIdC, queueSlugs: [testQueue.slug] });

    // 3. Simulate an identical, concurrent race condition.
    //    We execute three claim requests in parallel using Promise.all.
    //    This forces all three workers to hit the DB at the exact same instant.
    const claimAttempts = await Promise.all([
      workerA.claimNextJob(),
      workerB.claimNextJob(),
      workerC.claimNextJob(),
    ]);

    // 4. Filter out instances where a worker successfully acquired a job row
    const successfulClaims = claimAttempts.filter((job) => job !== null);

    // ASSERTION 1: Exactly one worker must have successfully stepped past
    // the database row lock (FOR UPDATE SKIP LOCKED ensures the other two
    // skip the locked row and return null).
    expect(successfulClaims.length).toBe(1);

    // ASSERTION 2: The job status must now be RUNNING (set atomically
    // inside the claim transaction), not still QUEUED.
    const updatedJobState = await Job.findByPk(targetJob.id);
    expect(updatedJobState.status).toBe('RUNNING');

    // ASSERTION 3: The winning worker's ID must be recorded on the job row.
    expect(updatedJobState.worker_id).toBeTruthy();
    expect([workerIdA, workerIdB, workerIdC]).toContain(updatedJobState.worker_id);

    // ASSERTION 4: A JobExecution audit record must exist for the claim.
    const executions = await JobExecution.findAll({ where: { job_id: targetJob.id } });
    expect(executions.length).toBe(1);
    expect(executions[0].status).toBe('RUNNING');
  });

  test('🔀 Batch Distribution: Multiple queued jobs are claimed by different workers without duplication', async () => {
    // 1. Seed 5 queued jobs
    const jobIds = [];
    for (let i = 0; i < 5; i++) {
      const j = await Job.create({
        id: uuidv4(),
        queue_id: testQueue.id,
        name: `BatchJob-${i}`,
        status: 'QUEUED',
        priority: 5,
        payload: { index: i },
      });
      jobIds.push(j.id);
    }

    // 2. Create 5 REAL worker records and spin up 5 concurrent executors
    const workers = [];
    for (let i = 0; i < 5; i++) {
      const wid = await createTestWorker();
      workers.push(new JobExecutor({ workerId: wid, queueSlugs: [testQueue.slug] }));
    }

    // 3. All 5 workers attempt to claim simultaneously
    const claims = await Promise.all(workers.map((w) => w.claimNextJob()));
    const successful = claims.filter((c) => c !== null);

    // ASSERTION: Each worker must have claimed a DIFFERENT job — no duplicates
    const claimedJobIds = successful.map((j) => j.id);
    const uniqueIds = new Set(claimedJobIds);
    expect(uniqueIds.size).toBe(claimedJobIds.length);

    // ASSERTION: All claimed jobs must be in RUNNING state
    for (const id of claimedJobIds) {
      const job = await Job.findByPk(id);
      expect(job.status).toBe('RUNNING');
    }
  });
});
