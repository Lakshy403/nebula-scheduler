# System Architecture Diagram

This document illustrates the high-level system architecture of the Nebula Scheduler.
If you are viewing this on GitHub, the Mermaid diagram will render automatically.

```mermaid
architecture-beta
    group cluster(cloud)[Nebula Scheduler Cluster]

    %% External
    service user(internet)[User / Admin]
    
    %% Frontend
    service dashboard(server)[Dashboard (Vite/React)] in cluster

    %% Backend Services
    service api(server)[REST API (Express)] in cluster
    service scheduler(server)[Cron Scheduler (Node)] in cluster
    service worker1(server)[Worker Node 1] in cluster
    service worker2(server)[Worker Node 2] in cluster
    
    %% Databases
    service mysql(database)[MySQL (State & Jobs)] in cluster
    service redis(database)[Redis (Cache/PubSub)] in cluster

    %% Connections
    user:R --> L:dashboard
    user:R --> L:api
    
    dashboard:R --> L:api
    
    api:B --> T:mysql
    api:B --> T:redis
    
    scheduler:B --> T:mysql
    
    worker1:L --> R:mysql
    worker2:L --> R:mysql
```

## Data Flow Overview

1. **Dashboard & Clients**: Users interact with the React Dashboard (or hit the API directly) to create projects, configure queues, and enqueue jobs.
2. **API Service**: The Express API authenticates requests (via JWT), validates payloads using Zod, and writes Job records to MySQL.
3. **Scheduler Service**: A dedicated background process that wakes up periodically to scan for delayed jobs (`scheduled_at <= NOW()`) or recurring cron jobs. It promotes them from `SCHEDULED` to `QUEUED`.
4. **Worker Nodes**: Horizontally scalable Node.js processes that poll MySQL for `QUEUED` jobs. They use an atomic `UPDATE ... LIMIT` query to claim jobs exclusively, execute the opaque JSON payload, and write the result (Success/Failure) back to the database.
5. **Databases**: 
   - **MySQL** acts as the primary source of truth, utilizing InnoDB row-level locking to handle high-concurrency dispatching. 
   - **Redis** is used for ephemeral state (like caching and rate limiting).
