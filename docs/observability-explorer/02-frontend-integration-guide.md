# Observability Explorer — Build Summary, Routes & Frontend Integration Guide

This document describes exactly what was created on the backend, the complete
route surface, and what the frontend needs to build/update to consume it.

> Backend-first delivery. **No frontend files were changed in this repository**
> (it is a backend service). This guide is the contract the frontend implements
> against. See also `00-architecture.md` and `01-api-reference.md`.

---

## 1. What was created (backend)

New module: `src/modules/observability/` — registered in `src/app.ts` and
mounted at `/organizations/:orgId/observability`. It reads telemetry from the
dedicated Log DB (`events_*` tables) and identity/permissions from the primary
DB. Redis-free.

```
src/modules/observability/
├─ query-engine/                 # Unified Explorer Query Engine (shared core)
│  ├─ types.ts                   # DSL + response envelope types
│  ├─ operators.ts               # operators → parameterized SQL, ParamBag, coercion
│  ├─ field-registry.ts          # ExplorerResource/FieldDef, JSON-path fields, facets
│  ├─ cursor.ts                  # stable keyset cursors (no OFFSET)
│  ├─ search-parser.ts           # `status:500 method:POST latency>1000 "text"` DSL
│  ├─ sql-builder.ts             # index-aware list/summary/statistics/timeline SQL
│  ├─ query-schema.ts            # HTTP query params → validated DSL
│  ├─ engine.ts                  # orchestration + bidirectional keyset pagination
│  └─ index.ts                   # barrel
├─ resources/                    # one definition per explorer (the only per-signal code)
│  ├─ common.ts                  # shared event columns + row mapper
│  ├─ requests|errors|logs|traces|spans|metrics|crons|profiles.resource.ts
│  └─ index.ts                   # ResourceRegistry (register a resource → full explorer)
├─ correlation/engine.ts         # correlated bundle from a seed event (Phase 16)
├─ ai/
│  ├─ context-assembler.ts       # backend-assembled AI context + prompts (Phase 15)
│  └─ investigator.ts            # LLM via existing provider + heuristic fallback
├─ live/sse.ts                   # SSE live tail (bounded poll, Redis-free) (Phase 13)
├─ repository.ts                 # Log-DB read executor + safe correlation fetchers
├─ context.ts                    # QueryContext resolver (org/role/plan/retention)
├─ service.ts                    # application layer (list/detail/timeline/ask/nav/…)
├─ controller.ts                 # thin HTTP handlers
├─ routes.ts                     # route wiring (auth + org guard)
└─ observability.module.ts       # Fastify plugin
```

Tests: `test/unit/observability-query-engine.test.ts` (operators, cursor, search
DSL, field resolution, SQL generation, HTTP parsing, engine envelope/pagination,
and a registry-integrity suite over all eight resources).

Docs added: `docs/observability-explorer/00-architecture.md`,
`01-api-reference.md`, and this file.

Capabilities delivered: list/summary/statistics/timeline for 8 signals, keyset
pagination, field projection, search DSL, saved-view-ready filters, facet
metadata, universal correlated detail, lazy relationship tabs, SSE live tail,
and AI investigation (Ask AI) at both row and event level.

---

## 2. Routes (complete surface)

Base: `/organizations/:orgId/observability`
`:resource` ∈ `requests | errors | logs | traces | spans | metrics | crons | profiles`

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | GET | `/navigation` | Sidebar/IA tree |
| 2 | GET | `/resources` | Explorer resource names |
| 3 | GET | `/:resource` | List (items+pagination+summary+statistics+facets) |
| 4 | GET | `/:resource/summary` | Summary aggregates only |
| 5 | GET | `/:resource/statistics` | Statistics aggregates only |
| 6 | GET | `/:resource/timeline` | Bucketed count + error-count series (`?interval=minute\|hour\|day`) |
| 7 | GET | `/:resource/facets` | Available filters (facet metadata) |
| 8 | GET | `/:resource/stream` | SSE live tail |
| 9 | POST | `/:resource/ask` | AI investigation over the filtered set |
| 10 | GET | `/:resource/:id` | Universal correlated event detail |
| 11 | GET | `/:resource/:id/related/:relation` | Lazy relationship (`spans\|logs\|errors\|requests\|metrics\|profiles\|crons`) |
| 12 | POST | `/:resource/:id/ask` | AI investigation for one event |

