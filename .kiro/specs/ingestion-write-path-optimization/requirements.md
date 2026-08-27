# Requirements Document

## Introduction

Phase 1 of the ingestion optimization program (recorded in `docs/ingestion-performance-forensics.md`) removed five structural defects from the telemetry write path: connection oversubscription, unbounded ingest transactions, an unpruned queue-depth probe, non-deterministic `error_groups` lock ordering, and duplicate-driven outbox write amplification. Those protections are now load-bearing and must survive this phase.

Phase 2, defined by `planning/ginindexing.md`, addresses what remains: the PostgreSQL write-path cost itself. The work is a forensics-then-implementation cycle. Every database object touched during ingestion — index, GIN/JSONB index, trigger, sequence, column default, generated column, constraint — must be inventoried, justified against a real read path, and assigned an explicit disposition before any change is made. Batch sizing, transaction shape, WAL/COMMIT cost, storage bloat, cross-signal interference, tenant fairness, memory bounds, and write amplification must be measured rather than assumed.

The repository already carries partial Phase 2 work: `025_request_ingestion_hot_path.sql`, `028_request_ingestion_minimal_indexes.sql`, and `029_span_log_ingestion_hot_path.sql` removed GIN and dashboard indexes from `events_requests`, `events_spans`, and `events_logs`; `026_fast_typed_event_contract.sql` reduced per-row trigger work; and `ErrorGroupRepository.upsertGroupsBatch` is already set-based. This spec therefore requires verification of the current state before remediation, so that already-solved problems are recorded as falsified rather than re-implemented.

Schema and index changes ship as new numbered migration files under `database/migrations/logdb/`, with the corresponding base schema files updated so a freshly created database converges to the same state as a migrated one.

The single non-negotiable output rule: no reported measurement may be invented. Where a measurement cannot be executed, the report states so explicitly.

## Glossary

- **Log_DB**: The independent PostgreSQL telemetry database defined by `database/migrations/logdb/`, reached through `LOG_DB_PRIMARY`.
- **Ingestion_Pipeline**: The end-to-end telemetry write path from the ingestion HTTP endpoint through pg-boss to a committed Log_DB transaction, comprising `src/modules/ingestion/` and `src/shared/workers/ingestion-worker-main.ts`.
- **Signal_Type**: One of the ten SDK event types processed by the Ingestion_Pipeline: request, error, trace, span, log, metric, message, replay, profile, cron_checkin.
- **Canonical_Event_Table**: One of `events_requests`, `events_errors`, `events_traces`, `events_spans`, `events_logs`, `events_metrics`, `events_messages`, `events_replays`, `events_profiles`, `events_cron_checkins`.
- **Ingestion_Table_Set**: Every Canonical_Event_Table plus `error_groups`, `error_group_history`, `analytics_error_groups`, `telemetry_outbox`, `events_errors_idempotency`, and `alert_runtime_idempotency_keys`.
- **Event_Processor**: The batch job handler at `src/modules/ingestion/workers/event-processor.ts`.
- **Telemetry_Writer**: The typed multi-row insert component at `src/modules/ingestion/pipeline/telemetry-writer.ts`.
- **Write_Admission_Controller**: The FIFO admission semaphore at `src/modules/ingestion/pipeline/write-admission.ts`.
- **Error_Group_Repository**: The error grouping repository at `src/modules/errors/repositories/error-group.repository.ts`.
- **Phase_1_Protections**: The write-admission semaphore, the dedicated ingestion write pool, the ingest `statement_timeout` and its boot-time ordering assertion, the partition-prunable cached queue-depth probe, the deterministic `error_groups` lock ordering, the duplicate-event outbox suppression, the memoized error fingerprint, the bounded in-flight memory limits, and the tenant fairness gate.
- **Write_Path_Map**: The documented per-Signal_Type sequence of pipeline stages and database operations, classifying each operation as per-event or per-batch.
- **Index_Inventory**: The recorded set of every index on the Ingestion_Table_Set together with its properties, justification, and Index_Disposition.
- **Index_Disposition**: Exactly one of `KEEP`, `REPLACE`, `NARROW`, `PARTIAL`, `MOVE_TO_DERIVED`, `REMOVE`.
- **Trigger_Inventory**: The recorded set of every trigger on the Ingestion_Table_Set together with its timing, firing granularity, and per-row work.
- **Public_ID_Contract**: The guarantee that every row in every Canonical_Event_Table, in `error_groups`, and in `analytics_error_groups` carries a non-empty, sequence-derived, prefixed `public_id` value.
- **Baseline_Record**: The set of measurements captured before any Phase 2 source, schema, or configuration modification.
- **Evidence_Record**: The set of measurements, plans, catalog readings, and statement counts cited by the Forensic_Report.
- **Benchmark_Matrix**: The measurement run produced by `scripts/run-ingestion-benchmark-matrix.ts` across the defined Workload_Classes.
- **Workload_Class**: One of small batch, medium batch, large batch, mixed signal, duplicate-heavy, error-heavy, trace-and-span-heavy, multi-tenant, sustained high volume.
- **Phase_2_Change_Set**: The complete set of source, schema, and configuration modifications delivered by this spec.
- **Schema_Change_Set**: The new `.sql` migration files under `database/migrations/logdb/` delivered by the Phase_2_Change_Set, together with the corresponding Base_Schema_File updates.
- **Base_Schema_File**: An existing applied migration file that defines the create-time state of a table, index, trigger, or function.
- **Regression_Suite**: The tests executed by `npm run test` and `npm run test:integration`.
- **Forensic_Report**: The Phase 2 deliverable document at `docs/ingestion-write-path-optimization.md`.
- **Unmeasured_Declaration**: The exact sentence `Runtime throughput could not be measured.`

## Requirements

### Requirement 1: Baseline Evidence Capture

**User Story:** As a performance engineer, I want a recorded pre-change baseline, so that every later claim of improvement is checkable against a measurement taken before the change.

#### Acceptance Criteria

1. THE Baseline_Record SHALL contain, for each of the ten Signal_Types, measured values for events per second, and for batch transaction duration, INSERT duration, COMMIT duration, database connection checkout wait, and queue wait each recorded in milliseconds at p50, p95, and p99.
2. THE Baseline_Record SHALL record, for each measured value, the executed command, the target environment identified as a staging or benchmark environment, the ISO 8601 UTC timestamp of the run, and the Git commit identifier of the measured working tree.
3. IF the Log_DB accepts connections, THEN THE Baseline_Record SHALL derive measurements from the existing harnesses `npm run bench:ingestion:matrix`, `npm run ingestion:db:audit`, `npm run ingestion:db:runtime`, and `npm run explain:ingestion`.
4. THE Baseline_Record SHALL contain only measurements whose recorded UTC timestamp precedes the first modification to any file under `src/modules/ingestion/`, `src/modules/errors/`, `database/migrations/logdb/`, or `src/config/env.ts`.
5. IF the Log_DB refuses connections on 3 consecutive attempts each bounded by a 10 second connection timeout, THEN THE Baseline_Record SHALL state the Unmeasured_Declaration for each affected metric and SHALL record the connection failure reason.
6. IF `pg_stat_statements` is absent from the measured environment, THEN THE Baseline_Record SHALL record the absence and SHALL substitute `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` output as the statement-cost evidence source.
7. THE Baseline_Record SHALL derive each recorded value from at least 3 measurement runs of at least 60 seconds of sustained ingestion each, and SHALL record the median across those runs together with the minimum and maximum observed run value.
8. IF a baseline harness exits with a non-zero status, or a Signal_Type produces zero ingested events across every measurement run, THEN THE Baseline_Record SHALL state the Unmeasured_Declaration for each affected metric of that Signal_Type and SHALL record the failing command together with its reported failure reason.

