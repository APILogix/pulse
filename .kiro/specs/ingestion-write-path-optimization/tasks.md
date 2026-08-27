# Implementation Plan: Ingestion Write-Path Optimization (Phase 2)

## Overview

The plan is ordered by the design's own hard rule: **no database object is touched before its evidence
exists, and no number is reported that a command did not produce** (Requirement 17.4, Requirement 22.1).

That produces four ordering gates the task numbering encodes literally:

1. **Instrumentation before baseline.** Tasks 1–4 touch only `scripts/` and `scripts/lib/`. None of them
   modifies `src/modules/ingestion/`, `src/modules/errors/`, `database/migrations/logdb/` or
   `src/config/env.ts`, because Requirement 1.4 requires the Baseline_Record timestamp to precede the
   first modification to those four paths, and the evidence gate enforces it mechanically through
   `git status --porcelain` (design §1.2). Test files under `src/**` are *inside* the guarded paths, so
   every `src/`-resident test lands after task 6.
2. **Baseline before any guarded-path edit.** Task 6 captures the baseline on a clean tree. Task 6.4 is
   deliberately the first guarded-path modification in the whole plan.
3. **Measurement before its remediation.** Every conditional change in tasks 12.x names its authorizing
   measurement task from group 7 and states the condition under which it is implemented versus deferred
   with a recorded required command (Requirement 22.5, Requirement 22.7).
4. **P0 → P1 → P2 with the Regression_Suite green between ranks** (Requirement 22.4). The only
   unconditional P0 is design §6.3, which closes a real gap between Requirement 7.7 and the
   implementation. Every P1 is measurement-gated. P2 is the report and closeout.

Language: TypeScript for all harness, pipeline and test code (matching the existing `scripts/` and
`src/` tree and the `vitest` projects); SQL for every migration and `.down.sql` file. `fast-check` is
the property-based testing library, driven by the existing `vitest` runner.

Every generated artifact is written to `artifacts/ingestion-phase2/` and is git-ignored, so it never
appears in the Requirement 19.6 modified-file boundary check.

## Tasks

