import { Model, DataTypes } from 'sequelize';

export class Queue extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      project_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(160), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      priority: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 5, validate: { min: 1, max: 10 } },
      concurrency_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 5 },
      rate_limit_per_minute: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      is_paused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      default_timeout_seconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 300 },
      default_max_retries: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 3 },
      default_retry_strategy: { type: DataTypes.ENUM('FIXED', 'LINEAR', 'EXPONENTIAL'), allowNull: false, defaultValue: 'EXPONENTIAL' },
      default_retry_backoff_base_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1000 },
    }, {
      sequelize,
      modelName: 'Queue',
      tableName: 'queues',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'uq_queues_project_slug', unique: true, fields: ['project_id', 'slug'] },
        { name: 'idx_queues_project', fields: ['project_id'] },
        { name: 'idx_queues_slug', fields: ['slug'] },
      ],
    });
  }
}
