# Organization Module Backend/Frontend Response Audit

## Scope

This audit was produced by reading source code only:

- Backend: `pulse/src/modules/organization/*`
- Frontend: `pulse_fe/src/modules/organizations/*`, `pulse_fe/src/pages/team/*`, `pulse_fe/src/pages/billing/*`, `pulse_fe/src/modules/settings/pages/*`, `pulse_fe/src/app/layouts/AppHeader/OrgSwitcher.tsx`

Not used:

- `dist/`
- generated files
- prebuilt artifacts

This report covers:

1. What the backend organization module sends in `res.body`
2. What the frontend actually uses
3. Which backend fields are unused by the current frontend
4. Which backend responses are over-wide or unsafe by industry standard
5. Which frontend expectations do not match the real backend contract

## Executive Summary

The backend organization module is mostly using explicit DTOs and is already better than average in terms of payload discipline. The main problems are not broad `SELECT *` exposure from these org routes, but contract drift between backend responses and frontend expectations.

Highest-signal findings:

- The frontend is incorrectly parsing several organization-module responses.
- Some backend routes return paginated payloads, but the frontend expects raw arrays.
- `GET /organizations/invitations/validate` does not match the frontend type or UI assumptions.
- `GET /organizations/:orgId/billing-summary` and `GET /organizations/:orgId/usage-limits` do not match frontend types at all.
- `POST /organizations/:orgId/invitations` returns sensitive invitation material (`token`, `inviteUrl`) that the current frontend does not use and that should not be returned by default in an enterprise product.
- The entire SDK config submodule exists on the backend, but there is no frontend source consumer for it in `pulse_fe`.

## Method

For each route, this report evaluates:

- Backend response shape from route + service DTO/mapping code
- Frontend consumer presence
- Exact frontend fields read from the returned object
- Unused backend fields
- Whether those unused fields are acceptable, questionable, or should not be sent

## Route-by-Route Audit

### Core Organization Routes

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `POST /organizations` | `{ success: true, data: OrganizationDto }` | Used in `CreateOrganizationPage` | `id` | `name`, `slug`, `description`, `logoUrl`, `websiteUrl`, `industry`, `companySize`, `country`, `timezone`, `billingEmail`, `supportEmail`, `ownerUserId`, `status`, `createdAt`, `updatedAt` | Payload is valid as a canonical created resource, but current frontend only needs `id`. `ownerUserId` is not needed by current UI and is a candidate to remove from general org DTOs. |
| `GET /organizations` | `{ success: true, data: UserOrganizationDto[], meta }` | Used in `useOrganizations`, `OrgSwitcher` | `id`, `name` | `slug`, `logoUrl`, `role`, `status`, `createdAt`, `meta.*` mostly unused in current UI | Contract is correct. Payload is broader than current switcher usage, but reasonable for a list endpoint. |
| `GET /organizations/:id` | `{ success: true, data: OrganizationDto }` | Used in `OrgProfilePage` | `name`, `slug`, `billingEmail`, `status`, `createdAt` | `description`, `logoUrl`, `websiteUrl`, `industry`, `companySize`, `country`, `timezone`, `supportEmail`, `ownerUserId`, `updatedAt` | DTO is explicit, but `ownerUserId` is questionable in a general details DTO when the UI does not need it. |
| `PATCH /organizations/:id` | `{ success: true, data: OrganizationDto }` | Used in `OrgProfilePage` only as mutation success | none | all returned fields unused | Returning the full updated object is acceptable, but the current frontend ignores it. |
| `DELETE /organizations/:id` | `204` | No frontend consumer | none | none | Backend route exists, but no source usage in frontend. |
| `POST /organizations/:id/archive` | `{ success: true }` | Used in `OrgProfilePage` | none | none | Frontend API client is wrong. It expects `r.data.data as Organization`, but backend returns no `data`. |
| `POST /organizations/:id/restore` | `{ success: true, data: OrganizationDto }` | No frontend consumer | none | all | Unused route from frontend perspective. |
| `POST /organizations/:id/transfer-ownership` | `{ success: true }` | No frontend consumer | none | none | Frontend API client is wrong. It expects `Organization`, but backend returns only success. |
| `GET /organizations/by-slug/:slug` | `{ success: true, data: OrganizationDto }` | No frontend consumer | none | all | Backend route is unused by current frontend. |
| `GET /organizations/slug-available/:slug` | `{ success: true, data: { slug, available } }` | No frontend consumer | none | `slug` | Current frontend API type only expects `{ available }`. Returning `slug` is harmless, but unnecessary if the client already knows the slug it asked for. |