- [x] 1. Shared measurement modules under `scripts/lib/` (pre-baseline safe)
  - [x] 1.1 Create `scripts/lib/ingestion-evidence.ts` — the provenance envelope
    - Export `UNMEASURED = 'Runtime throughput could not be measured.' as const`, `Provenance`
      (`command`, `environment`, `timestampUtc`, `gitCommit`, `repetitions`) and `Measured<T>` exactly as
      specified in design §1.1
    - Export `recordMeasured()` / `recordUnmeasured(reason)` constructors that enforce
      `runs.length === provenance.repetitions` for the measured branch and a byte-exact `declaration`
      plus non-empty `reason` for the unmeasured branch
    - Export `assertBenchEnvironment(label)` resolving the allowlist from `process.env.INGESTION_BENCH_ENV_ALLOWLIST`
      with default `staging,bench,benchmark,local`, throwing with a non-zero-exit-friendly error before any
      database work. Read directly from `process.env` here — **not** from `src/config/env.ts` — because
      editing `src/config/env.ts` before the baseline would violate Requirement 1.4; task 6.4 promotes it
    - Export `captureProvenance()` shelling `git rev-parse HEAD` and `git status --porcelain` and returning
      the guarded-path dirty file list used by the Requirement 1.4 clean-tree gate
    - _Requirements: 1.2, 5.4, 8.4, 8.5, 11.2, 17.5, 17.6, 17.7_ (design §1.1, §1.2)

  - [ ]* 1.2 Write property test for the evidence traceability gate
    - **Property 18: Every reported number is traceable or explicitly unmeasured**
    - **Validates: Requirements 1.2, 8.4, 11.2, 17.2, 17.4, 17.5, 17.6, 17.7, 20.3, 20.6, 20.9**
    - `scripts/lib/ingestion-evidence.property.test.ts`, unit project, `fast-check` with `numRuns: 100`,
      generator `arbEvidenceDocument` producing all five states from design §Generators including the
      near-miss declaration string that proves the check is byte-exact

  - [ ]* 1.3 Write property test for unmeasurable-metric isolation
    - **Property 19: An unmeasurable metric never voids its siblings**
    - **Validates: Requirements 1.8, 8.7, 10.8, 11.8, 13.7**
    - `scripts/lib/unmeasured-isolation.property.test.ts`, unit project, `numRuns: 100`, quantifying over
      arbitrary unmeasurable subsets including cross-Signal_Type subsets

  - [x] 1.4 Create `scripts/lib/aggregate.ts` — run aggregation, validity filtering, knee selection
    - `summarize(runs)` returning `{median, min, max}` with `min <= median <= max` and permutation
      invariance
    - `filterValidRepetitions(reps)` excluding repetitions that terminated before their measurement window
      completed and repetitions whose error rate exceeded 1 % of events submitted, returning the excluded
      set with each exclusion's termination reason or measured error rate
    - `selectKnee(series)` implementing the Requirement 11.3 rule (smallest N whose median events/s exceeds
      the next smaller N's median by ≤5 %), the Requirement 11.5 regression rule and the Requirement 11.6
      no-knee rule
    - _Requirements: 1.7, 11.3, 11.5, 11.6, 17.8, 17.9_ (design §1.2, §7.2)

  - [ ]* 1.5 Write property test for run aggregation
    - **Property 16: Run aggregation is permutation-invariant and range-respecting**
    - **Validates: Requirements 1.7**
    - `scripts/lib/aggregate.property.test.ts`, unit project, `numRuns: 100`

  - [ ]* 1.6 Write property test for repetition validity filtering
    - **Property 17: Incomplete and invalid repetitions never influence a reported aggregate**
    - **Validates: Requirements 17.8, 17.9**
    - `scripts/lib/repetition-validity.property.test.ts`, unit project, `numRuns: 100`, plus
      `arbSweepSeries` (monotone, flat, noisy, decreasing, no-knee) exercising `selectKnee`

  - [x] 1.7 Create `scripts/lib/statement-counter.ts` — server-statement counting
    - Export `StatementRecord`, `StatementTally` and `countStatements(client)` returning
      `{tally, reset, restore}` exactly as specified in design §2.1
    - Export `splitTopLevelStatements(sql)` as a pure function that is single-quote, `$tag$` dollar-quote,
      `--` comment and `/* */` comment aware, so a semicolon inside a JSON literal or a plpgsql body is
      never miscounted
    - Record both `roundTrips` and `serverStatements`, because `applyIngestionTransactionSettings()` joins
      up to four `SET LOCAL` statements into one round trip and round trips therefore undercount
    - Capture the calling stack frame inside `src/` into `caller`
    - _Requirements: 2.7, 9.1, 21.3_ (design §2.1)

  - [ ]* 1.8 Write property test for the statement splitter
    - **Property 14: The statement splitter counts top-level statements correctly**
    - **Validates: Requirements 9.1, 2.7**
    - `scripts/lib/statement-counter.property.test.ts`, unit project, `numRuns: 100`, generator
      `arbAdversarialSql` from design §Generators (semicolons in literals, dollar-quoted bodies, line and
      block comments, whitespace-and-comment-only text returning zero)

  - [x] 1.9 Create the evidence artifact directory and exclude it from the diff boundary
    - Create `artifacts/ingestion-phase2/.gitkeep`
    - Add `artifacts/ingestion-phase2/` to `.gitignore` — this is the one file the design deliberately
      touches outside the Requirement 19.6 path set, called out rather than smuggled in
    - _Requirements: 19.6_ (design §9)

- [ ] 2. Catalog audit, query-path scanner, and Index_Inventory generator
  - [x] 2.1 Extend `scripts/audit-ingestion-db-schema.ts` with usage, storage and autovacuum readings
    - Add `AuditOutputV2 extends AuditOutput` with `statsResetAt`, `indexUsage`, `tableStorage`,
      `toastRelations`, `autovacuumSettings`, `partitionIndexRollup` — additive only, so
      `scripts/summarize-ingestion-db-runtime.ts` and the evidence gate keep parsing older bundles
    - Implement the `indexUsage` query from design §1.3, summing `pg_relation_size` and `idx_scan` across
      the parent index **and every attached partition index** via `pg_inherits`; reading the parent alone
      produces a false zero that Requirement 22.6 would treat as removal authorization
    - Record `readUsage: 'unavailable'` with the reason when an index is missing from `pg_stat_all_indexes`
      or `track_counts` is off, and record `readUsageWindowSource: 'stats_reset_only'` when `last_idx_scan`
      is unavailable (pre-PostgreSQL 16)
    - Implement `tableStorage` (parents and every partition: table bytes, index bytes, live/dead tuples,
      dead percentage, last autovacuum/autoanalyze/vacuum/analyze), `toastRelations` with an explicit
      `hasToast: false` for a JSONB-bearing table without a TOAST relation, and `autovacuumSettings` from
      `reloptions` filtered to `autovacuum_*`
    - _Requirements: 4.1, 4.2, 4.3, 4.10, 5.1, 6.1, 12.1, 12.2, 12.4, 12.7, 12.8_ (design §1.3)

  - [~] 2.2 Correct the audited table set and reuse the prior-phase removed-index list
    - Replace `defaultTables` with the full Ingestion_Table_Set: the ten Canonical_Event_Tables plus
      `error_groups`, `error_group_history`, `analytics_error_groups`, `telemetry_outbox`,
      `alert_runtime_idempotency_keys`, `ingestion_dead_letter_jobs`
    - Record `events_errors_idempotency` as the unique guard index `idx_events_errors_event_unique` on
      `events_errors` created by `018_events_errors_idempotency.sql`, with that origin noted, so the
      glossary term resolves to a real object instead of a missing table
    - Read the eighteen prior-phase dropped index names from the existing `forbiddenRequestHotPathIndexes`
      list in `scripts/validate-ingestion-evidence-bundle.ts` rather than duplicating them, and emit each
      with its originating migration file (`025`/`028`/`029`), `REMOVE` marked `priorPhase: true`, and the
      catalog confirmation that the name is absent
    - _Requirements: 4.1, 4.11_ (design §1.3, §4.1)

  - [~] 2.3 Create `scripts/lib/query-path-scan.ts` and wire `--query-path-scan` into the audit script
    - Implement the nine-pattern set from design §4.2 per indexed column (containment, reversed
      containment, contained-by, key/any-key/all-keys existence, path extraction, key extraction,
      `jsonb_path_exists`/`jsonb_path_query*`, `WHERE`/`HAVING` co-occurrence as `weak`, and the index name
      itself)
    - Scan every `src/**/*.ts`; classify matches in `**/*.test.ts` as `strength: 'test-only'` and record
      them separately, because a test is not a production read path and must not justify `KEEP`
    - Emit `QueryPathScanEntry` (`patterns`, `globs`, `filesInspected`, `matches[]` with file, line range,
      snippet and strength), including an explicit empty `matches: []` when no predicate exists
    - _Requirements: 4.8, 5.2_ (design §4.2)

  - [ ]* 2.4 Write property test for the JSONB query-path scanner
    - **Property 15: The JSONB query-path scanner finds every predicate it must find**
    - **Validates: Requirements 5.2, 4.8**
    - `scripts/lib/query-path-scan.property.test.ts`, unit project, `numRuns: 100`, generator
      `arbSourceFileWithJsonbPredicate` including decoys (column name in a comment, in a string, in an
      unrelated expression)

  - [~] 2.5 Create `scripts/lib/index-inventory.ts` — inventory generator, redundancy detection, disposition gate
    - Build `IndexInventoryEntry` records from `AuditOutputV2.indexUsage` plus the query-path scan, with
      every field of the design §Data Models interface populated
    - Implement Requirement 4.7 redundancy detection as a pure computation over parsed `indkey` column
      ordering (not the `indexdef` string): flag every pair on the same table where one column list is an
      ordered leading prefix of the other, both share an access method, and both carry the same partial
      predicate or neither has one; both members carry their own disposition
    - Implement the §4.1 disposition state machine and the `assertDispositionsAuthorized(inventory)` gate:
      reject `REMOVE` without zero usage over a ≥24 h window plus an empty query-path scan plus both
      index-present and index-absent INSERT measurements; reject `REMOVE`/`MOVE_TO_DERIVED` on any entry
      recording uniqueness or idempotency; reject `REMOVE` when usage is unavailable or greater than zero;
      force `KEEP` plus a stated authorizing command when an authorizing measurement is unmeasured; record
      the `usage_without_predicate` discrepancy as `KEEP`
    - Assert the ten expected GIN index names from design finding F6 are present and record any additional
      GIN index found, reading the GIN set from the catalog rather than a hard-coded list
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 5.1, 5.5, 5.6, 5.8, 5.9, 22.1, 22.6_ (design §4.1, §4.2)

  - [ ]* 2.6 Write property test for the removal-authorization gate
    - **Property 20: No database object is removed without its authorizing evidence**
    - **Validates: Requirements 4.8, 4.9, 4.10, 5.5, 5.6, 5.8, 5.9, 22.1, 22.6**
    - `scripts/lib/index-inventory.property.test.ts`, unit project, `numRuns: 100`, generator
      `arbIndexInventory` deliberately allowed to produce **invalid** inventories, because the property is
      an if-and-only-if and the gate must reject them

- [ ] 3. Runtime, plan, throughput and index-cost harnesses
  - [~] 3.1 Add 1 Hz sampling mode to `scripts/diagnose-ingestion-db-runtime.ts`
    - Add `--duration-seconds` and `--sample-interval-ms` (default 1000) and emit one series per
      Signal_Type with every field of the design §3 table: `writePoolMax`, `active`, `idle`, `waiting`,
      `checkoutWaitMs` and `transactionMs` p50/p95/p99, `workerConcurrency`, `writePermits`,
      `admissionInFlight`, `admissionQueued`, `queueDepth`
    - Add the DB-side backend count from
      `SELECT COUNT(*) FROM pg_stat_activity WHERE application_name LIKE 'pulse_ingestion_writes_%'`, which
      is what makes Requirement 3.4 measurable at the database rather than inferred from the client
    - Add the `pg_stat_bgwriter`, `pg_stat_wal` and `pg_locks` (`granted = false`) delta sections used by
      the Requirement 10.2 attribution table
    - Emit the Requirement 3.2/3.7/3.8 verdict per Signal_Type from the 5 ms p95 checkout-wait rule,
      citing both the checkout-wait and batch-duration series
    - _Requirements: 3.1, 3.2, 3.7, 3.8, 10.2_ (design §3, §7.1)

  - [-] 3.2 Create `scripts/lib/pg-stat-statements.ts` — capability probe, scoped reset, delta capture
    - Probe with `SELECT to_regclass('pg_stat_statements') IS NOT NULL`; on absence record
      `statementCostSource: 'explain_analyze'` and the absence itself
    - Reset scoped by `(userid, dbid)` so the measurement is valid on a shared benchmark cluster; on
      permission failure fall back to a `calls` / `total_exec_time` delta with
      `resetScope: 'delta_without_reset'` and the concurrent-activity caveat recorded
    - Capture `queryid`, query prefix, `calls`, `total_exec_time`, `mean_exec_time`, `rows`, `wal_bytes`,
      `shared_blks_hit`, `shared_blks_read` filtered to the current role and database
    - Record the `Unmeasured_Declaration` with a reason when neither this source nor the in-process
      counter can run
    - _Requirements: 1.6, 8.3, 9.1, 9.8_ (design §2.2)

  - [-] 3.3 Extend `scripts/explain-ingestion-writes.ts` with WAL extraction and the environment guard
    - Flatten per-statement `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` output into a table keyed by
      statement, exposing WAL records/bytes/FPI per statement alongside plan node types and the index names
      appearing in the plan
    - Call `assertBenchEnvironment()` before any `EXPLAIN ANALYZE`, aborting non-zero when the resolved
      environment is not allowlisted; when a plan is obtainable only from production, omit it, record the
      `Unmeasured_Declaration` for that statement and record the reason
    - _Requirements: 8.3, 8.4, 8.5, 8.6_ (design §1.1, §Component map)

  - [~] 3.4 Extend `scripts/bench-ingestion-worker.ts` with windows, repetitions, WAL and mix control
    - Add `--warmup-seconds`, `--duration-seconds`, `--repetitions`, and a sustained mode, discarding the
      warm-up window from every reported value
    - Add WAL bytes per batch transaction from `pg_current_wal_lsn()` sampled on a separate connection
      immediately before `BEGIN` and after `COMMIT`, differenced with `pg_wal_lsn_diff()`; record
      `walAttribution: 'exclusive_cluster' | 'shared_cluster'` from the concurrent non-idle backend count
      and mark shared-cluster figures as upper bounds
    - Add a per-Signal_Type offered-rate mix specification (for the Requirement 13.1 composition) and
      per-organization offered-share specification with benchmark-only per-org metric labels (production
      metrics stay aggregate to avoid unbounded label cardinality)
    - Wire `countStatements()` from task 1.7 and `summarize()` / `filterValidRepetitions()` from task 1.4;
      emit every value through `Measured<T>`
    - Record process CPU ms, peak RSS MB and `ingestion-workers` restart count per run
    - _Requirements: 1.7, 3.1, 10.1, 11.1, 11.2, 13.1, 13.2, 14.3, 15.6, 16.1, 17.1, 17.2_ (design §Component map, §7)

  - [~] 3.5 Add the `phase2` preset to `scripts/run-ingestion-benchmark-matrix.ts`
    - Cover all nine Workload_Classes with ≥3 repetitions each, ≥10 s warm-up and ≥60 s measurement window
      per repetition, and the batch-size grid N ∈ {1, 10, 25, 50, 100, 200, 500} × ten Signal_Types
    - Label every cell with its Workload_Class and aggregate repetitions through `scripts/lib/aggregate.ts`
    - Record the per-cell `excludedReason` values from design §Data Models
      (`error_rate_regression`, `exceeds_job_max_bytes`, `exceeds_statement_timeout`, `terminated_early`)
    - _Requirements: 11.1, 11.7, 11.8, 17.1, 17.3, 17.8, 17.9_ (design §7.2)

  - [~] 3.6 Create `scripts/measure-ingestion-index-cost.ts` — the only DDL-executing harness
    - Enforce all five guards before any DDL: (1) `--allow-ddl` present, (2) resolved environment in the
      allowlist, (3) `SELECT current_database()` equals an explicitly supplied `--expect-database`,
      (4) `pg_is_in_recovery()` false, (5) measured tables' `n_live_tup` below `--max-live-tuples`
      (default 5,000,000)
    - Per-index procedure from design §4.3: capture `pg_get_indexdef` and summed size, seed and time R
      repetitions of a 200-row single-signal batch through `TelemetryWriter`, `DROP INDEX IF EXISTS`,
      repeat the identical batch, execute the captured definition verbatim, then **assert
      `pg_get_indexdef` equals the captured text**
    - Restoration failure is a **hard stop**: exit non-zero, print the captured definition to stdout for
      manual replay, and record the index `restorationFailed` so the evidence gate refuses the bundle
    - Delete every seeded row by `payload->>'benchRunId'` so no rows are left behind
    - Add `--target trigger` mode: `ALTER TABLE … DISABLE TRIGGER` where permitted else `DROP TRIGGER` with
      `pg_get_triggerdef` captured and restored verbatim, R = 5, on `events_errors` and `events_spans`;
      condition B supplies `public_id`, `metadata.environment`, `payload`, `occurred_at`, `created_at`,
      `ingested_at` explicitly and the harness asserts on a sample row that `public_id` matches the
      contract and `metadata->>'environment' = environment`, aborting as unmeasured if not
    - Add `--target sequence` mode recording INSERT duration and `SELECT last_value FROM seq_pubid_*`
      advance with `public_id` supplied versus omitted
    - Emit `presentMedianMs`, `presentP95Ms`, `absentMedianMs`, `absentP95Ms`, `deltaMs`, `deltaPct` and
      the printed `deltaFormula`, plus per-row trigger overhead in microseconds with its formula
    - On any guard failure or rejected `DROP`/`DISABLE`, record the `Unmeasured_Declaration` with the
      reason, force `KEEP`, and state the command that would authorize removal
    - _Requirements: 4.8, 5.3, 5.4, 5.8, 6.4, 6.9, 7.8, 17.5, 22.1_ (design §4.3, §5.3)

  - [ ]* 3.7 Write integration test for the index-cost harness safety guards
    - Against a scratch database: assert each of the five guards rejects before issuing any DDL (a
      non-allowlisted environment, a mismatched `--expect-database`, a simulated standby, an oversized
      table, and a missing `--allow-ddl`), assert `pg_get_indexdef` equals the captured definition after a
      successful run, and assert the seeded measurement rows are gone
    - `scripts/__tests__/measure-ingestion-index-cost.integration.test.ts`
    - _Requirements: 5.4, 22.1_ (design §Testing Strategy, integration tests)

- [ ] 4. Evidence gate and change-set ledger
  - [~] 4.1 Extend `scripts/validate-ingestion-evidence-bundle.ts` into the Requirement 17.4 gate
    - Fail the bundle when any evidence entry is neither `measured` with complete provenance nor a
      byte-exact `Unmeasured_Declaration` with a non-empty reason — the third state is what the gate exists
      to catch
    - Fail when `provenance.repetitions` does not equal `runs.length`, when `environment` is not
      allowlisted, when `timestampUtc` is not ISO 8601 UTC, or when `gitCommit` is empty
    - Fail when the Baseline_Record's recorded `git status --porcelain` is non-empty for any path under
      `src/modules/ingestion/`, `src/modules/errors/`, `database/migrations/logdb/` or `src/config/env.ts`
      — the mechanical enforcement of Requirement 1.4
    - Fail when a derived number lacks its constituent measurements and stated arithmetic
    - Fail when any GIN index or trigger branch in the bundle lacks a disposition, and when any index
      carries `restorationFailed`
    - _Requirements: 1.4, 4.10, 5.5, 17.4, 17.5, 17.6, 17.7, 20.6, 20.9, 22.1_ (design §1.1, §10)

  - [~] 4.2 Create `scripts/lib/change-set.ts` — the Phase_2_Change_Set ledger and rank gate
    - Implement `ChangeRecord` from design §Data Models with `rank`, `citedEvidence`, `modifiedFiles`,
      `before`/`after`/`changePct`, `implementedAtUtc`, `status`, `deferredRequiredCommand`,
      `rejectionEvidence`, `requiresOperatorApproval`, `approvalRecordedAtUtc`
    - Implement `assertRankOrdering(changes)`: every change carries exactly one rank, ≥1 cited evidence
      entry, ≥1 modified file path and a UTC implementation timestamp; ordered by that timestamp, no P1
      precedes an unimplemented P0 and no P2 precedes an unimplemented P1
    - Implement `assertApprovalGating(changes)`: every change marked out of scope, deferred, or requiring
      explicit operator approval is absent from the implemented set until an approving decision with a UTC
      timestamp is recorded
    - _Requirements: 12.6, 14.5, 21.6, 21.7, 22.3, 22.4, 22.5, 22.7, 22.8_ (design §Data Models, §10)

  - [ ]* 4.3 Write property test for the change-set ranking and approval gate
    - **Property 21: Every change is ranked, evidenced, and implemented in rank order**
    - **Validates: Requirements 12.6, 14.5, 21.6, 21.7, 22.3, 22.4, 22.5, 22.7, 22.8**
    - `scripts/lib/change-set.property.test.ts`, unit project, `numRuns: 100`, generator `arbChangeSet`
      including orderings that violate the P0-before-P1 rule and approval states that must be rejected

- [~] 5. Checkpoint — instrumentation complete, guarded paths untouched
  - Run `npm run test` and confirm the new `scripts/lib/**` property tests pass
  - Confirm `git status --porcelain` reports **no** changes under `src/modules/ingestion/`,
    `src/modules/errors/`, `database/migrations/logdb/` or `src/config/env.ts` — if it does, the baseline
    in task 6 is invalid under Requirement 1.4
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Baseline capture — the Requirement 1.4 ordering gate
  - [~] 6.1 Create `scripts/capture-ingestion-baseline.ts` — the baseline runner
    - Reachability probe: 3 connection attempts each with a 10 s `connectionTimeoutMillis`; on exhaustion
      mark every metric of every Signal_Type unmeasured with the driver error as the reason and continue in
      catalog-and-source-only mode
    - Sequence the four harness commands from design §1.2 in order: `npm run ingestion:db:audit`,
      `npm run explain:ingestion`, `npm run bench:ingestion:matrix -- --preset phase2 --mode processor
      --commit --repetitions 3 --warmup-seconds 30 --duration-seconds 60`, and
      `npm run ingestion:db:runtime -- --duration-seconds 300 --sample-interval-ms 1000` executed
      **concurrently** with the sustained cell, since Requirement 3.1 requires 1 Hz samples while the
      sustained workload runs
    - Record `gitCommit`, `git status --porcelain`, `statementCostSource` and the connectivity block; emit
      `BaselineRecord` per design §Data Models to `artifacts/ingestion-phase2/baseline-record.json`
    - Per-Signal_Type failure isolation: a non-zero harness exit, or zero ingested events across all
      repetitions for a Signal_Type, marks only that Signal_Type unmeasured with the failing command and
      reason; siblings keep their values
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 3.1_ (design §1.2)

  - [~] 6.2 Execute the baseline runner and validate the bundle
    - Run `scripts/capture-ingestion-baseline.ts` on a clean tree and commit
      `artifacts/ingestion-phase2/baseline-record.json` content into the evidence bundle
    - Run `scripts/validate-ingestion-evidence-bundle.ts` against it and confirm the clean-tree gate passes
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 17.6_ (design §1.2)

  - [~] 6.3 Capture the pre-change Regression_Suite pass list
    - Run `npm run test` and `npm run test:integration` once, before any guarded-path modification, and
      write the full passing-test list to `artifacts/ingestion-phase2/pre-change-pass-list.json`
    - _Requirements: 19.4, 19.5_ (design §9)

  - [~] 6.4 Promote the bench environment allowlist into `src/config/env.ts`
    - Add `INGESTION_BENCH_ENV_ALLOWLIST` as a comma-separated Zod-validated setting with default
      `staging,bench,benchmark,local`, and have `assertBenchEnvironment()` in
      `scripts/lib/ingestion-evidence.ts` consume it
    - This is **deliberately the first guarded-path modification in the plan**; it must not happen before
      task 6.2 completes
    - _Requirements: 5.4, 8.5_ (design §1.1)

- [ ] 7. Forensic inventories, attribution and sweeps (read-only against the Log_DB)
  - [~] 7.1 Generate the Write_Path_Map
    - Create `scripts/generate-ingestion-write-path-map.ts` emitting `WritePathMapEntry` per Signal_Type
      with the ordered stages (endpoint → queue insert → worker claim → batch assembly → validation →
      normalization → connection acquisition → `BEGIN` → SQL statements → outbox insert → `COMMIT` → ack),
      each carrying its source file path and line range
    - Classify every database operation as per-event or per-batch using the design §1.4 rule (per-batch
      when the call site lies outside any loop over `scoped`/`errors`/`items`), recording `loopVariable` as
      the reviewer-checkable discriminator
    - Populate `perRow` from the catalog reading: indexes maintained, triggers fired, defaults evaluated,
      generated columns computed, constraints checked
    - Emit the closed-form `statementCountFormula` per Signal_Type from the design §1.4 table, including
      the `[outbox]` term documented explicitly as a property of batch *contents* rather than of N
    - Emit remediation candidates mechanically for every per-event `SELECT`/`INSERT`/`UPDATE`/`DELETE`/
      advisory-lock operation with file, line range, observed per-event count and achievable per-batch count
    - Programmatically assert each of the ten Signal_Types has an `INGEST_QUEUES` entry, a
      `TelemetryWriter.writeTyped()` case and a target table; record any failing type as unimplemented with
      its missing stages
    - Confirm each closed form against observed counts at N ∈ {1, 10, 50, 200}
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_ (design §1.4)

  - [~] 7.2 Execute the Index_Inventory and GIN forensics collection
    - Run `npm run ingestion:db:audit -- --query-path-scan` and generate the full Index_Inventory through
      `scripts/lib/index-inventory.ts` into `artifacts/ingestion-phase2/index-inventory.json`
    - Confirm the read-usage window spans at least 24 h or one complete Benchmark_Matrix run, whichever is
      longer, recording `statsResetAt` and the reading timestamp
    - Record the redundancy pairs, the prior-phase dispositions, and per-GIN-index `ginEvidence`
      `jsonbPredicates`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.11, 5.1, 5.2_ (design §1.3, §4.1, §4.2)

  - [~] 7.3 Execute the index-present versus index-absent INSERT measurements
    - Run `scripts/measure-ingestion-index-cost.ts --allow-ddl --expect-database <db>` for every candidate
      index (the ten GIN indexes of design finding F6 first), R = 3, 200 rows per repetition
    - Attach each `IndexInsertCostMeasurement` to its inventory entry, run
      `assertDispositionsAuthorized()`, and record for every index that could not be measured the
      `Unmeasured_Declaration`, the forced `KEEP` and the authorizing command
    - Enumerate `narrowKeys` (≤5) and specify an expression index, partial index or derived-table
      alternative wherever a bounded JSONB read requirement exists
    - _Requirements: 4.8, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 22.1, 22.6_ (design §4.2, §4.3, §4.4)

  - [~] 7.4 Generate the Trigger_Inventory with the `RETURNING` branch probe
    - Create `scripts/generate-ingestion-trigger-inventory.ts` enumerating every trigger on the
      Ingestion_Table_Set from the catalog, including partitioned-parent triggers, partition-attached
      triggers and disabled triggers, with `whenClause`, `statementsPerInvocation` and
      `sequenceCallsPerInvocation`
    - For one Telemetry_Writer-inserted row on each of the ten Canonical_Event_Tables, record all four
      `logdb_sync_typed_event_contract` branches (timestamps, `metadata` environment, `public_id`, `payload`
      fallback) as `taken` or `skipped`, **confirmed by a `RETURNING` probe** comparing returned
      `public_id`, `metadata->>'environment'`, `occurred_at`, `created_at`, `ingested_at` and
      `jsonb_typeof(payload)` against the submitted values, so `verifiedBy: 'returning_probe'` rather than
      code reading
    - Record the `ai_response` interaction between branch 4 and the GIN inventory so the two are not
      evaluated independently
    - Assign each branch `duplicative` or `load-bearing` with its guarantee and its regression test file
    - _Requirements: 6.1, 6.2, 6.3, 6.7, 6.8_ (design §5.1, §5.4)

  - [~] 7.5 Execute the trigger-cost and sequence-advance measurements
    - Run `scripts/measure-ingestion-index-cost.ts --target trigger` (R = 5, 200 rows, `events_errors` and
      `events_spans`) and `--target sequence`, recording median ms, p95 ms, per-row overhead in
      microseconds with the printed formula, and the condition-B contract assertion result
    - On privilege failure record the `Unmeasured_Declaration` with the reason and mark the design §6.2
      narrowing deferred
    - _Requirements: 6.4, 6.9, 7.8_ (design §5.3)

  - [~] 7.6 Generate the public identifier, sequence and default analysis
    - Emit `PublicIdAnalysisEntry` per Canonical_Event_Table: default expression, backing sequence, trigger
      branch, and the assigning mechanism plus contract satisfaction for each of the three shapes
      (omitted, `NULL`, empty string)
    - Record that gaps from rollback are permitted and reuse impossible because sequences are
      non-transactional, that `idx_events_*_pubid` is non-unique so uniqueness is a generator property, and
      that Requirement 7.7 is **currently unenforced** for an explicitly supplied malformed value — the gap
      task 9 closes
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_ (design §5.2)

  - [~] 7.7 Execute the INSERT and statement cost attribution
    - Per Canonical_Event_Table, 200-event controlled batch replayed ≥3 times: rows inserted, bytes
      inserted, INSERT duration, WAL bytes, index count, total index size, median reported with command,
      environment and UTC timestamp per run
    - Attribute INSERT duration on `events_traces`, `events_spans`, `events_logs`, `events_requests` and
      `events_errors` across index maintenance, WAL generation, trigger execution, constraint checking,
      TOAST activity, lock waiting and CPU, with the remainder recorded as unattributed so the percentages
      sum to 100 ± 5
    - For every statement at or above 1 % of measured database time, record calling file path and line
      range, statement text, execution count, mean and p95 duration and the plan
    - Record any table assigning ≥25 % of INSERT duration to index maintenance as a remediation candidate
      together with its Index_Inventory entries
    - Record the `Unmeasured_Declaration` per metric for unmeasurable WAL, TOAST or lock-wait values while
      retaining the table's other measured values
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_ (design §2.2, §Component map)

  - [~] 7.8 Execute the transaction, WAL and COMMIT attribution
    - Aggregate ≥100 batch transactions per Signal_Type into p50/p95/p99 for `BEGIN`, summed statement,
      outbox insert, `COMMIT`, connection hold time (`transactionMs + dbConnectionWaitMs`, derivation
      printed) and WAL bytes per batch transaction
    - Where p95 `COMMIT` exceeds p95 summed statement duration by more than 10 %, attribute the excess
      across WAL flush latency, checkpoint activity, lock waiting and concurrent write pressure with the
      cited measurement from the design §7.1 table for each
    - Read `synchronous_commit` and `statement_timeout` back **inside** an ingest transaction via `SHOW`
      and record the observed values rather than the config defaults
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.8_ (design §7.1)

  - [~] 7.9 Execute the error-ingestion statement count measurement and classification
    - Create `scripts/measure-error-ingestion-statements.ts` covering the eight cells N ∈ {1, 10, 50, 200}
      × fingerprint distribution ∈ {distinct-per-event, single-repeated}, and separately the new-group,
      existing-group and merged-group states
    - Issue `BEGIN` and `applyIngestionTransactionSettings()` outside the measured window so the
      Requirement 9.1 exclusion of `BEGIN`/`COMMIT` is structural rather than arithmetic; `ROLLBACK` unless
      `--commit` so repeated measurement accumulates neither rows nor bloat
    - Classify `growing` when `count(200) − count(1) > 2` for the same fingerprint distribution, `bounded`
      otherwise, per distribution independently, cross-validating the in-process counter against
      `pg_stat_statements`
    - When the classification is `bounded`, record the `Q(N) = 3N + 6` hypothesis as **falsified** citing
      all eight counts; record the pre-change per-batch error statement counts at N ∈ {1, 10, 50, 200} for
      the Requirement 9.7 before/after pair
    - _Requirements: 9.1, 9.2, 9.4, 9.7, 9.8_ (design §2.1, §2.2, §6.1)

  - [~] 7.10 Execute the storage and autovacuum analysis
    - From `AuditOutputV2`, record per parent and per partition: table bytes, index bytes, live/dead tuples,
      dead percentage, last autovacuum and autoanalyze timestamps, plus TOAST size or explicit absence
    - Apply the Requirement 12.3 candidate rule including the second clause (`n_live_tup = 0` with
      `n_dead_tup ≥ 1000`), which catches a freshly truncated or new partition whose estimate has not
      caught up and that a percentage test alone would silently pass
    - Derive proposed `autovacuum_vacuum_scale_factor`, `autovacuum_vacuum_threshold` and
      `autovacuum_analyze_scale_factor` per candidate **from its measured dead-tuple ratio**, recording the
      ratio that produced each number
    - Record any full-rewrite remediation (`VACUUM FULL`, `CLUSTER`, rewriting `ALTER TABLE`) with measured
      table size, an estimated maintenance window derived from it, and the mark
      `requiresOperatorApproval: true` plus its exclusion from the Phase_2_Change_Set
    - Record a missing `last_autovacuum`/`last_autoanalyze` as never autovacuumed/analyzed **together with**
      `statsResetAt`, so "never" and "not since the stats reset" are not conflated
    - Cite the analytics engine's `retention_jobs`/`retention_statistics` ownership of retention pruning
      rather than adding a second pruning path
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6, 12.8_ (design §7.3)

  - [~] 7.11 Execute the batch size sweep
    - Run the `phase2` matrix grid N ∈ {1, 10, 25, 50, 100, 200, 500} × ten Signal_Types, 3 runs × ≥60 s
      with the first 30 s discarded, recording every field of `BatchSizeSweepCell`
    - Apply `selectKnee()`, the >5 % regression rule and the no-knee rule; exclude any N whose error rate
      exceeds N = 1's for the same Signal_Type, recording both rates
    - State one recommended value each for `INGESTION_JOB_CHUNK_SIZE`, `INGESTION_GENERAL_BATCH_SIZE` and
      `INGESTION_SPECIALIZED_BATCH_SIZE`; for the latter two state plainly that the setting is currently
      **inert** (design finding F8), give the value that would apply if the tiers were wired, and record the
      live equivalent — a recommendation for an inert knob without that statement is a number that looks
      measured and is not
    - Record the `Unmeasured_Declaration` per unmeasurable (N, Signal_Type) cell with its reason
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_ (design §7.2)

  - [~] 7.12 Execute the cross-signal interference comparison
    - Mixed run: trace + span ≥60 % of offered events, request/error/log each ≥10 %, ≥300 s, ≥100,000
      offered events; control runs: each of request, error, log, trace, span alone at the **same offered
      events/s for that signal**, same batch size, worker concurrency, environment and build
    - Record interference when mixed p95 queue wait for request, log or error exceeds its single-signal p95
      by more than 50 %; record absence with both values cited when all three stay within 50 %
    - Record the interference verdict `unavailable` with the `Unmeasured_Declaration` and reason when a run
      cannot execute
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.7_ (design §7.4)

  - [~] 7.13 Execute the multi-tenant fairness measurement
    - Multi-tenant class with ≥5 organizations, one submitting ≥90 % of offered events; record per
      organization events/s, queue wait p50/p95/p99, deferral count and the count admitted after reaching
      `INGESTION_FAIRNESS_MAX_DEFERS`, reading `recordDeferred` and
      `recordFairnessStarvationAdmission` from the metrics endpoint with benchmark-only per-org labels
    - Record `retainedPct` against the Baseline_Record for every organization submitting ≤10 % of offered
      events, and flag any shortfall below 95 % as a fairness regression attributed to the change that
      produced it and marked `requiresOperatorApproval: true`
    - _Requirements: 14.3, 14.4, 14.5_ (design §7.5)

  - [~] 7.14 Compute and validate the memory bound
    - Emit `MemoryBound` with `maxInFlightJobs = queues × INGESTION_TYPE_WORKER_CONCURRENCY ×
      INGESTION_TYPE_WORKER_BATCH_SIZE`, `worstCaseJobBytes = maxInFlightJobs × INGESTION_JOB_MAX_BYTES`,
      plus measured peak serialized batch allocation and measured peak DB connection buffer allocation,
      recording the setting or measurement behind every input term
    - Apply the 358 MB ceiling (70 % of the 512 MB `--max-old-space-size` on the `ingestion-workers` PM2
      entry); lower any task 7.11 recommendation whose worst case, measured peak RSS, or restart count
      breaches it, recording every rejected candidate alongside the adopted value
    - Count restarts from PM2 rather than inferring them from the heap figure, since the separate
      `max_memory_restart: '700M'` bound means RSS above the heap limit is possible
    - Record peak RSS MB, restart count and run timestamp at the recommended batch size and concurrency
    - _Requirements: 15.1, 15.3, 15.6_ (design §7.6)

  - [~] 7.15 Execute the write amplification accounting
    - Per Signal_Type from a controlled 200-event batch, to two decimal places: Canonical_Event_Table rows
      written, rows **updated** as a separate term so the design finding F7 double write is visible, index
      entries maintained split by access method, `telemetry_outbox` rows, auxiliary rows
      (`alert_runtime_idempotency_keys`, `error_groups`, `error_group_history`), and WAL bytes per event
      cross-checked between the LSN delta and summed `pg_stat_statements.wal_bytes`
    - Compute removal candidates as the recorded per-event writes minus the pinned set (`telemetry_outbox`
      delivery, `alert_runtime_idempotency_keys` reservations, usage accounting, uniqueness/idempotency
      indexes) intersected with `KEEP`-disposition indexes, each with the writing code's file and line
      range and its measured per-event WAL
    - _Requirements: 16.1, 16.4, 16.6_ (design §7.7)

  - [~] 7.16 Rank the bottlenecks and assign P0/P1/P2
    - Order every recorded bottleneck by measured contribution to batch transaction duration, highest
      first, each carrying its measured contribution and its Evidence_Record source
    - Assign every proposed change exactly one rank through `scripts/lib/change-set.ts`: P0 for a defect
      threatening durability, correctness, idempotency, the Public_ID_Contract, usage accounting or tenant
      fairness; P1 for a measured latency or write-amplification defect; P2 for secondary optimization and
      observability
    - Mark every change whose authorizing measurement is unmeasured as **deferred** with its required
      command, and confirm `assertRankOrdering()` and `assertApprovalGating()` pass over the ledger
    - _Requirements: 3.7, 8.8, 20.7, 22.3, 22.5, 22.7_ (design §Architecture control flow, §10)

- [~] 8. Checkpoint — forensics complete before any remediation
  - Run `scripts/validate-ingestion-evidence-bundle.ts` and confirm every collected artifact passes the
    Requirement 17.4 gate
  - Confirm every entry in `index-inventory.json` carries a disposition and every `REMOVE` carries its
    three authorizing evidence items
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. P0 — Public_ID_Contract enforcement (unconditional, design §6.3)
  - [~] 9.1 Add the `public_id` CHECK constraints migration and its down file
    - Create `database/migrations/logdb/03_observability_v2/032_public_id_contract_checks.sql` with ten
      `ALTER TABLE … ADD CONSTRAINT chk_events_<t>_public_id CHECK (public_id ~ '^<PFX>-[0-9]{9,19}$') NOT VALID`
      statements using the design §5.2 prefixes (`REQ`, `ERR`, `TRC`, `SPN`, `LOG`, `MTR`, `MSG`, `RPL`,
      `PRF`, `CRN`)
    - `NOT VALID` is immediately enforcing for new rows, which is the actual requirement, and avoids an
      `ACCESS EXCLUSIVE` validation scan during the migration; the `BEFORE` trigger has already replaced a
      `NULL`/`''` `public_id` by the time constraints are checked, so all three legal insert shapes pass
    - Create `032_public_id_contract_checks.down.sql` following the design §8.4 convention exactly: ten
      `DROP CONSTRAINT IF EXISTS` statements, then
      `DELETE FROM logdb_migrations WHERE filename = '03_observability_v2/032_public_id_contract_checks.sql'`
      — keyed on the exact recorded relative path so precisely one ledger row is removed
    - _Requirements: 7.7, 18.1, 18.2, 18.4, 18.5, 18.8, 18.9_ (design §6.3, §8.2, §8.4)

  - [~] 9.2 Add the `db_constraint_violation` failure class for SQLSTATE 23514
    - Add the class to `ingestionFailureClass()` in `src/modules/ingestion/workers/event-processor.ts` and
      to `failureReason()` in `src/modules/ingestion/workers/worker-registry.ts`, classified **permanent**
      so the batch is dead-lettered rather than retried
    - Keep the existing `23*` prefix rule for `23505`, which genuinely is an idempotency signal; without
      the new class a CHECK violation is classified `idempotency` and burns three retries on a batch that
      can never succeed
    - _Requirements: 7.7, 10.7, 19.8_ (design §6.3, §Error Handling)

  - [ ]* 9.3 Author the approval-gated `VALIDATE CONSTRAINT` file and record it as excluded
    - Create `database/migrations/logdb/03_observability_v2/033_public_id_contract_validate.sql` with ten
      `ALTER TABLE … VALIDATE CONSTRAINT` statements
    - Record it in the change-set ledger with `requiresOperatorApproval: true` and **excluded from the
      implemented set**, because the validation scan is a maintenance action on a large deployment. The
      task is to author the artifact and record the gate, not to obtain the approval
    - _Requirements: 12.5, 12.6, 21.7_ (design §6.3, §8.2)

  - [ ]* 9.4 Write property test for the Public_ID_Contract across insert shapes
    - **Property 1: Public_ID_Contract holds for every insert shape**
    - **Validates: Requirements 6.5, 7.2, 7.3, 7.6, 19.1, 19.2, 21.1**
    - `src/modules/ingestion/__tests__/public-id-contract.property.test.ts`, integration project,
      `numRuns: 100`, generators `arbCanonicalTable` and `arbPublicIdShape` (omitted / `NULL` / empty)

  - [ ]* 9.5 Write property test for public identifier non-reuse
    - **Property 2: Public identifier numeric portions are never reused**
    - **Validates: Requirements 7.4**
    - `src/modules/ingestion/__tests__/public-id-sequence.property.test.ts`, integration project,
      `numRuns: 100`, quantifying over interleavings of committed and rolled-back batches

  - [ ]* 9.6 Write property test for malformed public identifier rejection
    - **Property 3: Malformed public identifiers are rejected**
    - **Validates: Requirements 7.7**
    - `src/modules/ingestion/__tests__/public-id-rejection.property.test.ts`, integration project,
      `numRuns: 100`, asserting SQLSTATE `23514`, the `db_constraint_violation` classification and zero
      rows persisted in the enclosing batch

- [ ] 10. Preserved-behaviour property tests and regression assertions
  - [ ]* 10.1 Write property test for metadata environment equality
    - **Property 4: Metadata environment equality is preserved**
    - **Validates: Requirements 6.6, 21.1**
    - `src/modules/ingestion/__tests__/metadata-environment.property.test.ts`, integration project,
      `numRuns: 100`, generator `arbMetadata` including `NULL`, a JSONB array, a JSONB scalar, `{}`, an
      object without `environment`, and an object whose `environment` conflicts with the column — the
      non-object cases are what exercise the `jsonb_typeof` disjunct of the task 12.1 `WHEN` guard

  - [ ]* 10.2 Write property test for submitted-field round trip
    - **Property 5: Submitted event fields round-trip through persistence**
    - **Validates: Requirements 19.1, 19.7**
    - `src/modules/ingestion/__tests__/event-round-trip.property.test.ts`, integration project,
      `numRuns: 100`, including the submitted trace identifier on every persisted span row and the
      submitted request identifier on every persisted event row

  - [ ]* 10.3 Write property test for error group accumulation and re-delivery idempotency
    - **Property 6: Error group accumulation is exact and idempotent under re-delivery**
    - **Validates: Requirements 9.5, 19.2, 21.1**
    - `src/modules/errors/__tests__/error-group-accumulation.property.test.ts`, integration project,
      `numRuns: 100`, generator `arbErrorBatch` over a small fingerprint alphabet with generated timestamps
      so ties, reversals and duplicates are seen; asserts grouping is driven by the **confirmed-inserted**
      set, not the submitted set

  - [ ]* 10.4 Write property test for resolved-group regression
    - **Property 7: A qualifying event on a resolved group regresses it without changing its grouping**
    - **Validates: Requirements 9.9**
    - `src/modules/errors/__tests__/error-group-regression.property.test.ts`, integration project,
      `numRuns: 100`

  - [ ]* 10.5 Write property test for opposite-order concurrent error batches
    - **Property 8: Concurrent opposite-order error batches never deadlock**
    - **Validates: Requirements 9.6, 9.10**
    - `src/modules/errors/__tests__/error-group-lock-order.property.test.ts`, integration project,
      `numRuns: 100`, asserting both transactions commit without a `40P01` deadlock error

  - [ ]* 10.6 Write property test for duplicate outbox suppression
    - **Property 9: Duplicate events produce no outbox rows**
    - **Validates: Requirements 16.2, 19.2, 21.1**
    - `src/modules/ingestion/__tests__/outbox-duplicate-suppression.property.test.ts`, integration project,
      `numRuns: 100`

  - [ ]* 10.7 Write property test for ingest transaction atomicity
    - **Property 10: A failed ingest transaction persists nothing**
    - **Validates: Requirements 7.7, 10.7, 19.7, 19.8, 21.1**
    - `src/modules/ingestion/__tests__/transaction-atomicity.property.test.ts`, integration project,
      `numRuns: 100`, injecting a raised error, a constraint violation and a `statement_timeout`
      cancellation (via a 1 ms `statement_timeout`) and asserting zero rows, the error surfaced to the
      Event_Processor and no acknowledgement

  - [ ]* 10.8 Write property test for write admission
    - **Property 11: Write admission is FIFO, leak-free, and bounded by pool capacity**
    - **Validates: Requirements 3.3, 3.4, 21.1**
    - `src/modules/ingestion/pipeline/write-admission.property.test.ts`, unit project, `numRuns: 100`,
      generator `arbAdmissionSchedule` that **must** include a throw on the last in-flight handler, the
      case that leaks a permit if `finally` is ever removed

  - [ ]* 10.9 Write property test for batch-size-independent statement count
    - **Property 12: Per-batch server statement count is independent of batch size**
    - **Validates: Requirements 2.4, 2.7, 9.2, 9.3, 21.3**
    - `src/modules/ingestion/pipeline/statement-count.property.test.ts`, unit project, `numRuns: 100`,
      using a recording stub `PoolClient` wrapped by `countStatements()`, asserting the closed form from the
      Write_Path_Map, the Baseline_Record ceiling, and a difference from N = 1 of at most 2 statements for
      either fingerprint distribution at N ∈ {1, 10, 50, 200, 500}

  - [ ]* 10.10 Write property test for fingerprint memoization
    - **Property 13: The error fingerprint is computed exactly once per ingested error event**
    - **Validates: Requirements 16.3**
    - `src/modules/ingestion/pipeline/error-fingerprint.property.test.ts`, unit project, `numRuns: 100`,
      instrumenting `computeErrorFingerprint` with a call counter and asserting exactly N invocations for N
      events irrespective of the distinct fingerprint count

  - [~] 10.11 Write the ten-signal round-trip integration test
    - Submit one event of each of the ten Signal_Types through the gateway, drain the worker, assert
      retrievability from the Canonical_Event_Table after acknowledgement, a non-empty `public_id`, and
      field-by-field equality with the submitted values
    - `src/modules/ingestion/__tests__/ten-signal-round-trip.integration.test.ts`
    - _Requirements: 19.1, 19.2_ (design §Testing Strategy, integration tests)

  - [~] 10.12 Write the retry, acknowledgement, usage and correlation assertions
    - Assert a transient failure returns the job to the queue and a permanent failure does not; that
      acknowledgement occurs only after `COMMIT` succeeds; that usage counters increase by the persisted
      non-duplicate count; that every persisted span references its submitted trace identifier; and that
      every persisted row carries its submitted request identifier
    - Record, for each of durability, idempotency, tenant fairness, the Public_ID_Contract, billing and
      usage accounting, `telemetry_outbox` correctness and retry semantics, the asserting test path and its
      post-change pass result into the evidence bundle
    - Also assert the Requirement 14.6 structural claim: under mixed tenant load every write-admission
      permit and every database connection is observed serving more than one organization during the run,
      and no worker slot, permit or connection is reserved for a single organization identifier
    - `src/modules/ingestion/__tests__/retry-and-guarantees.integration.test.ts`
    - _Requirements: 14.6, 19.7, 21.1, 21.4_ (design §7.5, §9)

  - [~] 10.13 Write the boot-guard and backpressure example unit tests
    - `INGESTION_LOG_DB_STATEMENT_TIMEOUT_MS >= INGESTION_JOB_EXPIRE_SECONDS × 1000` throws at module load
      with the ordering message, which is what makes "terminate before claiming any job" hold by
      construction
    - Shedding thresholds at exactly `INGESTION_BACKPRESSURE_HIGH_WATER`, one below it, exactly
      `INGESTION_BACKPRESSURE_CRITICAL_WATER` and one below it, for a free/starter/growth event and for a
      business/enterprise `error` event, asserting admission-time rejection with a per-event backpressure
      reason and no discarding of already-enqueued jobs
    - Fixture tests for the recorded-verdict text rules: ten `absent` starvation verdicts produce the
      directive to investigate PostgreSQL execution cost; `bounded` statement counts record
      `Q(N) = 3N + 6` as falsified with eight citations; an unreachable Log_DB and an absent
      `pg_stat_statements` produce the exact declaration and the switched statement-cost source; a
      Signal_Type with no `writeTyped` case is recorded unimplemented with its missing stages; GIN
      narrowing fixtures at 1, 5 and 6 distinct keys; autovacuum candidate boundaries at
      `dead = 0.2 × live`, `dead = 0.21 × live`, `live = 0 ∧ dead = 999` and `live = 0 ∧ dead = 1000`;
      `last_autovacuum` null recorded with `statsResetAt`
    - `src/modules/ingestion/__tests__/backpressure-and-boot-guard.test.ts` and
      `scripts/lib/__tests__/report-fixtures.test.ts`
    - _Requirements: 1.5, 1.6, 2.8, 3.5, 3.8, 5.7, 9.4, 10.4, 12.3, 12.8, 15.2, 15.5_ (design §Testing Strategy, example tests)

- [~] 11. Checkpoint — P0 complete and Regression_Suite green before any P1 change
  - Run `npm run test` and `npm run test:integration`; zero failures required before task 12 begins
    (Requirement 22.4)
  - Confirm the change-set ledger shows every P0 change implemented with its UTC timestamp
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. P1 — measurement-gated remediations
  - [ ]* 12.1 Narrow the typed-event-contract trigger with a `WHEN` guard (design §6.2)
    - **Condition:** implement only if task 7.5 measured a per-row trigger overhead that task 7.16 ranked
      at or above the P1 threshold **and** the trigger-absent measurement was executable. Otherwise record
      the change deferred with the required command (Requirement 22.5) and stop.
    - Create `database/migrations/logdb/03_observability_v2/031_typed_event_contract_when_guard.sql` with
      explicit `BEGIN;`/`COMMIT;`: `CREATE OR REPLACE FUNCTION logdb_sync_typed_event_contract()` with a
      **byte-identical** body, then re-create `trg_sync_typed_event_contract` on all ten Canonical_Event_
      Tables with the design §6.2 `WHEN` clause — the disjunction of the four branch predicates, including
      the `jsonb_typeof(NEW.metadata) <> 'object'` disjunct kept deliberately even though it is unreachable
      while `environment` stays `NOT NULL`
    - **Edit `03_observability_v2/999_typed_event_contract.sql` in the same task** to add the identical
      `WHEN` clause to its `CREATE TRIGGER` loop. Design finding F11: `999` sorts last and re-creates the
      trigger, so without this edit a fresh database ends with the unguarded trigger and a migrated one with
      the guarded trigger, and the two diverge permanently. Keep its filename and relative path unchanged so
      databases holding it in `logdb_migrations` do not re-execute it
    - Create `031_typed_event_contract_when_guard.down.sql` per the design §8.4 convention (re-create the
      trigger without the `WHEN` clause on all ten tables, then delete exactly its own ledger row)
    - Narrowing the attachment rather than the body means rollback is a `CREATE TRIGGER` without the `WHEN`
      and there is no function-body diff to reason about; the guard also removes the per-row plpgsql call on
      the `attachGroups` `UPDATE`
    - _Requirements: 6.4, 6.7, 6.8, 18.1, 18.2, 18.3, 18.4, 18.5, 18.9, 18.11, 22.2_ (design §6.2, §8.2, §8.3, §8.4)

  - [ ]* 12.2 Convert any remaining per-event error-group statement to set-based form (design §6.1)
    - **Condition:** implement only if task 7.9 classified the recorded statement count as `growing` for
      either fingerprint distribution. If `bounded` (the expected outcome given design finding F2), skip the
      code change and record the hypothesis falsified instead.
    - Normal-path growth: convert the offending statement in
      `src/modules/errors/repositories/error-group.repository.ts` to one `VALUES`-driven statement per
      logical operation, ordered by `(project_id, fingerprint)`
    - Merged-group fallback growth (design finding F3, `error-ingestion.service.ts` L180–L215): implement the
      `WITH RECURSIVE` merge-chain resolution from design §6.1 with `ORDER BY g.project_id, g.fingerprint`
      **before** `FOR UPDATE` — PostgreSQL places `LockRows` above `Sort`, so the fleet-wide lock order that
      prevents `40P01` is preserved — and the `depth < 16` cycle guard that falls back to the existing
      per-event path and increments `recordErrorGroupMergeFallback` so the escape hatch stays observable
    - Preserve the Requirement 9.5 invariants: one row per distinct fingerprint, exact `occurrence_count`,
      earliest `first_seen_at`, latest `last_seen_at`, all unchanged on re-delivery
    - Acceptance: re-measure through task 7.9's script; count(10), count(50) and count(200) each within 2 of
      count(1) for both fingerprint distributions
    - _Requirements: 9.3, 9.5, 9.6, 9.7_ (design §6.1)

  - [ ]* 12.3 Resolve or formally reject the error-event double write (design §6.4, finding F7)
    - **Condition:** implement only if task 7.7's attribution assigns a material share of `events_errors`
      INSERT+UPDATE duration to the `attachGroups` `UPDATE` **and** the per-event WAL attributable to it was
      recorded.
    - Candidate change: resolve groups before the event insert using an indexed probe `SELECT` on the
      `(organization_id, event_id, occurred_at)` identity tuples, trading one `UPDATE` per row for one
      indexed `SELECT` per batch, in `src/modules/errors/repositories/error.repository.ts` and
      `src/modules/errors/services/error-ingestion.service.ts`
    - If the probe cannot distinguish an in-flight concurrent insert without serializable isolation, keep
      the current insert → group → update order and record the change **rejected on correctness grounds**
      with the reasoning, which is itself a Requirement 20.4 deliverable
    - Either outcome must keep grouping driven by the confirmed-inserted set so a re-delivered duplicate
      cannot inflate `occurrence_count` (Property 6 must still pass)
    - _Requirements: 8.2, 16.1, 16.6, 16.7, 20.4_ (design §6.4)

  - [ ]* 12.4 Wire the general and specialized worker tiers (design §7.4 option A)
    - **Condition:** implement only if task 7.12 recorded cross-signal interference.
    - Split `SDK_EVENT_TYPES` into the general set (error, message, request, span, metric, log,
      cron_checkin) and the specialized set (profile, replay, trace) as the `src/config/env.ts` comment
      already describes, and pass the corresponding `INGESTION_GENERAL_CONCURRENCY` /
      `INGESTION_SPECIALIZED_CONCURRENCY` and `*_BATCH_SIZE` per queue in
      `WorkerRegistry.start()`'s `pgboss.work()` call — a per-queue argument change only, adding no process
      entry, no runtime service and no network dependency
    - Acceptance: re-measured mixed p95 queue wait for request, log and error within 50 % of single-signal
      **while** re-measured trace and span mean events/s stays at or above baseline — the second half is
      what prevents "fixing" interference by starving the heavy signals
    - Record the concurrency-raise evidence (DB CPU %, DB resident MB, backend count at both the old and new
      values, backends ≤80 % of `max_connections`, CPU ≤80 %) if any concurrency knob is raised
    - Record that no connection pool was added, so the Requirement 13.8 three-combination evidence is not
      required
    - _Requirements: 3.6, 3.9, 13.5, 13.6, 13.8, 21.2_ (design §7.4)

  - [ ]* 12.5 Ship the GIN disposition migration with its base-schema edits (design §5, §8.2)
    - **Condition:** implement only for GIN indexes whose task 7.3 disposition is `REMOVE`, `NARROW`,
      `PARTIAL`, `REPLACE` or `MOVE_TO_DERIVED` with all three authorizing evidence items present. Any index
      whose authorizing measurement is unmeasured stays `KEEP` and is excluded.
    - Create `database/migrations/logdb/03_observability_v2/030_ingestion_gin_disposition.sql` with
      `DROP INDEX IF EXISTS` per `REMOVE` index and `CREATE INDEX IF NOT EXISTS` per narrowed, partial or
      expression replacement. All index DDL is **non-concurrent** and `IF EXISTS`/`IF NOT EXISTS` guarded,
      because every affected index is a partitioned parent index and PostgreSQL rejects the `CONCURRENTLY`
      forms on those. Write the file without `BEGIN;`/`COMMIT;` so the runner wraps it and a failure leaves
      no ledger row and every object at its pre-migration definition
    - Create `030_ingestion_gin_disposition.down.sql` recreating each dropped index, dropping each
      replacement, and deleting exactly its own ledger row
    - **In the same task**, edit `03_observability_v2/002_events_errors.sql` and `004_events_metrics.sql` to
      remove the `CREATE INDEX … USING GIN` statements whose final disposition is `REMOVE`, so a fresh
      database does not build and immediately drop them. Apply this only for `REMOVE` dispositions; narrowed
      replacements stay out of the base files so those files remain a faithful record of the original table
      shape
    - Add the equivalent `04_analytics/007_analytics_error_groups_gin_disposition.sql` (+ `.down.sql`) and
      `07_outbox/004_telemetry_outbox_index_disposition.sql` (+ `.down.sql`) only if those indexes received a
      non-`KEEP` disposition
    - _Requirements: 4.6, 5.5, 5.7, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.9, 22.1, 22.6_ (design §4, §8.2, §8.3)

  - [ ]* 12.6 Ship the per-table autovacuum tuning migration (design §7.3)
    - **Condition:** implement only for tables task 7.10 recorded as autovacuum tuning candidates. Full
      rewrites stay excluded and approval-gated.
    - Create `database/migrations/logdb/03_observability_v2/034_ingestion_autovacuum_tuning.sql` applying the
      proposed `autovacuum_vacuum_scale_factor`, `autovacuum_vacuum_threshold` and
      `autovacuum_analyze_scale_factor` to each candidate parent **and** iterating existing partitions with a
      `DO` block over `pg_inherits`, because settings on a range-partitioned parent do not propagate to
      existing partitions
    - Create `034_ingestion_autovacuum_tuning.down.sql` with `ALTER TABLE … RESET (autovacuum_*)` and its own
      ledger-row delete
    - Record live tuples, dead tuples, dead percentage and last autovacuum timestamp per changed table before
      and after
    - _Requirements: 12.4, 12.7, 18.1, 18.2, 18.4, 18.5_ (design §7.3, §8.2, §8.4)

  - [~] 12.7 Capture and compare removed-index result-set parity
    - Create a helper mode that, for each `namedProductionQueries` entry in the Index_Inventory, executes the
      query with fixed input parameters against a seeded dataset and stores
      `{rowCount, sha256 of the ordered serialized rows}` **before** any removal ships; keep the full result
      for any query whose hash later differs so the diff is inspectable
    - Add `src/modules/ingestion/__tests__/removed-index-result-parity.integration.test.ts` asserting
      post-removal row count and row contents equal the pre-removal capture for every recorded query
    - On any difference, restore the removed index or supply a replacement satisfying the recorded query, and
      record the differing comparison in the report
    - _Requirements: 19.3, 19.9, 21.1_ (design §9)

- [ ] 13. Schema delivery verification
  - [~] 13.1 Write the fresh-versus-migrated parity integration test
    - Apply every migration to a scratch database created from empty; dump `pg_indexes`,
      `pg_get_triggerdef`, `pg_get_functiondef`, column defaults and `reloptions` for the whole
      Ingestion_Table_Set; compare against the same dump from a database that applied the pre-Phase-2
      migration set plus the new files; require zero recorded differences
    - Automating this is the only way Requirement 18.3 stays true after the next migration lands
    - `database/__tests__/logdb-migration-parity.integration.test.ts`
    - _Requirements: 18.3, 18.11_ (design §8.3)

  - [ ]* 13.2 Write property test for migration and ledger convergence
    - **Property 22: Migrating twice, or forward-down-forward, converges on one schema state**
    - **Validates: Requirements 18.3, 18.5, 18.7, 18.9, 18.10**
    - `database/__tests__/logdb-migrations.property.test.ts`, integration project, `numRuns: 100` over
      generated starting states and migration orderings against a scratch database

  - [~] 13.3 Write the `.down.sql` convention conformance test
    - For every new migration file that creates or drops an index, trigger, column or function, assert a
      sibling `.down.sql` exists with the same three-digit ordinal prefix, the same base name and the same
      subfolder; assert each down file deletes exactly one `logdb_migrations` row keyed on its own forward
      file's recorded relative path and touches no other ledger row; assert a down file executed against a
      database that never applied its forward migration is harmless (`IF EXISTS`-guarded restorations, zero
      rows deleted)
    - Assert `npm run db:migrate:logdb` run twice against a migrated database and twice against an empty one
      exits 0 all four times with exactly one ledger row per new file after each run
    - Assert no new or altered Log_DB column stores a primary-database identifier as anything other than
      plain `UUID`/`TEXT` and no foreign key to a control-plane table was added
    - `database/__tests__/logdb-down-file-convention.test.ts`
    - _Requirements: 18.4, 18.5, 18.7, 18.8, 18.10_ (design §8.4)

- [~] 14. Checkpoint — P1 complete and Regression_Suite green before P2
  - Run `npm run test` and `npm run test:integration`; zero failures required before task 15 begins
  - Confirm the change-set ledger's rank ordering gate passes and every deferred change carries its required
    command
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. P2 — re-measurement, Forensic_Report and closeout
  - [~] 15.1 Re-measure with the identical commands and environment
    - Re-run every baseline command with byte-identical arguments in the same environment, and re-run the
      task 7.9 error statement counts and the task 7.15 amplification accounting from the same
      Workload_Class and the same controlled 200-event batch
    - Attach `before`/`after`/`changePct` to every implemented `ChangeRecord`; where a before or after value
      cannot be produced, record the `Unmeasured_Declaration` and the reason instead
    - Assert Requirement 21.3: per-batch statement count per Signal_Type at N ∈ {1, 10, 50, 200, 500} stays
      independent of N and at or below the Baseline_Record count
    - Record any after value exceeding its before value together with the write that produced it and the
      guarantee requiring that write
    - _Requirements: 9.7, 16.5, 16.7, 20.3, 20.6, 21.3_ (design §Architecture control flow, §10)

  - [~] 15.2 Generate the Forensic_Report with its 23 sections
    - Create `docs/ingestion-write-path-optimization.md` via a generator script reading the artifact bundle,
      with one distinct non-empty heading per design §10 item in that order: current architecture,
      Phase_1_Protections status, bottleneck ranking, expensive statements, Index_Inventory, GIN and JSONB
      analysis, Trigger_Inventory, public identifier analysis, sequence and default analysis, INSERT
      analysis, transaction analysis, WAL and COMMIT analysis, batch size analysis, connection pool
      analysis, queue and backpressure analysis, tenant fairness analysis, write amplification analysis,
      implemented changes, before and after measurements, remaining bottlenecks, risks, recommended next
      phase, verdict
    - Order the bottleneck ranking from highest to lowest measured contribution to batch transaction
      duration with each entry's measured contribution and Evidence_Record source; list the 10 highest
      measured mean-duration statements (or all, if fewer than 10 are recorded) with calling file path and
      execution count
    - Per implemented change state the measured before value, the modified file path with the applied
      modification, the measured after value and the percentage change computed from the recorded pair
    - Record every falsified hypothesis (`Q(N) = 3N + 6`, the F2/F3/F4 code-reading findings) as falsified
      rather than re-implemented, and record the inert-knob mapping for
      `INGESTION_GENERAL_*` / `INGESTION_SPECIALIZED_*`
    - _Requirements: 20.1, 20.2, 20.3, 20.6, 20.7, 20.8, 20.9_ (design §10)

  - [~] 15.3 Emit the machine-checkable report index and wire it into the gate
    - Write `artifacts/ingestion-phase2/report-index.json` mapping every reported number in the report to its
      Evidence_Record entry and provenance envelope
    - Extend `scripts/validate-ingestion-evidence-bundle.ts` to fail when a number in the report has no
      entry, or when an entry is neither `measured` nor a byte-exact `Unmeasured_Declaration`
    - _Requirements: 17.4, 17.6, 20.6, 20.9_ (design §10)

  - [~] 15.4 Write the verdict section
    - State each defect the Phase_2_Change_Set fixed; each remaining bottleneck with its measured value; the
      highest-cost remaining bottleneck and the Evidence_Record entry identifying it; the change with the
      largest measured events/s improvement; each change recommended against adopting with its supporting
      measured evidence (including the task 12.3 rejection if taken); and each readiness condition expressed
      as a metric, a comparison operator and a numeric threshold
    - Record every out-of-scope proposal (Redis, Kafka, any additional network service on the write path)
      with its PostgreSQL-only alternative, and every approval-gated item as excluded pending an approving
      operator decision with a UTC timestamp
    - _Requirements: 20.4, 21.5, 21.6, 21.7, 22.5, 22.7, 22.8_ (design §10)

  - [~] 15.5 Record the Phase_1_Protections status table
    - Assign each of the ten Phase_1_Protections items exactly one of `PRESERVED`, `MODIFIED` or `REMOVED`
      with the source file path evidencing it, and reference `docs/ingestion-performance-forensics.md` as the
      Phase 1 record
    - The write-admission FIFO ordering, the release-on-throw behaviour and the permit derivation from the
      live pool max are evidenced by task 10.8's property test rather than by inspection
    - _Requirements: 3.3, 3.4, 20.5, 21.1, 21.4_ (design §Design principles, §10)

  - [~] 15.6 Run the post-change Regression_Suite and compare pass lists
    - Run `npm run test` and `npm run test:integration` after the final modification; require zero failures
    - Diff the passing-test list against `artifacts/ingestion-phase2/pre-change-pass-list.json` and require
      every pre-change pass to still pass
    - _Requirements: 19.4, 19.5, 21.4, 22.4_ (design §9)

  - [~] 15.7 Add the modified-file boundary check
    - Add a CI script asserting `git diff --name-only <baseline-commit>..HEAD` contains only paths under
      `src/modules/ingestion/`, `src/modules/errors/`, `database/migrations/logdb/`, `src/config/env.ts`, the
      ingestion measurement scripts under `scripts/` (including the new
      `scripts/measure-ingestion-index-cost.ts` and the shared `scripts/lib/*`), Regression_Suite test files,
      `docs/ingestion-write-path-optimization.md`, and the single `.gitignore` line from task 1.9
    - Generated evidence artifacts live under the git-ignored `artifacts/ingestion-phase2/` so they never
      appear in the diff
    - _Requirements: 19.6_ (design §9)

  - [~] 15.8 Write the closeout smoke checks
    - Each of the four baseline harness commands exits 0 against the bench database; the Benchmark_Matrix
      records a command invoking `scripts/run-ingestion-benchmark-matrix.ts`;
      `docs/ingestion-write-path-optimization.md` exists with all 23 headings present, distinct and
      non-empty; the `ecosystem.config.cjs` app list is unchanged and no new network client dependency
      appears in `package.json`
    - `scripts/__tests__/phase2-closeout-smoke.test.ts`
    - _Requirements: 1.3, 17.3, 20.1, 20.2, 21.2_ (design §Testing Strategy, smoke checks)

- [~] 16. Final checkpoint
  - Confirm the evidence gate accepts the full bundle, the change-set rank ordering gate passes, the report
    index resolves every reported number, and both Regression_Suite projects are green
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional in the workflow sense and conditional in the design sense: every one of
  12.1, 12.2, 12.3, 12.4, 12.5, 12.6 is gated on a measurement outcome from group 7, and 9.3 is gated on an
  operator approval the plan deliberately does not seek. When a gate does not open, the task's deliverable is
  a recorded deferral with the command that would authorize it (Requirement 22.5), not silence.
- The property-test sub-tasks are marked optional per the workflow's convention, but Properties 1, 3, 6, 10
  and 20 are the tests that make the design's central claims checkable; skipping them removes the mechanical
  enforcement of "no fabricated numbers" and "no blind removal".
- Group 1 through 4 must not touch `src/modules/ingestion/`, `src/modules/errors/`,
  `database/migrations/logdb/` or `src/config/env.ts`. Task 6.4 is the first guarded-path edit by design.
- Design finding F11 is why tasks 12.1 and 12.5 each pair their new migration with its `Base_Schema_File`
  edit in a single task: `999_typed_event_contract.sql` sorts last and would otherwise overwrite the new
  `03x_*` definitions on a fresh database.
- Every `.down.sql` follows the design §8.4 convention, including the ledger-row `DELETE` keyed on its own
  forward file's exact recorded relative path — the existing
  `07_outbox/002_telemetry_outbox_idempotency.down.sql` does not do this and is not the model to copy.
- Measurement tasks in group 7 read the Log_DB and run harness scripts; only task 7.3 and task 7.5 execute
  DDL, and only through `scripts/measure-ingestion-index-cost.ts` with its five guards and restore-and-verify
  hard stop.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4", "1.7", "1.9", "2.1", "3.2", "3.3"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5", "1.6", "1.8", "2.2", "3.1", "3.4"] },
    { "id": 2, "tasks": ["2.3", "3.5", "3.6"] },
    { "id": 3, "tasks": ["2.4", "2.5", "4.1"] },
    { "id": 4, "tasks": ["2.6", "3.7", "4.2"] },
    { "id": 5, "tasks": ["4.3", "6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3"] },
    { "id": 7, "tasks": ["6.4"] },
    { "id": 8, "tasks": ["7.1", "7.2", "7.4", "7.10"] },
    { "id": 9, "tasks": ["7.3", "7.5", "7.9", "7.11"] },
    { "id": 10, "tasks": ["7.6", "7.7", "7.8", "7.12", "7.13", "7.14", "7.15"] },
    { "id": 11, "tasks": ["7.16"] },
    { "id": 12, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 13, "tasks": ["9.4", "9.5", "9.6", "10.13"] },
    { "id": 14, "tasks": ["10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "10.7", "10.8", "10.9", "10.10", "10.11", "10.12"] },
    { "id": 15, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7"] },
    { "id": 16, "tasks": ["13.1", "13.2", "13.3"] },
    { "id": 17, "tasks": ["15.1"] },
    { "id": 18, "tasks": ["15.2"] },
    { "id": 19, "tasks": ["15.3", "15.4"] },
    { "id": 20, "tasks": ["15.5", "15.7"] },
    { "id": 21, "tasks": ["15.6", "15.8"] }
  ]
}
```
