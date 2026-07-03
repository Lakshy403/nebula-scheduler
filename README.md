# Nebula Scheduler

Nebula Scheduler is a distributed job scheduling platform with:

- JWT auth and tenant-aware APIs
- Projects, queues, jobs, workers, retries, and DLQ handling
- A React dashboard for monitoring and job management

## Frontend Deployment

The dashboard is the frontend app and is ready for Vercel.

1. In Vercel, create a new project from this GitHub repository:
   [Lakshy403/nebula-scheduler](https://github.com/Lakshy403/nebula-scheduler.git)
2. Set the Root Directory to `apps/dashboard`.
3. Keep the build command as `npm run build`.
4. Set the output directory to `dist`.
5. Add `VITE_API_BASE_URL` if your backend is deployed separately.

## Local Development

Install dependencies at the repo root:

```bash
npm install
```

Run the dashboard:

```bash
npm run dev:dashboard
```

Run the backend services:

```bash
npm run dev:api
npm run dev:scheduler
npm run dev:worker
```

## Useful Links

- Dashboard: [http://localhost:8080](http://localhost:8080)
- API health: [http://localhost:3000/health](http://localhost:3000/health)
- Swagger docs: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