### Settings

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/settings` | `{ success: true, data: OrgSettingsDto }` | Used in `SettingsGeneralPage` | `dataRegion`, `sessionTimeoutMinutes`, `dataRetentionDays`, `auditLogRetentionDays` | `enforceSso`, `enforceMfa`, `allowPublicProjects` | DTO is fine. Current frontend does not expose three settings that backend sends. |
| `PATCH /organizations/:orgId/settings` | `{ success: true, data: OrgSettingsDto }` | Used in `SettingsGeneralPage` only as mutation success | none | all returned fields unused | Acceptable, but frontend ignores returned object. |

### Members

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/members` | `{ success: true, data: MemberDto[], meta }` | Used in `MembersPage` | `id`, `userId`, `email`, `fullName`, `role`, `status`, `lastActiveAt` | `joinedAt`, `createdAt`, `meta.*` mostly unused in current page | Good DTO. No sensitive oversharing. |
| `GET /organizations/:orgId/members/me` | `{ success: true, data: MemberDto }` | No frontend consumer | none | all | Backend route exists to support role-aware UX, but current frontend does not use it. |
| `GET /organizations/:orgId/members/:userId` | `{ success: true, data: MemberDto }` | Used in `MemberDetailPage` | `fullName`, `email`, `status`, `role`, `joinedAt`, `userId`, `lastActiveAt` | `id`, `createdAt` | DTO is acceptable. |
| `PATCH /organizations/:orgId/members/:userId/role` | `{ success: true }` | No frontend consumer | none | none | Frontend API client is wrong. It expects `Member`, but backend returns only success. |
| `DELETE /organizations/:orgId/members/:userId` | `204` | Used in `MemberDetailPage` | none | none | Fine. |
| `POST /organizations/:orgId/members/:userId/suspend` | `{ success: true }` | Used in `MembersPage` | none | none | Frontend API client is wrong. It expects `Member`, but backend returns only success. |
| `POST /organizations/:orgId/members/:userId/reactivate` | `{ success: true }` | Used in `MembersPage` | none | none | Frontend API client is wrong. It expects `Member`, but backend returns only success. |
| `POST /organizations/:orgId/leave` | `204` | Used in `OrgProfilePage` | none | none | Fine. |