### Requirement 2: Write-Path Map Per Signal Type

**User Story:** As a performance engineer, I want a per-signal map of the write path, so that hidden per-event database work becomes visible instead of inferred.

#### Acceptance Criteria

1. THE Forensic_Report SHALL contain the Write_Path_Map documenting, for each of the ten Signal_Types, the ordered stages from ingestion endpoint through queue insert, worker claim, batch assembly, validation, normalization, connection acquisition, `BEGIN`, SQL statements, outbox insert, `COMMIT`, and job acknowledgement.
2. THE Write_Path_Map SHALL classify every database operation on every documented path, including every `SELECT`, `INSERT`, `UPDATE`, `DELETE`, advisory lock acquisition, `BEGIN`, and `COMMIT`, as exactly one of per-event or per-batch.
3. THE Write_Path_Map SHALL list, for one inserted row on each Canonical_Event_Table, every index maintained, every trigger fired, every column default evaluated, every generated column computed, and every constraint checked, derived from Log_DB catalog readings recorded in the Evidence_Record.
4. THE Write_Path_Map SHALL state, for each Signal_Type, the SQL statement count for a batch of N events as a closed-form function of N.
5. IF a database operation executes once per event where one statement per batch is achievable, THEN THE Write_Path_Map SHALL record the operation as a remediation candidate together with the source file path and line range of the calling code, the observed per-event statement count, and the achievable per-batch statement count.
6. Each stage recorded in the Write_Path_Map SHALL carry the source file path and line range of the code that implements that stage.
7. THE Evidence_Record SHALL record the observed SQL statement count per batch for each Signal_Type at batch sizes 1, 10, 50, and 200, and the function stated by criterion 4 SHALL reproduce each recorded count.
8. IF a Signal_Type has no implemented processing path in the Ingestion_Pipeline, THEN THE Write_Path_Map SHALL record that Signal_Type as unimplemented and SHALL record the stages absent from its path.

### Requirement 3: Connection Pool and Write-Admission Verification

**User Story:** As a performance engineer, I want proof of whether connection starvation still exists, so that effort is not spent tuning connections when the cost has moved into PostgreSQL.

#### Acceptance Criteria

1. WHILE the Benchmark_Matrix executes the sustained high volume Workload_Class for at least 300 seconds, THE Evidence_Record SHALL record, sampled at least once per second and reported per Signal_Type, telemetry write pool maximum as a connection count, active connection count, idle connection count, connection checkout wait at p50, p95 and p99 in milliseconds, batch transaction duration at p50, p95 and p99 in milliseconds, worker concurrency as a job count, write-admission permits as a permit count, and queue depth as a job count.
2. IF measured connection checkout wait at p95 for a Signal_Type falls below 5 milliseconds while measured batch transaction duration at p95 for the same Signal_Type stays at or above the Baseline_Record batch transaction duration at p95 for that Signal_Type, THEN THE Forensic_Report SHALL record connection starvation as absent for that Signal_Type and SHALL cite the sampled checkout-wait and batch-duration values as the supporting evidence.
3. THE Phase_2_Change_Set SHALL preserve the FIFO waiter ordering, the derivation of permits from the live pool maximum, and the release-on-throw behaviour of the Write_Admission_Controller, and THE Regression_Suite SHALL assert each of those three behaviours.
4. THE Phase_2_Change_Set SHALL preserve acquisition of every ingest write transaction connection from the dedicated ingestion write pool sized by `INGESTION_WRITE_POOL_SIZE`, and THE Regression_Suite SHALL assert that the concurrent ingest write connection count never exceeds the configured `INGESTION_WRITE_POOL_SIZE` value.
5. IF `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` is greater than or equal to `INGESTION_JOB_EXPIRE_SECONDS` expressed in milliseconds at process boot, THEN THE Ingestion_Pipeline SHALL terminate before claiming any job and SHALL emit an error indicating that the statement timeout must be lower than the job expiry.
6. IF the Phase_2_Change_Set raises `INGESTION_WRITE_POOL_SIZE`, `INGESTION_WRITE_CONCURRENCY`, `INGESTION_GENERAL_CONCURRENCY`, or `INGESTION_SPECIALIZED_CONCURRENCY`, THEN THE Evidence_Record SHALL record database CPU utilization as a percentage, database resident memory in megabytes, and database backend count, each measured under the sustained high volume Workload_Class at the pre-increase value and at the raised value.
7. IF measured connection checkout wait at p95 for a Signal_Type is at or above 5 milliseconds, THEN THE Forensic_Report SHALL record connection starvation as present for that Signal_Type, SHALL cite the sampled checkout-wait values, and SHALL rank the corresponding remediation as P1 under Requirement 22.
8. IF THE Forensic_Report records connection starvation as absent for all ten Signal_Types, THEN THE Forensic_Report SHALL direct remaining investigation to PostgreSQL execution and write cost.
9. IF the Phase_2_Change_Set raises `INGESTION_WRITE_POOL_SIZE`, `INGESTION_WRITE_CONCURRENCY`, `INGESTION_GENERAL_CONCURRENCY`, or `INGESTION_SPECIALIZED_CONCURRENCY`, THEN THE Phase_2_Change_Set SHALL keep measured database backend count at or below 80 percent of the Log_DB configured connection limit and measured database CPU utilization at or below 80 percent under the sustained high volume Workload_Class.

### Requirement 4: Index Inventory and Disposition

**User Story:** As a performance engineer, I want every ingestion-path index justified against a real read path, so that index maintenance cost is paid only where a query benefits.

#### Acceptance Criteria

1. THE Index_Inventory SHALL contain one entry for every index on every table in the Ingestion_Table_Set, enumerated from a Log_DB catalog reading produced by `npm run ingestion:db:audit`, and SHALL record the UTC timestamp of that reading, the total index count returned by it, and one entry per parent-level index for each partitioned table together with the count of attached partition indexes.
2. Each Index_Inventory entry SHALL record table name, index name, access method, indexed columns or expression in declared order, partial predicate or the explicit value `NONE` where no predicate exists, size in bytes summed across the parent index and every attached partition index, uniqueness, and read-usage count expressed as an index scan count.
3. Each Index_Inventory entry SHALL record the read-usage observation window as the UTC timestamp of the last statistics reset and the UTC timestamp of the reading, where the window spans at least 24 hours or one complete Benchmark_Matrix run, whichever is longer.
4. Each Index_Inventory entry SHALL record one or more of the values uniqueness enforcement, idempotency, or named production query, or SHALL record the value `NONE` where the entry serves none of them.
5. WHERE an Index_Inventory entry is required for a named production query, THE Index_Inventory SHALL record the source file path and line range of the query, the plan node type that uses the index, and the index name as it appears in the `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` output cited by the Evidence_Record.
6. Each Index_Inventory entry SHALL carry exactly one Index_Disposition value, and each entry carrying an Index_Disposition value other than `KEEP` SHALL record the replacement, narrowed, partial, or derived definition that supersedes the index.
7. THE Index_Inventory SHALL record every pair of indexes on the same table where the indexed column list of one index is an ordered leading prefix of the indexed column list of the other, both indexes share the same access method, and both carry the same partial predicate or no partial predicate, and SHALL record the Index_Disposition value assigned to each index in the pair.
8. IF an Index_Inventory entry carries Index_Disposition `REMOVE`, THEN THE Evidence_Record SHALL contain a read-usage count of zero over the recorded observation window, the search patterns and searched source paths that returned no query whose filter, join, ordering, or uniqueness requirement can use the indexed columns or expression, and the measured INSERT duration for a controlled batch on the owning table with the index present and with the index absent.
9. IF an Index_Inventory entry records uniqueness enforcement or idempotency as a requirement, THEN THE Index_Inventory SHALL NOT assign Index_Disposition `REMOVE` or `MOVE_TO_DERIVED` to that entry.
10. IF the read-usage count for an index cannot be read from the Log_DB catalog reading, THEN THE Index_Inventory SHALL record the count as unavailable together with the reason, and SHALL NOT assign Index_Disposition `REMOVE` to that entry.
11. THE Index_Inventory SHALL record each index already removed by `025_request_ingestion_hot_path.sql`, `028_request_ingestion_minimal_indexes.sql`, and `029_span_log_ingestion_hot_path.sql` with its table name, index name, originating migration file name, an Index_Disposition value of `REMOVE` marked as a prior-phase disposition, and the confirmation from the Log_DB catalog reading that the index is absent from the measured environment.

