# Ingestion alerts

Status date: 2026-08-27.

# BENCHMARK NOT EXECUTED

The entries below are alert *policies to calibrate*, not production-ready numeric rules. Numeric thresholds, windows, severity, ownership, and paging routes require SLO and workload evidence.

## Page-worthy conditions (threshold/window TBD)

| Condition | Why it matters | Correlate before action |
| --- | --- | --- |
| No healthy intended ingestion workers during expected traffic | complete drain halt | deployment/startup logs, `/healthz`, queue age |
| Oldest pending age breaches ingest SLO and continues rising | durable backlog misses latency objective | per-queue depth, insert rate, failures, admission/pool/DB |
| DB pool waiting/checkout timeout or connection exhaustion | workers cannot start transactions/cancellation helpers | endpoint sessions, pool ownership, external users |
| Repeated job failures/retry exhaustion by one reason | systematic loss/delay risk | SQLSTATE, event type, phase, DLQ persistence |
| Usage final-drain failure or repeated flush/rollup failure | billing counts at risk | process lifecycle, staging, DB restart/failover |
| PostgreSQL restart/failover while UNLOGGED staging may contain rows | staged billing can disappear | staging/rollup snapshots and failover timeline |
| OOM/restart or RSS/heap near approved limit | raw/copy/trace/cardinality memory risk | jobs in flight, trace sizes, UsageCounter keys, GC |
| Migration/index/queue mutation outside approved window | high-impact unreviewed change | advisory lock, actor, SQL, ledger/catalog |

## Warning/trend conditions (threshold/window TBD)

- admission queue/wait grows while DB has verified headroom;
- pool waiting grows after admission;
- query duration, lock timeout, statement timeout, rollback, or deadlock rate changes;
- callback expiry/cancellation failures or jobs apparently active after abort;
- partial-duplicate/outbox conflict work rises;
- error merged-group fallback count is nonzero or increasing;
- fairness deferral/starvation-guard ratio changes per process/queue;
- DLQ retained rows or validation rejection ratio changes;
- WAL/event, TOAST/table/index growth, dead tuples, or autovacuum lag changes under comparable workload; and
- log traffic continues while migration 030's scoped unique guard remains absent.

## Do not encode unsupported constants

The audit did **not** authorize values such as “checkout p95 >5 ms,” “DLQ >100/min,” or arbitrary fixed paging windows. Use:

1. business SLO/error budget;
2. observed normal and incident distributions;
3. minimum volume guards for ratios;
4. per-queue/type/tenant dimensions with cardinality controls;
5. multi-signal confirmation where paging is costly; and
6. an owned runbook and rollback action.

## Mandatory annotations

Every deployed alert should link to dashboard/runbook, name owner/severity, identify data source and aggregation scope, state threshold/window and calibration evidence, include maintenance suppression, and record last failure-injection test.

## Special correctness alerts

### Cancellation

Alert on failed/repeated backend-cancel attempts, abort-to-rollback/release delay, expiry retry spikes, and successful-COMMIT races missing inserted-only usage. Current exported metrics do not fully expose all of these phases; structured logs/new counters may be required.

### Billing

Alerting on flush/rollup failure is necessary but insufficient: a hard crash before staging may leave no expected-count record to alert from. Closing this blind spot requires a durable/replayable accounting source.

### Fairness

Current counters are process-local. Do not label them fleet-wide tenant fairness or use them to claim a global guarantee.

## Acceptance status

| Gate | Status | Evidence |
| --- | --- | --- |
| Failure conditions enumerated | PASS (design) | source-derived failure modes |
| Numeric thresholds calibrated | **UNMET** | no SLO/workload baseline |
| Correctness alerts instrumented end-to-end | **UNMET** | cancellation/billing blind spots |
| Alerts failure-tested | **UNMET** | no chaos/failover run |
| Routing/ownership approved | **UNMET** | organizational decision required |
