import { Model, DataTypes } from 'sequelize';

export class Worker extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      project_id: { type: DataTypes.UUID, allowNull: true },
      hostname: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      ip_address: { type: DataTypes.STRING(64), allowNull: true },
      version: { type: DataTypes.STRING(50), allowNull: true },
      status: { type: DataTypes.ENUM('IDLE', 'BUSY', 'DRAINING', 'OFFLINE'), allowNull: false, defaultValue: 'IDLE' },
      queues: { type: DataTypes.JSON, allowNull: true },
      last_heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      current_memory_mb: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      active_jobs: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      deregistered_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      sequelize,
      modelName: 'Worker',
      tableName: 'workers',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'idx_workers_status_heartbeat', fields: ['status', 'last_heartbeat_at'] },
        { name: 'idx_workers_project', fields: ['project_id'] },
      ],
    });
  }
}