### Requirement 5: GIN and JSONB Index Forensics

**User Story:** As a performance engineer, I want each remaining JSONB GIN index decided on evidence, so that document tokenization cost on the insert path is paid only where a JSONB query exists.

#### Acceptance Criteria

1. THE Index_Inventory SHALL record every GIN index on the Ingestion_Table_Set as read from the Log_DB catalog, SHALL record the GIN index count per table, and SHALL include the six GIN indexes on `events_errors` (`context`, `tags`, `extra`, `metadata`, `payload`, `ai_response`) and the four GIN indexes on `events_metrics` (`attributes`, `metadata`, `payload`, `ai_response`).
2. For each GIN index, THE Evidence_Record SHALL record every JSONB containment, key-existence, or path predicate against the indexed column found by a search covering every source file under `src/`, identified by source file path and line range, or SHALL record that the search returned no such predicate.
3. For each GIN index, THE Evidence_Record SHALL record index size in bytes, and the median INSERT duration in milliseconds across at least 3 repetitions of a controlled batch of 200 rows on the owning table measured once with the index present and once with the index absent, together with the percentage difference between the two recorded medians.
4. THE Evidence_Record SHALL identify the environment for every index-present and index-absent INSERT measurement as a staging or benchmark environment.
5. THE Forensic_Report SHALL assign each GIN index recorded in the Index_Inventory exactly one Index_Disposition value and SHALL cite the criterion 2 search result and the criterion 3 measurements for that index.
6. IF the criterion 2 search returns no JSONB containment, key-existence, or path predicate against an indexed JSONB column, THEN THE Forensic_Report SHALL record that absence together with the criterion 3 measured difference as the evidence supporting Index_Disposition `REMOVE` for that GIN index.
7. WHERE a JSONB read requirement exists for at most 5 distinct keys of an indexed JSONB column, THE Forensic_Report SHALL enumerate those keys and SHALL specify a narrower expression index, a partial index, or a derived-table alternative in place of the whole-document GIN index.
8. IF the index-absent INSERT measurement required by criterion 3 cannot be executed, THEN THE Evidence_Record SHALL state the Unmeasured_Declaration for that measurement, and THE Forensic_Report SHALL assign Index_Disposition `KEEP` to that GIN index and SHALL state the measurement required to authorize removal.
9. IF the recorded read-usage count for a GIN index is greater than zero while the criterion 2 search returns no predicate, THEN THE Forensic_Report SHALL record the discrepancy and SHALL assign Index_Disposition `KEEP` to that GIN index.

### Requirement 6: Trigger Forensics

**User Story:** As a performance engineer, I want the per-row cost of ingestion triggers measured, so that trigger work is reduced without silently dropping a contract the trigger enforces.

#### Acceptance Criteria

1. THE Trigger_Inventory SHALL contain one entry for every trigger on every table in the Ingestion_Table_Set, enumerated from the Log_DB catalog, including triggers defined on partitioned parent tables, triggers attached to their partitions, and triggers currently in a disabled state.
2. Each Trigger_Inventory entry SHALL record trigger name, table, timing, triggering events, function name, per-row or per-statement firing, enabled or disabled state, any `WHEN` clause predicate, and the count of SQL statements and sequence calls the trigger function executes per invocation.
3. THE Trigger_Inventory SHALL record, for one row inserted by the Telemetry_Writer into each of the ten Canonical_Event_Tables, every branch of `logdb_sync_typed_event_contract` covering timestamp coalescing, `metadata` environment synchronization, `public_id` assignment, and `payload` fallback, together with the columns each branch assigns and whether each branch evaluates as taken or skipped.
4. THE Evidence_Record SHALL record measured INSERT duration in milliseconds for a batch of 200 rows of identical shape on `events_errors` and on `events_spans`, over at least 5 consecutive runs per condition, once with `trg_sync_typed_event_contract` enabled and once with the trigger absent, in a staging or benchmark environment, and SHALL record median duration, p95 duration, and derived per-row trigger overhead in microseconds for each condition.
5. THE Phase_2_Change_Set SHALL preserve Public_ID_Contract compliance for every row inserted into a Canonical_Event_Table, including rows supplied with `public_id` omitted, rows supplied with `public_id` set to `NULL`, and rows supplied with `public_id` set to an empty string.
6. THE Phase_2_Change_Set SHALL preserve equality between `metadata->>'environment'` and the `environment` column for every row inserted into a Canonical_Event_Table, including rows supplied with `metadata` set to `NULL`, rows supplied with `metadata` omitting the `environment` key, and rows supplied with a `metadata` `environment` value differing from the `environment` column value.
7. IF a trigger branch duplicates a guarantee already delivered by a column default or by Telemetry_Writer output, THEN THE Forensic_Report SHALL record the duplication together with the Regression_Suite test that proves the guarantee holds for the same inserted row after the branch is removed.
8. IF a trigger branch delivers a guarantee that no column default, constraint, or Telemetry_Writer output delivers, THEN THE Phase_2_Change_Set SHALL retain that branch AND THE Forensic_Report SHALL record the retained branch together with the guarantee it delivers.
9. IF `trg_sync_typed_event_contract` cannot be disabled or dropped in the measurement environment, THEN THE Evidence_Record SHALL state the Unmeasured_Declaration for the trigger-absent INSERT duration and SHALL record the reason the trigger could not be removed.

### Requirement 7: Public ID, Sequence, and Default Forensics

**User Story:** As a platform engineer, I want the public identifier mechanism proven before it is touched, so that a human-readable identifier contract is never broken for a throughput gain.

#### Acceptance Criteria

1. THE Forensic_Report SHALL record, for each of the ten Canonical_Event_Tables, the `public_id` column default expression or the recorded absence of a default, the backing sequence name or the recorded absence of a sequence, and the trigger branch that assigns `public_id` or the recorded absence of such a branch.
2. THE Forensic_Report SHALL state, for each of the ten Canonical_Event_Tables, whether the column default, the trigger branch, or no mechanism assigns `public_id` in each of the three cases where the Telemetry_Writer omits the column, where the Telemetry_Writer supplies `NULL`, and where the Telemetry_Writer supplies an empty string, and SHALL state for each case whether the stored value satisfies the Public_ID_Contract.
3. THE Public_ID_Contract SHALL require every `public_id` value to be non-empty, to match the pattern `^[A-Z]{3}-[0-9]{9,19}$`, to carry the three-character prefix assigned to its owning table, and to be unique within its Canonical_Event_Table.
4. THE Public_ID_Contract SHALL permit gaps in the numeric portion arising from transaction rollback and SHALL prohibit reuse of a previously assigned numeric portion within the same Canonical_Event_Table.
5. THE Phase_2_Change_Set SHALL retain sequence-backed generation as the source of `public_id` values for every Canonical_Event_Table and SHALL NOT substitute an application-generated or random identifier.
6. IF the Phase_2_Change_Set removes or narrows a `public_id` trigger branch, THEN THE Regression_Suite SHALL assert, for each of the ten Canonical_Event_Tables, that a row inserted with `public_id` omitted, a row inserted with `public_id` set to `NULL`, and a row inserted with `public_id` set to an empty string each commit successfully and each store a value satisfying the Public_ID_Contract.
7. IF an insert into a Canonical_Event_Table would store a `public_id` value that fails the Public_ID_Contract, THEN THE Log_DB SHALL reject the insert with an error indicating the `public_id` violation and SHALL leave the enclosing batch transaction rolled back with zero rows persisted.
8. THE Evidence_Record SHALL record, for a controlled batch of 200 rows on `events_errors` and on `events_spans`, the measured INSERT duration and the observed sequence advance count with `public_id` supplied by the Telemetry_Writer and with `public_id` omitted.