### Invitations

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/invitations` | `{ success: true, data: InvitationDto[], meta }` | Used in `InvitationsPage` | `id`, `email`, `role`, `status`, `invitedAt`, `invitedBy.name`, `invitedBy.email` | `expiresAt`, `meta.*` mostly unused | DTO is fine. |
| `POST /organizations/:orgId/invitations` | `{ success: true, data: { invitation, token, inviteUrl, accountExists, emailSent } }` | Used in `InvitationsPage`, but result is ignored | none | everything | This is the clearest over-response. The raw invitation `token` and generated `inviteUrl` should not be returned by default in an enterprise app unless there is an explicit admin "copy invite link" workflow. Current frontend does not use them. |
| `POST /organizations/:orgId/invitations/:invitationId/resend` | `{ success: true, data: { inviteUrl, accountExists } }` | Used in `InvitationsPage`, but result is ignored | none | `inviteUrl`, `accountExists` | `inviteUrl` is unnecessary for a normal resend flow and should not be returned by default. |
| `DELETE /organizations/:orgId/invitations/:invitationId` | `204` | Used in `InvitationsPage` | none | none | Fine. |
| `POST /organizations/invitations/accept` | `{ success: true }` | Used in `AcceptInviteLandingPage` | none | none | Fine. |
| `POST /organizations/invitations/:id/decline` | `{ success: true }` | Used in `AcceptInviteLandingPage` | none | none | Fine. |
| `GET /organizations/invitations/validate` | `{ success: true, data: { valid, email, role, orgName, orgSlug, expiresAt, accountExists } }` | Used in `AcceptInviteLandingPage` | `email`, `role` would be useful, but the page currently expects `Invitation` shape instead | backend does not send `id`, `invitedBy`, `status` | This is a contract mismatch. Frontend expects `Invitation`, but backend returns an invitation-validation payload. The page uses fields that backend never sends, including `invitedBy` and `id`. |

### Environments

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/environments` | `{ success: true, data: EnvironmentDto[] }` | Used in `EnvironmentsPage`, `EnvironmentDetailPage` | `id`, `name`, `isProduction`, `createdAt` | `slug`, `description` | DTO is fine. Current UI does not surface `slug` or `description`. |
| `POST /organizations/:orgId/environments` | `{ success: true, data: EnvironmentDto }` | Used in `EnvironmentsPage`, result ignored | none | all returned fields unused | Acceptable. |
| `PATCH /organizations/:orgId/environments/:envId` | `{ success: true, data: EnvironmentDto }` | Used in `EnvironmentDetailPage`, result ignored | none | all returned fields unused | Acceptable. |

### API Keys

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/api-keys` | `{ success: true, data: ApiKeyDto[], meta }` | Used in `OrgApiKeysPage` | `id`, `name`, `keyPrefix`, `role`, `lastUsedAt`, `expiresAt`, `revokedAt` | `environmentId`, `createdAt`, `meta.*` mostly unused | Backend payload is fine. Frontend API client is wrong because it expects `r.data.data as ApiKey[]`, losing the pagination contract. |
| `POST /organizations/:orgId/api-keys` | `{ success: true, data: ApiKeyDto + { rawKey } }` | No current frontend consumer | none | all | Returning `rawKey` once is industry-standard for create/rotate flows. Not an issue, but route is currently unused. |
| `DELETE /organizations/:orgId/api-keys/:keyId` | `204` | Used in `OrgApiKeysPage` | none | none | Fine. |
| `POST /organizations/:orgId/api-keys/:keyId/rotate` | `{ success: true, data: ApiKeyDto + { rawKey } }` | No current frontend consumer | none | all | Returning `rawKey` once is acceptable. Route unused in UI. |

### SSO

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/sso` | `{ success: true, data: SsoProviderDto[] }` | Used in `SsoPage` | `id`, `providerName`, `isActive`, `entityId`, `ssoUrl` | `providerType`, `domain`, `createdAt` | DTO is okay. |
| `POST /organizations/:orgId/sso` | `{ success: true, data: SsoProviderDto }` | Used in `SsoPage`, result ignored | none | all returned fields unused | Acceptable. |
| `PATCH /organizations/:orgId/sso/:ssoId` | `{ success: true, data: SsoProviderDto }` | Used in `SsoPage`, result ignored | none | all returned fields unused | Acceptable. |
| `DELETE /organizations/:orgId/sso/:ssoId` | `204` | No frontend consumer | none | none | Route exists but no UI consumer. |

