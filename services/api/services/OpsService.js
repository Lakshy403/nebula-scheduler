import { Op, QueryTypes } from 'sequelize';
import { sequelize, Worker, DeadLetterQueue, Job, Queue } from '../../../packages/database/index.js';
import { JobStatus } from '../../../packages/database/models/Job.js';

export class OpsService {
  async listWorkers({ organizationId }) {
    const rows = await Worker.findAll({
      include: [{ association: 'project', required: false, where: organizationId ? { organization_id: organizationId } : undefined }],
      order: [['last_heartbeat_at', 'DESC']],
    });
    return rows.map((r) => r.toJSON());
  }

  async listDlq({ organizationId, limit = 50 }) {
    const queues = await Queue.findAll({
      include: [{ association: 'project', required: true, where: { organization_id: organizationId } }],
      attributes: ['id'],
    });
    const queueIds = queues.map((q) => q.id);
    if (!queueIds.length) return [];
    const rows = await DeadLetterQueue.findAll({ where: { queue_id: { [Op.in]: queueIds } }, order: [['promoted_at', 'DESC']], limit });
    return rows.map((r) => r.toJSON());
  }

  async replayDlq({ organizationId, dlqId, userId }) {
    const dlq = await DeadLetterQueue.findOne({
      where: { id: dlqId },
      include: [{ association: 'queue', required: true, include: [{ association: 'project', required: true, where: { organization_id: organizationId } }] }],
    });
    if (!dlq) {
      const err = new Error('DLQ entry not found in this organization.');
      err.status = 404;
      err.code = 'DLQ_NOT_FOUND';
      throw err;
    }

    return sequelize.transaction(async (transaction) => {
      const replayJob = await Job.create({
        queue_id: dlq.queue_id,
        name: `${dlq.job_name}-replay`,
        payload: dlq.payload,
        status: JobStatus.QUEUED,
        priority: 5,
        scheduled_at: new Date(),
        created_by: userId,
      }, { transaction });
      await dlq.update({ replay_job_id: replayJob.id, replayed_by: userId, replayed_at: new Date() }, { transaction });
      return replayJob.toJSON();
    });
  }

  async retryJob({ organizationId, jobId }) {
    const job = await Job.findOne({
      where: { id: jobId },
      include: [{ association: 'queue', required: true, include: [{ association: 'project', required: true, where: { organization_id: organizationId } }] }],
    });
    if (!job) {
      const err = new Error('Job not found in this organization.');
      err.status = 404;
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }
    if (![JobStatus.FAILED, JobStatus.DEAD, JobStatus.CANCELLED].includes(job.status)) {
      const err = new Error(`Job in status ${job.status} cannot be retried manually.`);
      err.status = 409;
      err.code = 'JOB_NOT_RETRYABLE';
      throw err;
    }
    await job.update({ status: JobStatus.QUEUED, scheduled_at: new Date(), worker_id: null, started_at: null, completed_at: null });
    return job.toJSON();
  }

  async getJobExecutions({ organizationId, jobId }) {
    const job = await Job.findOne({
      where: { id: jobId },
      include: [{ association: 'queue', required: true, include: [{ association: 'project', required: true, where: { organization_id: organizationId } }] }],
    });
    if (!job) {
      const err = new Error('Job not found in this organization.');
      err.status = 404;
      err.code = 'JOB_NOT_FOUND';
      throw err;
    }
    return sequelize.query('SELECT * FROM job_executions WHERE job_id = :jobId ORDER BY attempt_number DESC', {
      type: QueryTypes.SELECT,
      replacements: { jobId },
    });
  }
}

export const opsService = new OpsService();