### Requirement 8: Insert and Statement Cost Forensics

**User Story:** As a performance engineer, I want measured attribution of insert cost, so that remediation targets the component that actually consumes the time.

#### Acceptance Criteria

1. THE Evidence_Record SHALL record, for each Canonical_Event_Table, rows inserted, bytes inserted, INSERT duration, WAL bytes generated, index count, and total index size for a controlled batch of 200 events of a single Signal_Type replayed at least 3 times, and SHALL report the median of those runs together with the command, environment, and UTC timestamp of each run.
2. THE Evidence_Record SHALL attribute measured INSERT duration on `events_traces`, `events_spans`, `events_logs`, `events_requests`, and `events_errors` to index maintenance, WAL generation, trigger execution, constraint checking, TOAST activity, lock waiting, and CPU as a percentage of that measured INSERT duration, and SHALL record any remaining share as unattributed, such that the recorded percentages sum to 100 plus or minus 5 percentage points.
3. WHEN a statement accounts for at least 1 percent of total measured database time during a controlled batch run, THE Evidence_Record SHALL record the calling source file path and line range, the statement text, the execution count, the mean duration in milliseconds, the p95 duration in milliseconds, and the execution plan for that statement.
4. THE Evidence_Record SHALL derive each recorded plan from `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` output captured in the same environment as the measured statement, and SHALL record the command and UTC timestamp that produced the plan.
5. THE Evidence_Record SHALL identify the environment for every `EXPLAIN ANALYZE` result as a staging or benchmark environment and SHALL record that environment name.
6. IF a plan for a recorded statement can be obtained only from a production environment, THEN THE Evidence_Record SHALL omit that plan, SHALL state the Unmeasured_Declaration for that statement, and SHALL record the reason the plan could not be captured in a staging or benchmark environment.
7. IF WAL bytes generated, TOAST activity, or lock-wait duration cannot be measured for a Canonical_Event_Table, THEN THE Evidence_Record SHALL state the Unmeasured_Declaration for that metric, SHALL record the reason the measurement could not be executed, and SHALL retain the remaining measured values for that table.
8. WHEN measured attribution assigns at least 25 percent of INSERT duration on a Canonical_Event_Table to index maintenance, THE Evidence_Record SHALL record that table as a remediation candidate together with the Index_Inventory entries for the indexes on that table.

### Requirement 9: Error Ingestion Query Amplification

**User Story:** As a performance engineer, I want the claimed `Q(N) = 3N + 6` amplification tested against the current code, so that a batch-level grouping strategy is implemented only if per-event statements actually remain.

#### Acceptance Criteria

1. THE Evidence_Record SHALL record the SQL statement count executed by `ErrorGroupRepository.upsertGroupsBatch` for batch sizes 1, 10, 50, and 200, measured once with a distinct fingerprint per event and once with a single fingerprint repeated across every event in the batch, counting every SQL statement issued by that method inside the batch transaction, excluding `BEGIN` and `COMMIT`, and derived from `pg_stat_statements` execution-count deltas captured across the invocation or, where `pg_stat_statements` is absent, from captured database statement output for the same invocation.
2. THE Forensic_Report SHALL state the recorded statement count for each of the eight measurements required by criterion 1 and SHALL classify the count as growing when the count recorded at batch size 200 exceeds the count recorded at batch size 1 by more than 2 statements for the same fingerprint distribution, or as bounded otherwise.
3. IF the recorded statement count is classified as growing, THEN THE Phase_2_Change_Set SHALL replace the per-event statements with set-based statements whose recorded statement count at batch sizes 10, 50, and 200 does not exceed the recorded statement count at batch size 1 by more than 2 statements for either fingerprint distribution.
4. IF the recorded statement count is classified as bounded, THEN THE Forensic_Report SHALL record the `Q(N) = 3N + 6` hypothesis as falsified and SHALL cite the eight recorded statement counts required by criterion 1.
5. THE Phase_2_Change_Set SHALL preserve, for an identical ingested error batch, an `error_groups` row per distinct fingerprint whose `occurrence_count` equals the number of ingested events carrying that fingerprint, whose `first_seen_at` equals the earliest ingested event timestamp for that fingerprint, whose `last_seen_at` equals the latest ingested event timestamp for that fingerprint, and whose `occurrence_count`, `first_seen_at`, and `last_seen_at` remain unchanged when an already-processed batch is re-delivered.
6. THE Phase_2_Change_Set SHALL apply ascending `(project_id, fingerprint)` ordering to every row set locked with `FOR UPDATE` in Error_Group_Repository.
7. THE Forensic_Report SHALL state the per-batch statement count for error ingestion at batch sizes 1, 10, 50, and 200 measured before the first Phase_2_Change_Set modification and at the same four batch sizes measured after the Phase_2_Change_Set.
8. IF neither `pg_stat_statements` nor database statement capture is available in the measured environment, THEN THE Evidence_Record SHALL state the Unmeasured_Declaration for each affected batch size and SHALL record the reason the statement count could not be captured.
9. WHEN an event carrying a fingerprint whose `error_groups` row is in a resolved state is ingested, THE Ingestion_Pipeline SHALL record that row as regressed and SHALL retain the row's existing fingerprint grouping.
10. THE Regression_Suite SHALL assert that two concurrently executed error batches containing the same fingerprint set supplied in opposite input order both commit without a deadlock error.

### Requirement 10: Transaction, WAL, and COMMIT Forensics

**User Story:** As a performance engineer, I want commit cost attributed, so that durability is never traded away to improve a benchmark number.

#### Acceptance Criteria

1. THE Evidence_Record SHALL record, for each Signal_Type, `BEGIN` duration in milliseconds, summed statement duration in milliseconds, outbox insert duration in milliseconds, `COMMIT` duration in milliseconds, connection hold time in milliseconds, and WAL bytes generated per batch transaction, each reported at p50, p95, and p99 over at least 100 measured batch transactions.
2. WHEN measured p95 `COMMIT` duration for a Signal_Type exceeds the measured p95 summed statement duration of the same transaction by more than 10 percent, THE Forensic_Report SHALL attribute the excess to WAL flush latency, checkpoint activity, lock waiting, or concurrent write pressure, and SHALL cite the measurement supporting each attributed cause.
3. THE Ingestion_Pipeline SHALL apply `synchronous_commit = on` to every ingest write transaction executed on the dedicated ingestion write pool.
4. THE Ingestion_Pipeline SHALL bound every ingest write transaction with `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS` set greater than 0 milliseconds and lower than `INGESTION_JOB_EXPIRE_SECONDS` expressed in milliseconds.
5. IF the Forensic_Report proposes a `synchronous_commit` value other than `on`, THEN THE Forensic_Report SHALL state the durability loss window in milliseconds, SHALL cite the measured `COMMIT` duration reduction supporting the proposal, and SHALL mark the proposal as requiring explicit operator approval before adoption.
6. THE Evidence_Record SHALL record the `synchronous_commit` value and the `statement_timeout` value observed on an ingestion write connection during an ingest write transaction.
7. IF an ingest write transaction exceeds `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS`, THEN THE Ingestion_Pipeline SHALL roll back that transaction, SHALL leave zero rows from that transaction committed to the Ingestion_Table_Set, and SHALL return to the Event_Processor an error indicating statement-timeout cancellation for retry classification.
8. IF any measurement required by criterion 1 cannot be executed for a Signal_Type, THEN THE Evidence_Record SHALL state the Unmeasured_Declaration for that metric and SHALL record the reason the measurement could not be executed.

