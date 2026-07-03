# API Documentation

The Nebula Scheduler provides a robust RESTful API built with Express and validated using Zod. All endpoints return a structured JSON response.

## Base URL
Local environment: `http://localhost:3000/api/v1`

## Authentication
Most endpoints require a JWT token passed in the `Authorization` header.
`Authorization: Bearer <token>`

---

## 1. Authentication
### `POST /auth/login`
Authenticates a user and returns a JWT token.
- **Request Body**:
  ```json
  {
    "email": "admin@nebula.com",
    "password": "password123"
  }
  ```
- **Response** (200 OK):
  ```json
  {
    "token": "eyJhb...",
    "user": {
      "id": "uuid",
      "email": "admin@nebula.com"
    }
  }
  ```

---

## 2. Queues
### `GET /queues`
Returns a list of all queues the user has access to.
- **Response** (200 OK):
  ```json
  [
    {
      "id": "uuid",
      "slug": "default",
      "concurrency_limit": 5,
      "rate_limit_per_minute": null
    }
  ]
  ```

---

## 3. Jobs
### `POST /jobs`
Enqueues a new job into a specific queue.
- **Request Body**:
  ```json
  {
    "queue_id": "uuid",
    "name": "data-export",
    "payload": { "table": "users" },
    "priority": 5,
    "max_retries": 3,
    "retry_strategy": "EXPONENTIAL",
    "retry_backoff_base_ms": 1000,
    "scheduled_at": "2026-07-03T12:00:00Z" // Optional
  }
  ```

### `GET /jobs`
Lists jobs with pagination and optional status filtering.
- **Query Params**: `?status=FAILED&cursor=uuid`
- **Response** (200 OK):
  ```json
  {
    "data": [...jobs],
    "hasMore": true,
    "nextCursor": "uuid"
  }
  ```

### `POST /jobs/:id/retry`
Manually moves a `FAILED` or `CANCELLED` job back to `QUEUED`.
- **Response** (200 OK): `{ "success": true }`

### `POST /jobs/:id/cancel`
Cancels a `PENDING`, `SCHEDULED`, or `QUEUED` job.
- **Response** (200 OK): `{ "success": true }`

---

## 4. Metrics & Workers
### `GET /metrics/throughput`
Returns historical job throughput for dashboard charts.
- **Query Params**: `?timeframe=24h` (Accepts `1h`, `24h`, `7d`)

### `GET /workers`
Lists all active workers that have sent a heartbeat recently.
