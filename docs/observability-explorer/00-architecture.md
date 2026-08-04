# Observability Explorer Platform — Architecture

Status: Authoritative design for the Pulse Observability Explorer Platform.
Scope: Backend-first. The backend owns correlation, aggregation, and context
assembly; the frontend only renders. This document is the contract that the
implementation under `src/modules/observability` fulfills.

Data plane: the dedicated Log DB (`config/log-database.ts`,
`logDB.getPrimaryPool()`) hosting the canonical `events_*` tables and the
`analytics_*` rollups. Control-plane identity/permissions come from the primary
DB (`config/database.ts`).

---

## Phase 1 — Information Architecture (Sidebar)

```
Overview
Live
  Requests
  Errors
  Logs
  Traces
  Spans
  Metrics
  Cron Check-ins
  Profiles
Analytics
  Dashboard
  Services
  Endpoints
  Databases
  External APIs
  AI Insights
  Correlations
  Trends
Deployments
Releases
Alerting
Settings
```

The sidebar is served by the backend (`GET /observability/navigation`) so
entitlements/feature-flags/permissions drive visibility. The frontend renders
the tree it is given; it never hard-codes which sections exist.

Each explorer node maps to one telemetry resource exposed by the Unified
Explorer Query Engine. Live nodes reuse the same resource with `live=true`.

---

## Phase 2 — Page Inventory

Every explorer page is one of three archetypes, and each declares the same
responsibility contract (purpose, primary/secondary data, live, filters,
actions, charts, tables, AI, permissions, empty/loading/error states).

| Page | Resource | Primary data | Secondary data | Live | Key filters |
|------|----------|--------------|----------------|------|-------------|
| Requests Explorer | requests | request rows | summary+stats | yes | method,status,latency,route,user,geo,device |
| Request Detail | requests | one request | trace/spans/logs/errors/metrics | no | — |
| Errors Explorer | errors | error rows | groups, stats | yes | severity,handled,fingerprint,release |
| Error Detail | errors | one error | stack, request, trace, breadcrumbs | no | — |
| Traces Explorer | traces | trace rows | service graph, stats | yes | duration,service,operation,root span |
| Trace Detail | traces | span tree | waterfall, critical path | no | — |
| Spans Explorer | spans | span rows | stats | yes | kind,db.system,http.status |
| Logs Explorer | logs | log rows | stats | yes | level,logger,service,trace |
| Metrics Explorer | metrics | metric series | top dimensions | yes | metric,aggregation,percentile |
| Cron Explorer | crons | check-in rows | schedule health | yes | monitor,status |
| Profiles Explorer | profiles | profile rows | hot paths | yes | type,function |

All list pages share the Common Explorer Framework (Phase 3). All detail pages
share the Universal Event Detail contract (Phase 14). Empty/loading/error
states are standardized envelope fields so the frontend renders them uniformly.

---

## Phase 3 — Common Explorer Framework

Every explorer list endpoint accepts the same query envelope and returns the
same response envelope. No page invents its own UX or query contract.

Shared query inputs (inherited by every resource):
`search, from, to, range, environment, projectId, filters, sort, cursor,
limit, direction, fields, live, tags, release, sdkVersion, savedViewId`.

Shared response envelope (see Phase "Response Models"):
`items, pagination, summary, statistics, appliedFilters, availableFilters,
aggregations, query, states`.

Toolbar features map to envelope fields:
- Search → `search` (parsed by the Search Engine DSL)
- Time Range → `from/to` or `range`
- Environment / Project → `environment` / `projectId`
- Saved Views / Bookmarks → `savedViewId` (+ Saved Views API)
- Filters → `filters[]` (typed operators)
- Columns / Field Projection → `fields`
- Pagination → `cursor` + `limit` + `direction` (keyset, never OFFSET)
- Sorting → `sort`
- Export → `format=csv|ndjson` streaming variant
- Live Toggle / Auto Refresh → `live=true` (SSE stream endpoint)
- Ask AI → `POST /:resource/ask` and per-row `POST /:resource/:id/ask`

---

## Phase 4 — Unified Explorer Query Engine

