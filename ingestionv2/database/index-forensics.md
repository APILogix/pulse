# Index forensics

## Document status

| Classification | Scope |
| --- | --- |
| **MEASURED** | Recorded snapshot from schema audit artifact `schema-audit-before.json` captured 2026-08-27T06:31:07.626Z. |
| **MEASURED** | No index was created, removed, or rebuilt by this document. This is a recorded state, not a live-change authorization. |
| **UNKNOWN** | Current deployed index state may differ from the captured snapshot. |

## Active identity indexes (confirmed present at capture)

| Classification | Table | Index | Columns | Unique |
| --- | --- | --- | --- | --- |
| **MEASURED** | `events_requests` | `idx_events_requests_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_errors` | `idx_events_errors_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_spans` | `idx_events_spans_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_traces` | `idx_events_traces_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_metrics` | `idx_events_metrics_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_messages` | `idx_events_messages_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_profiles` | `idx_events_profiles_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_replays` | `idx_events_replays_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_cron_checkins` | `idx_events_cron_checkins_event_unique` | `(organization_id, event_id, occurred_at)` | Yes |
| **MEASURED** | `events_logs` | `idx_events_logs_event` | Non-unique lookup | No |

## Proposed log identity index (migration 030, not deployed)

| Classification | Index | Columns | Unique |
| --- | --- | --- | --- |
| **MEASURED** | `idx_events_logs_event_unique` | `(organization_id, project_id, environment, event_id, occurred_at)` | Yes |
| **MEASURED** | Source: `030_events_logs_idempotency.up.sql` | Drain-gated, 5s lock timeout, duplicate preflight | — |
| **UNKNOWN** | Deployment status | Not confirmed live. |

See [../live-db-rollout/events-logs-identity.md](../live-db-rollout/events-logs-identity.md) for the gated rollout procedure.

## Public-ID lookup indexes (confirmed present)

| Classification | Table | Index | Unique |
| --- | --- | --- | --- |
| **MEASURED** | All 10 typed tables | `idx_events_<type>_public_id` | No (lookup only) |
| **MEASURED** | Explicitly retained by migration 030 | — | — |

## Outbox indexes (confirmed present)

| Classification | Index | Table | Purpose |
| --- | --- | --- | --- |
| **MEASURED** | `uq_telemetry_outbox_idem` | `telemetry_outbox` | Unique idempotency |
| **MEASURED** | Partial unpublished index | `telemetry_outbox` | Claim path |
| **MEASURED** | Claimed-recovery index | `telemetry_outbox` | Recovery path |

## Prior-phase index removals (historical record)

| Classification | Migration | Relation | Count |
| --- | --- | --- | ---: |
| **MEASURED** | `025_request_ingestion_hot_path.sql` | `events_requests` | 4 |
| **MEASURED** | `028_request_ingestion_minimal_indexes.sql` | `events_requests` (10 additional) + `events_spans` (4) | 14 |
| **MEASURED** | `029_span_log_ingestion_hot_path.sql` | `events_spans` + `events_logs` (6) | 6 |
| **MEASURED** | **Total prior-phase drops** | — | **24** |

**MEASURED:** `schema-audit-before.json` records all 24 named indexes as `confirmed_absent` with `prior_phase_removal` provenance.

**MEASURED:** This forensic session authorized no additional index removal and did not re-authorize the historical decisions.

## Recorded duplicate and semantic-redundancy findings

The live catalog snapshot proved six exact definition/signature pairs at the audited parent level:

| Classification | Relation | Duplicate signature |
| --- | --- | --- |
| **MEASURED** | `error_group_history` | `group_id, created_at` pair |
| **MEASURED** | `events_errors` | organization/project/environment/time pair |
| **MEASURED** | `events_logs` | organization/project/environment/time pair |
| **MEASURED** | `events_messages` | organization/project/time pair |
| **MEASURED** | `events_spans` | partial db-system/time pair |
| **MEASURED** | `events_traces` | organization/project/time pair |

**MEASURED:** additional semantic overlap exists between the non-unique and unique `error_groups` project/fingerprint indexes and between status-seen v1/v2 indexes.

**MEASURED:** none was removed. Structural equality does not supply an adequate observation window, lock/runtime estimate, rollback rehearsal, or measured insert/WAL benefit.

**UNVERIFIED:** a complete index A–F classification over a bounded usage window was not completed. This remains an explicit acceptance gap.

## Duplicate-index deferral rationale

| Classification | Observation |
| --- | --- |
| **MEASURED** | `statsResetAt` is null — the pg_stat observation window start is unknown. |
| **DERIVED** | An `idx_scan=0` value without a known observation window, source-query proof, and insert-cost comparison is insufficient for any additional removal. |
| **DERIVED** | Historical absence of 24 indexes from migrations 025/028/029 is retained as fact. It is not a new recommendation or fresh authorization. |

### Authorization criteria for future index removal

Any additional index removal requires ALL of:

1. **MEASURED** ≥24-hour observation window with known `statsResetAt`.
2. **MEASURED** Proof that no capable source query uses the index (query plan evidence).
3. **MEASURED** Insert-cost comparison: present vs absent (benchmark).
4. **MEASURED** Rollback plan with tested recreation.
5. Explicit operator/DBA approval with named owner.

## Statistics epoch issue

| Classification | Issue |
| --- | --- |
| **MEASURED** | `statsResetAt: null` in the schema audit artifact. |
| **DERIVED** | Without a known statistics epoch, any `idx_scan=0` or `seq_scan` count is uninterpretable for removal decisions. |
| **DERIVED** | A stats reset could have occurred at any time, making zero-scan counts meaningless for authorization. |

## Index-build considerations for partitioned tables

| Classification | Consideration |
| --- | --- |
| **DERIVED** | `CREATE INDEX` on a partitioned parent recursively builds on all children, requiring an `ACCESS EXCLUSIVE` lock on each leaf. |
| **DERIVED** | `CREATE INDEX CONCURRENTLY` cannot be used directly on a partitioned parent (PostgreSQL limitation). |
| **DERIVED** | Leaf-by-leaf concurrent build + parent attach is the low-lock alternative but is operator-complex and unimplemented in repository tooling. |
| **MEASURED** | Migration 030 uses the direct partitioned parent approach with a 5-second `lock_timeout` and drain prerequisite. |

## Related documents

| Document | Scope |
| --- | --- |
| [schema-indexes-and-triggers.md](schema-indexes-and-triggers.md) | Full schema snapshot |
| [database-architecture.md](database-architecture.md) | Partition structure |
| [query-optimization.md](query-optimization.md) | Index usage in query paths |
| [trigger-forensics.md](trigger-forensics.md) | Trigger interaction with indexes |
| [../live-db-rollout/events-logs-identity.md](../live-db-rollout/events-logs-identity.md) | Migration 030 procedure |
