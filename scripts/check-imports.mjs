process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
await import('../services/api/app.js');
await import('../services/worker/src/executor/JobExecutor.js');
await import('../services/scheduler/src/promoter/PromotionService.js');
console.log('imports ok');
