import { Model, DataTypes } from 'sequelize';

export class Organization extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      name: { type: DataTypes.STRING(160), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      plan: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'developer' },
    }, {
      sequelize,
      modelName: 'Organization',
      tableName: 'organizations',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ name: 'idx_organizations_slug', unique: true, fields: ['slug'] }],
    });
  }
}
