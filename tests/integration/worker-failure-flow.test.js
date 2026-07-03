import test from 'node:test';
import assert from 'node:assert/strict';

import { sequelize, Job, DeadLetterQueue } from '../../packages/database/index.js';
import { JobExecutor } from '../../services/worker/src/executor/JobExecutor.js';
import { dlqHandler } from '../../services/worker/src/core/DLQHandler.js';
import logger from '../../services/worker/src/utils/logger.js';
import { aiFailureAnalyzer } from '../../services/worker/src/ai/AIFailureAnalyzer.js';

const originals = [];

function stub(obj, key, value) {
  originals.push([obj, key, obj[key]]);
  obj[key] = value;
}

function restoreAll() {
  while (originals.length) {
    const [obj, key, value] = originals.pop();
    obj[key] = value;
  }
}

test.afterEach(restoreAll);

function createExecutor() {
  return new JobExecutor({ workerId: 'worker-1', queueSlugs: ['default'] });
}

test('executor reschedules a failed job when retries remain', async () => {
  const queries = [];
  let dlqCalls = 0;

  stub(sequelize, 'transaction', async (callback) => callback({ id: 'tx-1' }));
  stub(sequelize, 'query', async (sql, options = {}) => {
    queries.push({ sql, replacements: options.replacements });
    if (sql.includes('SELECT COUNT(*) AS cnt')) {
      return [{ cnt: 0 }];
    }
    return [1];
  });
  stub(dlqHandler, 'moveToDLQ', async () => { dlqCalls += 1; return null; });

  const executor = createExecutor();
  const job = {
    id: 'job-retry',
    payload: { type: 'UNKNOWN' },
    retry_count: 1,
    max_retries: 3,
    retry_strategy: 'LINEAR',
    retry_backoff_base_ms: 2000,
    timeout_seconds: 1,
    dataValues: {
      retry_count: 1,
      max_retries: 3,
      retry_strategy: 'LINEAR',
      retry_backoff_base_ms: 2000,
    },
  };

  await executor.execute(job);

  const retryUpdate = queries.find(({ sql }) => sql.includes("SET status = 'SCHEDULED'"));
  assert.ok(retryUpdate, 'expected the job to be rescheduled');
  assert.equal(retryUpdate.replacements.newRetryCount, 2);
  assert.equal(dlqCalls, 0);

  const scheduledAt = new Date(`${retryUpdate.replacements.nextScheduledAt.replace(' ', 'T')}Z`).getTime();
  const deltaMs = scheduledAt - Date.now();
  assert.ok(deltaMs >= 2500 && deltaMs <= 4500, `expected roughly 4s retry delay, got ${deltaMs}ms`);
});

test('executor sends exhausted jobs to the DLQ', async () => {
  const queries = [];
  const dlqCalls = [];

  stub(sequelize, 'transaction', async (callback) => callback({ id: 'tx-2' }));
  stub(sequelize, 'query', async (sql, options = {}) => {
    queries.push({ sql, replacements: options.replacements });
    if (sql.includes('SELECT COUNT(*) AS cnt')) {
      return [{ cnt: 0 }];
    }
    return [1];
  });
  stub(dlqHandler, 'moveToDLQ', async (payload) => {
    dlqCalls.push(payload);
    return { id: 'dlq-1' };
  });

  const executor = createExecutor();
  const job = {
    id: 'job-dlq',
    payload: { type: 'UNKNOWN' },
    retry_count: 3,
    max_retries: 3,
    retry_strategy: 'EXPONENTIAL',
    retry_backoff_base_ms: 1000,
    timeout_seconds: 1,
    dataValues: {
      retry_count: 3,
      max_retries: 3,
      retry_strategy: 'EXPONENTIAL',
      retry_backoff_base_ms: 1000,
    },
  };

  await executor.execute(job);

  assert.equal(dlqCalls.length, 1, 'expected a DLQ promotion call');
  assert.equal(dlqCalls[0].jobId, 'job-dlq');
  assert.equal(dlqCalls[0].totalAttempts, 4);
  assert.equal(dlqCalls[0].workerId, 'worker-1');
  assert.ok(queries.some(({ sql }) => sql.includes("SET status = 'FAILED'")), 'expected a terminal FAILED update');
  assert.ok(!queries.some(({ sql }) => sql.includes("SET status = 'SCHEDULED'")), 'did not expect a retry reschedule');
});

test('DLQ handler inserts a dead-letter record and marks the job failed', async () => {
  const queries = [];
  const createdRecords = [];
  const loggerChildren = [];

  stub(logger, 'info', () => {});
  stub(logger, 'error', () => {});
  stub(logger, 'warn', () => {});
  stub(logger, 'debug', () => {});
  stub(logger, 'child', (meta) => {
    loggerChildren.push(meta);
    return { info() {}, warn() {}, error() {}, debug() {} };
  });
  stub(aiFailureAnalyzer, 'analyze', async () => ({
    analyzed_by: 'rule-based',
    confidence_score: 0.91,
    summary: 'exhausted retries',
  }));
  stub(Job, 'findByPk', async () => ({
    id: 'job-9',
    name: 'Nightly Sync',
    status: 'RUNNING',
    queue_id: 'queue-9',
    payload: { type: 'NOOP' },
    queue: { project_id: 'project-9' },
  }));
  stub(DeadLetterQueue, 'create', async (payload) => {
    createdRecords.push(payload);
    return { ...payload, id: 'dlq-9' };
  });
  stub(sequelize, 'transaction', async (callback) => callback({ id: 'tx-3' }));
  stub(sequelize, 'query', async (sql) => {
    queries.push(sql);
    if (sql.includes('SELECT id FROM dead_letter_queue')) {
      return [];
    }
    if (sql.includes('UPDATE jobs')) {
      return [1];
    }
    return [];
  });

  const record = await dlqHandler.moveToDLQ({
    jobId: 'job-9',
    error: new Error('boom'),
    totalAttempts: 4,
    workerId: 'worker-9',
  });

  assert.equal(record.id, 'dlq-9');
  assert.equal(createdRecords.length, 1);
  assert.equal(createdRecords[0].original_job_id, 'job-9');
  assert.equal(createdRecords[0].total_attempts, 4);
  assert.equal(createdRecords[0].queue_id, 'queue-9');
  assert.ok(queries.some((sql) => sql.includes("status       = 'FAILED'")), 'expected failed job state update');
  assert.ok(loggerChildren.length > 0, 'expected a scoped DLQ logger');
});
