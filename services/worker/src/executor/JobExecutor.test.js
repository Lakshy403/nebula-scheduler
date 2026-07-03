import test from 'node:test';
import assert from 'node:assert';
import { computeNextScheduledAt } from './JobExecutor.js';

test('JobExecutor: computeNextScheduledAt calculates LINEAR backoff correctly', () => {
  const job = {
    retry_strategy: 'LINEAR',
    retry_backoff_base_ms: 2000,
    retry_count: 2,
  };
  
  const now = Date.now();
  const scheduledAt = computeNextScheduledAt(job).getTime();
  
  // Linear backoff: base * (attempt + 1) -> 2000 * (2 + 1) = 6000ms delay
  const expectedDelay = 6000;
  
  // Allow 50ms buffer for test execution time difference
  assert.ok(scheduledAt - now >= expectedDelay - 50);
  assert.ok(scheduledAt - now <= expectedDelay + 50);
});

test('JobExecutor: computeNextScheduledAt calculates EXPONENTIAL backoff correctly', () => {
  const job = {
    retry_strategy: 'EXPONENTIAL',
    retry_backoff_base_ms: 1000,
    retry_count: 3,
  };
  
  const now = Date.now();
  const scheduledAt = computeNextScheduledAt(job).getTime();
  
  // Exponential backoff: base * (2 ^ attempt) -> 1000 * (2 ^ 3) = 8000ms delay
  const expectedDelay = 8000;
  
  // Allow 50ms buffer for test execution time difference
  assert.ok(scheduledAt - now >= expectedDelay - 50);
  assert.ok(scheduledAt - now <= expectedDelay + 50);
});

test('JobExecutor: computeNextScheduledAt caps delay at MAX_RETRY_DELAY_MS', () => {
  const MAX_RETRY_DELAY_MS = 60 * 60 * 1000; // 1 hour
  const job = {
    retry_strategy: 'EXPONENTIAL',
    retry_backoff_base_ms: 1000,
    retry_count: 20, // 2^20 = 1048576 * 1000 = ~12 days
  };
  
  const now = Date.now();
  const scheduledAt = computeNextScheduledAt(job).getTime();
  
  // The delay should be capped at exactly 1 hour
  assert.ok(scheduledAt - now >= MAX_RETRY_DELAY_MS - 50);
  assert.ok(scheduledAt - now <= MAX_RETRY_DELAY_MS + 50);
});
