import { Model, DataTypes } from 'sequelize';

export class DeadLetterQueue extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      original_job_id: { type: DataTypes.UUID, allowNull: false, unique: true },
      queue_id: { type: DataTypes.UUID, allowNull: false },
      project_id: { type: DataTypes.UUID, allowNull: false },
      job_name: { type: DataTypes.STRING(200), allowNull: false },
      payload: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
      last_error_message: { type: DataTypes.TEXT, allowNull: true },
      last_error_stack: { type: DataTypes.TEXT, allowNull: true },
      total_attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      first_attempted_at: { type: DataTypes.DATE, allowNull: true },
      last_attempted_at: { type: DataTypes.DATE, allowNull: true },
      promoted_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      replay_job_id: { type: DataTypes.UUID, allowNull: true },
      replayed_by: { type: DataTypes.UUID, allowNull: true },
      replayed_at: { type: DataTypes.DATE, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
    }, {
      sequelize,
      modelName: 'DeadLetterQueue',
      tableName: 'dead_letter_queue',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'uq_dlq_original_job', unique: true, fields: ['original_job_id'] },
        { name: 'idx_dlq_queue_promoted', fields: ['queue_id', 'promoted_at'] },
        { name: 'idx_dlq_project', fields: ['project_id'] },
      ],
    });
  }
}
