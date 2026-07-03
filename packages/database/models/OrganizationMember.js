import { Model, DataTypes } from 'sequelize';

export class OrganizationMember extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      organization_id: { type: DataTypes.UUID, allowNull: false },
      user_id: { type: DataTypes.UUID, allowNull: false },
      role: { type: DataTypes.ENUM('OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER'), allowNull: false, defaultValue: 'OWNER' },
      invited_by: { type: DataTypes.UUID, allowNull: true },
      joined_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      sequelize,
      modelName: 'OrganizationMember',
      tableName: 'organization_members',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'uq_org_members_user', unique: true, fields: ['organization_id', 'user_id'] },
        { name: 'idx_org_members_user', fields: ['user_id'] },
      ],
    });
  }
}
