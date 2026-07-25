# MODULE KNOWLEDGE BASE: ORGANIZATION

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/organization`
> **Health Score:** 78/100

---

## 1. Executive Summary & Purpose

The **organization** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 1
- **Services:** 10
- **Repositories:** 12
- **Discovered Routes:** 65
- **Owned Database Tables:** organizations, organization_settings, organization_members, organization_invitations, organization_audit_logs, organization_email_outbox, organization_sso_providers, organization_scim_tokens, organization_subscriptions, organization_alert_thresholds, organization_verified_domains, organization_security_events
- **External Integrations:** SAML Single Sign-On

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/organization/
├── alert-thresholds.repository.ts
├── audit-logs.repository.ts
├── audit-logs.schema.ts
├── audit-logs.service.ts
├── core.repository.ts
├── core.schema.ts
├── core.service.ts
├── domains.controller.ts
├── domains.repository.ts
├── domains.routes.ts
├── domains.schema.ts
├── domains.service.ts
├── organization-domain-verification.job.ts
├── invitations.repository.ts
├── invitations.schema.ts
├── invitations.service.ts
├── members.repository.ts
├── members.schema.ts
├── members.service.ts
├── organization.module.ts
├── organizationservice.ts
├── quotas.repository.ts
├── quotas.schema.ts
├── quotas.service.ts
├── repository.ts
├── routes.ts
├── sdk-config.repository.ts
├── sdk-config.routes.ts
├── sdk-config.service.ts
├── sdk-config.types.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `POST` | `/` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/switch` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:id` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `PATCH` | `/:id` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `DELETE` | `/:id` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:id/archive` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:id/restore` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:id/transfer-ownership` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/settings` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `PATCH` | `/:orgId/settings` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/members` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/members/me` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/members/:userId` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `PATCH` | `/:orgId/members/:userId/role` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `DELETE` | `/:orgId/members/:userId` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/members/:userId/suspend` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/members/:userId/reactivate` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/leave` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/invitations` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/invitations` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/invitations/:invitationId/resend` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `DELETE` | `/:orgId/invitations/:invitationId` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/invitations/accept` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/invitations/:id/decline` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/invitations/validate` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/sso` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/sso` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `PATCH` | `/:orgId/sso/:ssoId` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `DELETE` | `/:orgId/sso/:ssoId` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/scim-tokens` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/scim-tokens` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/scim-tokens/:tokenId/rotate` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `DELETE` | `/:orgId/scim-tokens/:tokenId` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/security-events` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/audit-logs` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/audit-logs/export` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/quota-requests` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/quota-requests` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/quota-requests/:requestId/approve` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/quota-requests/:requestId/reject` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/billing-summary` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/usage-limits` | ❌ No | Org | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/slug-available/:slug` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/by-slug/:slug` | ❌ No | Global | `src/modules/organization/routes.ts` | Standard (60/min) |
| `GET` | `/:organizationId/domains` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `GET` | `/:organizationId/domains/:domainId` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `POST` | `/:organizationId/domains` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `POST` | `/:organizationId/domains/:domainId/verify` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `POST` | `/:organizationId/domains/:domainId/recheck` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `POST` | `/:organizationId/domains/:domainId/enable-auto-join` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `POST` | `/:organizationId/domains/:domainId/disable-auto-join` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `PATCH` | `/:organizationId/domains/:domainId` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `DELETE` | `/:organizationId/domains/:domainId` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `POST` | `/:organizationId/domains/:domainId/make-primary` | ❌ No | Org | `src/modules/organization/domains/domains.routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/sdk-configs` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/sdk-configs` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/sdk-configs/resolve` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/sdk-configs/:configId` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `PATCH` | `/:orgId/sdk-configs/:configId` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/sdk-configs/:configId/rollback` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/sdk-configs/:configId/versions` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/sdk-configs/:configId/versions/:version` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `GET` | `/:orgId/sdk-configs/:configId/deployments` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |
| `POST` | `/:orgId/sdk-configs/:configId/versions/:version/ack` | ❌ No | Org | `src/modules/organization/sdk-config/sdk-config.routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (POST /)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] Public Route
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] DomainsController
  ↓
[Service] OrganizationService
  ↓
