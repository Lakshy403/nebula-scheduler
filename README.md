# Nebula Scheduler

A production-ready, distributed background job scheduling platform using a Node.js monorepo architecture.

## How to Run This Project

Because we architected this with Docker and Docker Compose, running this massive distributed system on your local machine is incredibly simple. When you demonstrate this in an interview for a graduate role, being able to spin up a complex microservice architecture with a single command will instantly prove your platform engineering skills.

Here is the exact step-by-step guide to run Nebula Scheduler.

### Prerequisites

Before starting, ensure you have the following installed:
- **Docker Desktop** (Running)
- **Node.js** (v18+)
- **Git**

### Step 1: Clone and Install

First, you'll bring the monorepo down and install the dependencies. Because npm handles monorepo workspaces natively, running install at the root configures everything.

```bash
git clone https://github.com/yourusername/nebula-scheduler.git
cd nebula-scheduler
npm install
```

### Step 2: Configure Environment Variables

You need to set up the configuration for the database and external services. Create a `.env` file at the root of the project.

```bash
cp .env.example .env
```
*(Your `.env.example` will contain default dummy values like `DB_PASSWORD=root` and `REDIS_URL=redis://redis:6379`, which match the Docker Compose setup).*

### Step 3: The Magic Command (Full Cluster Launch)

To spin up the entire production-like cluster—including the MySQL database, Redis lock manager, API server, Scheduler loop, a Worker node, and the React frontend—run:

```bash
docker-compose up --build -d
```

**What happens next?**
- Docker pulls the MySQL and Redis images.
- It builds the lightweight Alpine Node.js images for your API, Worker, and Scheduler.
- It builds the React Vite dashboard and serves it via Nginx.
- The `depends_on` health checks ensure the API and Workers wait patiently until MySQL is fully initialized before attempting to connect.

### Step 4: Access the Platform

Once the terminal output stabilizes, the system is fully operational. Open your browser:

- **Admin Dashboard**: [http://localhost:8080](http://localhost:8080)
- **API Health Check**: [http://localhost:3000/health](http://localhost:3000/health) *(Note: this may be mounted at `/api/v1/metrics/health` depending on your routing).*
- **Interactive Swagger Docs**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)

### Step 5: The "Wow" Factor (Scaling Workers)

To truly demonstrate that this is a distributed system, you can scale the worker nodes horizontally without stopping the cluster. Open a second terminal window and run:

```bash
docker-compose up --scale worker=3 -d
```

You will immediately see three separate Worker containers heartbeat into the MySQL database. When you enqueue a batch of jobs via the dashboard, you can watch the three independent workers utilize the `SKIP LOCKED` SQL mechanism to safely distribute the load without ever executing the same job twice.

---

### Alternative: Local Development Mode

If you are actively coding and don't want to rebuild Docker images every time you change a line of Node.js or React code, you can run just the infrastructure in Docker and the apps locally:

**1. Start only the databases:**
```bash
docker-compose up mysql redis -d
```

**2. Run the API (Terminal 1):**
```bash
npm run dev --workspace=services/api
```

**3. Run the Worker (Terminal 2):**
```bash
npm run dev --workspace=services/worker
```

**4. Run the React Dashboard (Terminal 3):**
```bash
npm run dev --workspace=apps/dashboard
```