The single backend entry point for querying observability data. No controller
or service builds SQL directly. Adding a new explorer requires only a Resource
definition (table, field registry, resource filters, row mapper); the engine
supplies filtering, search, sorting, keyset pagination, projection,
permission/tenant scoping, aggregation, summary, and statistics.

Modules (`src/modules/observability/query-engine`):
- `operators.ts` — typed filter operators → parameterized SQL fragments.
- `field-registry.ts` — `ExplorerResource`/`FieldDef` types + registry helpers.
- `cursor.ts` — stable keyset cursor (base64 of `{t,id,dir}`) encode/decode.
- `search-parser.ts` — DSL: `status:500 method:POST latency>1000 "free text"`.
- `query-schema.ts` — Zod schema for the shared query envelope.
- `sql-builder.ts` — deterministic, index-aware, fully parameterized SQL.
- `engine.ts` — orchestration: validate → plan → execute → assemble envelope.
- `context.ts` — resolves `QueryContext` (org/project/env/role/plan/retention).

### DSL (typed query object)

```
ExplorerQuery {
  search?: string
  timeRange: { from: Date; to: Date }
  environment?: string
  projectId?: string
  filters: FilterClause[]        // { field, op, value }
  sort: SortClause[]             // [{ field, direction }]
  cursor?: string                // keyset cursor
  direction: 'forward'|'backward'
  limit: number                  // 1..200
  fields?: string[]              // projection allow-list
  live: boolean
}
```

### Operators

`eq, neq, gt, gte, lt, lte, in, nin, contains, ncontains, startsWith,
endsWith, exists, nexists, between`. Each operator maps to a parameterized
fragment and validates its value against the field type
(`string|number|boolean|uuid|timestamp|enum|json`). JSON fields support
`attr:key` addressing that compiles to `attributes->>'key'` with a GIN-friendly
containment path.

### Cursor pagination (keyset, never OFFSET)

Cursor tuple is `(timeColumn, idColumn)`. Forward + DESC:
`WHERE (time, id) < ($cursorTime, $cursorId)`; forward + ASC uses `>`. Backward
reverses the comparator and re-orders results. Cursors are opaque base64 and
carry the sort direction so `nextCursor`/`previousCursor` are both stable on
billions of rows and always resolve against `idx_<table>_tenant_time`.

### Search Engine DSL

Tokenizes `key:value`, `key>value`, `key>=`, `key<`, `key<=`, quoted phrases,
and free text. Known keys map to registered fields and become `FilterClause`s;
free text becomes an ILIKE/`to_tsvector` predicate over the resource's declared
`searchFields`. Unknown keys are rejected (fail-closed) with a clear error.

### Index-aware query planner

- Always leads with `organization_id = $1` then `project_id`/`environment` and
  the time range, matching `idx_<table>_tenant_env_time` /
  `idx_<table>_tenant_time`.
- Range scans use the `occurred_at` BRIN + native range partitions
  (partition pruning) for wide windows.
- JSON filters use the `attributes/metadata/payload` GIN indexes.
- Trace joins use `idx_<table>_trace`; service filters use `idx_<table>_service`.
- Resource-specific btree indexes (route/user/fingerprint/level/metric_name)
  are declared on each Resource so the planner can prefer them.

### Summary + statistics (auto, single round-trip family)

Every list response includes `summary` (counts/rates over the filtered window),
`statistics` (latency/percentile/error aggregates where applicable),
`appliedFilters`, `availableFilters` (facet metadata from the field registry),
and `aggregations`. No separate summary endpoint is required, though explicit
`GET /:resource/summary|statistics|timeline` are also exposed for detail pages.

### Extensibility contract

A new explorer supplies: `table`, `timeColumn`, `idColumn`, `fields` (registry),
`searchFields`, `defaultSort`, optional `preferredIndexes`, and a `mapRow`
function. Everything else is inherited.

---

## Response Models

```
ExplorerListResponse<T> {
  success: true
  items: T[]
  pagination: { nextCursor, previousCursor, hasNext, hasPrevious, limit, direction }
  summary: Record<string, number>
  statistics: Record<string, number|null>
  appliedFilters: FilterClause[]
  availableFilters: FacetDef[]
  aggregations: Record<string, unknown>
  query: { resource, timeRange, sort, search }
  states: { empty: boolean }        // loading/error are transport-level
}
```

