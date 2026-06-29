# Notification Connectors

A pluggable, multi-tenant notification system. Organizations configure one or
more connectors (Slack, Discord, Teams, PagerDuty, generic Webhook, Email, SMS)
and the platform delivers notifications through them with rate limiting, retry
with exponential backoff, a circuit breaker, health monitoring, and a
dead-letter queue for unrecoverable failures.

## Architecture

| Concern | Pattern | Where |
|---|---|---|
| Per-connector behaviour | Strategy (`INotificationConnector`) | `connectors/connectors/*.connector.ts` |
| Instantiation | Factory | `registry.ts` (`createConnector`) |
| Adding new providers | Plugin (dynamic registration) | `registry.ts` (`registerConnectorType`) |
| Delivery + reliability | Dispatcher | `dispatcher.ts` |
| Background retries + health | Monitor | `monitor.ts` |
| Persistence | Repository | `repository.ts` |
| Business rules + audit | Service | `service.ts` |
| HTTP surface | Routes | `routes.ts` |

### Reliability envelope

Every delivery passes through, in order:

1. **Rate limit** — sliding window per connector (`rate_limit_requests` per
   `rate_limit_window_seconds`).
2. **Circuit breaker** — opens after `failure_threshold` consecutive failures,
   half-opens after a reset timeout.
3. **Send** — the connector's `send()` call with a hard HTTP timeout.
4. **Outcome** — success updates health counters; a *retryable* failure is
   re-scheduled with exponential backoff + jitter; a terminal failure is
   written to the **dead-letter queue**.

## Data model

Migration: `src/db/postgres/migrations2/002_add_notification_connectors.up.sql`
(rollback: `...down.sql`).

Tables: `connector_configs`, `connector_secrets`, `notification_templates`,
`notification_routes`, `notification_deliveries`, `notification_dead_letter`,
`connector_health_checks`, `connector_audit_logs`.

- **UUID** primary keys, **soft deletes** (`deleted_at`), `updated_at` triggers.
- Credentials live **encrypted** (AES-256-GCM) in `connector_configs.encrypted_config`
  (`bytea`). DTOs returned by the API never include decrypted credentials.
- **Tenant isolation is enforced in the service layer** (every query is scoped
  by `organization_id`). The spec's Row-Level-Security policies are included in
  the migration but **commented out**: this codebase does not set a
  `app.current_org_id` GUC per request, so enabling them would return zero rows.
  See the migration header for how to adopt RLS later.

### Applying the migration

```bash
psql "$DATABASE_URL" -f src/db/postgres/migrations2/002_add_notification_connectors.up.sql
# rollback
psql "$DATABASE_URL" -f src/db/postgres/migrations2/002_add_notification_connectors.down.sql
```

## Security

- **Encryption at rest** — AES-256-GCM via `shared/utils/encryption.ts`, keyed
  by `ENCRYPTION_KEY`. Each ciphertext carries its own random salt + IV.
- **Secret rotation** — `crypto.reencryptConfig()` re-encrypts in place with a
  fresh salt/IV without changing plaintext.
- **Webhook signing** — the generic webhook connector signs the body with
  HMAC-SHA256 over `${timestamp}.${body}` and sends `X-Pulse-Signature:
  t=<ts>,v1=<hex>`. Receivers should verify with a constant-time compare and
  reject stale timestamps.
- **Input validation** — every connector config is validated by a Zod schema
  before persistence; payloads are length-bounded per provider.
- **Audit** — every create/update/delete/test/send writes a
  `connector_audit_logs` row with actor, IP, user agent, and request id.

## API

All endpoints are organization-scoped and require a valid session plus active
membership of the organization (`authenticate` + `requireOrgAccess`).

Base path: `/organizations/:orgId/connectors`

| Method | Path | Description |
|---|---|---|
| `GET` | `/types` | List available connector types + their config fields |
| `POST` | `/` | Create a connector |
| `GET` | `/` | List connectors (`?type=&status=&search=&limit=&offset=`) |
| `GET` | `/:id` | Get a connector |
| `PATCH` | `/:id` | Update (config patches are merged + re-validated) |
| `DELETE` | `/:id` | Soft delete |
| `POST` | `/:id/test` | Test connectivity (records a health check) |
| `POST` | `/:id/send` | Send a test notification through the connector |
| `GET` | `/:id/deliveries` | Delivery history for a connector |

> Note: the original spec used `/api/v1/connectors`. This backend mounts
> feature modules under organization-scoped prefixes (no `/api/v1`), so the
> connector routes follow the existing convention for multi-tenancy.

### Example: create a Slack connector

```http
POST /organizations/{orgId}/connectors
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "name": "eng-alerts",
  "type": "slack",
  "config": { "webhookUrl": "https://hooks.slack.com/services/T000/B000/XXXX" }
}
```

### Example: send a test notification

```http
POST /organizations/{orgId}/connectors/{id}/send
{
  "severity": "critical",
  "title": "Database CPU > 90%",
  "body": "prod-db-1 has been above 90% CPU for 5 minutes.",
  "url": "https://app.example.com/incidents/123",
  "fields": [{ "label": "Region", "value": "us-east-1", "short": true }]
}
```

## Connector setup guides

### Slack
- **Webhook mode**: create an Incoming Webhook in your Slack app and set
  `config.webhookUrl`.
- **Bot mode**: create a bot token (`chat:write` scope), set `config.botToken`
  and `config.defaultChannel`. Bot mode returns a message `ts` and supports
  threading via `threadKey`.

### Discord
- Server Settings → Integrations → Webhooks → New Webhook. Set
  `config.webhookUrl`. Optional `username` / `avatarUrl` overrides. Threading
  uses the message `threadKey` (Discord `thread_id`).

### Microsoft Teams
- Channel → Connectors → Incoming Webhook → create and copy the URL into
  `config.webhookUrl`. Messages render as Adaptive Cards.

### PagerDuty
- Create an **Events API v2** integration on a service and copy its
  **Integration/Routing Key** into `config.routingKey`. Severity maps to
  PagerDuty severities; `dedupKey` collapses repeats onto one incident.

### Generic Webhook
- Set `config.url` (HTTPS), optional `config.method`, `config.headers`, and
  `config.signingSecret`. Verify `X-Pulse-Signature` on the receiver.

### Email (SMTP)
- Set `config.to` (recipients). Optionally override the platform SMTP with
  `config.smtp` (`host`, `port`, `secure`, `user`, `pass`) and
  `config.fromEmail` / `config.fromName`. Falls back to `SMTP_*` env.

### SMS (Twilio)
- Set `config.accountSid`, `config.authToken`, `config.fromNumber`, and
  `config.toNumbers`. Uses the Twilio Messages REST API (no SDK dependency).

## Adding a new connector type

1. Implement a class extending `BaseConnector` in
   `connectors/connectors/<type>.connector.ts` (define `configSchema`,
   `deliver`, `testConnection`, capability flags).
2. Add the type to the `connector_type` enum (new migration) and to
   `ConnectorTypeSchema`.
3. Register it in `registry.ts` via `registerConnectorType` with its metadata.

No other code needs to change — the factory, dispatcher, routes, and monitor
are type-agnostic.

## Testing

Unit tests for the pure logic (rate limiter, circuit breaker, backoff, webhook
signing, config validation) live in
`test/unit/modules/connectors.test.ts`:

```bash
npx vitest run test/unit/modules/connectors.test.ts
```
