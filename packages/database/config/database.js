/**
 * @file packages/database/config/database.js
 * @description Enterprise-grade Sequelize configuration for MySQL.
 *
 * Connection pool is tuned for high-concurrency workloads:
 *   - max:     Upper bound of concurrent DB connections per process.
 *   - min:     Warm connections kept alive to avoid cold-start latency.
 *   - acquire: Max ms to wait before throwing a connection timeout error.
 *   - idle:    Max ms a connection can sit unused before being released.
 *
 * Raw SQL logging is suppressed in production to eliminate I/O overhead
 * on high-throughput query paths (worker claim loops, scheduler ticks).
 */

import { Sequelize } from 'sequelize';
const env = process.env;

// ---------------------------------------------------------------------------
// Pool sizing strategy
// ---------------------------------------------------------------------------
// Rule of thumb: pool.max per process ≤ (MySQL max_connections / pod_count) - headroom
// Adjust MAX_POOL_SIZE via environment to match your deployment topology.
const MAX_POOL_SIZE   = parseInt(env.DB_POOL_MAX   ?? '20',  10);
const MIN_POOL_SIZE   = parseInt(env.DB_POOL_MIN   ?? '5',   10);
const ACQUIRE_TIMEOUT = parseInt(env.DB_POOL_ACQUIRE ?? '30000', 10); // 30 s
const IDLE_TIMEOUT    = parseInt(env.DB_POOL_IDLE   ?? '10000', 10); // 10 s

// ---------------------------------------------------------------------------
// Dialect options
// ---------------------------------------------------------------------------
const dialectOptions = {
  // Enforce strict SSL in production. Provide ca/cert/key from secrets manager
  // when connecting to managed MySQL (e.g., Cloud SQL, RDS).
  ...(env.NODE_ENV === 'production' && {
    ssl: {
      require:            true,
      rejectUnauthorized: true,
    },
  }),

  // Prevent the MySQL driver from converting DATE columns to JS Date objects,
  // which can introduce silent timezone shifts.
  dateStrings: true,

  typeCast(field, next) {
    if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
      return field.string(); // return raw ISO string; let the app layer parse
    }
    return next();
  },
};

// ---------------------------------------------------------------------------
// Sequelize instance
// ---------------------------------------------------------------------------
const sequelize = new Sequelize(
  env.DB_NAME,
  env.DB_USER,
  env.DB_PASSWORD,
  {
    host:    env.DB_HOST     ?? 'localhost',
    port:    parseInt(env.DB_PORT ?? '3306', 10),
    dialect: 'mysql',

    pool: {
      max:     MAX_POOL_SIZE,
      min:     MIN_POOL_SIZE,
      acquire: ACQUIRE_TIMEOUT,
      idle:    IDLE_TIMEOUT,

      // Validate a connection before handing it to a caller.
      // Drops dead connections (e.g. after MySQL server restart) automatically.
      validate(connection) {
        return connection && !connection.destroyed;
      },
    },

    dialectOptions,

    // Suppress all raw SQL output in production. In development/test, emit
    // structured log entries instead of raw console.log strings.
    logging:
      env.NODE_ENV === 'production'
        ? false
        : (sql, timing) => {
            // Lazy import avoids circular dependency during bootstrap.
            import('../../../services/api/utils/logger.js').then(({ default: logger }) => {
              logger.debug('SQL executed', { sql, durationMs: timing });
            });
          },

    // Emit query timing in development for performance profiling.
    benchmark: env.NODE_ENV !== 'production',

    // Keep table names exactly as defined in models; do not auto-pluralise.
    define: {
      underscored:   true,   // snake_case column names
      freezeTableName: true, // prevent Sequelize from pluralising table names
      timestamps:    true,   // createdAt / updatedAt managed by ORM
    },

    timezone: '+00:00', // always store timestamps in UTC
  },
);

export default sequelize;
