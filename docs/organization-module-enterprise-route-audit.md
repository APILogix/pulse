# Organization Module Enterprise Route Audit

## Scope

Reviewed source files:

- `src/modules/organization/routes.ts`
- `src/modules/organization/organizationservice.ts`
- `src/modules/organization/repository.ts`
- `src/modules/organization/types.ts`
- `src/modules/organization/organization.module.ts`

Mounted prefix: `/organizations`.

This review evaluates the organization module as the tenant boundary for an enterprise SaaS product: tenant lifecycle, membership, RBAC, invitations, settings, SSO, SCIM tokens, audit logs, security events, quotas, environments, and organization-level credentials.

## Executive Summary

The organization module has the right enterprise shape. It already includes tenant CRUD, owner transfer, settings, member lifecycle, invitations, environments, organization API keys, SSO provider configuration, SCIM token lifecycle, security events, audit logs, audit export, quota requests, and slug availability.

The main issue is not route quantity. The issue is enterprise correctness. Several routes are present but need stronger authorization semantics, rate limits, request validation, MFA/re-auth requirements, idempotency, email delivery, token safety, org-policy integration, and tests. Some capabilities are also only configuration shells: SSO providers and SCIM tokens exist, but complete SSO and SCIM protocol endpoints are not implemented here.

Highest-priority hardening:

1. Add rate limits to public and sensitive routes.
2. Require MFA/re-auth for destructive tenant operations, ownership transfer, SSO/SCIM changes, and credential creation/rotation.
3. Fix role semantics so `security` and `billing` roles get capability-based access instead of relying only on numeric hierarchy.
4. Do not expose invitation raw tokens in normal API responses except in development-only flows.
5. Decide whether organization API keys are really service tokens; if yes, rename and add scopes.
6. Add missing SCIM protocol routes and SSO auth routes, or mark current SSO/SCIM as configuration-only.

## Existing Route Catalog

### Organization Lifecycle

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `POST /organizations` | Present | P0 | Creates tenant, settings, and owner membership. |
| `GET /organizations` | Present | P0 | Lists orgs for current user. |
| `GET /organizations/:id` | Present | P0 | Requires membership. |
| `PATCH /organizations/:id` | Present | P1 | Requires admin. Audited. |
| `DELETE /organizations/:id` | Present | P1 | Requires owner. Soft-deletes by setting archived/deleted state. |
| `POST /organizations/:id/archive` | Present | P1 | Requires owner. |
| `POST /organizations/:id/restore` | Present | P1 | Requires owner. |
| `POST /organizations/:id/transfer-ownership` | Present | P0 | Requires owner and target active member. |

Good:

- Creation is transactional and creates the organization, default settings, and owner membership together.
- Slugs are generated server-side with collision handling.
- Role checks are centralized in service helpers.
- Sensitive lifecycle actions write audit records.

Bad / risk:

- `createOrg` currently prevents a user from owning more than one organization. That may be too restrictive for enterprise users, consultants, agencies, and test/sandbox tenants.
- Destructive operations and ownership transfer do not require MFA or recent re-authentication.
- `DELETE` and `archive` semantics overlap. `softDeleteOrg` sets status to `archived`, which can confuse deletion vs archive.
- `restoreOrganization` calls `requireMember` before restoring. If soft deletion removes the org from normal reads or active membership checks fail in future, restore may become unusable without a platform-admin path.
- No route to read by slug even though service has `getOrganizationBySlug`.

Missing routes:

- `GET /organizations/by-slug/:slug` - tenant lookup by slug for UI routing.
- `POST /organizations/:id/delete-request` - safer delayed deletion.
- `POST /organizations/:id/cancel-delete` - cancel delayed deletion.
- `POST /organizations/:id/lock` - platform-admin/security lock.
- `POST /organizations/:id/unlock` - platform-admin/security unlock.
- `GET /organizations/:id/health` - tenant readiness/configuration health.

