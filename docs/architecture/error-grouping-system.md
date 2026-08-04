# Error Grouping System Architecture

The Error Grouping system is an enterprise-grade observability component built within our modular monolith. It ingests high volumes of incoming errors, groups them intelligently based on similarity, and tracks their lifecycle across versions and releases.

## Core Components

1. **`error_groups` (PostgreSQL Table)**
   Stores the mutable issue record. Uses optimistic locking (`version` field) and supports snapshot fields (e.g., `last_error_message`, `last_trace_id`) and advanced lifecycles (`status`, `is_regression`).
   
2. **`error_group_history` (PostgreSQL Table)**
   Immutable audit log of all lifecycle transitions (RESOLVED, REOPENED, etc.).

3. **`ErrorIngestionService` (Domain Orchestrator)**
   The primary entry point. Designed for strict idempotency and concurrency.
   - Upserts the error group (returns whether it's newly created, and regression status).
   - Inserts the error event with `ON CONFLICT (organization_id, event_id, occurred_at) DO NOTHING`.
   - If the event insert does nothing (duplicate retry), the service explicitly rolls back the transaction to undo the group counter increment, guaranteeing perfectly accurate counts.
   - Publishes specific domain events (`ErrorGroupCreated`, `ErrorOccurred`, `ErrorRegressed`).

4. **`IssueLifecycleService`**
   The sole authority for modifying group statuses (`resolve`, `ignore`, `reopen`, `archive`). Operates inside a transaction block to update `error_groups` and insert a record into `error_group_history` simultaneously, maintaining strict audit compliance.

5. **`WorkerMetrics` (Observability)**
   In-process metrics registry tracking:
   - `ingest_error_groups_created_total`
   - `ingest_error_groups_reused_total`
   - `ingest_error_regressions_total`
   - `ingest_error_duplicates_total`
   - Latencies for lookup, upsert, transaction execution, and domain event dispatch.

## Concurrency & Idempotency Guarantees

- **Atomic UPSERT**: Group lookup and creation happens in a single PostgreSQL statement.
- **Transactional Consistency**: Group bumps and event insertions are tightly coupled. A failure in either rolls back both.
- **Race Condition Safety**: PostgreSQL handles concurrency natively via `ON CONFLICT DO UPDATE`. No distributed locks (e.g., Redis) are necessary.
- **Retry Idempotency**: If the queue retries an event that was already fully processed, the unique constraint catches it. The `DO NOTHING` returns 0 rows, triggering an explicit rollback to prevent artificial counter inflation.
