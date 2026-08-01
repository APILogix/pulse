# ADR-0008 — Connector Workers Are Transport Only

Status: Proposed · Date: 2026-07-31

## Context

Connector workers today receive `{ organizationId, connectorId, payload, routeId, projectChannel }`.
The alerting batch processor has already resolved routing, but the connector layer still owns
provider selection semantics, rate limiting, circuit breaking, dedup/suppression windows, retry
scheduling, and dead-lettering. `NotificationDispatcher` also performs a `dedupKey` suppression check —
a business decision — inside the transport layer.

## Problem

1. Transport performs business logic (suppression window, dedup), so the same decision exists in two
   places and can disagree.
2. Rate limiting and the circuit breaker are **in-process**, so the effective limit multiplies by
   process count, and there are **two unsynchronized breakers** (in-memory in `runtime.ts`, plus a
   DB-derived one from `consecutive_failures`).
3. The connector DLQ is an audit-log row (`action='delivery.dead_lettered'`), so there is no queryable
   DLQ and no replay path.
4. Delivery outcome is never reported back to the alert, leaving `alert_delivery_attempts` at `queued`
   forever.
5. Adding a provider risks touching alerting code.

## Options Considered

| Option | Assessment |
|---|---|
| **A. Keep the current split, fix the breakers only** | Rejected. Leaves business logic in transport and the broken outcome loop. |
| **B. Move retries and rate limiting into the alerting module** | Rejected. Retry/backoff is genuinely a transport concern tied to provider semantics (HTTP status classification, `Retry-After`), and it works well today. |
| **C. Strict transport-only workers consuming a `NotificationJob`, with global DB-backed guards** | **Chosen.** |

## Decision

The **only** input to a connector worker is a `NotificationJob`: `jobId`, `organizationId`,
`connectorId`, `channelKind`, `recipientRef` (already resolved), `idempotencyKey`, `severity`, and a
fully rendered `payload`.

A connector worker may only:

1. Consume a **global** rate token via an atomic single-statement UPSERT on
   `connector_rate_buckets` (primary DB). The in-process limiter is demoted to a cheap pre-filter.
2. Check the **single** DB-backed circuit (`connector_circuit_state`), replacing both existing breakers.
3. Decrypt credentials and instantiate the provider from the registry.
4. Insert/find `connector_deliveries` by `(connector_id, idempotency_key)` — idempotent by index.
5. Call the provider.
6. Record `connector_deliveries` + `connector_delivery_attempts` + circuit transition; retry with the
   existing exponential backoff + full jitter, or dead-letter into the new
   `connector_dead_letters` table plus the `connector.dlq` queue.
7. Report the outcome by updating `alert_notification_jobs.status` and appending
   `alert_usage_events` for the delivered/failed channel.

It is **forbidden** to: import `modules/alerting/**`, read `alert_rules*`, resolve recipients, read
notification preferences, read entitlements, or read routing rules. This is enforced by an ESLint
import-boundary rule, not just convention.

Step 7 is the one deliberate coupling: transport writes **status and usage only**, never policy. Without
it, the audit's broken outcome loop persists. Suppression/dedup **policy** moves out of transport into
the Policy Engine; only the connector-level `(connector_id, idempotency_key)` idempotency guard stays,
because that protects the provider call itself.

Each provider gets its own queue (`connector.email`, `.slack`, `.discord`, `.teams`, `.pagerduty`,
`.webhook`, `.sms`), so one provider's outage or rate limit cannot block the others.

## Consequences

Positive: a truly global rate limit and one breaker (fixes audit C4/C5); a real, replayable DLQ (fixes
C6); alert delivery status becomes accurate; adding a provider is registry + queue + enum only;
connector workers are testable with a single JSON fixture.

Negative: one extra DB round-trip per send for the rate token (single-row, index-only — measured as
negligible relative to provider RTT); connector workers now write two alert-owned tables, which must be
kept narrow by review; seven queues instead of one to operate.

## Migration Impact

Increment 6 runs old `connector-send-<type>` and new `connector.<provider>` queues in parallel for one
release; the router targets the new queues only when `ALERTING_V2_READ=true`, and can fall back to
publishing the legacy queue. Increment 7 gates global guards behind `CONNECTOR_GLOBAL_LIMITS`; with the
flag off, today's in-process behaviour is unchanged. If the rate-bucket UPSERT itself fails, the worker
falls back to the local limiter and alarms — a metering failure must never block a page.

All existing provider implementations, config schemas, HMAC signing, SSRF guards, OAuth PKCE flow, and
credential versioning are preserved unchanged.

## Future Considerations

- Per-provider concurrency and rate defaults sourced from provider documentation rather than per
  connector config.
- Provider health scoring (success rate, latency percentiles) to drive automatic fallback ordering.
- A shared `connector.outbound` audit stream for compliance export.
