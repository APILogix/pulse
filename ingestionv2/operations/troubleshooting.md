# Ingestion troubleshooting

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

Use this as source-derived triage, not a performance certificate. No numeric paging threshold was calibrated.

## Events appear missing

1. Compare gateway response `accepted`/rejected results. `202` with `accepted: 0` does not prove a queue job exists.
2. Split queue state and oldest age by exact `ingest.*` queue.
3. Check jobs processed/failed/retried and failure reason.
4. Separate gateway rejects from worker normalization rejects persisted by DLQ intake.
5. Verify typed table identity/conflict behavior, outbox, and usage separately; duplicate suppression is not loss.
6. For logs, remember migration 030's intended scoped unique guard was not deployed in this phase.

## Latency/backlog grows

```text
oldest queue age rising?
  → admission queued/wait high?
      → inspect DB headroom; do not blindly raise permits
  → pool waiting/checkout high?
      → inspect endpoint sessions and other pool owners
  → query/lock time high?
      → capture SQLSTATE, locks, plan on clone
  → CPU/RSS/heap/GC high?
      → inspect jobs in flight, trace sizes, payload copies, usage keys
```

Default delivery can expose 80 typed jobs before a 16-permit DB gate. Admission waiters are delivery-bounded, not durable-backlog-sized, but the strict RSS/heap bound is unknown.

## Expired/cancelled jobs

Capture callback batch/job IDs, the shared signal time/reason, current phase, target backend PID, cancel result, COMMIT result, rollback result, client release, and pg-boss settlement.

Expected behavior:

- queued fairness/admission work exits;
- late checkout releases;
- active SQL is targeted with `pg_cancel_backend`;
- target client stays held through cancellation/rollback;
- only rollback is allowed after abort;
- pre-COMMIT abort fails/retries; and
- successful COMMIT race still executes inserted-only usage.

If work continues after abort or the client releases before cancellation completes, treat it as a correctness incident. Do not ACK or cancel arbitrary backend PIDs manually.

## Usage/billing discrepancy

1. Check whether telemetry committed.
2. Inspect flush errors, active/trailing drain logs, final shutdown drain, staging rows, and rollup state.
3. Correlate process hard-stop and PostgreSQL restart/failover times.
4. Distinguish pre-staging in-memory loss from post-staging UNLOGGED loss.
5. Do not assume 30 seconds is a maximum loss window during DB failure.
6. Note that registry shutdown catches/logs processor-stop failure, so a clean supervisor stop can coexist with a failed final drain.

No complete replay/reconciliation source was established; escalate rather than reconstruct billing ad hoc.

## DLQ/retry growth

Classify validation, lock/statement timeout, connection, aborted/expired, idempotency/conflict, and unknown failures. Verify DLQ intake persistence before bounded replay. Preserve receipt time and identity inputs. Replay-all can amplify DB, queue, outbox, and billing load.

## Trace/heap growth

Trace-derived spans serialize the complete parent trace into every row. For span count `S`, total copied payload is structurally O(S²). Capture trace node/depth/serialized bytes, jobs in flight, heap/GC, DB query size, TOAST/WAL deltas, and unified-search requirements. Do not switch to current-span-only payload without a versioned search/API contract.

## Error path slows

Inspect `ingest_error_group_merge_fallback_total` and `_events_total`. A merged target can force per-event group resolution (~3N plus constants). Also capture fingerprint distribution, lock waits, new/existing/regression branch, and transaction timing.

## Migration/queue operation fails

- use only repository Log DB migration tooling and its shared fail-fast lock;
- migration 030 drain/duplicate/lock failures require index+ledger verification before retry;
- dry-run does not execute migration-file SQL;
- default partitions contain data; never infer emptiness from parent-only queries; and
- queue rebuild remains inspection-only unless writers are drained and retained jobs have an archive/replay plan.

No production DDL, queue rebuild, or benchmark was authorized/executed.

## Read-only diagnostics

Use approved read-only views/tools for:

- `pg_stat_activity`, `pg_locks`, `pg_stat_database`, `pg_stat_wal`, and relation statistics;
- per-queue pg-boss state/oldest age;
- `/metrics` worker counters/latencies/pool snapshots;
- process RSS/heap/GC/CPU; and
- usage staging/rollup rows.

Avoid copying generic SQL against production until table/schema names and permissions are verified.

## Escalation policy

Escalate based on approved SLO/error budget and correctness impact, not invented constants. Immediate escalation candidates include potential ACK-before-COMMIT, typed/outbox atomicity break, work continuing after abort, incorrect inserted-only billing after successful COMMIT, telemetry deletion, unauthorized schema/queue mutation, or evidence of billing loss.

## Acceptance status

| Gate | Status | Evidence |
| --- | --- | --- |
| Current cancellation triage documented | PASS | implementation/source review |
| Usage residual windows documented | PASS | source/DDL review |
| Procedures failure-tested | **UNMET** | no chaos/kill/failover run |
| Numeric escalation thresholds calibrated | **UNMET** | no SLO/workload baseline |
| Strict memory troubleshooting validated | **UNMET** | no representative load run |