### SCIM

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/scim-tokens` | `{ success: true, data: ScimTokenDto[] }` | Used in `ScimPage` | `id`, `expiresAt`, `revokedAt` and newly created `rawToken` from create flow | `lastUsedAt`, `createdAt` | DTO is okay. |
| `POST /organizations/:orgId/scim-tokens` | `{ success: true, data: ScimTokenDto + { rawToken } }` | Used in `ScimPage` | `rawToken` | `id`, `lastUsedAt`, `expiresAt`, `revokedAt`, `createdAt` | Returning `rawToken` once is correct. Extra token metadata is harmless but not used immediately. |
| `DELETE /organizations/:orgId/scim-tokens/:tokenId` | `204` | Used in `ScimPage` | none | none | Fine. |

### Security and Audit

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/security-events` | `{ success: true, data: SecurityEventDto[], meta }` | Used in `SecurityEventsPage` | `id`, `eventType`, `severity`, `userId`, `ipAddress`, `createdAt` | `metadata`, `meta.*` mostly unused | `metadata` can be useful for drill-down, but current list page does not use it. Not inherently wrong. |
| `GET /organizations/:orgId/audit-logs` | `{ success: true, data: AuditLogDto[], meta }` | Used in `AuditLogsPage` | `id`, `actorEmail`, `actorUserId`, `action`, `entityType`, `entityName`, `entityId`, `status`, `createdAt` | `meta.*` mostly unused | DTO is disciplined. |
| `GET /organizations/:orgId/audit-logs/export` | `{ success: true, data: AuditLogExportRow[] }` where each row includes `oldValues`, `newValues`, `changedFields` | No frontend consumer | none | all | Export route is unused by current frontend. Returning change payloads is appropriate for an export endpoint. |