### Requirement 11: Batch Size Optimization

**User Story:** As a performance engineer, I want the batch size chosen empirically, so that batch tuning stops at the measured point of diminishing return instead of assuming larger is faster.

#### Acceptance Criteria

1. THE Benchmark_Matrix SHALL measure ingestion at batch sizes 1, 10, 25, 50, 100, 200, and 500 for each Signal_Type, executing at least 3 runs of at least 60 seconds of sustained load per batch size per Signal_Type, and discarding the first 30 seconds of each run as warm-up.
2. For each measured batch size and each Signal_Type, THE Benchmark_Matrix SHALL record events per second, megabytes per second, transaction duration at p50 and p95, connection hold time at p50 and p95, queue wait at p50 and p95, connection checkout wait at p50 and p95, INSERT duration at p50 and p95, `COMMIT` duration at p50 and p95, WAL bytes per ingested event, process CPU time in milliseconds, process resident memory in megabytes, error rate, and the command, environment, and UTC timestamp of each run.
3. THE Forensic_Report SHALL state, for each Signal_Type, the smallest measured batch size whose median events per second across the runs of criterion 1 exceeds the median events per second of the next smaller measured batch size by 5 percent or less.
4. THE Forensic_Report SHALL state one recommended value for `INGESTION_JOB_CHUNK_SIZE`, `INGESTION_GENERAL_BATCH_SIZE`, and `INGESTION_SPECIALIZED_BATCH_SIZE`, each selected from the batch sizes measured by criterion 1, each no larger than the batch size recorded by criterion 3 for the Signal_Types that setting governs, each satisfying the worst-case in-flight memory bound required by Requirement 15, and each cited together with the measured values that support it.
5. IF the median events per second at a measured batch size falls more than 5 percent below the median events per second at the next smaller measured batch size, THEN THE Forensic_Report SHALL record both measured values and SHALL recommend the smaller batch size.
6. IF the median events per second increases by more than 5 percent at every measured batch size for a Signal_Type, THEN THE Forensic_Report SHALL record that the point of diminishing return was not reached within the measured range and SHALL recommend the largest measured batch size that satisfies the worst-case in-flight memory bound required by Requirement 15.
7. IF the measured error rate at a batch size exceeds the measured error rate at batch size 1 for the same Signal_Type, THEN THE Forensic_Report SHALL exclude that batch size from the recommended values of criterion 4 and SHALL record both measured error rates.
8. IF a batch size cannot be measured for a Signal_Type because the assembled batch exceeds `INGESTION_JOB_MAX_BYTES`, because the run exceeds `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS`, or because the run terminates before completing, THEN THE Forensic_Report SHALL state the Unmeasured_Declaration for that batch size and Signal_Type and SHALL record the reason the measurement could not be executed.

### Requirement 12: Storage and Autovacuum Analysis

**User Story:** As an operator, I want bloat and vacuum pressure measured, so that ingestion latency attributable to storage maintenance is addressed without a blocking rewrite.

#### Acceptance Criteria

1. THE Evidence_Record SHALL record, for every table in the Ingestion_Table_Set and for every partition of every partitioned table in the Ingestion_Table_Set, table size in bytes, total index size in bytes, live tuple count, dead tuple count, dead tuple count as a percentage of live tuple count, last autovacuum UTC timestamp, and last autoanalyze UTC timestamp, together with the command, environment, and UTC timestamp of the catalog reading that produced them.
2. THE Evidence_Record SHALL record TOAST relation size in bytes for every Canonical_Event_Table that declares at least one JSONB column, and SHALL record the absence of a TOAST relation for any such table that has none.
3. IF measured dead tuple count on a table in the Ingestion_Table_Set exceeds 20 percent of measured live tuple count, or measured live tuple count is zero while measured dead tuple count is at least 1000, THEN THE Forensic_Report SHALL record the table as an autovacuum tuning candidate together with proposed values for that table's autovacuum vacuum scale factor, autovacuum vacuum threshold, and autovacuum analyze scale factor.
4. THE Phase_2_Change_Set SHALL deliver every per-table autovacuum setting proposed for a recorded autovacuum tuning candidate through the Schema_Change_Set, and SHALL bound recorded bloat growth on the Ingestion_Table_Set through retention pruning of rows older than the configured retention window.
5. IF a proposed remediation requires a full table rewrite, meaning a `VACUUM FULL`, a `CLUSTER`, or an `ALTER TABLE` that rewrites the table, THEN THE Forensic_Report SHALL record the measured table size in bytes and the estimated maintenance window in minutes derived from that measured size, and SHALL mark the remediation as requiring explicit operator approval before adoption.
6. IF a remediation is marked as requiring explicit operator approval, THEN THE Phase_2_Change_Set SHALL exclude that remediation until the Forensic_Report records the approval.
7. WHEN the Phase_2_Change_Set applies a per-table autovacuum setting, THE Evidence_Record SHALL record live tuple count, dead tuple count, dead tuple percentage, and last autovacuum UTC timestamp for that table before the change and after the change.
8. IF a catalog reading returns no last autovacuum timestamp or no last autoanalyze timestamp for a table in the Ingestion_Table_Set, THEN THE Evidence_Record SHALL record that table as never autovacuumed or never autoanalyzed and SHALL record the statistics reset timestamp of the measured environment.

### Requirement 13: Cross-Signal Workload Interference

**User Story:** As a platform engineer, I want interference between heavy and light signals measured, so that trace and span ingestion cannot starve error and request ingestion.

#### Acceptance Criteria

1. THE Evidence_Record SHALL record queue wait at p50, p95 and p99, connection checkout wait at p50, p95 and p99, transaction duration at p50, p95 and p99, mean events per second, and end-to-end ingestion latency at p50, p95 and p99 for each of request, error, log, trace, and span under a mixed workload in which trace and span events together supply at least 60 percent of offered events and request, error, and log events each supply at least 10 percent of offered events, sustained for at least 300 seconds and at least 100,000 total offered events.
2. THE Evidence_Record SHALL record the metrics listed in criterion 1 for each of request, error, log, trace, and span under a single-Signal_Type workload executed at the same offered events per second for that Signal_Type, the same batch size, the same worker concurrency, the same environment, and the same source build as the mixed workload run.
3. WHEN measured p95 queue wait for request, log, or error events under the mixed workload exceeds the single-Signal_Type p95 queue wait for the same Signal_Type by more than 50 percent, THE Forensic_Report SHALL record interference from trace and span ingestion together with the affected Signal_Type, both measured p95 queue wait values, and the measured percentage difference.
4. WHERE measured p95 queue wait for request, log, and error events under the mixed workload stays within 50 percent of the single-Signal_Type p95 queue wait for the same Signal_Type, THE Forensic_Report SHALL record cross-signal interference as absent and SHALL cite both measured p95 queue wait values for each of those three Signal_Types.
5. WHERE the Forensic_Report records interference, THE Phase_2_Change_Set SHALL bound concurrency per admission class using `INGESTION_GENERAL_CONCURRENCY` and `INGESTION_SPECIALIZED_CONCURRENCY` of the existing general and specialized worker tiers until re-measured p95 queue wait for request, log, and error events under the mixed workload of criterion 1 stays within 50 percent of the single-Signal_Type value for the same Signal_Type while re-measured mean events per second for trace and span stays at or above the Baseline_Record value.
6. WHEN the Phase_2_Change_Set changes a concurrency bound for an admission class, THE Evidence_Record SHALL record the metrics listed in criterion 1 after the change under the same mixed workload composition, duration, environment, and offered load used before the change.
7. IF the mixed workload run or any single-Signal_Type run cannot be executed, THEN THE Forensic_Report SHALL state the Unmeasured_Declaration for each affected metric, SHALL record the cross-signal interference verdict as unavailable, and SHALL state the reason the run could not be executed.
8. IF the Phase_2_Change_Set adds a database connection pool to the ingestion worker process, THEN THE Evidence_Record SHALL contain the measured p95 queue wait per Signal_Type under the mixed workload of criterion 1 for at least three tested combinations of `INGESTION_GENERAL_CONCURRENCY` and `INGESTION_SPECIALIZED_CONCURRENCY`, each of which leaves p95 queue wait for request, log, or error events more than 50 percent above the single-Signal_Type value or reduces trace and span mean events per second below the Baseline_Record value.

