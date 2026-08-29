# GIN Index Audit — metadata/payload/attributes/ai_response

**Scope:** Every GIN index on a JSONB column across the ten canonical `events_*` tables in
`database/migrations/logdb/03_observability_v2/`.
**Verdict:** 30 additional GIN indexes removed (migration `031_remaining_jsonb_gin_hot_path.sql`),
closing a gap left by two earlier remediations that covered only 3 of the 10 tables. Zero
GIN indexes on these columns have any confirmed query usage anywhere in the repository.

---

## 1. Full inventory (10 tables × up to 6 JSONB columns each)

| Table | JSONB columns with a GIN index | Migration that created them |
|---|---|---|
| events_requests | attributes, metadata, payload, ai_response | `001_events_requests.sql` |
| events_errors | context, tags, extra, metadata, payload, ai_response | `002_events_errors.sql` |
| events_logs | context, tags, attributes, metadata, payload, ai_response | `003_events_logs.sql` |
| events_metrics | attributes, metadata, payload, ai_response | `004_events_metrics.sql` |
| events_spans | attributes, metadata, payload, ai_response | `005_events_spans.sql` |
| events_traces | attributes, metadata, payload, ai_response | `006_events_traces.sql` |
| events_messages | attributes, metadata, payload, ai_response | `007_events_messages.sql` |
| events_profiles | attributes, metadata, payload, ai_response | `008_events_profiles.sql` |
| events_replays | attributes, metadata, payload, ai_response | `009_events_replays.sql` |
| events_cron_checkins | attributes, metadata, payload, ai_response | `010_events_cron_checkins.sql` |

(`stack_frames`/`breadcrumbs` on events_errors, and `args`/`spans_tree`/`buckets`/`events`/
`links`/`contexts`/`profile_data` on other tables, never had a GIN index — only the
attributes/metadata/payload/ai_response family, plus context/tags/extra on errors/logs.)

## 2. Prior remediation (already applied, unchanged by this task)

| Migration | Table(s) | Indexes dropped |
|---|---|---|
| `025_request_ingestion_hot_path.sql` | events_requests | payload, ai_response, metadata, attributes (4) |
| `029_span_log_ingestion_hot_path.sql` | events_spans | attributes, metadata, payload, ai_response (4) |
| `029_span_log_ingestion_hot_path.sql` | events_logs | context, tags, attributes, metadata, payload, ai_response (6) |

Both migrations' own comments record the same rationale used below: "production
profiling showed batch INSERT/COMMIT time dominated by JSONB document tokenization... no
current production query path in this repo using JSONB containment."

## 3. This task's remediation — `031_remaining_jsonb_gin_hot_path.sql`

Drops the identical index class on the seven tables the prior two migrations missed:

| Table | Indexes dropped |
|---|---|
| events_errors | context, tags, extra, metadata, payload, ai_response (6) |
| events_metrics | attributes, metadata, payload, ai_response (4) |
| events_traces | attributes, metadata, payload, ai_response (4) |
| events_messages | attributes, metadata, payload, ai_response (4) |
| events_profiles | attributes, metadata, payload, ai_response (4) |
| events_replays | attributes, metadata, payload, ai_response (4) |
| events_cron_checkins | attributes, metadata, payload, ai_response (4) |

**Total: 30 indexes removed.** Combined with the 14 already removed by `025`/`029`, all
44 attributes/metadata/payload/ai_response(/context/tags/extra) GIN indexes across every
`events_*` table are now gone.

Exact statements — see the migration file itself
(`database/migrations/logdb/03_observability_v2/031_remaining_jsonb_gin_hot_path.sql`).
All 30 are plain `DROP INDEX IF EXISTS <name>;` inside a `BEGIN;...COMMIT;` transaction,
matching the exact pattern of `025`/`029` (partitioned parent indexes reject
`CONCURRENTLY`, so this was never an option, same as the prior two migrations).

## 4. Query-usage evidence (why zero of these are needed)

