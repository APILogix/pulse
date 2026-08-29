# JSON (metadata/payload) Persistence Audit

**Scope:** Whether `metadata`/`payload`/`attributes`/`ai_response` JSONB columns on the
canonical `events_*` tables should be removed from the ingestion write path.
**Verdict:** The columns are read back live by a real product feature (request/error "raw
event" detail views). They are **not removed**. Only their GIN indexes — which have zero
query usage anywhere in the repository — are removed. See `gin-index-audit.md`.

---

## 1. Where these JSONB values are constructed and written

Two independent write paths populate these columns:

### 1a. `TelemetryWriter` (`src/modules/ingestion/pipeline/telemetry-writer.ts`)

Handles `writeRequests`, `writeMessages`, `writeSpans`/`writeTraces`/`writeTraceSpanTree`,
`writeMetrics`, `writeLogs`, `writeProfiles`, `writeCronCheckins`, `writeReplays`, and
`writeErrors` (the latter is defined but not the live call path for errors — see 1b).

- `payloadFor(ev)`: `return JSON.stringify(ev);` — the **entire normalized SDK event
  object**, verbatim. The function's own comment: *"Preserve the exact normalized SDK
  event so newly added SDK fields are never lost."*
- `metadataFor(ev, environment)`: spreads `ev.metadata` (if a plain object), overwrites
  only `metadata.environment`. Duplicates data that is also promoted into typed columns
  (release, sdk_name, etc. via `metadataField()`), but keeps the full object including any
  custom SDK-added keys.
- `ai_response`: `e.aiResponse != null ? JSON.stringify(e.aiResponse) : null`.
- `attributes`: built per-type by dedicated stripping functions (`requestAttributes`,
  `traceAttributes`, `normalizedSpanAttributes`, `metricAttributes`) that merge
  `ev.attributes`/`ev.tags`/`ev.extra`, then delete keys that already have dedicated typed
  columns. This is a "leftover custom fields" bag, not a raw passthrough.
- `context`/`tags`/`extra` (errors, logs, messages, metrics, cron checkins): raw
  `JSON.stringify(e.context ?? {})` / `JSON.stringify(e.tags ?? {})` etc.

### 1b. `ErrorRepository` (`src/modules/errors/repositories/error.repository.ts`)

The **live** production path for `events_errors`, invoked from
`EventProcessor.process()` (`src/modules/ingestion/workers/event-processor.ts`) via
`ErrorIngestionService.ingestBatch()` — not `TelemetryWriter.writeErrors`.
`ERROR_EVENT_COLUMNS` includes `metadata`, `extra`, `tags`, `ai_response`, `payload`;
`errorEventValues()` builds `payload` as `JSON.stringify(record.payload ?? {})` where
`record.payload = e` (the full raw normalized error event), set in
`event-processor.ts` (`eventRecord.payload = e`). Same pattern as `payloadFor()`.

No other `INSERT INTO events_*` statement exists anywhere else in `src/`.

## 2. Downstream dependency check

| Consumer | Reads `metadata`/`payload`? | Evidence |
|---|---|---|
| Alerting outbox (`appendTelemetryOutbox()`) | **No.** Re-derives typed fields directly from the in-memory `ScopedEvent.event` object (`record.message`, `record.statusCode`, `record.stack`, etc.), independent of what got serialized into the DB columns. | telemetry-writer.ts `appendTelemetryOutbox()` |
| Analytics rollups (`analytics-engine/workers/*.ts`) | **No.** Aggregate typed columns only (`method`, `endpoint`, `duration_ms`, `status_code`, `severity`, …). | grep across `src/modules/analytics-engine/workers/` — zero `payload`/`metadata` references |
| Error fingerprinting/grouping (`errorFingerprint()`) | **No.** Takes only `errorType` (typed `error_name`) and `frames` (typed `stack`). | `src/modules/errors/fingerprint.ts` |
| Deduplication (`ON CONFLICT DO NOTHING`) | **No.** Keyed on `(project_id, event_id)` / `(organization_id, event_id, occurred_at)`. | migration unique indexes |
| AI investigation context (`investigation-context.ts`) | **No** for `metadata`/`payload`. Uses `tags`/`context`/`extra` (sanitized) plus typed columns for errors; never touches `metadata`/`payload`. | `src/modules/ai/investigation-context.ts` |
| Request detail "HTTP" tab (`request-detail.ts`) | **YES.** `assembleRequestDetail()` extracts `queryParameters`/`routeParameters`/`requestHeaders`/`responseHeaders`/`requestBody`/`responseBody` from the raw `payload` column via `PAYLOAD_*_KEYS` lookups. | `src/modules/observability/request-detail.ts` |
| Request/error "developer tools" raw view | **YES.** `assembleRequestDeveloperTools()` returns `rawSdkEvent` (masked `payload`), `normalizedEvent`, `rawDatabaseRecord`. `assembleErrorDetail()` returns `context`/`tags`/`extra`/`metadata` and `aiResponse: raw.ai_response`. | `request-detail.ts`, `src/modules/observability/error-detail.ts` |

**Conclusion:** `metadata`, `payload`, `attributes`, `ai_response`, `context`, `tags`,
`extra` are all live, real product features (raw event / developer-tools views on request
and error detail pages), not dead weight. Removing the columns or their write would
silently break those pages per the master prompt's own §6/§15 rules ("do NOT silently lose
information required by existing functionality"; "if the product requires raw-event
viewing, flag it... rather than silently breaking it").

## 3. Decision

**Columns and their INSERT parameters are UNCHANGED.** This audit's action is scoped to
removing the GIN indexes only (`gin-index-audit.md`), which have separately confirmed zero
query usage and therefore contribute pure write-path cost with no offsetting read benefit.

If a future product decision explicitly wants to stop persisting raw `payload`, the request
detail HTTP tab and both raw-event/developer-tools views would need to be redesigned first
(e.g. by extracting `requestBody`/`responseBody`/headers into dedicated bounded columns) —
that is a product/API-contract change out of scope for this write-path performance task and
is flagged here rather than done silently.
