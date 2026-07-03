import { Model, DataTypes } from 'sequelize';

export class User extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true, validate: { isEmail: true } },
      password_hash: { type: DataTypes.STRING(255), allowNull: false },
      display_name: { type: DataTypes.STRING(120), allowNull: false },
      status: { type: DataTypes.ENUM('ACTIVE', 'DISABLED'), allowNull: false, defaultValue: 'ACTIVE' },
      last_login_at: { type: DataTypes.DATE, allowNull: true },
    }, {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ name: 'idx_users_email', unique: true, fields: ['email'] }],
    });
  }
}
