import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextScheduledAt } from '../../services/worker/src/executor/JobExecutor.js';

function expectDelay(job, expectedMs, toleranceMs = 150) {
  const startedAt = Date.now();
  const scheduledAt = computeNextScheduledAt(job).getTime();
  const actualDelay = scheduledAt - startedAt;

  assert.ok(
    actualDelay >= expectedMs - toleranceMs && actualDelay <= expectedMs + toleranceMs,
    `expected delay around ${expectedMs}ms, got ${actualDelay}ms`,
  );
}

test('retry policy uses fixed delay when configured', () => {
  expectDelay({
    retry_strategy: 'FIXED',
    retry_backoff_base_ms: 2500,
    retry_count: 7,
  }, 2500);
});

test('retry policy uses linear backoff when configured', () => {
  expectDelay({
    retry_strategy: 'LINEAR',
    retry_backoff_base_ms: 2000,
    retry_count: 2,
  }, 6000);
});

test('retry policy uses exponential backoff when configured', () => {
  expectDelay({
    retry_strategy: 'EXPONENTIAL',
    retry_backoff_base_ms: 1000,
    retry_count: 3,
  }, 8000);
});

test('retry policy caps the retry delay at one hour', () => {
  expectDelay({
    retry_strategy: 'EXPONENTIAL',
    retry_backoff_base_ms: 1000,
    retry_count: 20,
  }, 60 * 60 * 1000);
});
