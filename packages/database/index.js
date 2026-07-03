/**
 * @file packages/database/index.js
 * @description Database module entry point.
 *
 * Responsibilities:
 *  1. Initialises every model against the Sequelize instance.
 *  2. Declares all inter-model associations (relationships) in one place so
 *     that circular imports between model files are avoided.
 *  3. Exports a `connectDB` function that the service entry point calls once
 *     at startup. It authenticates the connection pool and optionally syncs
 *     the schema (development only — production uses versioned migrations).
 *  4. Re-exports all models and the Sequelize instance for use in services.
 *
 * Association cascade rules follow the ERD in Phase 1:
 *  - Organization → Projects → Queues → Jobs → JobExecutions  (CASCADE DELETE)
 *  - Worker → Jobs                                             (SET NULL on delete)
 *  - Job → DeadLetterQueue                                     (CASCADE DELETE)
 *  - User → OrganizationMembers, Jobs, Projects               (SET NULL on delete)
 */

import sequelize        from './config/database.js';
import logger           from '../../services/api/utils/logger.js';

// ── Model class imports ─────────────────────────────────────────────────────
import { User }               from './models/User.js';
import { Organization }       from './models/Organization.js';
import { OrganizationMember } from './models/OrganizationMember.js';
import { Project }            from './models/Project.js';
import { Queue }              from './models/Queue.js';
import { Worker }             from './models/Worker.js';
import { Job }                from './models/Job.js';
import { JobExecution }       from './models/JobExecution.js';
import { DeadLetterQueue }    from './models/DeadLetterQueue.js';

// ---------------------------------------------------------------------------
// Step 1 — Initialise all models (order-independent; associations come later)
// ---------------------------------------------------------------------------
User.initialize(sequelize);
Organization.initialize(sequelize);
OrganizationMember.initialize(sequelize);
Project.initialize(sequelize);
Queue.initialize(sequelize);
Worker.initialize(sequelize);
Job.initialize(sequelize);
JobExecution.initialize(sequelize);
DeadLetterQueue.initialize(sequelize);

// ---------------------------------------------------------------------------
// Step 2 — Declare associations
// ---------------------------------------------------------------------------
// Naming conventions:
//   A.hasMany(B)    → A is the 1-side;  B holds the foreign key.
//   A.belongsTo(B)  → A is the N-side;  A holds the foreign key.
//   Use `foreignKey` to ensure the exact column name from the DDL is used.
//   Use `as` aliases to resolve ambiguity when a model has multiple FK→same target.

// ── User ──────────────────────────────────────────────────────────────────
User.hasMany(OrganizationMember, {
  foreignKey: 'user_id',
  onDelete:   'CASCADE',
  as:         'memberships',
});
OrganizationMember.belongsTo(User, {
  foreignKey: 'user_id',
  as:         'user',
});

User.hasMany(Project, {
  foreignKey: 'created_by',
  onDelete:   'SET NULL',
  as:         'createdProjects',
});
Project.belongsTo(User, {
  foreignKey: 'created_by',
  as:         'creator',
});

User.hasMany(Job, {
  foreignKey: 'created_by',
  onDelete:   'SET NULL',
  as:         'createdJobs',
});
Job.belongsTo(User, {
  foreignKey: 'created_by',
  as:         'creator',
});

// ── Organization ──────────────────────────────────────────────────────────
Organization.hasMany(OrganizationMember, {
  foreignKey: 'organization_id',
  onDelete:   'CASCADE',
  as:         'members',
});
OrganizationMember.belongsTo(Organization, {
  foreignKey: 'organization_id',
  as:         'organization',
});

Organization.hasMany(Project, {
  foreignKey: 'organization_id',
  onDelete:   'CASCADE',
  as:         'projects',
});
Project.belongsTo(Organization, {
  foreignKey: 'organization_id',
  as:         'organization',
});

// ── OrganizationMember (self-referential inviter) ─────────────────────────
OrganizationMember.belongsTo(User, {
  foreignKey: 'invited_by',
  as:         'inviter',
  constraints: false,   // inviter may be deleted (SET NULL handled by DB)
});

// ── Project ───────────────────────────────────────────────────────────────
Project.hasMany(Queue, {
  foreignKey: 'project_id',
  onDelete:   'CASCADE',
  as:         'queues',
});
Queue.belongsTo(Project, {
  foreignKey: 'project_id',
  as:         'project',
});

