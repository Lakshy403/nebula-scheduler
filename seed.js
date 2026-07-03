import { authService } from './services/api/services/AuthService.js';
import { connectDB, sequelize } from './packages/database/index.js';

async function seed() {
  try {
    await connectDB({ force: false, sync: false });
    console.log('DB Connected');
    const user = await authService.register({
      email: 'admin@nebula.com',
      password: 'password123',
      displayName: 'Nebula Admin',
      organizationName: 'Nebula Corp'
    });
    console.log('Successfully registered user:', user.email);
  } catch (err) {
    console.error('Error seeding:', err);
  } finally {
    await sequelize.close();
  }
}
seed();