All routes require `authenticate` + `requireOrgAccess`.

### Auth requirements (frontend)

- Send `Authorization: Bearer <accessToken>` on every request.
- The caller must be an active member of `:orgId` (enforced server-side).
- CORS: the app allows the configured `FRONTEND_URL`/`ALLOWED_ORIGINS` with
  credentials. Exposed headers include `X-Request-ID` and `ETag`.

### Shared query parameters (all list-type endpoints: 3–9)

`search, from, to, range(15m|1h|6h|24h|7d|30d|90d), projectId, environment,
filters(JSON), sort(field:asc|desc), cursor, direction(forward|backward),
limit(1–200), fields(csv), live`.

`filters` JSON shape: `[{ "field": "statusCode", "op": "gte", "value": 500 }]`.
Operators: `eq neq gt gte lt lte in nin contains ncontains startsWith endsWith
exists nexists between`. JSON attributes: use field `attr:key` / `meta:key` /
`payload:key`.

`POST …/ask` body: `{ "intent": "explain|root_cause|find_similar|performance|security|optimization|incident_summary|ask", "question?": "..." }`.

---

## 3. Frontend: what to build / update

Nothing was changed in the frontend. The following must be built (or updated if
an older observability UI exists) to consume the new backend.

### 3.1 Sidebar / navigation
Fetch `GET …/navigation` and render the returned tree verbatim (do not hard-code
sections). Nodes carry `{ label, route, resource?, live? }`. Sections: Overview,
Live (8 signals), Explore (8 signals), Analytics (Dashboard/Services/Endpoints/
Databases/External APIs/AI Insights/Correlations/Trends), Deployments, Releases,
Alerting, Settings.

### 3.2 Common Explorer Framework (one reusable page shell)
Build ONE explorer shell that all eight list pages reuse. Map toolbar controls
directly to query params — no page invents its own query logic:

| Toolbar control | Query param |
|-----------------|-------------|
| Search box | `search` |
| Time range picker | `range` or `from`/`to` |
| Environment / Project selectors | `environment` / `projectId` |
| Filter builder | `filters` (JSON) |
| Column chooser | `fields` (csv) |
| Sort header | `sort` |
| Pagination (next/prev) | `cursor` + `direction` |
| Page size | `limit` |
| Live toggle | switch to the `…/stream` SSE endpoint |
| Ask AI (toolbar) | `POST …/ask` |

Populate the filter builder from `GET …/:resource/facets` (each facet has
`field, label, type, operators, enumValues?`). Render `summary`/`statistics`
from the list response as header stat cards, and draw the sparkline/bar from
`GET …/:resource/timeline`.

### 3.3 List pages (Requests, Errors, Logs, Traces, Spans, Metrics, Crons, Profiles)
Render `items` in a table using the resource's default columns (or the user's
column selection). Each row exposes actions: open detail, and “Ask AI” (calls
event-level ask). Use `pagination.nextCursor`/`previousCursor` for paging.

### 3.4 Universal detail page (`GET …/:resource/:id`)
One layout for every signal. The backend returns ONE correlated payload — the
frontend performs zero joins. Render tabs/sections from:
`entity, attributes, metadata, payload, trace, spanTree, spans, logs,
relatedErrors, relatedRequests, metrics, profiles, crons, correlations, counts,
timeline, aiContext`. Use `aiContext.intents` to render the AI action buttons
(Explain / Find Root Cause / Find Similar / Performance / Security /
Optimization / Incident Summary). Heavy tabs may lazy-load via
`GET …/:resource/:id/related/:relation`.

