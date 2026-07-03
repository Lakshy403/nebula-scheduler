/**
 * Seed script: creates realistic demo data for the Nebula Scheduler dashboard.
 * Run inside the API container: docker exec nebula_api node seed-data.js
 */

import { sequelize } from './packages/database/index.js';
import { v4 as uuidv4 } from 'uuid';

const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SCHEDULED', 'CANCELLED'];
const JOB_NAMES = [
  'email-digest', 'invoice-generation', 'thumbnail-resize',
  'report-export', 'data-sync', 'cache-warmup',
  'user-notification', 'log-rotate', 'backup-snapshot',
  'metrics-aggregation', 'webhook-delivery', 'pdf-render',
  'search-reindex', 'analytics-etl', 'cleanup-expired-tokens',
];

function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('DB Connected');

    // Find existing queues
    const [queues] = await sequelize.query('SELECT id FROM queues LIMIT 10');
    if (queues.length === 0) {
      console.error('No queues found. Run the seed.js first to create the admin user and queues.');
      process.exit(1);
    }

    const queueIds = queues.map(q => q.id);

    // Find project to attach workers to
    const [projects] = await sequelize.query('SELECT id FROM projects LIMIT 1');
    const projectId = projects[0]?.id;

    // ── Seed Jobs ──────────────────────────────────────────────────────────
    const jobValues = [];
    const jobIds = [];

    // Create 40 jobs with various statuses
    for (let i = 0; i < 40; i++) {
      const id = uuidv4();
      jobIds.push(id);
      const status = randomItem(JOB_STATUSES);
      const name = randomItem(JOB_NAMES);
      const queueId = randomItem(queueIds);
      const priority = randomInt(1, 10);
      const maxRetries = randomInt(0, 5);
      const retryCount = status === 'FAILED' ? randomInt(1, maxRetries || 1) : 0;
      const createdAt = new Date(Date.now() - randomInt(60_000, 7_200_000));
      const completedAt = (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED')
        ? new Date(createdAt.getTime() + randomInt(1000, 120_000))
        : null;

      jobValues.push([
        id, queueId, name,
        JSON.stringify({ type: name.toUpperCase().replace(/-/g, '_') }),
        status, priority, maxRetries, retryCount,
        'EXPONENTIAL', 1000, 300, null, null,
        completedAt ? completedAt.toISOString().slice(0, 19).replace('T', ' ') : null,
        createdAt.toISOString().slice(0, 19).replace('T', ' '),
        createdAt.toISOString().slice(0, 19).replace('T', ' '),
      ]);
    }

    for (const v of jobValues) {
      await sequelize.query(
        `INSERT INTO jobs (id, queue_id, name, payload, status, priority, max_retries, retry_count, retry_strategy, retry_backoff_base_ms, timeout_seconds, idempotency_key, cron_expression, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        { replacements: v }
      );
    }
    console.log(`Inserted ${jobValues.length} jobs`);

    // ── Seed Job Executions ────────────────────────────────────────────────
    let execCount = 0;
    for (const v of jobValues) {
      const jobId = v[0];
      const status = v[4];
      if (status === 'QUEUED' || status === 'SCHEDULED') continue;

      const attempts = status === 'FAILED' ? randomInt(1, 3) : 1;
      for (let a = 1; a <= attempts; a++) {
        const execId = uuidv4();
        const durationMs = randomInt(50, 25000);
        const execStatus = (a < attempts) ? 'FAILED' : status === 'RUNNING' ? 'RUNNING' : status;
        const startedAt = new Date(Date.now() - randomInt(60_000, 3_600_000));
        const completedAtExec = execStatus !== 'RUNNING' ? new Date(startedAt.getTime() + durationMs) : null;
        const errorMsg = execStatus === 'FAILED' ? 'TimeoutError: execution exceeded 300s deadline' : null;

        await sequelize.query(
          `INSERT INTO job_executions (id, job_id, attempt_number, worker_id, status, started_at, completed_at, duration_ms, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          {
            replacements: [
              execId, jobId, a, null, execStatus,
              startedAt.toISOString().slice(0, 19).replace('T', ' '),
              completedAtExec ? completedAtExec.toISOString().slice(0, 19).replace('T', ' ') : null,
              execStatus !== 'RUNNING' ? durationMs : null,
              errorMsg,
              startedAt.toISOString().slice(0, 19).replace('T', ' '),
              startedAt.toISOString().slice(0, 19).replace('T', ' '),
            ]
          }
        );
        execCount++;
      }
    }
    console.log(`Inserted ${execCount} job executions`);

    // ── Seed Dead Letter Queue ─────────────────────────────────────────────
    const failedJobs = jobValues.filter(v => v[4] === 'FAILED');
    let dlqCount = 0;
    for (const v of failedJobs) {
      const dlqId = uuidv4();
      const jobId = v[0];
      const queueId = v[1];
      const reason = randomItem([
        'Max retries exceeded (3/3)',
        'Circuit breaker tripped: upstream service unavailable',
        'Payload deserialization error: invalid JSON at position 42',
        'Timeout exceeded: 300s deadline',
        'Worker OOM killed during execution',
      ]);
      const replayed = Math.random() > 0.6; // 40% are resolved
      const createdAt = new Date(Date.now() - randomInt(60_000, 3_600_000));

      await sequelize.query(
        `INSERT INTO dead_letter_queue (id, job_id, queue_id, reason, replayed_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        {
          replacements: [
            dlqId, jobId, queueId, reason,
            replayed ? createdAt.toISOString().slice(0, 19).replace('T', ' ') : null,
            replayed ? 'Replayed by admin' : null,
            createdAt.toISOString().slice(0, 19).replace('T', ' '),
            createdAt.toISOString().slice(0, 19).replace('T', ' '),
          ]
        }
      );
      dlqCount++;
    }
    console.log(`Inserted ${dlqCount} DLQ entries`);

    // ── Seed Workers ───────────────────────────────────────────────────────
    const workerNames = ['worker-alpha-01', 'worker-alpha-02', 'worker-beta-01', 'worker-beta-02', 'worker-gamma-01'];
    let workerCount = 0;
    for (const name of workerNames) {
      const wId = uuidv4();
      const isActive = Math.random() > 0.3;
      const heartbeat = isActive
        ? new Date(Date.now() - randomInt(1000, 30_000))
        : new Date(Date.now() - randomInt(120_000, 600_000));

      await sequelize.query(
        `INSERT INTO workers (id, project_id, hostname, status, last_heartbeat_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        {
          replacements: [
            wId, projectId, name,
            isActive ? 'ACTIVE' : 'OFFLINE',
            heartbeat.toISOString().slice(0, 19).replace('T', ' '),
          ]
        }
      );
      workerCount++;
    }
    console.log(`Inserted ${workerCount} workers`);

    console.log('\n✅ Seed data complete!');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
}

seed();
