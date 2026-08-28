# Ingestion database, indexes, and trigger contract

## Database authority

| Classification | Authority | Evidence |
| --- | --- | --- |
| **MEASURED** | Log DB migrations | `database/migrations/logdb`, discovered by `src/shared/logdb/migrations.ts`. |
| **MEASURED** | Log DB ledger | `logdb_migrations(filename, applied_at, duration_ms)`. |
| **MEASURED** | Log DB runner | `npm run db:migrate:logdb`; requires `LOG_DB_PRIMARY`, excludes `.down.sql`, and uses one fail-fast advisory-locked session. |
| **MEASURED** | Log DB rollback tool | `npx tsx scripts/logdb-rollback.ts <relative.down.sql>`; operator controlled, excluded from forward discovery, and serialized with the same advisory lock. |
| **UNKNOWN** | Primary/control-plane canonical migration root for proposed new work | Tooling references canonical/draft profiles, but the expected canonical source directories were absent during the forensic audit. `primary_db_draft` material is not proven live-upgrade authority. |

## Migration command coordination and dry-run effects

| Classification | Behavior | Contract |
| --- | --- | --- |
| **MEASURED** | Shared key | Forward `applyLogDbMigrations()` and `logdb-rollback.ts` call `acquireLogDbMigrationLock()` on the same exported key using the same checked-out client they retain through execution. |
| **MEASURED** | Fail-fast acquisition | The helper uses `SELECT pg_try_advisory_lock($1)`. Contention throws `Another Log DB migration or rollback already holds the migration lock`; it does not wait. |
| **MEASURED** | Release | Each command releases only after a successful acquisition and releases from `finally`; session termination is PostgreSQL's final lock cleanup. |
| **MEASURED** | Forward dry-run | File discovery/filtering occurs, then the runner acquires the lock, may execute `CREATE TABLE IF NOT EXISTS logdb_migrations`, and queries the ledger for each selected migration. It skips migration-file SQL, duplicate scans, drain assertions, index DDL, and ledger inserts. |
| **MEASURED** | Rollback dry-run | The tool reads the selected down file, acquires the same lock, and queries `current_database()` for target display. It does not execute the down SQL. It does not itself create/query the migration ledger outside that down SQL. |
| **MEASURED** | Migration-local timeout scope | Migration 030's `SET LOCAL lock_timeout='5s'` begins only when migration SQL runs. It does not apply to file discovery, client checkout, shared lock acquisition, ledger DDL, or ledger reads. |
| **UNVERIFIED** | Concurrent-command rehearsal | Granted/denied lock behavior and rollback source wiring have focused coverage, but concurrent forward/rollback commands were not exercised against a production-sized clone. |

**DERIVED:** The repository commands cannot interleave migration SQL and ledger mutation while both honor the shared lock. An operator can still bypass this protection with direct SQL or other tooling; operational access controls must prohibit that during the window.

## Typed table catalog

| Classification | Parent | Default partition | Existing repository identity guard |
| --- | --- | --- | --- |
| **MEASURED** | `events_requests` | `events_requests_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_errors` | `events_errors_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_logs` | `events_logs_default` | migration 030 proposes unique `(organization_id, project_id, environment, event_id, occurred_at)` |
| **MEASURED** | `events_metrics` | `events_metrics_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_spans` | `events_spans_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_traces` | `events_traces_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_messages` | `events_messages_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_profiles` | `events_profiles_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_replays` | `events_replays_default` | unique `(organization_id, event_id, occurred_at)` |
| **MEASURED** | `events_cron_checkins` | `events_cron_checkins_default` | unique `(organization_id, event_id, occurred_at)` |

**MEASURED:** Every typed parent is range-partitioned by `occurred_at`. PostgreSQL partitioned unique indexes therefore include that partition key.

**MEASURED:** The schema snapshot contained only one `_default` child for each typed parent and for `telemetry_outbox`; no bounded dated leaves were present at capture time.

**UNKNOWN:** Current partition topology may have changed and must be re-enumerated before DDL.

## Log identity change