### Settings and Policy

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/settings` | Present | P1 | Requires admin. |
| `PATCH /organizations/:orgId/settings` | Present | P0 | Requires admin. Audited. |

Good:

- Settings include SSO enforcement, MFA enforcement, session timeout, data region, retention, and public-project policy.
- Settings changes are audited.

Bad / risk:

- Auth module does not visibly enforce `enforceSso`, `enforceMfa`, or `sessionTimeoutMinutes`.
- Data retention and region settings are stored but enforcement is not proven here.
- `security` and `billing` role access is not capability-based. Some settings should be owner/security-only, not any admin.

Missing routes:

- `GET /organizations/:orgId/policy/effective` - returns effective auth/security policy for auth/frontend.
- `PATCH /organizations/:orgId/security-settings` - separate high-risk auth/security policy from general settings.
- `PATCH /organizations/:orgId/data-governance` - separate retention/region settings with stricter controls.
- `GET /organizations/:orgId/compliance-status` - summarizes SSO, MFA, audit retention, data region, and SCIM readiness.

### Members and RBAC

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/members` | Present | P0 | Requires membership. Cursor paginated. |
| `GET /organizations/:orgId/members/:userId` | Present | P1 | Requires membership. |
| `PATCH /organizations/:orgId/members/:userId/role` | Present | P0 | Requires admin. Prevents managing equal/higher role. |
| `DELETE /organizations/:orgId/members/:userId` | Present | P0 | Requires admin. Prevents self removal and last-owner removal. |
| `POST /organizations/:orgId/members/:userId/suspend` | Present | P1 | Requires admin. |
| `POST /organizations/:orgId/members/:userId/reactivate` | Present | P1 | Requires admin. |
| `POST /organizations/:orgId/leave` | Present | P1 | Prevents last owner from leaving. |

Good:

- Role hierarchy exists and is centralized.
- Self role-change and self removal are blocked.
- Last-owner removal/leave protection exists.
- Cursor pagination is used for member listing.

Bad / risk:

- `RemoveMemberSchema` and `SuspendMemberSchema` define a reason, but route handlers ignore it. Audit trails lose important context.
- `reactivateMember` does not check whether the actor can manage the target role.
- Numeric hierarchy is not enough for enterprise RBAC. Billing and security roles often need specific permissions that do not map cleanly to "higher/lower".
- No bulk member operations for enterprise admin workflows.
- No group/team model.

Missing routes:

- `PATCH /organizations/:orgId/members/:userId` - update member metadata, not only role.
- `POST /organizations/:orgId/members/bulk-remove`
- `POST /organizations/:orgId/members/bulk-role-update`
- `GET /organizations/:orgId/roles` - list roles and permissions.
- `GET /organizations/:orgId/permissions/me` - frontend-friendly permission contract.
- `GET /organizations/:orgId/access-reviews`
- `POST /organizations/:orgId/access-reviews`
- `POST /organizations/:orgId/access-reviews/:reviewId/complete`
- `GET /organizations/:orgId/teams`
- `POST /organizations/:orgId/teams`
- `PATCH /organizations/:orgId/teams/:teamId`
- `DELETE /organizations/:orgId/teams/:teamId`

### Invitations

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/invitations` | Present | P1 | Requires admin. |
| `POST /organizations/:orgId/invitations` | Present | P0 | Requires admin. |
| `POST /organizations/:orgId/invitations/:invitationId/resend` | Present | P2 | Requires admin. |
| `DELETE /organizations/:orgId/invitations/:invitationId` | Present | P1 | Requires admin. |
| `POST /organizations/invitations/accept` | Present | P0 | Requires authenticated user. |
| `POST /organizations/invitations/:id/decline` | Present | P2 | Requires authenticated user. |
| `GET /organizations/invitations/validate` | Present | P1 | Public token validation. |

Good:

- Invitation tokens are hashed in storage.
- Accept checks pending status and expiry.
- Invite roles exclude owner.

Bad / risk:

- Create invitation returns raw token and invite URL. In production this should usually be emailed, not returned, except in test/dev.
- Invitation accept does not visibly verify invited email equals authenticated user's email. That can allow a token holder to join as a different user if token leaks.
- Public validation route has no route-level rate limit and may leak organization name/slug.
- Resend route increments count but does not visibly send an email.
- Invitation ID params for resend/revoke are cast directly rather than parsed with the existing `InvitationIdParamsSchema`.

Missing routes:

- `GET /organizations/invitations/me` - list invitations for current authenticated email.
- `POST /organizations/:orgId/invitations/:invitationId/rotate-token` - emergency replacement.
- `POST /organizations/:orgId/invitations/bulk` - enterprise bulk invite.
- `POST /organizations/:orgId/invitations/:invitationId/resend-email` - explicit email delivery route if resend remains.

### Environments

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/environments` | Present | P1 | Requires membership. |
| `POST /organizations/:orgId/environments` | Present | P1 | Requires admin. |
| `PATCH /organizations/:orgId/environments/:envId` | Present | P2 | Requires admin. |