[Repository] OrganizationRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### OrganizationService
- **Source File:** `src/modules/organization/organizationservice.ts`
- **Methods:** `audit()`, `requireMember()`, `requireMutableOrg()`, `createOrganization()`, `switchOrganization()`, `getOrganization()`, `getOrganizationBySlug()`, `updateOrganization()`, `deleteOrganization()`, `archiveOrganization()`, `restoreOrganization()`, `transferOwnership()`, `getSettings()`, `updateSettings()`, `listMembers()`, `getMember()`, `updateMemberRole()`, `removeMember()`, `suspendMember()`, `reactivateMember()`, `inviteMember()`, `resendInvitation()`, `revokeInvitation()`, `acceptInvitation()`, `declineInvitation()`, `listInvitations()`, `createSsoProvider()`, `updateSsoProvider()`, `deleteSsoProvider()`, `createScimToken()`, `revokeScimToken()`, `rotateScimToken()`, `listSecurityEvents()`, `listAuditLogs()`, `createQuotaRequest()`, `approveQuotaRequest()`, `rejectQuotaRequest()`, `listQuotaRequests()`, `getBillingSummary()`, `getUsageLimits()`, `listUserOrganizations()`, `validateInvitationToken()`, `checkSlugAvailability()`, `exportAuditLogs()`, `leaveOrganization()`, `listSsoProviders()`, `listScimTokens()`, `toScimTokenDto()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/types").OrganizationServiceDependencies
- **External Calls:** None


### AuditLogsService
- **Source File:** `src/modules/organization/audit-logs/audit-logs.service.ts`
- **Methods:** `audit()`, `listAuditLogs()`, `exportAuditLogs()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/audit-logs/audit-logs.service").AuditLogsServiceDependencies
- **External Calls:** None


### CoreService
- **Source File:** `src/modules/organization/core/core.service.ts`
- **Methods:** `requireMutableOrg()`, `createOrganization()`, `switchOrganization()`, `getOrganization()`, `getOrganizationBySlug()`, `updateOrganization()`, `deleteOrganization()`, `archiveOrganization()`, `restoreOrganization()`, `transferOwnership()`, `getSettings()`, `updateSettings()`, `checkSlugAvailability()`, `listUserOrganizations()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/core/core.service").CoreServiceDeps
- **External Calls:** None


### DomainsService
- **Source File:** `src/modules/organization/domains/domains.service.ts`
- **Methods:** `list()`, `get()`, `create()`, `verify()`, `verifyInternal()`, `autoJoin()`, `update()`, `delete()`, `primary()`, `verifyPending()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/domains/domains.repository").DomainsRepository, (o: string, u: string, r?: "owner" | "admin" | "developer" | "billing" | "security" | "member" | "viewer" | undefined) => Promise<unknown>, (m: import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/shared/types").RequestMeta, d: any) => Promise<void>, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, (d: string) => Promise<string[][]>
- **External Calls:** None


### InvitationsService
- **Source File:** `src/modules/organization/invitations/invitations.service.ts`
- **Methods:** `sendInvitationEmail()`, `inviteMember()`, `resendInvitation()`, `revokeInvitation()`, `acceptInvitation()`, `declineInvitation()`, `listInvitations()`, `validateInvitationToken()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/invitations/invitations.service").InvitationsServiceDependencies
- **External Calls:** None


### MembersService
- **Source File:** `src/modules/organization/members/members.service.ts`
- **Methods:** `hasMinRole()`, `requireMember()`, `addMember()`, `removeMember()`, `suspendMember()`, `reactivateMember()`, `updateMemberRole()`, `listMembers()`, `getMember()`, `countOwners()`, `leaveOrganization()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/members/members.service").MembersServiceDependencies
- **External Calls:** None


### QuotasService
- **Source File:** `src/modules/organization/quotas/quotas.service.ts`
- **Methods:** `limitFrom()`, `featureAllowed()`, `assertWithinLimit()`, `requireBillingEntitlements()`, `enforceBillingLimit()`, `createQuotaRequest()`, `approveQuotaRequest()`, `rejectQuotaRequest()`, `listQuotaRequests()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/quotas/quotas.service").QuotasServiceDependencies
- **External Calls:** None


### SdkConfigService
- **Source File:** `src/modules/organization/sdk-config/sdk-config.service.ts`
- **Methods:** `requireAdmin()`, `requireMember()`, `audit()`, `createConfig()`, `listConfigs()`, `getConfig()`, `updateConfig()`, `updateProjectConfig()`, `rollbackConfig()`, `listVersions()`, `getVersion()`, `listDeployments()`, `resolveForSdk()`, `acknowledgeDeployment()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/sdk-config/sdk-config.repository").SdkConfigRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger
- **External Calls:** None