### Requirement 14: Tenant Fairness Preservation

**User Story:** As a platform engineer, I want fairness preserved under mixed tenant load, so that one high-volume organization cannot monopolize ingestion capacity.

#### Acceptance Criteria

1. WHEN the count of in-flight ingestion jobs for one organization reaches the per-organization in-flight job budget configured for the Ingestion_Pipeline, THE Ingestion_Pipeline SHALL defer the next claimed job of that organization without marking the job failed and SHALL keep the job eligible for a later claim.
2. WHEN a job has been deferred `INGESTION_FAIRNESS_MAX_DEFERS` times, THE Ingestion_Pipeline SHALL admit that job for processing irrespective of the in-flight job count of its organization.
3. WHEN the multi-tenant Workload_Class executes with at least five organizations of which one submits at least 90 percent of the events offered during the run, THE Benchmark_Matrix SHALL record, per organization and for the same run, events per second, queue wait at p50, p95 and p99, deferral count, and the count of jobs admitted after reaching `INGESTION_FAIRNESS_MAX_DEFERS`.
4. THE Phase_2_Change_Set SHALL keep the recorded events per second of every organization submitting no more than 10 percent of the offered events at or above 95 percent of the Baseline_Record value recorded for the same Workload_Class, batch size, and per-organization load share.
5. IF the recorded events per second of an organization submitting no more than 10 percent of the offered events falls below 95 percent of the corresponding Baseline_Record value, THEN THE Forensic_Report SHALL record the fairness regression together with the change that produced it and SHALL mark that change as requiring explicit operator approval before adoption.
6. THE Regression_Suite SHALL assert that, under mixed tenant load, no worker slot, no write-admission permit, and no database connection of the Ingestion_Pipeline is reserved for or bound to a single organization identifier.

### Requirement 15: Memory and Backpressure Bounds

**User Story:** As an operator, I want worst-case memory bounded, so that a throughput recommendation cannot drive the ingestion worker into restart loops.

#### Acceptance Criteria

1. THE Forensic_Report SHALL state worst-case in-flight memory in megabytes as the product of the maximum concurrent in-flight jobs, derived from the configured ingest queue count, worker concurrency, and pg-boss fetch batch size, and `INGESTION_JOB_MAX_BYTES`, plus the measured peak serialized batch allocation and the measured peak database connection buffer allocation, recording the numeric value and the configuration setting or measurement that produced each input term.
2. IF the cached ingest queue pending depth reaches or exceeds `INGESTION_BACKPRESSURE_HIGH_WATER` and stays below `INGESTION_BACKPRESSURE_CRITICAL_WATER`, THEN THE Ingestion_Pipeline SHALL reject at admission, without discarding already-enqueued jobs and with a per-event rejection reason indicating backpressure shedding, every event whose combined plan-tier and event-urgency weight falls below the business-tier top-urgency floor.
3. IF the calculated worst-case in-flight memory for a batch size or concurrency recommended under Requirement 11 exceeds 358 megabytes, being 70 percent of the 512 megabyte heap limit configured for the `ingestion-workers` process in `ecosystem.config.cjs`, or the measured peak resident memory recorded for that recommendation exceeds 358 megabytes, or the `ingestion-workers` process restarts at least once during the run that produced that measurement, THEN THE Forensic_Report SHALL lower the recommended batch size and concurrency until the recalculated worst case and the re-measured peak both fall at or below 358 megabytes with zero recorded restarts, recording every rejected candidate value together with the adopted value.
4. THE Phase_2_Change_Set SHALL resolve, from the ingestion configuration defaults in `src/config/env.ts`, a maximum entry count and a maximum byte size for every queue and buffer the Phase_2_Change_Set introduces, each validated at boot as a positive integer.
5. IF the cached ingest queue pending depth reaches or exceeds `INGESTION_BACKPRESSURE_CRITICAL_WATER`, THEN THE Ingestion_Pipeline SHALL reject at admission, with a per-event rejection reason indicating backpressure shedding, every event other than a business-tier or enterprise-tier event of a top-urgency Signal_Type (error, message, cron_checkin).
6. WHEN the Benchmark_Matrix executes the sustained high volume Workload_Class at the batch size and concurrency recommended by the Forensic_Report, THE Evidence_Record SHALL record the peak resident memory of the `ingestion-workers` process in megabytes, the count of `ingestion-workers` process restarts observed during the run, and the UTC timestamp of the run.
7. IF a queue or buffer introduced by the Phase_2_Change_Set reaches its configured maximum entry count or maximum byte size, THEN THE Ingestion_Pipeline SHALL refuse further additions to that queue or buffer, retaining already-accepted in-flight work and surfacing a rejection reason indicating the bound was reached, rather than growing the queue or buffer beyond the configured maximum.

### Requirement 16: Write Amplification Accounting

**User Story:** As a performance engineer, I want per-event write amplification quantified, so that unnecessary downstream writes are removed while required durability writes stay.

#### Acceptance Criteria

1. THE Forensic_Report SHALL state, for each of the ten Signal_Types, the Canonical_Event_Table rows written, index entries maintained, `telemetry_outbox` rows written, auxiliary rows written to each remaining table of the Ingestion_Table_Set, and WAL bytes generated per ingested event, each value derived from a controlled batch of 200 events of that Signal_Type and expressed to two decimal places.
2. WHEN the Event_Processor identifies an event as a duplicate, THE Ingestion_Pipeline SHALL write zero rows to `telemetry_outbox` for that event, such that the measured `telemetry_outbox` row count for a batch equals the count of events in that batch not identified as duplicates.
3. THE Ingestion_Pipeline SHALL compute the error fingerprint exactly once per ingested error event, such that a batch of N error events produces N fingerprint computations irrespective of the number of distinct fingerprint values in that batch.
4. THE Phase_2_Change_Set SHALL retain every write required for `telemetry_outbox` delivery, usage accounting, uniqueness enforcement, or idempotency enforcement.
5. THE Forensic_Report SHALL state, for each Signal_Type, the criterion 1 values recorded in the Baseline_Record as the before values and the same values re-measured after the Phase_2_Change_Set as the after values, both taken from the same Workload_Class and the same controlled batch of 200 events.
6. IF a per-event write recorded under criterion 1 is not required for `telemetry_outbox` delivery, usage accounting, uniqueness enforcement, idempotency enforcement, or an Index_Inventory entry carrying Index_Disposition `KEEP`, THEN THE Forensic_Report SHALL record that write as a removal candidate together with the source file path and line range of the writing code and the measured per-event WAL bytes attributable to it.
7. IF a criterion 5 after value exceeds the corresponding before value for any Signal_Type, THEN THE Forensic_Report SHALL record the increase, the write that produced it, and the durability, correctness, or idempotency guarantee that requires that write.

