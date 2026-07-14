# Organization schema-to-code parity audit

Audit source: `src/db/postgres/canonical_migrations_draft/{02_organizations,03_org_identity,11_billing}`. The database schema is treated as authoritative.

## Result

The module was not schema-compatible at the organization-creation boundary: it inserted legacy Billing columns (`org_id`, `billing_provider`, `seats`) and selected an Enterprise plan while calling it Free. It also omitted `organization_usage_current_period`. This is remediated in this change.

| Area | Score / 10 | Finding |
|---|---:|---|
| Architecture | 6 | Reasonable organization slices, but legacy compatibility repository duplicates ownership. |
| Schema parity | 5 | Core creation is now aligned; several optional tables and non-provisioning Billing slices remain incomplete. |
| Performance | 6 | Core uses keyset pagination, but Billing repositories still contain `SELECT *` and offset pagination. |
| Security | 6 | Organization routes generally enforce membership/RBAC; Billing mutation endpoints authenticate but do not enforce Billing/Owner role. |
| Maintainability | 5 | Two organization repository layers and legacy entitlement JSON adaptation remain. |
| Enterprise readiness | 5 | SSO/SCIM exist; verified-domain and organization-key lifecycle are absent. |
| Scalability | 6 | Canonical partitioned usage/audit schema exists; repository access needs query cleanup. |
| **Overall** | **5.6** | Creation is now safe; lifecycle and optional enterprise features require follow-up. |

## Canonical inventory and usage matrix

| Table | Purpose / lifecycle | Repository -> service -> route | Status |
|---|---|---|---|
| `organizations` | Organization identity; mandatory | `CoreRepository` -> `CoreService` -> `organizationservice` -> `/organizations` | Integrated |
| `organization_settings` | Per-org security/retention config; mandatory | `CoreRepository` -> `CoreService` -> same | Integrated |
| `organization_members` | Owner and member RBAC; mandatory | `MembersRepository` -> `MembersService` -> same | Integrated |
| `organization_invitations` | Membership invitation lifecycle; optional | `InvitationsRepository` -> `InvitationsService` -> same | Integrated |
| `quota_requests` | Support-managed quota requests; optional | `QuotasRepository` -> `QuotasService` -> same | Integrated; entitlement lookup was corrected to canonical view |
| `organization_audit_logs` | Security/business audit; mandatory on creation and lifecycle | `AuditLogsRepository` -> `AuditLogsService` -> same | Integrated; creation event is now transactional |
| `organization_security_events` | Security telemetry; optional | `SecurityEventsRepository` -> `SecurityEventsService` -> same | Read/list path only; event producers need coverage audit |
| `organization_email_outbox` | Durable organization email; optional | outbox helper -> worker | Integrated for invitations/email jobs |
| `organization_alert_thresholds` | Org/project alert defaults; optional | repository only | Missing service/controller/route |
| `organization_verified_domains` | Domain verification, SSO discovery, auto-join; optional | none | Missing |
| `organization_environments` | Org-level environments; optional | none | Intentionally unused: product currently uses project environments |
| `organization_api_keys` | Org-scoped API credentials; optional | none | Intentionally unused: product currently uses `project_api_keys`; migration or module consolidation is required before enabling |
| `organization_sso_providers` | SAML/OIDC SSO configuration; optional | `SsoRepository` -> `SsoService` -> `/organizations/:orgId/sso` | Integrated, except OIDC-specific fields are not exposed |
| `organization_scim_tokens` | SCIM credential lifecycle; optional | `ScimTokenService` -> organization facade -> `/organizations/:orgId/scim-tokens` | Integrated |
| SCIM scopes / IPs | Token permissions and allowlist; optional | `ScimTokenService` -> same | Integrated |
| `plans`, `billing_features`, `plan_feature_entitlements` | Billing catalog/entitlements; provisioning dependency | Billing repositories/services -> `/billing/*` | Integrated; quotas now consume `v_effective_entitlements` |
| `organization_subscriptions` | One current organization subscription; mandatory | `BillingProvisioningRepository` -> `BillingProvisioningService` -> invoked from core transaction | Integrated for creation; subscription routes need RBAC |
| `subscription_events` | Subscription lifecycle audit; mandatory at provisioning | Billing provisioning repository -> service | Integrated for creation |
| `organization_usage_current_period` | Fast quota counters; mandatory at provisioning | Billing provisioning repository -> service; Usage repository -> service -> `/billing/usage` | Integrated for creation |
| `usage_daily_counters` | Partitioned historical use; optional at creation | Usage repository/jobs -> Billing routes/jobs | Existing; no initial zero row is needed |
| `organization_feature_overrides`, `subscription_addons` | Commercial override/add-on lifecycle | Entitlements/jobs partial | No organization admin lifecycle routes |

## Creation flow after remediation

`POST /organizations` now uses one PostgreSQL transaction: slug/owner organization, settings, owner membership, user current-org update, canonical free-plan lookup, subscription, subscription event, entitlement-derived current-period usage counters, and `organization.created` audit log. A failure rolls back the entire unit. The event is published only after commit.

Optional business-domain provisioning is still deliberately not performed: the current request does not expose a verified-domain workflow, and automatically claiming a mailbox domain would be an unsafe ownership assertion. It must be implemented with a verification challenge, never as an implicit trusted domain.

## Highest-priority follow-up

1. Add verified-domain repository/service/routes and DNS challenge worker; authorize Owner/Security only, audit every state change, and rate-limit verification attempts.
2. Add `organization_alert_thresholds` service/controller/routes or remove the unused table migration.
3. Enforce Billing/Owner RBAC for every Billing subscription/payment mutation and make `/billing/usage/increment-events` internal-only (not merely authenticated).
4. Replace all Billing `SELECT *` and `OFFSET` queries with explicit projections and keyset pagination; current examples are in invoices, payments, subscriptions, plans, coupons, and usage repositories.
5. Remove the legacy `OrganizationRepository` entitlement bridge after all callers move to Billing `EntitlementsService`; it remains only for compatibility.
6. Add transactional integration tests covering duplicate slug, missing free plan, and each injected failure point in provisioning.

## Intentional boundaries

Invoices, payments, webhook inbox, coupons, and billing audit partitions are Billing-owned and not part of organization provisioning. They were reviewed for organization isolation but were not moved into the Organization module. Organization must call the Billing provisioning boundary only; it must not directly manage commercial lifecycle SQL.