Good:

- Environments are organization-scoped and audited when changed.
- Production flag exists.

Bad / risk:

- No delete/archive route for environments.
- Slug is generated on create, but update name does not appear to update or manage slug.
- No uniqueness handling for duplicate environment slugs is visible.

Missing routes:

- `GET /organizations/:orgId/environments/:envId`
- `DELETE /organizations/:orgId/environments/:envId`
- `POST /organizations/:orgId/environments/:envId/archive`
- `POST /organizations/:orgId/environments/:envId/set-default`

### Organization API Keys

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/api-keys` | Present | P2/P3 | Lists organization-level keys. |
| `POST /organizations/:orgId/api-keys` | Present | P2/P3 | Creates raw key once. |
| `DELETE /organizations/:orgId/api-keys/:keyId` | Present | P2/P3 | Revokes key. |
| `POST /organizations/:orgId/api-keys/:keyId/rotate` | Present | P2/P3 | Rotates by revoking and creating new key. |

Good:

- Raw key is generated once and hashed before storage.
- Revocation and rotation are audited.

Bad / risk:

- Product purpose overlaps with project ingestion API keys.
- Keys have role, but not explicit scopes. Enterprise service tokens need scopes.
- Rotate uses fixed defaults: name `rotated-key`, role `member`, no environment, no expiry. It should preserve old metadata or require explicit input.
- No get-detail, update, enable/disable, usage, last-used update, or scope management routes.
- No MFA/re-auth requirement for creating or rotating credentials.

Recommended product decision:

Rename this route family to service tokens if it remains:

- `/organizations/:orgId/service-tokens`
- `/organizations/:orgId/service-tokens/:tokenId`

Missing routes if retained:

- `GET /organizations/:orgId/service-tokens/:tokenId`
- `PATCH /organizations/:orgId/service-tokens/:tokenId`
- `POST /organizations/:orgId/service-tokens/:tokenId/disable`
- `POST /organizations/:orgId/service-tokens/:tokenId/enable`
- `GET /organizations/:orgId/service-tokens/:tokenId/usage`
- `PATCH /organizations/:orgId/service-tokens/:tokenId/scopes`

### SSO Providers

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/sso` | Present | P1 | Requires admin. |
| `POST /organizations/:orgId/sso` | Present | P1 | Requires owner. |
| `PATCH /organizations/:orgId/sso/:ssoId` | Present | P1 | Requires owner. |
| `DELETE /organizations/:orgId/sso/:ssoId` | Present | P1 | Requires owner. |

Good:

- SSO config is owner-controlled.
- SAML/OIDC provider type is modeled.
- SSO config changes are audited.

Bad / risk:

- These are configuration routes only. Actual auth SSO login/callback routes are missing from auth.
- SSO provider secrets/certificates are not clearly encrypted or redacted in all paths.
- Deleting an active provider while `enforceSso` is enabled should be guarded.
- No metadata import route for SAML XML.
- No test connection route.

Missing routes:

- `POST /organizations/:orgId/sso/:ssoId/test`
- `POST /organizations/:orgId/sso/import-metadata`
- `GET /organizations/:orgId/sso/:ssoId/metadata`
- `POST /organizations/:orgId/sso/:ssoId/rotate-certificate`
- Auth-module routes for login/callback: `/auth/sso/*`

