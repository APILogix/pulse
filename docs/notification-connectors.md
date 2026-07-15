# Notification Connectors

A provider-agnostic, multi-tenant connector system for delivering platform
notifications through Slack, Discord, Teams, PagerDuty, Webhook, Email, and SMS.
The module owns connector lifecycle, encrypted credentials, routing, delivery
history, health checks, tests, OAuth state, and audit logs.

## Architecture

| Concern | Pattern | Where |
|---|---|---|
| Provider behavior | Strategy (`INotificationConnector`) | `src/modules/connectors/providers/*` |
| Provider registry | Factory + metadata catalog | `src/modules/connectors/registry.ts` |
| Delivery reliability | Dispatcher | `src/modules/connectors/delivery/delivery.service.ts` |
| Background work | pg-boss queues | `src/modules/connectors/queue.ts` |
| Persistence | Repository facade + focused repositories | `src/modules/connectors/repository.ts` |
| Business rules + audit | Service | `src/modules/connectors/service.ts` |
| HTTP API | Fastify routes | `src/modules/connectors/routes.ts` |

## Reliability

Every delivery is persisted before provider dispatch. Runtime delivery then
passes through the connector rate limiter, circuit breaker, provider send, and
attempt recording. Retryable failures are rescheduled with exponential backoff;
terminal failures are represented in `connector_deliveries` and audited in
`connector_audit_logs`.

The worker surface is pg-boss only:

| Queue | Purpose |
|---|---|
| `connector-send` | Deliver an explicit connector send job |
| `connector-delivery-retry` | Sweep and process retryable deliveries |
| `connector-health-check` | Run periodic connector health checks |
| `connector-test` | Run queued connector tests |
| `connector-secret-rotation` | Rotate encrypted connector credentials |
| `connector-oauth-refresh` | Refresh provider credentials through provider contracts |
| `connector-cleanup` | Remove expired OAuth state rows |
| `connector-dead-letter-retry` | Move failed deliveries back to retryable state |

## Data Model

Canonical migrations live under
`src/db/postgres/canonical_migrations_draft/06_connectors`.

| Table | Purpose |
|---|---|
| `connector_configs` | Tenant-scoped connector metadata, status, capabilities, limits |
| `connector_credentials` | Current encrypted provider config (`key_name='config'`) and OAuth token material (`key_name='oauth'`) |
| `connector_secret_versions` | Historical encrypted configs for rotation auditability |
| `connector_routes` | Optional project/environment/event/severity routing rules consumed by alert routing `target_route_ids` |
| `connector_deliveries` | Partitioned delivery history and retry state |
| `connector_delivery_attempts` | Partitioned provider attempt history |
| `connector_health_checks` | Partitioned health-check history |
| `connector_test_runs` | User-triggered test history |
| `connector_oauth_states` | Short-lived OAuth state + PKCE verifier storage |
| `connector_audit_logs` | Partitioned immutable audit trail |

API DTOs expose `type` for connector provider type. The database column is
`connector_configs.provider`, and repository reads alias it back to `type`.
Credentials are encrypted at rest and are never returned decrypted in API
responses.

Connector request bodies, query objects, params, and provider configuration
schemas are strict: unknown keys are rejected rather than silently stripped.
Flexible metadata bags remain explicit `record` fields.
Route-level Zod validation failures return HTTP 400 with
`CONNECTOR_VALIDATION_ERROR` and per-field issue details.

## Security

All endpoints require `authenticate`, active organization membership, and a
connector-specific permission guard.

| Permission | Required role |
|---|---|
| `connectors:view` | viewer |
| `connectors:create` | admin |
| `connectors:update` | admin |
| `connectors:delete` | admin |
| `connectors:rotate_secret` | admin |
| `connectors:test` | developer |
| `connectors:audit:view` | security |
| `connectors:deliveries:view` | viewer |
| `connectors:routes:manage` | admin |

Audit rows are written for create, update, delete, enable, disable, tests,
manual sends, route changes, OAuth actions, retries, and secret rotation.
Audit failures are logged but do not block the user operation.

