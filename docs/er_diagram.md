# Entity Relationship (ER) Diagram

This document contains the Entity Relationship diagram for the Nebula Scheduler.
If you are viewing this on GitHub, the Mermaid diagram will render automatically.

```mermaid
erDiagram
    %% Core Multi-Tenancy
    USER ||--o{ ORGANIZATION_MEMBER : "has"
    USER ||--o{ PROJECT : "creates"
    ORGANIZATION ||--o{ ORGANIZATION_MEMBER : "has"
    ORGANIZATION ||--o{ PROJECT : "owns"
    
    %% Queues & Workers
    PROJECT ||--o{ QUEUE : "contains"
    WORKER ||--o{ JOB : "claims & executes"

    %% Job Lifecycle
    QUEUE ||--o{ JOB : "manages"
    JOB ||--o{ JOB_EXECUTION : "logs attempts in"
    JOB ||--o| DEAD_LETTER_QUEUE : "moves to (on fatal error)"
    JOB ||--o{ JOB : "parent of (dependencies)"
    USER ||--o{ JOB : "enqueues"

    USER {
        uuid id PK
        string email
        string password_hash
        datetime created_at
    }

    ORGANIZATION {
        uuid id PK
        string name
        string slug
    }

    ORGANIZATION_MEMBER {
        uuid id PK
        uuid user_id FK
        uuid organization_id FK
        string role "OWNER | MEMBER"
    }

    PROJECT {
        uuid id PK
        uuid organization_id FK
        string name
        string slug
    }

    QUEUE {
        uuid id PK
        uuid project_id FK
        string name
        string slug
        int priority
        int concurrency_limit
        int rate_limit_per_minute
        boolean is_paused
        int default_max_retries
        string default_retry_strategy "FIXED | LINEAR | EXPONENTIAL"
    }

    WORKER {
        uuid id PK
        string hostname
        string status "ACTIVE | DRAINING | OFFLINE"
        datetime last_heartbeat
    }

    JOB {
        uuid id PK
        uuid queue_id FK
        uuid worker_id FK
        uuid parent_job_id FK
        uuid created_by FK
        string name
        json payload
        string status "PENDING | QUEUED | RUNNING | SUCCEEDED | FAILED | DEAD"
        string cron_expression
        datetime scheduled_at
        int priority
        int retry_count
        int max_retries
        string retry_strategy
    }

    JOB_EXECUTION {
        uuid id PK
        uuid job_id FK
        uuid worker_id FK
        int attempt_number
        string status "RUNNING | SUCCEEDED | FAILED"
        text error_message
        text stack_trace
        datetime started_at
        datetime completed_at
    }

    DEAD_LETTER_QUEUE {
        uuid id PK
        uuid job_id FK
        string original_queue
        json job_payload
        text fatal_error
        datetime moved_at
    }
```
