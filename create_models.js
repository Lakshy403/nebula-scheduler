import fs from 'fs';

const dummyTemplate = (name) => `
import { Model, DataTypes } from 'sequelize';
export class ${name} extends Model {
  static initialize(sequelize) {
    this.init({ id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 } }, { sequelize, modelName: '${name}', tableName: '${name.toLowerCase()}s' });
  }
}
`;

const workerTemplate = `
import { Model, DataTypes } from 'sequelize';
export class Worker extends Model {
  static initialize(sequelize) {
    this.init({
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      hostname: { type: DataTypes.STRING, unique: true },
      ip_address: { type: DataTypes.STRING },
      version: { type: DataTypes.STRING },
      status: { type: DataTypes.STRING },
      last_heartbeat_at: { type: DataTypes.DATE },
      current_memory_mb: { type: DataTypes.INTEGER },
      deregistered_at: { type: DataTypes.DATE }
    }, { sequelize, modelName: 'Worker', tableName: 'workers' });
  }
}
`;

const models = ['User', 'Organization', 'OrganizationMember', 'Project', 'Queue', 'JobExecution', 'DeadLetterQueue'];

models.forEach(m => fs.writeFileSync('packages/database/models/' + m + '.js', dummyTemplate(m)));
fs.writeFileSync('packages/database/models/Worker.js', workerTemplate);