Manual delivery retry marks the delivery retryable and enqueues
`connector-dead-letter-retry` with the actor id. The worker reclaims the
delivery for the scheduled retry processor and writes a retry audit row.
Dispatcher outcomes also write connector audit rows for `delivery.sent`,
`delivery.retry_scheduled`, and `delivery.failed`; exhausted failures still add
the `delivery.dead_lettered` audit entry with the stored failure payload.

Health checks append rows to `connector_health_checks` and update
`connector_configs.status`: healthy checks promote monitorable connectors to
`active`, degraded checks mark them `degraded`, and unhealthy checks mark them
`error`. Disabled, inactive, and revoked connectors are not re-enabled by health
checks.

## API

Base path: `/organizations/:orgId/connectors`

| Method | Path | Permission | Description |
|---|---|---|---|
| `GET` | `/types` | `connectors:view` | List registered connector providers and capabilities |
| `POST` | `/` | `connectors:create` | Create a connector with encrypted config |
| `GET` | `/` | `connectors:view` | List connectors (`type`, `status`, `search`, `limit`, `offset`) |
| `GET` | `/:id` | `connectors:view` | Get connector metadata |
| `GET` | `/:id/details` | `connectors:view` | Alias for connector metadata |
| `PATCH` | `/:id` | `connectors:update` | Update mutable metadata, status, limits, or config |
| `DELETE` | `/:id` | `connectors:delete` | Soft-delete a connector |
| `POST` | `/:id/enable` | `connectors:update` | Set status to `active` |
| `POST` | `/:id/disable` | `connectors:update` | Set status to `disabled` |
| `POST` | `/:id/rotate-secret` | `connectors:rotate_secret` | Validate and replace encrypted config |
| `POST` | `/:id/test` | `connectors:test` | Test provider connectivity and record a test run |
| `POST` | `/:id/health-check` | `connectors:test` | Run a health check now |
| `GET` | `/:id/health-history` | `connectors:view` | List health checks |
| `GET` | `/:id/test-runs` | `connectors:view` | List test runs |
| `POST` | `/:id/send` | `connectors:test` | Send a test notification |
| `GET` | `/:id/deliveries` | `connectors:deliveries:view` | List connector delivery history |
| `GET` | `/deliveries/:deliveryId` | `connectors:deliveries:view` | Get one delivery, including payload |
| `POST` | `/deliveries/:deliveryId/retry` | `connectors:test` | Request delivery retry |
| `GET` | `/:id/deliveries/:deliveryId/attempts` | `connectors:deliveries:view` | List delivery attempts |
| `GET` | `/:id/audit` | `connectors:audit:view` | List audit rows for a connector |
| `GET` | `/audit` | `connectors:audit:view` | List organization connector audit rows |
| `POST` | `/:id/routes` | `connectors:routes:manage` | Create a connector route |
| `GET` | `/:id/routes` | `connectors:view` | List connector routes |
| `PATCH` | `/:id/routes/:routeId` | `connectors:routes:manage` | Update a route |
| `DELETE` | `/:id/routes/:routeId` | `connectors:routes:manage` | Delete a route |
| `POST` | `/:id/oauth/start` | `connectors:update` | Create OAuth state and PKCE challenge |
| `POST` | `/:id/oauth/callback` | `connectors:update` | Validate and consume OAuth callback state |
| `POST` | `/:id/oauth/refresh` | `connectors:update` | Queue credential refresh |
| `POST` | `/:id/oauth/disconnect` | `connectors:update` | Revoke stored OAuth credential material |
| `POST` | `/preview` | `connectors:view` | Render a normalized notification preview payload |
| `POST` | `/validate-configuration` | `connectors:create` | Validate provider config without saving |

### Create Connector

```http
POST /organizations/{orgId}/connectors
Content-Type: application/json

{
  "name": "eng-alerts",
  "type": "slack",
  "description": "Engineering incident alerts",
  "config": {
    "webhookUrl": "https://hooks.slack.com/services/T000/B000/XXXX"
  },
  "rateLimitRequests": 60,
  "rateLimitWindowSeconds": 60,
  "maxRetries": 3,
  "failureThreshold": 5,
  "metadata": {
    "owner": "sre"
  }
}
```

