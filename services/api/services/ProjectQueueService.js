import { Op, QueryTypes } from 'sequelize';
import { sequelize, Project, Queue, Job } from '../../../packages/database/index.js';

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 120) || 'default';
}

export class ProjectQueueService {
  async listProjects({ organizationId }) {
    return Project.findAll({ where: { organization_id: organizationId }, order: [['created_at', 'DESC']] }).then((rows) => rows.map((r) => r.toJSON()));
  }

  async createProject({ organizationId, userId, data }) {
    const slug = data.slug ? slugify(data.slug) : slugify(data.name);
    const project = await Project.create({ organization_id: organizationId, created_by: userId, name: data.name, slug, description: data.description ?? null });
    return project.toJSON();
  }

  async listQueues({ organizationId, projectId }) {
    const where = projectId ? { id: projectId, organization_id: organizationId } : { organization_id: organizationId };
    const projects = await Project.findAll({ where, attributes: ['id'] });
    const projectIds = projects.map((p) => p.id);
    if (!projectIds.length) return [];

    const queues = await Queue.findAll({ where: { project_id: { [Op.in]: projectIds } }, order: [['created_at', 'DESC']] });
    const counts = await Job.findAll({
      where: { queue_id: { [Op.in]: queues.map((q) => q.id) } },
      attributes: ['queue_id', 'status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['queue_id', 'status'],
      raw: true,
    });

    const stats = new Map();
    for (const row of counts) {
      if (!stats.has(row.queue_id)) stats.set(row.queue_id, {});
      stats.get(row.queue_id)[row.status] = Number(row.count);
    }

    return queues.map((q) => ({ ...q.toJSON(), stats: stats.get(q.id) ?? {} }));
  }

  async createQueue({ organizationId, data }) {
    const project = await Project.findOne({ where: { id: data.project_id, organization_id: organizationId } });
    if (!project) {
      const err = new Error('Project not found in this organization.');
      err.status = 404;
      err.code = 'PROJECT_NOT_FOUND';
      throw err;
    }
    const queue = await Queue.create({ ...data, slug: data.slug ? slugify(data.slug) : slugify(data.name) });
    return queue.toJSON();
  }

  async updateQueue({ organizationId, queueId, data }) {
    const queue = await this.#findQueue(organizationId, queueId);
    await queue.update(data);
    return queue.toJSON();
  }

  async pauseQueue({ organizationId, queueId, paused }) {
    const queue = await this.#findQueue(organizationId, queueId);
    await queue.update({ is_paused: paused });
    return queue.toJSON();
  }

  async getQueueStats({ organizationId, queueId }) {
    await this.#findQueue(organizationId, queueId);
    const rows = await sequelize.query(`
      SELECT status, COUNT(*) AS count
      FROM jobs
      WHERE queue_id = :queueId
      GROUP BY status
    `, { type: QueryTypes.SELECT, replacements: { queueId } });
    return rows;
  }

  async #findQueue(organizationId, queueId) {
    const queue = await Queue.findOne({
      where: { id: queueId },
      include: [{ association: 'project', required: true, where: { organization_id: organizationId } }],
    });
    if (!queue) {
      const err = new Error('Queue not found in this organization.');
      err.status = 404;
      err.code = 'QUEUE_NOT_FOUND';
      throw err;
    }
    return queue;
  }
}

export const projectQueueService = new ProjectQueueService();