### Quota Requests

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/quota-requests` | `{ success: true, data: QuotaRequestDto[], meta }` | Used in `QuotaRequestsPage` | `id`, `quotaType`, `currentLimit`, `requestedLimit`, `reason`, `status`, `createdAt` | `reviewedAt`, `notes`, `meta.*` mostly unused | Backend DTO is fine. Frontend API client is wrong because it expects `r.data.data as QuotaRequest[]`, ignoring pagination contract. |
| `POST /organizations/:orgId/quota-requests` | `{ success: true, data: QuotaRequestDto }` | Used in `QuotaRequestsPage`, result ignored | none | all returned fields unused | Acceptable. |
| `POST /organizations/:orgId/quota-requests/:requestId/approve` | `{ success: true, data: QuotaRequestDto }` | No frontend consumer | none | all | Backend route exists, but there is no source UI for approvals. |
| `POST /organizations/:orgId/quota-requests/:requestId/reject` | `{ success: true, data: QuotaRequestDto }` | No frontend consumer | none | all | Backend route exists, but there is no source UI for rejections. |

### Billing-Like Utility Routes Inside Organization Module

| Route | Backend success body | Frontend usage | Frontend fields actually used | Unused backend fields | Assessment |
|---|---|---|---|---|---|
| `GET /organizations/:orgId/billing-summary` | `{ success: true, data: { subscription, plan, usage } }` | Used in `PlanPage` | none correctly, because frontend expects a different shape | entire real payload mismatched | This is a full contract mismatch. Frontend expects `planName`, `price`, `billingCycle`, `nextInvoiceDate`, `amountDue`, `features`, but backend sends `subscription`, `plan`, and `usage`. |
| `GET /organizations/:orgId/usage-limits` | `{ success: true, data: { subscriptionStatus, planKey, limits } }` | Used in `BillingQuotasPage` | none correctly, because page expects an array-like quota list | entire real payload mismatched | This is a full contract mismatch. Frontend expects objects like `{ name, used, limit, unit }`, but backend sends a nested keyed object. |

### SDK Config Submodule

The following backend routes exist in `sdk-config.routes.ts`:

- `GET /organizations/:orgId/sdk-configs`
- `POST /organizations/:orgId/sdk-configs`
- `GET /organizations/:orgId/sdk-configs/resolve`
- `GET /organizations/:orgId/sdk-configs/:configId`
- `PATCH /organizations/:orgId/sdk-configs/:configId`
- `POST /organizations/:orgId/sdk-configs/:configId/rollback`
- `GET /organizations/:orgId/sdk-configs/:configId/versions`
- `GET /organizations/:orgId/sdk-configs/:configId/versions/:version`
- `GET /organizations/:orgId/sdk-configs/:configId/deployments`
- `POST /organizations/:orgId/sdk-configs/:configId/versions/:version/ack`

Frontend usage:

- No source consumer found in `pulse_fe`

Assessment:

- Entire backend SDK config surface is currently unused by the frontend.

## Fields Sent But Not Used By Current Frontend

These are unused by the current frontend, but not all of them are wrong to send.

### Safe but Currently Unused

- `OrganizationDto.description`
- `OrganizationDto.logoUrl`
- `OrganizationDto.websiteUrl`
- `OrganizationDto.industry`
- `OrganizationDto.companySize`
- `OrganizationDto.country`
- `OrganizationDto.timezone`
- `OrganizationDto.supportEmail`
- `EnvironmentDto.slug`
- `EnvironmentDto.description`
- `ApiKeyDto.environmentId`
- `ApiKeyDto.createdAt`
- `SsoProviderDto.providerType`
- `SsoProviderDto.domain`
- `SecurityEventDto.metadata`
- `QuotaRequestDto.reviewedAt`
- `QuotaRequestDto.notes`

These are acceptable to keep if the resource is meant to be a canonical representation.

### Questionable / Should Be Reconsidered

- `OrganizationDto.ownerUserId`
  - Current UI does not use it.
  - Exposing owner identity as a raw user id in every org fetch is not usually needed.
  - Prefer a dedicated ownership/admin endpoint or a `myRole`/`permissions` block if the client needs authorization context.

- `GET /organizations/slug-available/:slug` returning `slug`
  - The caller already knows the slug it asked for.
  - Returning only `{ available }` is cleaner.

### Should Not Be Sent By Default

- `POST /organizations/:orgId/invitations` returning `token`
- `POST /organizations/:orgId/invitations` returning `inviteUrl`
- `POST /organizations/:orgId/invitations/:invitationId/resend` returning `inviteUrl`

Reason:

- These values are invitation-bearing secrets or direct access links.
- In an enterprise system, default invite creation/resend should be server-driven and email-driven.
- If manual link copy is required, make it an explicit privileged action with audit, short expiry, and one-time display semantics.

## Frontend/Backend Contract Mismatches

These are more important than unused fields because they break correctness.

| Area | Backend actually returns | Frontend expects | Result |
|---|---|---|---|
| `archiveOrganization` | `{ success: true }` | `Organization` | Wrong client typing/parsing |
| `transferOwnership` | `{ success: true }` | `Organization` | Wrong client typing/parsing |
| `updateMemberRole` | `{ success: true }` | `Member` | Wrong client typing/parsing |
| `suspendMember` | `{ success: true }` | `Member` | Wrong client typing/parsing |
| `reactivateMember` | `{ success: true }` | `Member` | Wrong client typing/parsing |
| `createInvitation` | `{ invitation, token, inviteUrl, accountExists, emailSent }` | `Invitation` | Wrong client typing/parsing |
| `validateInvitation` | `{ valid, email, role, orgName, orgSlug, expiresAt, accountExists }` | `Invitation` | Hard contract mismatch, current UI expects fields backend does not send |
| `listApiKeys` | paginated `{ data, meta }` | raw `ApiKey[]` | Frontend drops pagination shape |
| `listQuotaRequests` | paginated `{ data, meta }` | raw `QuotaRequest[]` | Frontend drops pagination shape |
| `getBillingSummary` | `{ subscription, plan, usage }` | `BillingSummary` with `planName`, `price`, `billingCycle`, `nextInvoiceDate`, `amountDue`, `features` | Full shape mismatch |
| `getUsageLimits` | `{ subscriptionStatus, planKey, limits }` | quota card array-like structure | Full shape mismatch |

## Backend Routes With No Frontend Consumer

No source consumer was found in `pulse_fe` for:

- `DELETE /organizations/:id`
- `POST /organizations/:id/restore`
- `POST /organizations/:id/transfer-ownership`
- `GET /organizations/by-slug/:slug`
- `GET /organizations/slug-available/:slug`
- `GET /organizations/:orgId/members/me`
- `PATCH /organizations/:orgId/members/:userId/role`
- `DELETE /organizations/:orgId/sso/:ssoId`
- `GET /organizations/:orgId/audit-logs/export`
- `POST /organizations/:orgId/quota-requests/:requestId/approve`
- `POST /organizations/:orgId/quota-requests/:requestId/reject`
- All `sdk-configs` routes

Some additional frontend API methods exist but are unused because the UI has placeholder toasts instead of real flows:

- `createApiKey`
- `rotateApiKey`

## Industry-Standard Recommendations

### 1. Split Canonical DTOs from View DTOs

Current backend often returns a canonical resource representation, which is acceptable. But the frontend frequently needs a smaller view model.

Recommended pattern:

- Keep canonical DTOs for admin/detail APIs
- Add task-specific DTOs for list pages and action results
- Example: `OrganizationSummaryDto`, `OrganizationProfileDto`, `InvitationCreateResultDto`

### 2. Do Not Return Invitation Secrets By Default

Recommended:

- `POST /organizations/:orgId/invitations` should return only:
  - `invitationId`
  - `status`
  - `emailSent`
  - `expiresAt`
- If copy-link is required, add a separate privileged endpoint:
  - `POST /organizations/:orgId/invitations/:id/generate-link`

### 3. Standardize Mutation Responses

Right now some mutations return DTOs and some return only `{ success: true }`.

Recommended:

- Choose one contract style consistently:
  - Either `204`/minimal success for command endpoints
  - Or always return the updated resource

For this codebase, command-style endpoints are already common and fit well for:

- archive
- transfer ownership
- member suspend/reactivate
- revoke/revoke-like actions

The frontend should then stop pretending these return resources.

### 4. Fix Pagination Contracts

List endpoints should keep returning:

- `{ data: [...], meta: { hasMore, nextCursor, limit } }`

Frontend must parse them as paginated responses, not raw arrays.

### 5. Align Billing View Models

`billing-summary` and `usage-limits` are not wrong from a backend perspective, but they do not match the UI.

Recommended:

- Either adapt frontend to the backend domain model
- Or add presentation-oriented DTOs specifically for billing dashboard cards

### 6. Add Explicit Permissions/Capabilities Instead of Internal IDs

If the frontend needs to know whether to show transfer ownership, billing, or security controls, prefer:

- `myRole`
- `permissions`
- `capabilities`

over exposing fields like:

- `ownerUserId`

### 7. Keep Export Endpoints Rich, Keep List Endpoints Lean

Current separation is mostly good:

- list audit logs: lean DTO
- export audit logs: richer row with changes

This is a good pattern and should be preserved.

## Priority Fix List

### P0

- Fix frontend contract for `validateInvitation`
- Fix frontend contract for `getBillingSummary`
- Fix frontend contract for `getUsageLimits`
- Fix frontend contract for `listApiKeys`
- Fix frontend contract for `listQuotaRequests`

### P1

- Remove `token` and `inviteUrl` from default invitation create/resend responses
- Fix frontend API typings for `archiveOrganization`, `transferOwnership`, `updateMemberRole`, `suspendMember`, `reactivateMember`

### P2

- Remove or isolate `ownerUserId` from generic organization DTOs unless there is a real UI need
- Add frontend consumers only for routes that are intentionally part of the product surface
- Either wire or remove unused SDK config frontend gap

## Conclusion

The core backend org module is not broadly overexposing database rows. The bigger issue is that frontend and backend are not aligned on several response contracts, and one invitation flow returns more sensitive information than it should.

The cleanest next step is:

1. Fix the frontend contracts first
2. Then shrink invitation create/resend payloads
3. Then decide whether `ownerUserId` and other unused canonical org fields should stay in the general DTO or move behind narrower endpoints
