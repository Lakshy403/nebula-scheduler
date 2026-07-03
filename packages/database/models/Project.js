import { Model, DataTypes } from 'sequelize';

export class Project extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      organization_id: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING(160), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.UUID, allowNull: true },
      status: { type: DataTypes.ENUM('ACTIVE', 'ARCHIVED'), allowNull: false, defaultValue: 'ACTIVE' },
    }, {
      sequelize,
      modelName: 'Project',
      tableName: 'projects',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'uq_projects_org_slug', unique: true, fields: ['organization_id', 'slug'] },
        { name: 'idx_projects_org', fields: ['organization_id'] },
      ],
    });
  }
}
