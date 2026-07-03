/**
 * Seed DLQ + Workers — run after seed-data.js has populated jobs.
 * Usage: docker cp seed-dlq.js nebula_api:/app/ && docker exec nebula_api node seed-dlq.js
 */
import { sequelize } from './packages/database/index.js';
import { v4 as uuidv4 } from 'uuid';

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('DB Connected');

    const [projects] = await sequelize.query('SELECT id FROM projects LIMIT 1');
    const projectId = projects[0]?.id;
    if (!projectId) { console.error('No project found'); process.exit(1); }

    // Get failed jobs for DLQ
    const [failedJobs] = await sequelize.query("SELECT id, queue_id, name, payload FROM jobs WHERE status = 'FAILED' LIMIT 20");
    console.log('Found', failedJobs.length, 'failed jobs for DLQ');

    const reasons = [
      'Max retries exceeded (3/3)',
      'Circuit breaker tripped: upstream service unavailable',
      'Timeout exceeded: 300s deadline',
      'Worker OOM killed during execution',
      'Payload deserialization error: invalid JSON',
    ];

    let dlqCount = 0;
    for (const job of failedJobs) {
      const dlqId = uuidv4();
      const replayed = Math.random() > 0.6;
      const createdAt = new Date(Date.now() - randomInt(60000, 3600000));
      const ca = createdAt.toISOString().slice(0, 19).replace('T', ' ');
      const reason = randomItem(reasons);

      await sequelize.query(
        `INSERT INTO dead_letter_queue (id, original_job_id, queue_id, project_id, job_name, payload, last_error_message, total_attempts, first_attempted_at, last_attempted_at, promoted_at, replayed_at, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        {
          replacements: [
            dlqId, job.id, job.queue_id, projectId, job.name,
            typeof job.payload === 'string' ? job.payload : JSON.stringify(job.payload),
            reason, 3, ca, ca,
            ca,
            replayed ? ca : null,
            replayed ? 'Replayed by admin' : null,
            ca, ca,
          ],
        }
      );
      dlqCount++;
    }
    console.log('Inserted', dlqCount, 'DLQ entries');

    // Seed workers
    const workerNames = ['worker-alpha-01', 'worker-alpha-02', 'worker-beta-01', 'worker-beta-02', 'worker-gamma-01'];
    let workerCount = 0;
    for (const name of workerNames) {
      const wId = uuidv4();
      const isActive = Math.random() > 0.3;
      const hb = new Date(Date.now() - (isActive ? randomInt(1000, 30000) : randomInt(120000, 600000)));
      const hbs = hb.toISOString().slice(0, 19).replace('T', ' ');

      await sequelize.query(
        `INSERT INTO workers (id, project_id, hostname, status, last_heartbeat_at, created_at, updated_at) VALUES (?,?,?,?,?,NOW(),NOW())`,
        { replacements: [wId, projectId, name, isActive ? 'ACTIVE' : 'OFFLINE', hbs] }
      );
      workerCount++;
    }
    console.log('Inserted', workerCount, 'workers');

    console.log('\n✅ DLQ + Workers seed complete!');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err.message);
    console.error(err.sql || '');
    process.exit(1);
  }
}

seed();