### SCIM Tokens and Provisioning

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/scim-tokens` | Present | P2 | Requires owner. |
| `POST /organizations/:orgId/scim-tokens` | Present | P2 | Creates token shown once. |
| `DELETE /organizations/:orgId/scim-tokens/:tokenId` | Present | P2 | Revokes token. |

Good:

- Tokens are hashed before storage.
- Tokens expire after one year.
- Lifecycle is audited.

Bad / risk:

- These are token management routes only. SCIM protocol endpoints are missing.
- No token rotation route.
- No token naming, scopes, IP allowlist, or last-used update route.
- No rate limit.

Missing SCIM protocol routes:

- `GET /scim/v2/:orgId/ServiceProviderConfig`
- `GET /scim/v2/:orgId/ResourceTypes`
- `GET /scim/v2/:orgId/Schemas`
- `GET /scim/v2/:orgId/Users`
- `POST /scim/v2/:orgId/Users`
- `GET /scim/v2/:orgId/Users/:userId`
- `PATCH /scim/v2/:orgId/Users/:userId`
- `PUT /scim/v2/:orgId/Users/:userId`
- `DELETE /scim/v2/:orgId/Users/:userId`
- `GET /scim/v2/:orgId/Groups`
- `POST /scim/v2/:orgId/Groups`
- `PATCH /scim/v2/:orgId/Groups/:groupId`
- `DELETE /scim/v2/:orgId/Groups/:groupId`

Missing token management routes:

- `POST /organizations/:orgId/scim-tokens/:tokenId/rotate`
- `PATCH /organizations/:orgId/scim-tokens/:tokenId`
- `GET /organizations/:orgId/scim-tokens/:tokenId/usage`

### Security and Audit

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/security-events` | Present | P1 | Requires `security` minimum role. |
| `GET /organizations/:orgId/audit-logs` | Present | P0 | Requires admin. |
| `GET /organizations/:orgId/audit-logs/export` | Present | P1 | Requires admin. |

Good:

- Mutations write audit logs through service helper.
- Cursor pagination is used for normal list APIs.
- Export has a hard cap.

Bad / risk:

- `hasMinRole("admin", "security")` returns true because admin rank is higher. That may be acceptable, but capability-based permissions would be clearer.
- Security events are read-only; there are no routes or service hooks shown for creating them from auth/org events.
- Audit export query schema does not expose `startDate`, `endDate`, or format even though repository supports dates.
- Export returns JSON only; enterprise customers often need CSV or NDJSON.
- Audit log write failures are swallowed after logging. That may be acceptable for availability, but for sensitive actions some platforms require fail-closed.

Missing routes:

- `GET /organizations/:orgId/audit-logs/:auditLogId`
- `GET /organizations/:orgId/audit-logs/export?format=csv|json|ndjson`
- `POST /organizations/:orgId/audit-logs/streaming-destinations`
- `PATCH /organizations/:orgId/audit-logs/streaming-destinations/:destinationId`
- `DELETE /organizations/:orgId/audit-logs/streaming-destinations/:destinationId`
- `GET /organizations/:orgId/security-events/:eventId`
- `POST /organizations/:orgId/security-events/:eventId/acknowledge`

### Quotas

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/:orgId/quota-requests` | Present | P2 | Requires admin. |
| `POST /organizations/:orgId/quota-requests` | Present | P2 | Requires admin. |
| `POST /organizations/:orgId/quota-requests/:requestId/approve` | Present | P2 | Requires owner. |
| `POST /organizations/:orgId/quota-requests/:requestId/reject` | Present | P2 | Requires owner. |

Good:

- Quota request lifecycle exists.
- Approval/rejection is audited.

Bad / risk:

- In most SaaS systems, quota approval is an internal platform-admin function, not an organization owner action.
- No route to cancel a pending quota request.
- Quota type schema exists but create schema uses generic string.
- Approval does not visibly update actual quota limits.

Missing routes:

- `POST /organizations/:orgId/quota-requests/:requestId/cancel`
- `GET /organizations/:orgId/quotas`
- `PATCH /organizations/:orgId/quotas` - platform-admin only.
- `GET /admin/quota-requests` - platform support queue.
- `POST /admin/quota-requests/:requestId/approve`
- `POST /admin/quota-requests/:requestId/reject`

### Utility

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /organizations/slug-available/:slug` | Present | P2 | Public utility. |

Good:

- Useful for onboarding UX.

Bad / risk:

- Public enumeration route has no rate limit.
- Slug schema allows broad strings; should match slug generation rules.

Missing routes:

- `POST /organizations/slug-suggestions` - returns safe suggestions without repeated enumeration.

## Enterprise Missing Route Checklist

### P0 Before Enterprise Launch