### SecurityEventsService
- **Source File:** `src/modules/organization/security-events/security-events.service.ts`
- **Methods:** `listSecurityEvents()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/security-events/security-events.service").SecurityEventsServiceDependencies
- **External Calls:** None


### SsoService
- **Source File:** `src/modules/organization/sso/sso.service.ts`
- **Methods:** `listSsoProviders()`, `createSsoProvider()`, `updateSsoProvider()`, `deleteSsoProvider()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/sso/sso.service").SsoServiceDependencies
- **External Calls:** None


---

## 5. Repositories & Database Operations


### OrganizationRepository
- **Source File:** `src/modules/organization/repository.ts`
- **Methods:** `revokeExpiredScimTokens()`, `purgeSentEmailOutbox()`, `purgeFailedEmailOutbox()`, `purgeExpiredAuditLogs()`, `getUserContextForLogin()`, `getBillingEntitlements()`, `getOrganizationUsageCounts()`, `createAuditLog()`, `findActiveMember()`, `findUserByEmail()`, `expireStalePendingInvitations()`, `purgeTerminalInvitations()`
- **Tables Touched:** `users`, `organizations`, `organization_settings`, `organization_members`, `organization_invitations`, `organization_audit_logs`, `organization_email_outbox`, `organization_sso_providers`, `organization_scim_tokens`, `plans`, `organization_subscriptions`, `logs`, `user_preferences`
- **Transactions:** ✅ Uses Database Transactions


### AlertThresholdsRepository
- **Source File:** `src/modules/organization/alert-thresholds/alert-thresholds.repository.ts`
- **Methods:** `getAlertThresholds()`, `listAlertThresholds()`, `upsertAlertThresholds()`, `markAlertThresholdFired()`, `getOrgFallbackEmail()`
- **Tables Touched:** `users`, `organizations`, `organization_alert_thresholds`
- **Transactions:** ❌ Simple Queries Only


### AuditLogsRepository
- **Source File:** `src/modules/organization/audit-logs/audit-logs.repository.ts`
- **Methods:** `createAuditLog()`, `listAuditLogs()`, `exportAuditLogs()`, `purgeExpiredAuditLogs()`
- **Tables Touched:** `organization_settings`, `organization_audit_logs`, `logs`
- **Transactions:** ❌ Simple Queries Only


### CoreRepository
- **Source File:** `src/modules/organization/core/core.repository.ts`
- **Methods:** `createOrg()`, `setUserCurrentOrg()`, `findOrgById()`, `findOrgBySlug()`, `updateOrg()`, `softDeleteOrg()`, `listOrgApiKeyHashes()`, `archiveOrg()`, `restoreOrg()`, `transferOwnership()`, `getSettings()`, `updateSettings()`, `isSlugAvailable()`, `listUserOrganizations()`
- **Tables Touched:** `users`, `organizations`, `organization_settings`, `organization_members`, `projects`, `project_api_keys`, `errors`
- **Transactions:** ✅ Uses Database Transactions


### DomainsRepository
- **Source File:** `src/modules/organization/domains/domains.repository.ts`
- **Methods:** `create()`, `find()`, `list()`, `verificationResult()`, `setAutoJoin()`, `updateMetadata()`, `softDelete()`, `makePrimary()`, `hasIdentityDependency()`, `findVerifiedByDomain()`, `pending()`
- **Tables Touched:** `organization_verified_domains`, `organization_sso_providers`, `organization_scim_tokens`
- **Transactions:** ❌ Simple Queries Only


### InvitationsRepository
- **Source File:** `src/modules/organization/invitations/invitations.repository.ts`
- **Methods:** `createInvitation()`, `findInvitationById()`, `findInvitationByTokenHash()`, `listInvitations()`, `acceptInvitation()`, `acceptInvitationAndAddMember()`, `declineInvitation()`, `revokeInvitation()`, `incrementResentCount()`, `rotateInvitationToken()`, `expireStalePendingInvitations()`, `purgeTerminalInvitations()`, `findInvitationByOrgAndId()`, `findOrgNameAndSlug()`, `findUserByEmail()`
- **Tables Touched:** `users`, `organizations`, `organization_members`, `organization_invitations`, `errors`
- **Transactions:** ✅ Uses Database Transactions