Create stores encrypted provider config with status `pending_setup`, audits
`created`, and enqueues `connector-test`. The queued worker runs the provider's
`testConnection`, appends `connector_test_runs` and `connector_health_checks`,
and only promotes the connector to `active` after a successful provider test.
Thrown provider test errors are normalized into failed test runs and unhealthy
health checks so setup failures remain visible in history.

Connector updates that include `config` are treated as patches: the service
decrypts the existing stored config, overlays the supplied keys, validates the
merged provider config, and stores the merged result encrypted. This avoids
dropping existing secret fields when callers update one setting.

Requests that enable a connector or patch `status` to `active` do not write
`active` directly. They set the connector to `pending_setup`, enqueue
`connector-test`, and rely on the queued provider test to promote the connector
to `active` after successful validation.

### Send Test Notification

```http
POST /organizations/{orgId}/connectors/{connectorId}/send
Content-Type: application/json

{
  "notificationType": "incident",
  "severity": "critical",
  "title": "Database CPU above 90%",
  "body": "prod-db-1 has been above threshold for 5 minutes.",
  "url": "https://app.example.com/incidents/123",
  "fields": [
    { "label": "Region", "value": "us-east-1", "short": true }
  ]
}
```

### Rotate Secret

```http
POST /organizations/{orgId}/connectors/{connectorId}/rotate-secret
```

Rotation validates the replacement configuration through the provider contract
before persistence. The new encrypted value is written to
`connector_credentials.key_name='config'`; the previous value is archived in
`connector_secret_versions` with the caller recorded as `rotated_by`, then
`secret.rotated` is audited.

### OAuth Start

```http
POST /organizations/{orgId}/connectors/{connectorId}/oauth/start
```

Response data contains `state`, `codeChallenge`, `codeChallengeMethod`, and
`expiresAt`.

### OAuth Callback

```http
POST /organizations/{orgId}/connectors/{connectorId}/oauth/callback
Content-Type: application/json

{
  "state": "opaque-state",
  "code": "provider-auth-code",
  "accessToken": "provider-access-token",
  "refreshToken": "provider-refresh-token",
  "tokenType": "Bearer",
  "scope": "chat:write",
  "expiresIn": 3600
}
```

The callback consumes the OAuth state exactly once. When token material is
present, it is encrypted into `connector_credentials` with `key_name='oauth'`,
the prior OAuth credential is archived in `connector_secret_versions`, the
connector is marked `active`, `oauth.connected` is audited without token values,
and `connector-oauth-refresh` is scheduled before expiry.

### OAuth Refresh

```http
POST /organizations/{orgId}/connectors/{connectorId}/oauth/refresh
```

The route validates connector ownership, enqueues `connector-oauth-refresh`,
audits `oauth.refresh_requested`, and returns `{ "queued": true, "jobId": "..." }`.
The worker loads `connector_credentials.key_name='oauth'`, passes the decrypted
credential payload into the provider's `refreshCredentials` contract, and writes
refreshed material back through the versioned credential path without exposing
token values in audit logs.

### OAuth Disconnect

```http
POST /organizations/{orgId}/connectors/{connectorId}/oauth/disconnect
```

Disconnect archives the current OAuth credential through `connector_secret_versions`,
replaces the live credential with an encrypted revoked marker, marks the connector
`revoked`, and audits `oauth.disconnected`.

## Provider Contracts

Every provider implements `INotificationConnector`. In addition to `send()`,
providers expose `validateConfiguration`, `healthCheck`, `rotateSecret`,
`refreshCredentials`, `serialize`, and `deserialize` compatibility methods so
the module can operate without provider-specific branching.

## Adding a Provider

1. Implement a provider class under `src/modules/connectors/providers/<type>`.
2. Define and enforce the provider config schema.
3. Register the provider in `src/modules/connectors/registry.ts` with metadata
   and capabilities.
4. Add a canonical migration only if new persistent data is required.
5. Add unit coverage for validation, formatting, delivery behavior, and any
   provider-specific security behavior.

## Verification

Focused connector checks:

```bash
npx vitest run test/unit/modules/connector-permissions.test.ts test/unit/modules/connectors.test.ts test/scripts/canonical-migrations-draft.unit.test.ts test/integration/canonical-migrations-draft.test.ts
```
