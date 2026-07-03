import { Model, DataTypes } from 'sequelize';

export class JobExecution extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      job_id: { type: DataTypes.UUID, allowNull: false },
      worker_id: { type: DataTypes.UUID, allowNull: true },
      attempt_number: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.ENUM('CLAIMED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'), allowNull: false, defaultValue: 'RUNNING' },
      started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      duration_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      output: { type: DataTypes.JSON, allowNull: true },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      error_stack: { type: DataTypes.TEXT, allowNull: true },
      metrics: { type: DataTypes.JSON, allowNull: true },
    }, {
      sequelize,
      modelName: 'JobExecution',
      tableName: 'job_executions',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_job_exec_job_attempt', fields: ['job_id', 'attempt_number'] },
        { name: 'idx_job_exec_worker', fields: ['worker_id'] },
        { name: 'idx_job_exec_status_started', fields: ['status', 'started_at'] },
      ],
    });
  }
}
