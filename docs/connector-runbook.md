# Connector Module Runbook

This runbook covers the operation and maintenance of the notification connector module in APILogix Pulse.

## Architecture
The connector module uses a combination of Strategy and Registry patterns:
- **Registry**: Resolves connector classes based on database configuration (e.g., `SlackConnector`, `WebhookConnector`).
- **Strategy**: Each connector implements `INotificationConnector` for isolated logic.
- **Deduplication**: `pg_advisory_xact_lock` prevents duplicate pending deliveries by taking an advisory lock over the hash of the dedupKey (or correlationId).
- **Asynchronous Execution**: The `NotificationDispatcher` and connectors leverage `async` behavior to prevent blocking the Node.js event loop during operations like key derivation (KDF) using `scrypt`.

## Handling Dead Letters
Connectors may encounter terminal failures, rate limit exhaustion, or repeated unavailability. When a delivery exceeds its retry limit, it becomes a dead letter.

1. Dead letters are persisted in `connector_audit_logs`.
2. To monitor dead letter volume, `ConnectorMonitor` tracks `dlqGrowth` periodically.
3. Check `fastify.log.error` for `connector.dead_letter` events to set up alerting via external tools (Datadog/Sentry).

## DB Migrations
Connector module migrations are stored in `src/db/postgres/canonical_migrations_draft/06_connectors/`.
- Ensure you commit new `.up.sql` files properly.
- If you add a new `delivery_status`, update the `DeliveryStatusSchema` in `delivery.types.ts`.
- The database enforces no hard enum constraints on `status` columns, they are defined as `VARCHAR(30)` to simplify migrations. Validation happens in TypeScript through Zod.

## Security Practices
1. **SSRF**: Connectors disallow localhost, RFC1918 private IPs, and loopback addresses. Refer to `src/shared/url-safety.ts`.
2. **Redirects**: HTTP clients for webhook requests do not follow redirects, mitigating header exfiltration.
3. **Payload Truncation**: Delivery responses are not saved on success, and failure bodies are truncated to 2000 characters to prevent database bloat and memory leaks.
4. **Secret Storage**: Credentials are encrypted at rest using AES-256-GCM.
