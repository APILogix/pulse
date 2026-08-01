# Observability Explorer — API Reference

All endpoints are org-scoped and require `authenticate` + `requireOrgAccess`.

Base path: `/organizations/:orgId/observability`

`:resource` ∈ `requests | errors | logs | traces | spans | metrics | crons | profiles`.

## Shared list query parameters (Common Explorer Framework)

| Param | Type | Notes |
|-------|------|-------|
| `search` | string | Search DSL: `status:500 method:POST latency>1000 "free text"` |
| `from`,`to` | ISO datetime | Explicit window (half-open `[from,to)`) |
| `range` | enum | `15m,1h,6h,24h,7d,30d,90d` (default `24h`) when `from` absent |
| `projectId` | uuid | Project scope |
| `environment` | string | Environment scope |
| `filters` | JSON | `[{"field","op","value"}]`; ops: eq,neq,gt,gte,lt,lte,in,nin,contains,ncontains,startsWith,endsWith,exists,nexists,between |
| `sort` | string | `field:asc|desc` (time column drives keyset order) |
| `cursor` | string | Opaque keyset cursor (never OFFSET) |
| `direction` | enum | `forward` (default) or `backward` |
| `limit` | int | 1–200 (default 50) |
| `fields` | csv | Field projection allow-list |
| `live` | bool | Reserved for the stream endpoint |

JSON attribute addressing: filter/search field may be `attr:key`, `meta:key`, or `payload:key`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/navigation` | Sidebar/information-architecture tree (Phase 1) |
| GET | `/resources` | List of explorer resource names |
| GET | `/:resource` | List (items + pagination + summary + statistics + facets) |
| GET | `/:resource/summary` | Summary aggregates only |
| GET | `/:resource/statistics` | Statistics aggregates only |
| GET | `/:resource/timeline?interval=minute\|hour\|day` | Bucketed count + error-count series |
| GET | `/:resource/facets` | Available filters (facet metadata) |
| GET | `/:resource/stream` | SSE live tail (Phase 13) |
| POST | `/:resource/ask` | AI investigation over the filtered set |
| GET | `/:resource/:id` | Universal correlated event detail (Phase 14) |
| GET | `/:resource/:id/related/:relation` | Lazy relationship tab (`spans\|logs\|errors\|requests\|metrics\|profiles\|crons`) |
| POST | `/:resource/:id/ask` | AI investigation for one event (Phase 15) |

`POST …/ask` body: `{ "intent": "explain|root_cause|find_similar|performance|security|optimization|incident_summary|ask", "question?": string }`.

## List response envelope

```jsonc
{
  "success": true,
  "items": [ /* mapped rows (projection) */ ],
  "pagination": {
    "nextCursor": "…|null", "previousCursor": "…|null",
    "hasNext": true, "hasPrevious": false, "limit": 50, "direction": "forward"
  },
  "summary":    { "total": 1234, "errors": 12, "…": 0 },
  "statistics": { "p50": 42, "p95": 210, "p99": 980, "errorRate": 0.01 },
  "appliedFilters":   [ { "field": "statusCode", "op": "gte", "value": 500 } ],
  "availableFilters": [ { "field": "method", "label": "Method", "type": "string", "operators": ["eq","in","…"] } ],
  "aggregations": {},
  "query": { "resource": "requests", "timeRange": { "from": "…", "to": "…" }, "sort": { "field": "timestamp", "direction": "desc" }, "search": null },
  "states": { "empty": false }
}
```

## Detail response (universal, one correlated payload)

```jsonc
{
  "success": true,
  "data": {
    "resource": "requests",
    "entity": { /* the event */ },
    "attributes": {}, "metadata": {}, "payload": {},
    "trace": { /* trace row */ }, "spanTree": [ /* nested spans */ ],
    "spans": [], "logs": [], "relatedErrors": [], "relatedRequests": [],
    "metrics": [], "profiles": [], "crons": [],
    "correlations": { "traceId": "…", "requestId": "…", "spanId": null, "sessionId": null, "userId": "…" },
    "counts": { "spans": 8, "logs": 12, "errors": 1, "…": 0 },
    "timeline": [ { "bucket": "…", "count": 3, "errorCount": 1 } ],
    "aiContext": { "intents": ["explain","root_cause","…"], "facts": ["…"] }
  }
}
```

The backend performs all correlation; the frontend performs zero joins.

## AI investigation response

```jsonc
{
  "success": true,
  "data": {
    "intent": "root_cause",
    "summary": "…",
    "findings": ["…"],
    "rootCause": "…|null",
    "recommendations": ["…"],
    "confidence": 0.4,
    "source": "ai|heuristic",
    "model": "…|null"
  }
}
```

`source: "heuristic"` is returned when the AI provider is not enabled — a
deterministic analysis derived from the correlated telemetry (never a stub).
