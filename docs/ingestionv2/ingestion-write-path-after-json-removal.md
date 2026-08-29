# Ingestion Write Path — After Remaining GIN Index Removal

**Change:** `database/migrations/logdb/03_observability_v2/031_remaining_jsonb_gin_hot_path.sql`
drops 30 GIN indexes on `attributes`/`metadata`/`payload`/`ai_response` (and
`context`/`tags`/`extra` on `events_errors`) across `events_errors`, `events_metrics`,
`events_traces`, `events_messages`, `events_profiles`, `events_replays`, and
`events_cron_checkins` — the seven tables the earlier `025`/`029` hot-path migrations did
not cover.

## What changed

- **Indexes:** 30 GIN indexes removed via migration `031` for existing/upgrading
  databases, AND removed directly from the base schema files
  (`001_events_requests.sql` through `010_events_cron_checkins.sql`, plus the earlier
  `025`/`029`-covered tables) so a fresh database never creates any of the 44
  attributes/metadata/payload/ai_response(/context/tags/extra) GIN indexes across all ten
  `events_*` tables in the first place. See `gin-index-audit.md` for the full list.
- **Columns:** unchanged. `metadata`/`payload`/`attributes`/`ai_response`/`context`/`tags`/
  `extra` are still written by `TelemetryWriter` and `ErrorRepository` exactly as before —
  see `json-persistence-audit.md` for why (live request/error detail "raw event" feature
  depends on them).
- **INSERT SQL:** unchanged. No column was removed from any `INSERT INTO events_*`
  statement. Every INSERT is still a single batched multi-row statement per event type
  (`buildInsert()` in `telemetry-writer.ts`, `insertManyIfNew()` in `error.repository.ts`)
  — no per-event round trip was introduced or removed by this change.
- **Application code:** no TypeScript file was modified. This is a pure database migration.

## What did NOT change (per master prompt §20)

Tenant fairness, durable ACK ordering, event idempotency, billing/usage accounting,
transactional outbox, public ID generation/trigger, sequence behavior, event identity,
organization/project authentication, queue semantics, worker retry semantics, trace/span
relationships, error grouping, incident idempotency — none of these were touched. The
change is scoped exclusively to dropping seven tables' worth of unused GIN indexes.

## Compatibility implications

- **Fresh databases:** apply `001`–`010` (create tables+indexes) then `025`/`028`/`029`/`031`
  (drop unused indexes) in migration-file lexical order via `scripts/migrate-logdb.ts` /
  `applyLogDbMigrations()`. The dropped indexes are never recreated by any later migration.
- **Existing databases:** running `npm run db:migrate:logdb` applies `031` once (tracked in
  `logdb_migrations`) and is idempotent (`IF EXISTS` on every drop).
- **Rollback:** none of `025`/`028`/`029` ship a `.down.sql`, and `031` follows that same
  convention deliberately (a rollback would mean re-running the original `CREATE INDEX ...
  USING GIN` statements, re-introducing the exact write cost this migration removes). If a
  currently-unknown query requirement surfaces later, add a new, narrow, evidence-backed
  index rather than reverting this migration.

## Correctness verification

| Area | Status | Evidence |
|---|---|---|
| Alerts | Unaffected | `appendTelemetryOutbox()` re-derives typed fields from the in-memory event, never reads the persisted `metadata`/`payload` columns (`json-persistence-audit.md` §2) |
| Analytics | Unaffected | Rollup workers aggregate typed columns only, zero `payload`/`metadata` references found |
| Fast lookup | Unaffected | Detail-page reads are primary-key lookups with unfiltered JSONB passthrough — never used the GIN index |
| Deduplication | Unaffected | Keyed on `(project_id, event_id)` / `(organization_id, event_id, occurred_at)` unique indexes, untouched |
| Billing | Unaffected | No billing/usage-accounting code path was touched |
| Outbox | Unaffected | `telemetry_outbox` schema/insert untouched |
| Tenant isolation | Unaffected | No tenant-scoping index or query was touched |

## Tests performed

- `test/unit/logdb-remaining-gin-hot-path.test.ts` (5/5 passing) — static assertions that
  the migration drops exactly the 30 intended index names, does not touch the
  events_requests/events_spans/events_logs indexes already handled by `025`/`029`, does not
  touch any non-GIN (tenant/time/unique/BRIN) index, wraps the drops in an explicit
  transaction, and issues no `DROP INDEX CONCURRENTLY` (rejected on partitioned parent
  indexes).
- `scripts/lib/ingestion-catalog-scope.test.ts` (9/9 passing, pre-existing, unmodified) —
  confirms this change did not disturb the prior-phase (`025`/`028`/`029`) index-removal
  inventory.
- `npx tsc --noEmit` — 0 errors (no application code changed).

## Benchmark status

**NOT MEASURED.** No live database benchmark (before/after INSERT duration, WAL bytes,
commit latency, throughput) was run for this specific change in this session. The
integration test harness available in this environment is missing draft migration fixture
files unrelated to this change (pre-existing gap, reproduced identically with and without
this migration present). The performance rationale is qualitative and based on the same
mechanism (JSONB tokenization + GIN posting-list maintenance per insert) that the earlier
`025`/`029` migrations targeted and is documented as their measured cost driver in their own
migration comments — this task extends the identical, already-validated remediation to the
remaining seven tables rather than introducing a new technique.

## Known limitations

- `events_errors`, `events_metrics`, `events_traces`, `events_messages`, `events_profiles`,
  `events_replays`, `events_cron_checkins` are lower-traffic tables than `events_requests`/
  `events_spans`/`events_logs` (which is presumably why they were deprioritized in the
  original two-phase remediation). The absolute throughput benefit here is likely smaller in
  proportion to overall ingestion load than the `025`/`029` changes — this was not
  quantified.
- If a future feature needs to search inside `payload`/`metadata`/`attributes` (e.g. a
  "search raw event JSON" feature), a new, narrow, evidence-backed index should be added at
  that time rather than assuming these broad indexes should be restored.