| Missing Capability | Suggested Route |
| --- | --- |
| Effective org policy for auth/frontend | `GET /organizations/:orgId/policy/effective` |
| Permission contract for current user | `GET /organizations/:orgId/permissions/me` |
| MFA/re-auth guard for sensitive org actions | Shared middleware plus route policy |
| Get organization by slug | `GET /organizations/by-slug/:slug` |
| Admin/platform tenant lock | `POST /organizations/:id/lock`, `POST /organizations/:id/unlock` |
| SCIM user provisioning endpoints | `/scim/v2/:orgId/Users/*` |
| SSO test/import support | `/organizations/:orgId/sso/:ssoId/test`, `/sso/import-metadata` |

### P1 Enterprise Readiness

| Missing Capability | Suggested Route |
| --- | --- |
| Teams/groups | `/organizations/:orgId/teams/*` |
| Access reviews | `/organizations/:orgId/access-reviews/*` |
| Audit log detail and export formats | `/organizations/:orgId/audit-logs/:id`, `/export?format=...` |
| Service-token scopes and usage | `/organizations/:orgId/service-tokens/*` |
| SCIM token rotation | `/organizations/:orgId/scim-tokens/:tokenId/rotate` |
| Environment deletion/archive | `/organizations/:orgId/environments/:envId` |

### P2 Product Maturity

| Missing Capability | Suggested Route |
| --- | --- |
| Bulk invitations | `POST /organizations/:orgId/invitations/bulk` |
| Bulk member operations | `/organizations/:orgId/members/bulk-*` |
| Compliance dashboard | `GET /organizations/:orgId/compliance-status` |
| Audit streaming destinations | `/organizations/:orgId/audit-logs/streaming-destinations/*` |
| Slug suggestions | `POST /organizations/slug-suggestions` |

## Implementation Quality Assessment

### Good Engineering Decisions

- The module owns tenant-level concerns, which is the correct boundary.
- Route/service/repository separation is clear.
- Service layer owns RBAC and business decisions.
- Zod schemas cover most request body, params, and query parsing.
- Cursor pagination is used for lists.
- Audit logging is integrated into mutating service methods.
- Tokens are hashed for invitations, API keys, and SCIM tokens.
- Owner transfer is transactional.
- Last-owner protection exists for removal and voluntary leave.

### Weaknesses to Fix

- Public and sensitive routes lack explicit route-level rate limits.
- Some route params are cast directly instead of parsed with existing schemas.
- Remove/suspend reason schemas are parsed or imported but not used correctly.
- SSO and SCIM are not complete protocols yet; they are mostly configuration/token management.
- Organization API keys overlap with project API keys and should be renamed or removed.
- Some operations need recent-auth or MFA checks.
- Capability-based permissions are needed for billing/security roles.
- Invitation accept must bind token email to authenticated user email.
- No route-complete test suite is visible.

## Recommended Roadmap

### Phase 1: Stabilize Current Routes

1. Add rate limits to `slug-available`, invitation validation, invitation create/resend, API key create/rotate, SCIM token create, SSO mutations, ownership transfer, delete/archive/restore.
2. Parse all route params with Zod schemas.
3. Pass remove/suspend reasons into service and audit logs.
4. Require MFA or recent re-auth for ownership transfer, org deletion, SSO changes, SCIM token creation, and service-token creation/rotation.
5. Add tests for every existing route, including forbidden role, non-member, invalid org status, and last-owner cases.

### Phase 2: Clarify Product Boundaries

1. Rename organization API keys to service tokens or remove them from public API.
2. Add explicit scopes if service tokens remain.
3. Keep project API keys as the only ingestion credential.
4. Document org admin vs platform admin responsibilities for quota approval and tenant lock/unlock.

### Phase 3: Enterprise Identity Completion

1. Implement auth SSO login/callback routes and connect them to org SSO providers.
2. Implement SCIM protocol endpoints for users and groups.
3. Add teams/groups and access reviews.
4. Add audit export formats and optional streaming destinations.
5. Add compliance status and effective policy routes.

## Final Recommendation

Keep the organization module as the tenant-control module. It is architecturally pointed in the right direction.

Do not label it enterprise-grade solely because it has many routes. Enterprise-grade means every route has precise authorization, validation, audit behavior, rate limits, re-auth/MFA for sensitive changes, and tests. The current module is a strong tenant-management scaffold that needs policy enforcement, protocol completion, and security hardening before it becomes a dependable enterprise boundary.