Searched every JSONB operator (`@>`, `->`, `->>`, `?`, `jsonb_path_query`) against
`metadata`, `payload`, `attributes`, `context`, `tags`, `extra`, `ai_response` across:
- `src/modules/observability/**` (explorer, resources, detail pages)
- `src/modules/analytics-engine/**` (rollup workers)
- `src/modules/alerting/**` (evaluator, outbox relay)
- `src/modules/ai/**`
- every API route

**Result: NO QUERY FOUND anywhere.** Independently corroborated by:
- The observability query-engine's own field registry: every one of these columns is
  declared `filterable: false, projectable: false` in the resource definitions
  (`errors.resource.ts`, `requests.resource.ts`, etc.) — the explorer layer is structurally
  incapable of generating a predicate against them.
- The repo's own prior forensic docs (`docs/ingestion-performance-forensics.md`,
  `docs/modules/ingestion/INGESTION-PERFORMANCE-REMEDIATION.md`) reached the identical
  conclusion before authoring `025`/`029`.

Detail-page reads of these columns (`request-detail.ts`, `error-detail.ts`) fetch a single
row by primary key / `public_id` and pass the JSONB value through unfiltered for display —
this is a PK lookup, not a JSONB-filtered query, so it never used the GIN index in the
first place and is unaffected by removing it.

## 5. Fresh-database verification

Updated: the `CREATE INDEX ... USING GIN` statements have been **removed directly from the
base schema files** (`001_events_requests.sql` through `010_events_cron_checkins.sql`),
not merely dropped by a later migration. A fresh database bootstrap therefore never
creates any of these 44 GIN indexes in the first place — each base file has a comment in
place of the removed `CREATE INDEX` block explaining why (no query path, see §4) and citing
which later migration historically dropped it for deployments migrating forward from an
older schema.

`025_request_ingestion_hot_path.sql`, `029_span_log_ingestion_hot_path.sql`, and this
task's `031_remaining_jsonb_gin_hot_path.sql` are **retained unchanged** as forward
migrations. On a fresh database they run as pure no-ops (`DROP INDEX IF EXISTS` on an
index that was never created), and on an existing database bootstrapped before this
change, they still perform the real drop. This was verified against a live database:
`test/integration/logdb-migrations.test.ts` applies the full `00_shared` → `03_observability_v2`
migration set (including `001`-`010` with the GIN blocks removed, plus `025`/`028`/`029`)
against a real Postgres connection and passes, confirming the edited base schema files are
still syntactically and referentially valid on a from-scratch database.

## 6. Live-database verification query (per master prompt §18)

```sql
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE indexdef ILIKE '%USING gin%'
  AND (indexdef ILIKE '%metadata%' OR indexdef ILIKE '%payload%'
       OR indexdef ILIKE '%attributes%' OR indexdef ILIKE '%ai_response%'
       OR indexdef ILIKE '%context%' OR indexdef ILIKE '%tags%' OR indexdef ILIKE '%extra%')
  AND tablename LIKE 'events_%';
```

**Expected result after migration `031` is applied: 0 rows.**

**NOT MEASURED against a live database in this session** — the integration test harness in
this environment is missing draft migration fixture files unrelated to this change
(confirmed pre-existing, see `test/integration/alerting-bindings-repository.test.ts` ENOENT
failure reproduced identically before and after this change in an earlier part of this
session). The migration SQL itself is verified statically (`test/unit/logdb-remaining-gin-hot-path.test.ts`,
5/5 passing) and follows the identical, already-proven pattern of `025`/`029`.

## 7. Write-cost reduction (qualitative, not benchmarked)

Each GIN index removed eliminates, per inserted row on that table: one JSONB document
tokenization pass, one GIN posting-list update, and the associated WAL for that index
maintenance. This is the same mechanism the prior `025`/`029` migrations targeted and
documented as their primary hot-path cost driver. No live benchmark was run for this task's
7 additional tables — see `ingestion-write-path-after-json-removal.md` for the explicit
`NOT MEASURED` disclosure.
