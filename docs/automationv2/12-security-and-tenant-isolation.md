# 12 — Security and Tenant Isolation

## Tenant isolation mechanism: application-layer only, no RLS

Both modules rely entirely on `organization_id` (and often `project_id`) filters in application code. No Postgres Row Level Security policies were found for either module's tables in this pass. This matches the already-documented finding in `ALERT_RULE_CORRECTNESS_AUDIT.md` (tenant isolation "PASS at SQL layer for all direct paths ... no RLS backstop, accepted risk") — re-confirmed, not re-derived, for alerting. For automation, this audit independently confirmed the same pattern by reading representative WHERE clauses (see `03`/`04`): `getWorkflow`, `updateWorkflow`, `softDeleteWorkflow`, `setWorkflowEnabled`, `getRun`, `cancelRun`, `claimNextStep` (cross-checks run's org against workflow's org via a JOIN condition), `findMatchingWorkflows`, approvals lookups — all consistently include `organization_id = $n`.

**Risk framing**: this is a real but *accepted* architectural risk in this codebase (confirmed by the header comment in `rules.repository.ts`/`routing.repository.ts`: "Tenant isolation is enforced in the service layer ... this codebase isolates tenants in the application layer"). It means a single missed `organization_id` filter in any future query is a full cross-tenant data leak with no DB-level backstop. This audit did not find such a missed filter in the code paths examined, but did not exhaustively review every query in both modules line-by-line either — treat "no RLS" as a standing structural risk (J6/R6 in prior docs) rather than a proven active leak.

## NULL-org and cross-org edge cases (automation, newly verified in this pass)

- `automation_events_inbox` permits `organization_id IS NULL` (system-wide events). `processInbox` explicitly short-circuits: if `event.organizationId` is falsy, the event is completed immediately without matching any workflow — this correctly prevents a NULL-org event from executing any tenant's workflow. Classification: **VERIFIED WORKING** (defensive control, confirmed present).
- Project-scoped workflows require an exact `event.projectId === wf.projectId` match; `null` never matches. Classification: **VERIFIED WORKING**.
- One documented past bug (per context-gatherer's trace of `verifyProjectOwnership`): the check previously used the wrong column (checked something other than `projects.org_id`) — the current code checks `projects.org_id`, i.e. this was already fixed at some point prior to this audit. **NOT VERIFIED** whether this fix is fully complete across every call site — only the one call site traced (`createWorkflow`) was confirmed correct.

## Alerting cross-org sweep (intentional exception, flagged correctly)

`claimAutoResolvableAlerts` has `AND ($2::uuid IS NULL OR organization_id = $2::uuid)` — the org filter is *optional* by design, because this sweep intentionally runs cross-tenant (per the surrounding comment). This is not a leak: the sweep only *transitions alert state* (firing→resolved) based on a time threshold, it does not expose one tenant's data to another. Classification: **WORKING AS DESIGNED**, correctly distinguished in this audit from an actual isolation bug.

## Secrets management

`src/modules/connectors/secrets/secret.service.ts`:
- `encryptConfig`/`decryptConfig` — AES-256-GCM (via `../../../shared/utils/encryption.js`), keyed by `env.ENCRYPTION_KEY`. Stored as `bytea` (`salt:iv:authTag:ciphertext` hex, per code comment).
- `encryptSecret`/`decryptSecret` — same primitive for arbitrary secret strings (OAuth tokens, signing secrets).
- `reencryptConfig` — supports key rotation (decrypt with old key material, re-encrypt with fresh salt/IV).
- Classification: **VERIFIED WORKING** for connector credentials specifically. **NOT VERIFIED**: what happens to `env.ENCRYPTION_KEY` itself (rotation process, storage — likely an env var / secrets manager outside this repo's scope, not evaluated here).

## Secrets in logs / execution history

- `AlertDecisionEngine.decide()` explicitly avoids logging recipient/PII data (in-code comment: "Do NOT log recipient addresses - that is PII"); only `channelKind`/`deliveryMode`/`targetCount` are logged.
- `redactUrl()` (`connectors/shared/http.ts`) strips query string and credentials from any URL before it's used in error metadata — used in both the SSRF-block error path and network/timeout error paths of `httpRequest`.
- Notification job payloads (constructed in `decision.engine.ts`) contain `alertEventId`, `channelId`, `channelKind`, `connectorId`, `recipientRef`, `recipientUserId` — none of these are raw webhook URLs or tokens, based on the specific payload-construction code read in this pass. Classification: **VERIFIED WORKING** for this specific payload shape — **NOT exhaustively verified** across every code path that might construct a similar payload elsewhere in the module.

## SSRF protection (re-verified directly in this pass — resolves prior-doc uncertainty)

`src/modules/connectors/shared/http.ts`, `httpRequest()`:
```
if (!options.skipSsrfCheck) {
  const ssrf = validateWebhookUrl(url);
  if (!ssrf.safe) {
    throw new ConnectorDeliveryError(
      `SSRF protection blocked request: ${ssrf.reason ?? 'unsafe URL'}`,
      'invalid_config', false, { url: redactUrl(url) },
    );
  }
}
```
`validateWebhookUrl` imported from `src/shared/utils/ssrf.ts`. Since every connector transport routes through `httpRequest()` and `skipSsrfCheck` defaults falsy, SSRF validation runs on every outbound webhook call unless a caller explicitly opts out. A dedicated test exists: `test/unit/connector-ssrf-protection.test.ts`.

**This directly contradicts the uncertainty in the original `alerting-and-connectors-production-audit.md` (P1-01, "WebhookConnector doesn't reject private/metadata IPs")** — that finding is now **STALE / RESOLVED**, confirmed by direct code read, not by trusting a later doc's silence on the matter. Recommend updating or retiring that P1 finding in the original audit doc.

Automation has its own separate SSRF guard (`src/modules/automation/ssrf.ts`) — a second, independent implementation rather than a shared one. Flagged in `26-duplication-audit` territory: **DUPLICATED IMPLEMENTATION**, not verified whether the two guards enforce identical rules (e.g. same private-IP ranges blocked) — worth consolidating or at minimum confirming parity, since a webhook action in automation (once implemented) should be at least as strict as the alerting connector's guard.

## Authorization

Every traced write path in both modules gates on a role/permission check before mutating state (`requireWriteAccess`, entitlement checks via `checkAutomationEnabled`/`hasEntitlement`). No route was found in this pass that mutates workflow/rule state without such a check — but this was not an exhaustive route-by-route audit of every endpoint; treat as a spot-check confirmation, not a complete authorization audit.