### 3.5 Live pages (SSE)
`GET …/:resource/stream` emits `data: <row JSON>` events plus `:ping`
heartbeats. Support Pause/Resume/Auto-scroll/Buffer on the client. **Important:**
native `EventSource` cannot send an `Authorization` header — use a fetch-based
SSE client (e.g. `@microsoft/fetch-event-source`) so the Bearer token is sent.
Same query params as list apply (filters/search/env/project).

### 3.6 Ask AI
- Row/detail: `POST …/:resource/:id/ask` with `{ intent, question? }`.
- Toolbar (aggregate over current filters): `POST …/:resource/ask`.
Response: `{ summary, findings[], rootCause, recommendations[], confidence,
source: "ai"|"heuristic", model }`. Render `source:"heuristic"` results the same
way (they are real analysis, produced when the AI provider is disabled).

---

## 4. Integration patterns (copy-paste ready)

```ts
const BASE = `/api/organizations/${orgId}/observability`;
const authHeaders = { Authorization: `Bearer ${accessToken}` };

// List with filters + cursor pagination + field projection
async function listRequests(cursor?: string) {
  const params = new URLSearchParams({
    range: '24h',
    sort: 'timestamp:desc',
    limit: '50',
    fields: 'id,method,url,route,statusCode,latencyMs,timestamp,traceId',
    filters: JSON.stringify([{ field: 'statusCode', op: 'gte', value: 500 }]),
    search: 'method:POST latency>1000',
    ...(cursor ? { cursor } : {}),
  });
  const res = await fetch(`${BASE}/requests?${params}`, { headers: authHeaders });
  return res.json(); // { items, pagination, summary, statistics, availableFilters, ... }
}

// Timeline for the chart
await fetch(`${BASE}/errors/timeline?range=7d&interval=hour`, { headers: authHeaders });

// Universal detail (one correlated payload — no client joins)
await fetch(`${BASE}/requests/${id}`, { headers: authHeaders });

// Ask AI on one event
await fetch(`${BASE}/errors/${id}/ask`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ intent: 'root_cause' }),
});

// Live tail (fetch-based SSE so we can send the Bearer header)
import { fetchEventSource } from '@microsoft/fetch-event-source';
fetchEventSource(`${BASE}/logs/stream?environment=production&search=level:error`, {
  headers: authHeaders,
  onmessage(ev) { if (ev.data && ev.data !== '{}') append(JSON.parse(ev.data)); },
});
```

### Cursor pagination rules
- First page: no `cursor`.
- Next page: `cursor = pagination.nextCursor`, `direction=forward`.
- Previous page: `cursor = pagination.previousCursor`, `direction=backward`.
- Cursors are opaque — never construct or parse them client-side.

### State handling
- Empty: list response `states.empty === true` (and `items.length === 0`).
- Loading/Error: transport-level. On non-2xx, the body is
  `{ success: false, error: { code, message, details? } }` (422 for validation).

---

## 5. Response envelopes

See `01-api-reference.md` for the full list, detail, and AI response schemas.
List responses are returned directly (`{ success, items, pagination, summary,
statistics, appliedFilters, availableFilters, aggregations, query, states }`).
Detail / summary / statistics / timeline / facets / ask wrap their result as
`{ success: true, data: … }`.

---

## 6. Frontend build checklist

- [ ] Navigation renderer driven by `GET …/navigation`.
- [ ] Reusable Explorer shell (toolbar → query params) + facet-driven filter builder.
- [ ] 8 list pages (columns per resource; row actions: detail, Ask AI).
- [ ] Universal detail page (tabs from the correlated payload + `aiContext.intents`).
- [ ] Lazy relationship tabs via `…/:id/related/:relation`.
- [ ] 8 live pages using a header-capable SSE client (pause/resume/buffer/auto-scroll).
- [ ] Ask AI panels (row/detail + toolbar aggregate).
- [ ] Cursor pagination controls (forward/backward, opaque cursors).
- [ ] Empty/loading/error states from the envelope.
- [ ] Analytics/Deployments/Releases pages — pending backend endpoints (see
      `00-architecture.md` “Remaining”); render placeholders until available.