| Classification | Item | Detail |
| --- | --- | --- |
| **MEASURED** | Existing lookup index | `idx_events_logs_event` is non-unique and remains in place. |
| **MEASURED** | New guard | `idx_events_logs_event_unique` on `(organization_id, project_id, environment, event_id, occurred_at)`. |
| **DERIVED** | Scope reason | Project and environment prevent a valid SDK ID/timestamp in another stream from being silently suppressed. `occurred_at` is required by partitioned uniqueness. |
| **MEASURED** | Forward safety | Five-second relation-lock wait, populated-table drain assertion, exact five-column duplicate preflight, SQLSTATE `55000`/`23505`, no telemetry deletion. |
| **MEASURED** | Command serialization | Forward and rollback commands use the shared fail-fast advisory lock before migration or down SQL. |
| **MEASURED** | Rollback safety | Same drain gate; drops only the new index and exact ledger row; retains the old lookup index and telemetry. |
| **UNKNOWN** | Corrected five-column duplicate groups/surplus rows | Not measured. |

### Duplicate evidence must not be conflated

| Classification | Grouping | Result | Use |
| --- | --- | --- | --- |
| **MEASURED** | Broad `(organization_id, event_id, occurred_at)` | 643 groups and 5,057 surplus rows in a direct forensic query. | Historical collision signal only. It can combine distinct projects/environments. |
| **UNKNOWN** | Corrected `(organization_id, project_id, environment, event_id, occurred_at)` | Unknown. | Mandatory migration preflight; do not substitute broad numbers. |

**MEASURED:** No duplicate row was automatically deleted or merged.

**UNKNOWN:** The broad 643/5,057 query output is recorded in the forensic session summary but not persisted in the three checked-in JSON artifacts; re-run both grouped query and provenance capture before rollout.

## Nullable project caveat

**MEASURED:** The repository schema defines `events_logs.project_id` as nullable, while the active writer supplies a resolved project ID.

**DERIVED:** A normal PostgreSQL unique index treats NULL values as distinct. The five-column index does not prevent future direct-SQL duplicate rows with `project_id IS NULL`.

**UNKNOWN:** Current count of null-project log rows is not known.

**UNVERIFIED:** A future `NOT NULL`, `NULLS NOT DISTINCT`, or partial policy requires separate compatibility and live-data evidence; migration 030 intentionally does not add one.

## Public IDs: preserve the entire contract

| Classification | Object | Contract |
| --- | --- | --- |
| **MEASURED** | Sequences/prefixes | request `REQ-`, error `ERR-`, issue `ISS-`, trace `TRC-`, span `SPN-`, log `LOG-`, metric `MTR-`, message `MSG-`, replay `RPL-`, profile `PRF-`, cron `CRN-`, session `SES-`. |
| **MEASURED** | Column defaults | Generate public IDs when omitted/defaulted. |
| **MEASURED** | `logdb_sync_typed_event_contract()` | Normalizes timestamps, metadata environment, missing/empty public ID, and payload fallback. |
| **MEASURED** | `trg_sync_typed_event_contract` | `BEFORE INSERT OR UPDATE` on all ten typed tables. |
| **MEASURED** | Lookup indexes | Non-unique public-ID lookup indexes are retained. |
| **DERIVED** | Sequence gaps | Conflict/rollback can consume sequence values; public IDs are stable lookup IDs, not gapless counters. |

**MEASURED:** The trigger is not redundant with sequence defaults. It also protects explicit NULL/empty input and enforces metadata/timestamp/payload behavior.

## Transactional outbox

| Classification | Object | Behavior |
| --- | --- | --- |
| **MEASURED** | `telemetry_outbox` | Range-partitioned by `created_at`; default partition exists. |
| **MEASURED** | `uq_telemetry_outbox_idem` | Unique `(organization_id, signal_kind, event_id, created_at)`. |
| **MEASURED** | Claim indexes | Partial unpublished and claimed-recovery indexes. |
| **MEASURED** | Cross-time reservation | `alert_runtime_idempotency_keys` namespace/key authority prevents replay across `created_at`. |
| **MEASURED** | Transaction | Typed telemetry and outbox use the same Log DB transaction. |

## Index-removal history and current disposition

