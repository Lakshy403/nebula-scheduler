/**
 * @file jest.config.js
 * @description Jest configuration for the Nebula Scheduler test suite.
 *
 * Uses the `--experimental-vm-modules` flag for native ESM support.
 * Tests are run against the live MySQL Docker container to validate
 * real transactional behavior (SELECT ... FOR UPDATE SKIP LOCKED).
 */
export default {
  testEnvironment: 'node',
  transform: {},
  extensionsToTreatAsEsm: [],
  testMatch: ['**/tests/**/*.test.js'],
  // Sequential execution — prevents DB race conditions between test suites
  maxWorkers: 1,
  // Increase timeout for DB integration tests
  testTimeout: 30000,
};