Detail responses (Phase 5/14) return ONE correlated payload assembled by the
backend Correlation Engine: `summary, entity, trace, spanTree, logs, metrics,
relatedErrors, relatedDeployments, timeline, attributes, tags, correlations,
aiContext`. The frontend performs zero joins.

---

## Phase 15/16 — AI + Correlation

- Correlation Engine (`correlation/`) resolves relationships from a seed event
  (request/error/trace/log/span) across requests, errors, logs, traces, spans,
  metrics, profiles, crons using `trace_id`, `request_id`, `span_id`,
  `session_id`, `user_id`, time-proximity, and fingerprint. It returns one
  correlated bundle used by both detail pages and the AI context assembler.
- AI Context Assembler (`ai/`) builds the model context server-side from the
  correlated bundle. The AI never fetches frontend state. Every explorer row
  exposes `ask`; every detail page exposes explain / root-cause / find-similar /
  performance / security / optimization / incident-summary intents.

---

## Phase 17 — Analytics (rollups, not live scans)

Dashboards read `analytics_*` rollups (hourly/daily/perf/error groups/service
edges). Rollup workers (`workers/`) populate them incrementally from `events_*`.
Explorer list/detail endpoints never aggregate over billions of raw rows for
dashboard cards; they scan bounded, index-backed windows for row listing and
read rollups for wide-window summaries.

---

## Phase 18 — Permissions

Every endpoint resolves and enforces: Organization (membership via
`requireOrgAccess`), Project (scoping + membership), Environment, Role, Plan,
and Feature entitlement. `QueryContext` carries these; the engine injects the
org/project/environment predicates so tenant isolation cannot be bypassed by a
malformed filter.

---

## Phase 19 — Implementation Order (tracked)

1. IA · 2. Explorer Framework · 3. API Contracts · 4. Response Models ·
5. DB Queries · 6. AI Contracts — this document.
7. Services · 8. Repositories · 9. Controllers · 10. Routes ·
11. WebSockets/SSE · 12. Frontend · 13. AI · 14. Performance — code.

## Phase 20 — Performance

Keyset pagination, field projection, streaming export, compression (global
plugin), lazy relationship loading in detail assembly, batched correlation
queries (no N+1), partition pruning + BRIN for time scans, GIN for JSON,
resource-declared btree indexes, and rollups for wide-window aggregation.

---

## Implementation Status

Backend module: `src/modules/observability` (registered in `src/app.ts`).

Done (verified by unit tests in `test/unit/observability-query-engine.test.ts`):
- Unified Explorer Query Engine: operators, ParamBag, keyset cursor, search
  DSL, field registry (+ JSON path addressing), index-aware SQL builder
  (list/summary/statistics/timeline), HTTP→DSL schema, engine orchestrator.
- Eight resources: requests, errors, logs, traces, spans, metrics, crons,
  profiles — each with field registry, search aliases, summary, statistics.
- Repository (log-DB read executor) + safe correlation fetchers.
- Correlation Engine (trace/request/session keyed bundle assembly).
- AI context assembler + investigator (LLM via existing provider, deterministic
  heuristic fallback).
- Service (list/summary/statistics/timeline/detail/related/ask/pollSince/nav),
  controller, routes, SSE live streaming, module wiring, context resolver.
- API reference: `docs/observability-explorer/01-api-reference.md`.

Remaining / next iterations:
- Analytics rollup workers (Phase 17): incremental population of `analytics_*`
  rollups from `events_*` (dashboards read rollups).
- Export endpoint (CSV/NDJSON streaming) and Saved Views / Bookmarks CRUD.
- Deployments/Releases explorers (backed by `release_lookup` + a deployments
  table) and service-graph analytics surfaces.
- Frontend (second, per the master prompt) against the documented contract.
- Verification: run `npm run build` (tsc) and `npm test` in an environment with
  toolchain access; wire an integration test against the Log DB.