### Requirement 17: Benchmark Matrix and Measurement Integrity

**User Story:** As a reviewer, I want every number in the report traceable to an executed command, so that the report can be trusted as an engineering record.

#### Acceptance Criteria

1. THE Benchmark_Matrix SHALL cover all nine Workload_Classes, executing each Workload_Class for at least 3 repetitions, where each repetition comprises a warm-up window of at least 10 seconds followed by a measurement window of at least 60 seconds.
2. For each Workload_Class and each repetition, THE Benchmark_Matrix SHALL record events submitted during the measurement window, events per second, megabytes per second, latency at p50, p95 and p99 in milliseconds, queue wait in milliseconds, connection checkout wait in milliseconds, transaction duration in milliseconds, INSERT duration in milliseconds, `COMMIT` duration in milliseconds, WAL bytes, CPU time in milliseconds, resident memory in bytes, database connection count, error rate as a percentage of events submitted, and duplicate rate as a percentage of events submitted.
3. THE Benchmark_Matrix SHALL execute through the existing harness at `scripts/run-ingestion-benchmark-matrix.ts`.
4. THE Forensic_Report SHALL report only values produced by an executed measurement command.
5. WHERE a reported value is derived from more than one recorded measurement, THE Forensic_Report SHALL record each constituent recorded measurement and the arithmetic that produced the derived value.
6. THE Forensic_Report SHALL record, for every reported measurement, the exact command invoked, the environment identified as a staging or benchmark environment, the UTC timestamp in ISO 8601 format, and the number of repetitions the reported value summarizes.
7. IF a measurement cannot be executed, THEN THE Forensic_Report SHALL state the Unmeasured_Declaration for the affected metric and SHALL state the reason the measurement could not be executed.
8. IF a Workload_Class repetition terminates before its measurement window completes, THEN THE Forensic_Report SHALL state the Unmeasured_Declaration for that Workload_Class, SHALL record the termination reason, and SHALL exclude the partial repetition from every reported value.
9. IF the recorded error rate for a Workload_Class repetition exceeds 1 percent of events submitted, THEN THE Forensic_Report SHALL record that repetition as invalid for throughput comparison and SHALL record the recorded error rate together with the classification of the observed failures.

### Requirement 18: Schema Change Delivery

**User Story:** As a database operator, I want schema changes delivered as new tracked migrations with matching base-schema updates, so that migrated databases and freshly created databases end in the same state.

#### Acceptance Criteria

1. WHEN the Phase_2_Change_Set alters an index, trigger, function, sequence, column, or table setting in the Log_DB, THE Schema_Change_Set SHALL deliver that alteration in a new `.sql` file under `database/migrations/logdb/` and SHALL leave the DDL statements of every already-applied migration file that is not a Base_Schema_File unchanged.
2. THE Schema_Change_Set SHALL place each new file in the numbered subfolder under `database/migrations/logdb/` that owns the affected tables, SHALL prefix each new file name with the lowest unused three-digit ordinal within that subfolder, and SHALL assign no two new files the same three-digit prefix within the same subfolder.
3. THE Schema_Change_Set SHALL update each affected Base_Schema_File so that the index definitions, trigger definitions, column definitions and defaults, function bodies, sequence definitions, and per-table settings of a database created from empty match those of a database that applied every existing migration plus the new migration files, with zero recorded differences across the Ingestion_Table_Set.
4. THE Schema_Change_Set SHALL provide one `.down.sql` file for every new migration file that creates or drops an index, trigger, column, or function, named with the same three-digit ordinal prefix and the same base name as its forward file and placed in the same subfolder.
5. Each `.down.sql` file SHALL delete exactly the one `logdb_migrations` ledger row whose filename equals the recorded relative path of its forward migration file and SHALL leave every other ledger row unchanged.
6. THE Schema_Change_Set SHALL use non-concurrent `DROP INDEX` and `CREATE INDEX` statements for indexes on partitioned parent tables and SHALL guard each such statement with `IF EXISTS` or `IF NOT EXISTS`.
7. WHEN `npm run db:migrate:logdb` runs against either a database that has already applied every existing migration or an empty database, THE Schema_Change_Set SHALL complete the run with a success exit status and SHALL leave exactly one `logdb_migrations` row per new migration file after each of two consecutive runs of that command.
8. THE Schema_Change_Set SHALL store primary-database identifiers in every new or altered Log_DB column as plain `UUID` or `TEXT` values and SHALL add no foreign key constraint from a Log_DB table to a control-plane table.
9. IF applying a new migration file fails, THEN THE Schema_Change_Set SHALL leave no `logdb_migrations` row for that file and SHALL leave every index, trigger, column, function, sequence, and table setting targeted by that file at its pre-migration definition.
10. WHEN a `.down.sql` file executes against a database that applied its forward migration, THE Schema_Change_Set SHALL restore each affected index, trigger, column, and function to its pre-migration definition and SHALL permit the next `npm run db:migrate:logdb` run to re-apply the forward migration file with a success exit status.
11. THE Schema_Change_Set SHALL keep the filename and relative path of every Base_Schema_File unchanged so that a database holding that filename in `logdb_migrations` does not re-execute it.

### Requirement 19: Regression Verification

**User Story:** As a reviewer, I want ingestion correctness re-proven after the change, so that a throughput improvement cannot ship alongside a silent behavioural regression.

#### Acceptance Criteria

1. THE Regression_Suite SHALL assert, for each of the ten Signal_Types, that at least one submitted event is retrievable from its Canonical_Event_Table after job acknowledgement, that the retrieved row carries a non-empty `public_id` value, and that every submitted field value equals the stored column value.
2. THE Regression_Suite SHALL assert duplicate suppression as zero additional Canonical_Event_Table rows and zero additional `telemetry_outbox` rows for a re-submitted event, error grouping as exactly one `error_groups` row per distinct `(project_id, fingerprint)` pair, occurrence counting as `occurrence_count` equal to the number of ingested events sharing that fingerprint, outbox row creation as exactly one `telemetry_outbox` row per non-duplicate event, and `public_id` assignment as Public_ID_Contract compliance.
3. WHEN the Phase_2_Change_Set removes an index, THE Regression_Suite SHALL assert, for each production query recorded against that index in the Index_Inventory, that the returned row count and the returned row contents equal the result captured for the same query with the same input parameters before removal.
4. THE Regression_Suite SHALL execute through `npm run test` and `npm run test:integration` once before the first modification of the Phase_2_Change_Set and once after the final modification, and SHALL report zero failing tests in the post-change run.
5. THE Phase_2_Change_Set SHALL keep every test recorded as passing in the pre-change Regression_Suite run passing in the post-change run, with the pre-change pass list captured before the first modification of the Phase_2_Change_Set.
6. THE Phase_2_Change_Set SHALL limit modified files to `src/modules/ingestion/`, `src/modules/errors/`, `database/migrations/logdb/`, `src/config/env.ts`, the ingestion measurement scripts under `scripts/` invoked by `npm run bench:ingestion:matrix`, `npm run ingestion:db:audit`, `npm run ingestion:db:runtime` and `npm run explain:ingestion`, the Regression_Suite test files, and `docs/ingestion-write-path-optimization.md`.
7. THE Regression_Suite SHALL assert retry classification as a transient failure returning the job to the queue and a permanent failure not returning the job to the queue, acknowledgement behaviour as job acknowledgement occurring only after `COMMIT` succeeds, usage accounting as usage counters increasing by the number of persisted non-duplicate events, trace-to-span linkage as every persisted span row referencing the trace identifier submitted with it, and request correlation as every persisted event row carrying the request identifier submitted with it.
8. IF an ingest write transaction raises an error or violates a constraint, THEN THE Regression_Suite SHALL assert zero persisted rows in the affected Canonical_Event_Table and zero persisted rows in `telemetry_outbox` for that batch, and SHALL assert that an error indicating the failure is surfaced to the Event_Processor.
9. IF a result-set comparison recorded for a removed index returns a row count or row contents differing from the pre-removal capture, THEN THE Phase_2_Change_Set SHALL restore the removed index or supply a replacement index satisfying the recorded query, and THE Forensic_Report SHALL record the differing comparison.