| Classification | Decision/history |
| --- | --- |
| **MEASURED** | Canonical prior-phase migrations contain 24 index drops: 4 in `025_request_ingestion_hot_path.sql`, 10 in `028_request_ingestion_minimal_indexes.sql`, and 10 in `029_span_log_ingestion_hot_path.sql`. |
| **MEASURED** | By relation, those prior drops cover 14 `events_requests`, 4 `events_spans`, and 6 `events_logs` indexes. `schema-audit-before.json` records the named indexes as prior-phase removals and `confirmed_absent`. |
| **MEASURED** | This forensic session authorized no additional index removal and did not execute any removal. It does not retroactively re-authorize or validate the historical decisions. |
| **MEASURED** | `schema-audit-before.json` reports `statsResetAt: null`; the current usage-window start is unknown. |
| **DERIVED** | An `idx_scan=0` value without an observation window, query-path proof, and insert-cost comparison is insufficient for any additional removal. |
| **MEASURED** | `idx_events_logs_event` is explicitly retained by migration 030. |

## Current forensic addendum

### Exact duplicate/semantic index findings

**MEASURED:** six exact catalog signature pairs were recorded: `error_group_history` group/time; `events_errors` org/project/environment/time; `events_logs` same; `events_messages` org/project/time; partial `events_spans` db-system/time; and `events_traces` org/project/time. Semantic overlap also exists for `error_groups` project/fingerprint non-unique versus unique indexes and status-seen v1 versus v2.

**MEASURED:** no pair was removed. **UNVERIFIED:** a full A–F classification over a bounded usage window was not completed.

### Public-ID evaluation order

**MEASURED:** all ten typed parents and `error_groups` had NOT NULL sequence-backed defaults; audited sequences used `CACHE 1` and were not `OWNED BY` their columns. Defaults execute before BEFORE triggers. An ordinary omitted-ID insert consumes one default `nextval`; the trigger sees the value and skips another. The trigger remains load-bearing for explicit NULL/empty IDs and repair fields. Trigger time and sequence contention are **UNKNOWN**.

### Partition/maintenance state

**MEASURED:** recorded default partitions contained data. `TelemetryMaintenanceWorker` uses the Primary DB and legacy unprefixed relation names while active telemetry is in Log DB `events_*` tables. No live maintenance correction or partition rollout was performed; blind retention/partition DDL is unsafe.

## Migration 030 deployment state

| Classification | State |
| --- | --- |
| **MEASURED** | Up/down SQL, shared lock helpers, rollback wiring, and contract tests exist in the working tree. |
| **MEASURED** | Static/focused tests assert five-column scope, relation-lock timeout, drain setting, SQLSTATEs, no telemetry deletion, narrow rollback, shared granted/denied lock behavior, and rollback helper wiring. |
| **UNKNOWN** | Live ledger state and deployed index state. |
| **UNVERIFIED** | Actual lock acquisition/build time, concurrent command behavior, and rollback on a production-sized clone. |

See [../live-db-rollout/events-logs-identity.md](../live-db-rollout/events-logs-identity.md) for the gated procedure.

## Phase-20 expanded documentation

This document is the canonical schema snapshot. The following Phase-20 documents provide expanded analysis of specific aspects:

| Document | Scope |
| --- | --- |
| [database-architecture.md](database-architecture.md) | Physical topology, partition structure, migration authority |
| [connection-pools.md](connection-pools.md) | Pool sizing, write admission, `pg_cancel_backend` safety |
| [transaction-model.md](transaction-model.md) | Transaction ordering, ACK boundaries, outbox atomicity, billing loss windows |
| [index-forensics.md](index-forensics.md) | Index state, prior removals, deferral rationale, authorization criteria |
| [trigger-forensics.md](trigger-forensics.md) | Trigger contract, function behavior, write-path interaction |
| [public-id-generation.md](public-id-generation.md) | Sequence/prefix catalog, generation layers, gap behavior |
| [query-inventory.md](query-inventory.md) | Per-path SQL statement catalog and scaling formulas |
| [query-optimization.md](query-optimization.md) | Bottleneck ranking, optimization candidates, WAL pressure |
| [neon-capacity.md](neon-capacity.md) | Provider capacity, uncertainty register, maintenance limitations |
