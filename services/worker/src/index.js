import { WorkerService } from './core/Worker.js';
import { connectDB } from '../../../packages/database/index.js';
import logger          from './utils/logger.js';

async function bootstrap() {
  logger.info('Starting Worker Node...');
  await connectDB({ sync: process.env.DB_SYNC === 'true' });
  const queues = (process.env.QUEUES || 'default,high-priority').split(',').map(q => q.trim());
  const worker = new WorkerService({ queueSlugs: queues });
  await worker.start();
}

bootstrap().catch(err => {
  logger.error('Worker failed to start', { error: err });
  process.exit(1);
});