### MembersRepository
- **Source File:** `src/modules/organization/members/members.repository.ts`
- **Methods:** `findActiveMember()`, `findMember()`, `getMemberRole()`, `listMembers()`, `addMember()`, `removeMember()`, `suspendMember()`, `reactivateMember()`, `updateMemberRole()`, `countActiveOwners()`
- **Tables Touched:** `users`, `organization_members`, `errors`
- **Transactions:** ✅ Uses Database Transactions


### QuotasRepository
- **Source File:** `src/modules/organization/quotas/quotas.repository.ts`
- **Methods:** `getBillingEntitlements()`, `getOrganizationUsageCounts()`, `createQuotaRequest()`, `reviewQuotaRequest()`, `listQuotaRequests()`
- **Tables Touched:** `organization_members`, `organization_invitations`, `quota_requests`, `organization_sso_providers`, `organization_scim_tokens`, `plans`, `organization_subscriptions`, `errors`
- **Transactions:** ❌ Simple Queries Only


### SdkConfigRepository
- **Source File:** `src/modules/organization/sdk-config/sdk-config.repository.ts`
- **Methods:** `withTransaction()`, `create()`, `findById()`, `list()`, `update()`, `listVersions()`, `getVersion()`, `listDeployments()`, `acknowledgeDeployment()`, `resolveForSdk()`
- **Tables Touched:** None
- **Transactions:** ✅ Uses Database Transactions


### SecurityEventsRepository
- **Source File:** `src/modules/organization/security-events/security-events.repository.ts`
- **Methods:** `listSecurityEvents()`
- **Tables Touched:** `organization_security_events`
- **Transactions:** ❌ Simple Queries Only


### BaseRepository
- **Source File:** `src/modules/organization/shared/base.repository.ts`
- **Methods:** `withTransaction()`
- **Tables Touched:** None
- **Transactions:** ✅ Uses Database Transactions


### SsoRepository
- **Source File:** `src/modules/organization/sso/sso.repository.ts`
- **Methods:** `createSsoProvider()`, `listSsoProviders()`, `updateSsoProvider()`, `deleteSsoProvider()`
- **Tables Touched:** `organization_sso_providers`, `errors`
- **Transactions:** ❌ Simple Queries Only


---

## 6. Database Tables & Ownership Matrix


| Table Name | Role | Columns | Indexes | Foreign Keys |
|---|---|---|---|---|
| `users` | Reader/Writer | 46 | 7 | 0 |
| `organizations` | Owner | 18 | 3 | 0 |
| `organization_settings` | Owner | 18 | 0 | 0 |
| `organization_members` | Owner | 15 | 3 | 0 |
| `organization_invitations` | Owner | 18 | 5 | 0 |
| `organization_audit_logs` | Owner | 23 | 6 | 0 |
| `organization_email_outbox` | Owner | 17 | 3 | 0 |
| `organization_sso_providers` | Owner | 16 | 4 | 0 |
| `organization_scim_tokens` | Owner | 8 | 5 | 0 |
| `plans` | Reader/Writer | 12 | 5 | 1 |
| `organization_subscriptions` | Owner | 25 | 6 | 2 |
| `logs` | Reader/Writer | 12 | 3 | 0 |
| `user_preferences` | Reader/Writer | 4 | 0 | 0 |
| `organization_alert_thresholds` | Owner | 25 | 2 | 0 |
| `projects` | Reader/Writer | 15 | 5 | 0 |
| `project_api_keys` | Reader/Writer | 18 | 8 | 0 |
| `errors` | Reader/Writer | 19 | 4 | 0 |
| `organization_verified_domains` | Owner | 29 | 7 | 1 |
| `quota_requests` | Reader/Writer | 13 | 1 | 0 |
| `organization_security_events` | Owner | 8 | 1 | 0 |


---

## 7. Event Bus & Queue Processing

- **Published Events:** None
- **Consumed Events:** None
- **Queue Jobs:** None

---

## 8. Enterprise Health Scorecard

| Domain | Score | Rating | Analysis |
|---|---|---|---|
| **Architecture** | 85/100 | Great | Bounded context isolation |
| **Security** | 60/100 | Needs Review | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **78/100** | **REMEDIATION NEEDED** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `organization` implement strict rate limiting.
- **P2:** Expand unit test coverage for `OrganizationService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.
