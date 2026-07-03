# Design Decisions & Trade-offs

This document outlines the major architectural decisions and trade-offs made during the development of Nebula Scheduler.

## 1. Concurrency Control: Atomic SQL Updates vs. Distributed Locks (Redis)
**Decision**: We chose to use MySQL atomic `UPDATE ... LIMIT` statements for job claiming rather than implementing a distributed locking mechanism using Redis (like Redlock).

**Reasoning**:
- **Simplicity & Operational Burden**: Relying on the primary datastore (MySQL) removes the need to maintain state consistency across two different systems. If Redis goes down, workers would fail to lock. 
- **Performance**: While Redis is faster in memory, the atomic SQL `UPDATE jobs SET status = 'RUNNING', worker_id = ? WHERE status = 'QUEUED' LIMIT ?` perfectly leverages InnoDB's row-level locking. Combined with the composite index `idx_jobs_queue_status_created`, this provides extremely high throughput for worker polling without race conditions or duplicate execution.
- **Trade-off**: At massive scale (10,000+ jobs/sec), polling MySQL can cause DB CPU contention. In a hyper-scale scenario, we would move to a push-based pub/sub queue (like RabbitMQ/Kafka), but for a robust scheduler, atomic SQL is highly reliable and easily debuggable.

## 2. Real-time Dashboard: Polling vs. WebSockets
**Decision**: The React Dashboard uses HTTP polling (via React Query) instead of WebSockets.

**Reasoning**:
- **Horizontal Scalability**: WebSockets require sticky sessions or a pub/sub backplane (like Redis PubSub) to sync state across multiple API instances. Polling is stateless, meaning API instances can be scaled horizontally behind a round-robin load balancer immediately.
- **Trade-off**: Polling introduces slight latency (e.g., 2-second delay) and higher network overhead compared to WebSockets. However, for a dashboard observing background tasks, near-real-time (2s delay) is completely acceptable and drastically reduces backend complexity.

## 3. Reliability: The Dead Letter Queue (DLQ) Pattern
**Decision**: Implemented a strict Retry Backoff system paired with a dedicated Dead Letter Queue table.

**Reasoning**:
- Background jobs fail for transient reasons (network timeouts) and deterministic reasons (bad code/payload). 
- If a job hits its `max_retries` (after exhausting exponential backoff), it transitions to `DEAD` and a copy of the payload and fatal error is moved to the `dead_letter_queue` table.
- **Trade-off**: This duplicates data slightly (the original job stays in `jobs` as `DEAD`, and a record goes to `dead_letter_queue`), but it makes the operator's life much easier. They can build a dedicated UI (which we did) to view, debug, and manually re-enqueue permanently failed jobs without cluttering the main operational `jobs` table.

## 4. Multi-Tenant Architecture
**Decision**: Built a nested `Organizations` -> `Projects` -> `Queues` hierarchy.

**Reasoning**:
- Designing for multi-tenancy from Day 1 is significantly easier than retrofitting it later. This allows the platform to act as a SaaS offering or support multiple isolated teams within a single enterprise.
- Everything cascades cleanly via foreign keys, ensuring data integrity if a project or organization is deleted.
