# Metrics ingestion

Status date: 2026-08-27.

## Current path

`ingest.metric` writes normalized metric events to `events_metrics` with the common set-based typed writer and transactional outbox/idempotency behavior. The worker normalizer accepts `counter`, `gauge`, and `histogram`; the writer has compatibility classification support for additional internal aggregation names, but the accepted ingress schema is the controlling boundary.

## Row mapping

The writer derives/stores metric name/type/value/unit, tags and dimensions, aggregation/category classification, service/environment/release metadata, tenant scope, stable occurrence time, and normalized payload. It builds one parameterized multi-row INSERT for the normal job and uses command-tag `rowCount` rather than returning every inserted row.

No exact statement total or ingestion-time aggregation claim is made; duplicate and outbox branches can differ. Durable billing rollup is a separate worker concern, not evidence that metric samples are pre-aggregated during typed insertion.

## Priority and backpressure

Metrics have configured urgency 20. Reactive queue-depth shedding can reject lower-score work at high/critical cached depths, but there is no strict metric-queue capacity or wired per-tenant enqueue quota. Priority is not a durability guarantee.

## Durability/idempotency

- fairness/write admission precede checkout;
- callback-batch cancellation reaches active PostgreSQL work and pre-COMMIT;
- typed rows and outbox commit atomically;
- conflict result determines inserted count; and
- usage increments only by inserted rows.

`MTR-` public IDs normally come from the sequence default before the sync trigger. Explicit NULL/empty values remain repairable by the trigger.

## Cardinality distinction

Metric tag cardinality can affect storage/query economics, while the in-process `UsageCounter` map has its own `(organization, project, counter)` key cardinality. They are different controls. The UsageCounter threshold is a flush trigger, not a strict memory cap during prolonged database failure.

## Evidence gaps

- production metric subtype/tag distributions;
- high-cardinality storage/index/WAL behavior;
- queue-lag and per-tenant rates;
- load/expiry/failover behavior; and
- isolated metric-specific throughput/latency.

# BENCHMARK NOT EXECUTED

## Related documents

- [Batching](batching.md)
- [Deduplication](deduplication.md)
- [Write path and invariants](write-path-and-invariants.md)
- [Worker backpressure](../workers/worker-backpressure.md)
