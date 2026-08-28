# Ingestion event types

Status date: 2026-08-27.

## Supported typed paths

The active SDK contract has ten typed signals plus the mixed `/v1/ingest` route:

| Type | Queue | Typed storage | Route |
| --- | --- | --- | --- |
| `error` | `ingest.error` | `events_errors` (+ grouping/history) | `POST /v1/errors` |
| `message` | `ingest.message` | `events_messages` | `POST /v1/events` |
| `request` | `ingest.request` | `events_requests` | `POST /v1/requests` |
| `span` | `ingest.span` | `events_spans` | `POST /v1/spans` |
| `trace` | `ingest.trace` | `events_traces` + derived `events_spans` | `POST /v1/traces` |
| `metric` | `ingest.metric` | `events_metrics` | `POST /v1/metrics` |
| `log` | `ingest.log` | `events_logs` | `POST /v1/logs` |
| `profile` | `ingest.profile` | `events_profiles` | `POST /v1/profiles` |
| `cron_checkin` | `ingest.cron_checkin` | `events_cron_checkins` | `POST /v1/checkins` |
| `replay` | `ingest.replay` | `events_replays` | `POST /v1/replays` |

`route-table.ts` maps route, `SdkEventType`, and SDK transport key. Typed routes reject a mismatched type; the mixed route can split accepted events by type. Worker normalization rejects are routed durably to DLQ intake, while valid siblings can continue.

## Write-shape differences

| Type/shape | Important distinction |
| --- | --- |
| Normal 1→1 types | Set-based typed INSERT and transactional outbox. |
| Error | Inserted-ID `RETURNING`, grouping/history branches, and a retained merged-group fallback that can be O(N). |
| Trace | Header rows plus iterative tree flattening; 67-value derived spans are chunked at 978 rows. |
| Request | Outbox eligibility can be conditional on request classification. |
| Span | Wide normalized row; trace-derived spans copy the complete parent trace payload. |

Statement totals are not represented as fixed per type because conflict, outbox, error-group, trace-chunk, and cancellation branches vary.

## Priority/urgency

The priority formula combines plan weight, type urgency, and fairness deferral count. The configured urgency classes are:

| Urgency | Types |
| ---: | --- |
| 100 | error, message, cron_checkin |
| 50 | request, span, trace |
| 30 | log |
| 20 | metric |
| 10 | profile, replay |

This is prioritization/reactive shedding, not a hard per-tenant or global queue capacity.

## Typed identity and partitions

All typed parents are range-partitioned by `occurred_at`; where a typed unique guard is deployed, it includes the partition key. The audited Log DB catalog is an explicit exception: its current `events_logs` event lookup is non-unique. Migration 030 proposes the scoped log identity guard, but it was **not executed** in this phase and must not be treated as deployed based on the file alone. Default partitions contain data, so repartitioning or index changes require an isolated plan.

## Public-ID ordering

Every audited typed parent has a NOT NULL, sequence-backed default with a signal prefix (`ERR-`, `MSG-`, `REQ-`, `SPN-`, `TRC-`, `MTR-`, `LOG-`, `PRF-`, `CRN-`, or `RPL-`) and the shared contract-sync BEFORE trigger.

PostgreSQL evaluates column defaults before BEFORE INSERT triggers:

1. ordinary omitted `public_id` receives the sequence default;
2. the trigger sees the nonempty value and does not allocate a second ID;
3. explicit NULL/empty values can be repaired by the trigger; and
4. the trigger also repairs timestamp/metadata/payload contract fields.

The audited sequences use `CACHE 1` and are not `OWNED BY`. Neither trigger nor sequence behavior changed.

## Common invariants

Every type must preserve:

- fairness and cancellation-aware write admission;
- abortable checkout and active query cancellation;
- typed data plus outbox in one transaction;
- cancellation check immediately before COMMIT;
- ACK only downstream of successful COMMIT;
- retry-safe conflict handling; and
- usage based only on actually inserted rows.

## Related documents

- [Error ingestion](error-ingestion.md)
- [Trace ingestion](trace-ingestion.md)
- [Span ingestion](span-ingestion.md)
- [Request ingestion](request-ingestion.md)
- [Log ingestion](log-ingestion.md)
- [Metrics ingestion](metrics-ingestion.md)
- [Public IDs](../database/public-id-generation.md)