Project.hasMany(Worker, {
  foreignKey: 'project_id',
  onDelete:   'CASCADE',
  as:         'workers',
});
Worker.belongsTo(Project, {
  foreignKey: 'project_id',
  as:         'project',
});

// ── Queue ─────────────────────────────────────────────────────────────────
Queue.hasMany(Job, {
  foreignKey: 'queue_id',
  onDelete:   'CASCADE',
  as:         'jobs',
});
Job.belongsTo(Queue, {
  foreignKey: 'queue_id',
  as:         'queue',
});

Queue.hasMany(DeadLetterQueue, {
  foreignKey: 'queue_id',
  onDelete:   'CASCADE',
  as:         'deadLetterEntries',
});
DeadLetterQueue.belongsTo(Queue, {
  foreignKey: 'queue_id',
  as:         'queue',
});

// ── Worker ────────────────────────────────────────────────────────────────
Worker.hasMany(Job, {
  foreignKey: 'worker_id',
  onDelete:   'SET NULL',   // releasing a worker should not delete its job history
  as:         'claimedJobs',
});
Job.belongsTo(Worker, {
  foreignKey: 'worker_id',
  as:         'worker',
});

Worker.hasMany(JobExecution, {
  foreignKey: 'worker_id',
  onDelete:   'SET NULL',
  as:         'executions',
});
JobExecution.belongsTo(Worker, {
  foreignKey: 'worker_id',
  as:         'worker',
});

// ── Job ───────────────────────────────────────────────────────────────────
Job.hasMany(JobExecution, {
  foreignKey: 'job_id',
  onDelete:   'CASCADE',
  as:         'executions',
});
JobExecution.belongsTo(Job, {
  foreignKey: 'job_id',
  as:         'job',
});

// Self-referential: parent/child job tree (fan-out, chaining).
Job.hasMany(Job, {
  foreignKey: 'parent_job_id',
  onDelete:   'SET NULL',
  as:         'childJobs',
});
Job.belongsTo(Job, {
  foreignKey: 'parent_job_id',
  as:         'parentJob',
});

// ── DeadLetterQueue ───────────────────────────────────────────────────────
DeadLetterQueue.belongsTo(Job, {
  foreignKey:  'replay_job_id',
  as:          'replayJob',
  constraints: false,   // replay_job_id may be null; let the DB enforce FK
});
DeadLetterQueue.belongsTo(User, {
  foreignKey:  'replayed_by',
  as:          'replayedByUser',
  constraints: false,
});

// ---------------------------------------------------------------------------
// Step 3 — connectDB
// ---------------------------------------------------------------------------

/**
 * Initialises the database connection pool and optionally synchronises the
 * schema. Call this **once** from the service entry point (server.js) before
 * binding the HTTP server.
 *
 * @param {object}  [options]
 * @param {boolean} [options.sync=false]  - Run `sequelize.sync({ alter: true })`.
 *                                          Never set true in production; use migrations.
 * @param {boolean} [options.force=false] - Drop and recreate all tables.
 *                                          Destructive — only for integration tests.
 * @returns {Promise<import('sequelize').Sequelize>}
 */
export async function connectDB({ sync = false, force = false } = {}) {
  const startMs = Date.now();

  try {
    logger.info('Connecting to MySQL...', { host: process.env.DB_HOST, db: process.env.DB_NAME });

    await sequelize.authenticate();

    logger.info('MySQL connection pool established.', { durationMs: Date.now() - startMs });

    if (sync) {
      if (force && process.env.NODE_ENV === 'production') {
        throw new Error('[connectDB] force:true is not permitted in production.');
      }
      logger.warn('Running sequelize.sync() — for development/testing only.');
      await sequelize.sync({ force, alter: !force });
      logger.info('Schema synchronised.');
    }

    return sequelize;
  } catch (err) {
    logger.error('Failed to establish database connection.', { error: err });
    throw err; // propagate so server.js can exit with a non-zero code
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export {
  sequelize,
  // Models
  User,
  Organization,
  OrganizationMember,
  Project,
  Queue,
  Worker,
  Job,
  JobExecution,
  DeadLetterQueue,
};