### Requirement 20: Forensic Report and Verdict

**User Story:** As a reviewer, I want a single forensic document with a blunt verdict, so that the state of the ingestion write path is legible without re-running the investigation.

#### Acceptance Criteria

1. THE Forensic_Report SHALL reside at `docs/ingestion-write-path-optimization.md`.
2. THE Forensic_Report SHALL contain one distinct, non-empty heading for each of the following sections: current architecture, Phase_1_Protections status, bottleneck ranking, expensive statements, Index_Inventory, GIN and JSONB analysis, Trigger_Inventory, public identifier analysis, sequence and default analysis, INSERT analysis, transaction analysis, WAL and COMMIT analysis, batch size analysis, connection pool analysis, queue and backpressure analysis, tenant fairness analysis, write amplification analysis, implemented changes, before and after measurements, remaining bottlenecks, risks, and recommended next phase.
3. For each implemented change, THE Forensic_Report SHALL state the measured before value, the modified file path together with the applied code, schema, or configuration modification, the measured after value, and the percentage change computed from the recorded before and after values.
4. THE Forensic_Report SHALL contain a verdict section stating each defect the Phase_2_Change_Set fixed, each bottleneck remaining after the Phase_2_Change_Set together with its measured value, the highest-cost remaining bottleneck, the Evidence_Record entry identifying that bottleneck, the implemented change carrying the largest measured events-per-second improvement, each change the Forensic_Report recommends against adopting together with the measured evidence supporting that recommendation, and each condition required before declaring the Ingestion_Pipeline ready for sustained heavy load expressed as a metric, a comparison operator, and a numeric threshold.
5. THE Forensic_Report SHALL reference `docs/ingestion-performance-forensics.md` as the Phase 1 record and SHALL assign each Phase_1_Protections item exactly one status value of `PRESERVED`, `MODIFIED`, or `REMOVED` together with the source file path evidencing the assigned value.
6. IF the Forensic_Report claims an improvement, THEN THE Forensic_Report SHALL cite the measurement command, the command output, and the before and after values that support the claim.
7. THE Forensic_Report SHALL order the bottleneck ranking section from highest to lowest measured contribution to batch transaction duration and SHALL state, for each ranked entry, the measured contribution value and the Evidence_Record source of that value.
8. THE Forensic_Report SHALL record in the expensive statements section the 10 statements carrying the highest measured mean duration in the Evidence_Record, or every recorded statement where fewer than 10 statements are recorded, together with the calling source file path and the execution count for each.
9. IF a measured before value or a measured after value cannot be produced for an implemented change, THEN THE Forensic_Report SHALL state the Unmeasured_Declaration in place of that value and SHALL state the reason the measurement could not be executed.

### Requirement 21: Preserved Behaviour and Architectural Constraints

**User Story:** As a platform owner, I want the optimization bounded by the existing architecture and guarantees, so that throughput gains do not arrive as new operational risk.

#### Acceptance Criteria

1. THE Phase_2_Change_Set SHALL preserve durability, idempotency, tenant fairness, the Public_ID_Contract, billing and usage accounting, `telemetry_outbox` correctness, retry semantics, and the result set returned by every named production query recorded in the Index_Inventory.
2. THE Phase_2_Change_Set SHALL implement every optimization using PostgreSQL, pg-boss, and the process entries already defined in `ecosystem.config.cjs`, and SHALL add no process entry, runtime service, or network dependency to the Ingestion_Pipeline.
3. THE Phase_2_Change_Set SHALL keep the per-batch SQL statement count for each Signal_Type independent of the event count in the batch, measured at batch sizes 1, 10, 50, 200, and 500, and at or below the per-batch statement count recorded in the Baseline_Record for the same Signal_Type.
4. THE Evidence_Record SHALL record, for durability, idempotency, tenant fairness, the Public_ID_Contract, billing and usage accounting, `telemetry_outbox` correctness, and retry semantics, the Regression_Suite test that asserts the guarantee and that test's pass result obtained after the Phase_2_Change_Set is applied.
5. IF a proposed optimization requires Redis, Kafka, or an additional network service on the ingestion write path, THEN THE Forensic_Report SHALL record the proposal as out of scope and SHALL supply a PostgreSQL-only alternative.
6. IF a proposed optimization reduces a durability, idempotency, or fairness guarantee, THEN THE Forensic_Report SHALL record the guarantee affected, SHALL state the durability loss window in milliseconds or the count of rows placed at risk, and SHALL mark the proposal as requiring explicit operator approval before adoption.
7. IF the Forensic_Report records a proposal as out of scope or as requiring explicit operator approval, THEN THE Phase_2_Change_Set SHALL exclude that proposal until the Evidence_Record records the approving operator decision together with its UTC timestamp.

### Requirement 22: Evidence-Gated Change Policy

**User Story:** As a reviewer, I want every removal gated on evidence and every change prioritized by severity, so that expensive-looking database objects are not deleted on suspicion.

#### Acceptance Criteria

1. WHEN the Phase_2_Change_Set removes an index, THE Evidence_Record SHALL contain, recorded before that removal ships in the Schema_Change_Set, the index read-usage count together with the UTC start timestamp and duration of the statistics window it was read from, that window being at least 24 hours long, the searched source scope and inspected source file paths that establish the absence of a query path capable of using the index, and the measured INSERT duration for a controlled batch of at least 200 rows on the owning table with the index present and with the index absent expressed both in milliseconds and as a percentage difference.
2. WHEN the Phase_2_Change_Set removes or alters a trigger, THE Evidence_Record SHALL contain, for each guarantee recorded for that trigger in the Trigger_Inventory, including `public_id` assignment and equality between `metadata->>'environment'` and the `environment` column where that trigger assigned them, the source file path of the Regression_Suite test asserting the guarantee and the recorded pass result of that test executed after the change on each affected Canonical_Event_Table.
3. THE Forensic_Report SHALL assign every change in the Phase_2_Change_Set exactly one rank of P0 for a defect threatening durability, correctness, idempotency, the Public_ID_Contract, usage accounting, or tenant fairness, P1 for a latency or write-amplification defect evidenced by a recorded Evidence_Record measurement, or P2 for secondary optimization and observability work, and SHALL record for each change its rank, the cited evidence, and the modified file paths.
4. THE Phase_2_Change_Set SHALL implement every P0 change with the Regression_Suite passing before implementing any P1 change, and every P1 change with the Regression_Suite passing before implementing any P2 change.
5. IF a measurement required to authorize a proposed change cannot be executed or returns no value, THEN THE Forensic_Report SHALL state the Unmeasured_Declaration for the affected metric, SHALL record the proposed change as deferred, and SHALL state the measurement command required to authorize the change.
6. IF the recorded index read-usage count for an index is greater than zero, or the Evidence_Record records a query path capable of using that index, THEN THE Phase_2_Change_Set SHALL NOT remove that index.
7. IF THE Forensic_Report records a proposed change as deferred, THEN THE Phase_2_Change_Set SHALL exclude that change.
8. THE Forensic_Report SHALL record, for each implemented change in the Phase_2_Change_Set, its rank and its UTC implementation timestamp, listed in ascending implementation order.
