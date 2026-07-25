# MODULE KNOWLEDGE BASE: PROJECTS

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/projects`
> **Health Score:** 87/100

---

## 1. Executive Summary & Purpose

The **projects** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 0
- **Services:** 12
- **Repositories:** 14
- **Discovered Routes:** 65
- **Owned Database Tables:** projects, project_members, project_api_keys, project_usage, project_usage_daily, project_settings, project_usage_hourly
- **External Integrations:** Slack API

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/projects/
├── activity.repository.ts
├── activity.routes.ts
├── activity.service.ts
├── activity.types.ts
├── alert-preferences.controller.ts
├── alert-preferences.repository.ts
├── alert-preferences.service.ts
├── alert-preferences.types.ts
├── alert-routes.controller.ts
├── alert-routes.repository.ts
├── alert-routes.service.ts
├── alert-routes.types.ts
├── connector-subscription.repository.ts
├── connector-subscription.routes.ts
├── connector-subscription.service.ts
├── connector-subscription.types.ts
├── api-key.repository.ts
├── api-key.routes.ts
├── api-key.service.ts
├── api-key.types.ts
├── project.repository.ts
├── project.routes.ts
├── project.service.ts
├── project.types.ts
├── environment.repository.ts
├── environment.routes.ts
├── environment.service.ts
├── environment.types.ts
├── member.repository.ts
├── member.routes.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `GET` | `/:projectId/activity` | ✅ Yes | Project | `src/modules/projects/activity/activity.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/api-keys` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/api-keys` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/api-keys/bulk-rotate` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/api-keys/bulk-revoke` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/api-keys/:apiKeyId` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/api-keys/:apiKeyId` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `DELETE` | `/:projectId/api-keys/:apiKeyId` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/api-keys/:apiKeyId/rotate` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/api-keys/:apiKeyId/regenerate` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/api-keys/:apiKeyId/enable` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/api-keys/:apiKeyId/disable` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/api-keys/:apiKeyId/usage` | ✅ Yes | Project | `src/modules/projects/api-keys/api-key.routes.ts` | Standard (60/min) |
| `GET` | `/` | ✅ Yes | Global | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `POST` | `/` | ✅ Yes | Global | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId` | ✅ Yes | Project | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/stats` | ✅ Yes | Project | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/usage` | ✅ Yes | Project | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId` | ✅ Yes | Project | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `DELETE` | `/:projectId` | ✅ Yes | Project | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/overview` | ✅ Yes | Project | `src/modules/projects/core/project.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/sdk-configs` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/sdk-configs/resolve` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/sdk-configs/:configId` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/sdk-configs/:configId` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/environments` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/environments` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/environments/:environmentId` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/environments/:environmentId` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `DELETE` | `/:projectId/environments/:environmentId` | ✅ Yes | Project | `src/modules/projects/environments/environment.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/members` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/members` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/members/:memberId` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `DELETE` | `/:projectId/members/:memberId` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/transfer-ownership` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/invitations` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/invitations` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/invitations/accept` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/invitations/:invitationId/decline` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `DELETE` | `/:projectId/invitations/:invitationId` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/roles` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/roles` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/roles/:roleId` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `DELETE` | `/:projectId/roles/:roleId` | ✅ Yes | Project | `src/modules/projects/members/member.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/settings` | ✅ Yes | Project | `src/modules/projects/settings/settings.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/settings` | ✅ Yes | Project | `src/modules/projects/settings/settings.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/analytics/usage` | ✅ Yes | Project | `src/modules/projects/usage/analytics.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/analytics/heatmap` | ✅ Yes | Project | `src/modules/projects/usage/analytics.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/analytics/top` | ✅ Yes | Project | `src/modules/projects/usage/analytics.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/analytics/comparison` | ✅ Yes | Project | `src/modules/projects/usage/analytics.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/analytics/monthly-usage` | ✅ Yes | Project | `src/modules/projects/usage/analytics.routes.ts` | Standard (60/min) |
| `GET` | `/` | ✅ Yes | Global | `src/modules/projects/alerts/preferences/alert-preferences.controller.ts` | Standard (60/min) |
| `PATCH` | `/:prefId` | ✅ Yes | Global | `src/modules/projects/alerts/preferences/alert-preferences.controller.ts` | Standard (60/min) |
| `POST` | `/sync` | ✅ Yes | Global | `src/modules/projects/alerts/preferences/alert-preferences.controller.ts` | Standard (60/min) |
| `POST` | `/` | ✅ Yes | Global | `src/modules/projects/alerts/routes/alert-routes.controller.ts` | Standard (60/min) |
| `GET` | `/` | ✅ Yes | Global | `src/modules/projects/alerts/routes/alert-routes.controller.ts` | Standard (60/min) |
| `GET` | `/:routeId` | ✅ Yes | Global | `src/modules/projects/alerts/routes/alert-routes.controller.ts` | Standard (60/min) |
| `PATCH` | `/:routeId` | ✅ Yes | Global | `src/modules/projects/alerts/routes/alert-routes.controller.ts` | Standard (60/min) |
| `DELETE` | `/:routeId` | ✅ Yes | Global | `src/modules/projects/alerts/routes/alert-routes.controller.ts` | Standard (60/min) |
| `POST` | `/:routeId/toggle` | ✅ Yes | Global | `src/modules/projects/alerts/routes/alert-routes.controller.ts` | Standard (60/min) |
| `GET` | `/:projectId/connectors` | ✅ Yes | Project | `src/modules/projects/alerts/subscriptions/connector-subscription.routes.ts` | Standard (60/min) |
| `POST` | `/:projectId/connectors` | ✅ Yes | Project | `src/modules/projects/alerts/subscriptions/connector-subscription.routes.ts` | Standard (60/min) |
| `GET` | `/:projectId/connectors/:subscriptionId` | ✅ Yes | Project | `src/modules/projects/alerts/subscriptions/connector-subscription.routes.ts` | Standard (60/min) |
| `PATCH` | `/:projectId/connectors/:subscriptionId` | ✅ Yes | Project | `src/modules/projects/alerts/subscriptions/connector-subscription.routes.ts` | Standard (60/min) |
| `DELETE` | `/:projectId/connectors/:subscriptionId` | ✅ Yes | Project | `src/modules/projects/alerts/subscriptions/connector-subscription.routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (GET /:projectId/activity)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] JWT Bearer Authentication Validated
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] projectsController
  ↓
[Service] ProjectsService
  ↓
[Repository] ProjectsRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic


### ProjectsService
- **Source File:** `src/modules/projects/service.ts`
- **Methods:** `listProjects()`, `createProject()`, `getProject()`, `getProjectSettings()`, `updateProjectSettings()`, `getProjectOverview()`, `updateProject()`, `deleteProject()`, `restoreProject()`, `archiveProject()`, `unarchiveProject()`, `pauseProject()`, `resumeProject()`, `getProjectStats()`, `getProjectUsage()`, `listProjectActivity()`, `listEnvironments()`, `getEnvironment()`, `createEnvironment()`, `updateEnvironment()`, `deleteEnvironment()`, `listApiKeys()`, `createApiKey()`, `getApiKey()`, `updateApiKey()`, `deleteApiKey()`, `rotateApiKey()`, `regenerateApiKey()`, `enableApiKey()`, `disableApiKey()`, `bulkRotateKeys()`, `bulkRevokeKeys()`, `getApiKeyUsage()`, `validateApiKey()`, `requireOrganizationAccess()`, `requireProjectAccess()`, `limitFrom()`, `assertWithinLimit()`, `requireMutableBilling()`, `enforceProjectModuleLimit()`, `generateUniqueSlug()`, `assertFutureExpiry()`, `publicApiKey()`, `summarizeBulk()`, `warmApiKeyCache()`, `evictApiKeyConfig()`, `evictProjectApiKeys()`, `audit()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository").ProjectsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/settings/settings.repository").SettingsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.repository").ApiKeyRepository
- **External Calls:** None


### ProjectActivityService
- **Source File:** `src/modules/projects/activity/activity.service.ts`
- **Methods:** `listProjectActivity()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository").ProjectsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/settings/settings.repository").SettingsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.repository").ApiKeyRepository
- **External Calls:** None


### ApiKeyService
- **Source File:** `src/modules/projects/api-keys/api-key.service.ts`
- **Methods:** `listApiKeys()`, `createApiKey()`, `getApiKey()`, `updateApiKey()`, `deleteApiKey()`, `rotateApiKey()`, `regenerateApiKey()`, `enableApiKey()`, `disableApiKey()`, `bulkRotateKeys()`, `bulkRevokeKeys()`, `getApiKeyUsage()`, `validateApiKey()`, `assertFutureExpiry()`, `publicApiKey()`, `summarizeBulk()`, `warmApiKeyCache()`, `evictApiKeyConfig()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository").ProjectsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/settings/settings.repository").SettingsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.repository").ApiKeyRepository
- **External Calls:** None


### ProjectService
- **Source File:** `src/modules/projects/core/project.service.ts`
- **Methods:** `listProjects()`, `createProject()`, `seedDefaultNotificationPreferences()`, `getProject()`, `getProjectOverview()`, `updateProject()`, `deleteProject()`, `restoreProject()`, `archiveProject()`, `unarchiveProject()`, `pauseProject()`, `resumeProject()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository").ProjectsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/settings/settings.repository").SettingsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.repository").ApiKeyRepository
- **External Calls:** None


### EnvironmentService
- **Source File:** `src/modules/projects/environments/environment.service.ts`
- **Methods:** `listEnvironments()`, `getEnvironment()`, `createEnvironment()`, `updateEnvironment()`, `deleteEnvironment()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository").ProjectsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/settings/settings.repository").SettingsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.repository").ApiKeyRepository
- **External Calls:** None


### ProjectMemberService
- **Source File:** `src/modules/projects/members/member.service.ts`
- **Methods:** `listMembers()`, `addMember()`, `removeMember()`, `updateMemberRole()`, `transferOwnership()`, `inviteMember()`, `acceptInvitation()`, `declineInvitation()`, `cancelInvitation()`, `listInvitations()`, `createRole()`, `updateRole()`, `deleteRole()`, `listRoles()`, `auditAndActivity()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/members/member.service").ProjectMemberServiceDeps
- **External Calls:** None


### SettingsService
- **Source File:** `src/modules/projects/settings/settings.service.ts`
- **Methods:** `getProjectSettings()`, `updateProjectSettings()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository").ProjectsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/settings/settings.repository").SettingsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.repository").ApiKeyRepository
- **External Calls:** None


### BaseProjectService
- **Source File:** `src/modules/projects/shared/base.service.ts`
- **Methods:** `getProjectStats()`, `getProjectUsage()`, `requireOrganizationAccess()`, `requireProjectAccess()`, `limitFrom()`, `assertWithinLimit()`, `requireMutableBilling()`, `enforceProjectModuleLimit()`, `generateUniqueSlug()`, `audit()`, `evictProjectApiKeys()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/repository").ProjectsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/settings/settings.repository").SettingsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/api-keys/api-key.repository").ApiKeyRepository
- **External Calls:** None


### UsageAnalyticsService
- **Source File:** `src/modules/projects/usage/analytics.service.ts`
- **Methods:** `getUsageAnalytics()`, `getHeatmap()`, `getTopList()`, `getComparison()`, `getMonthlyUsageVsPlan()`, `evictProjectCache()`, `cacheKey()`, `encodeCursor()`, `decodeCursor()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/usage/analytics.repository").UsageAnalyticsRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/shared/base.service").BaseProjectService, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger
- **External Calls:** None


### ProjectMemberAlertPreferenceService
- **Source File:** `src/modules/projects/alerts/preferences/alert-preferences.service.ts`
- **Methods:** `getPreferences()`, `updatePreference()`, `bulkSubscribe()`, `resolveRecipients()`, `sync()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/alerts/preferences/alert-preferences.repository").AlertPreferencesRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/service").ProjectsService, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger
- **External Calls:** None


### ProjectAlertRouteService
- **Source File:** `src/modules/projects/alerts/routes/alert-routes.service.ts`
- **Methods:** `createRoute()`, `getRoute()`, `listRoutes()`, `updateRoute()`, `toggleRoute()`, `deleteRoute()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/alerts/routes/alert-routes.repository").AlertRoutesRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/service").ProjectsService, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger
- **External Calls:** None


### ProjectConnectorSubscriptionService
- **Source File:** `src/modules/projects/alerts/subscriptions/connector-subscription.service.ts`
- **Methods:** `list()`, `get()`, `create()`, `update()`, `delete()`, `resolveRoutingTarget()`, `resolveRoutingTargetByProjectId()`, `audit()`
- **Injected Dependencies:** import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/alerts/subscriptions/connector-subscription.repository").ConnectorSubscriptionRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/projects/shared/base.service").BaseProjectService, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/src/modules/organization/repository").OrganizationRepository, import("C:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/node_modules/fastify/types/logger").FastifyBaseLogger
- **External Calls:** None


---

## 5. Repositories & Database Operations


### ProjectsRepository
- **Source File:** `src/modules/projects/repository.ts`
- **Methods:** `withTransaction()`, `findOrganizationMembership()`, `getProjectMemberRole()`, `addProjectMember()`, `listProjects()`, `createProject()`, `findProjectBySlug()`, `findProjectById()`, `findProjectByIdIncludingDeleted()`, `updateProject()`, `softDeleteProject()`, `restoreProject()`, `getProjectStats()`, `getProjectUsageCounters()`, `getProjectModuleUsageCounts()`, `findSdkConfigPlanKey()`, `createDefaultSdkConfigs()`
- **Tables Touched:** `projects`, `project_members`
- **Transactions:** ❌ Simple Queries Only


### ActivityRepository
- **Source File:** `src/modules/projects/activity/activity.repository.ts`
- **Methods:** `listProjectActivity()`
- **Tables Touched:** `organization_audit_logs`, `project_api_keys`
- **Transactions:** ❌ Simple Queries Only


### ApiKeyRepository
- **Source File:** `src/modules/projects/api-keys/api-key.repository.ts`
- **Methods:** `listApiKeys()`, `createApiKey()`, `countActiveApiKeys()`, `findApiKeyById()`, `findApiKeyRecordById()`, `listActiveApiKeyRecords()`, `updateApiKey()`, `setApiKeyActiveState()`, `revokeApiKey()`, `markApiKeyRotated()`, `touchApiKeyLastUsed()`, `listApiKeyHashesByProject()`, `findActiveApiKeyCandidatesByPrefix()`, `getApiKeyUsageSummary()`, `prefixedProjectRow()`, `mapProject()`, `mapApiKey()`, `mapApiKeyRecord()`
- **Tables Touched:** `projects`, `project_api_keys`, `feature_flags`
- **Transactions:** ❌ Simple Queries Only


### ProjectRepository
- **Source File:** `src/modules/projects/core/project.repository.ts`
- **Methods:** `withTransaction()`, `listProjects()`, `createProject()`, `findProjectBySlug()`, `findProjectById()`, `findProjectByIdIncludingDeleted()`, `updateProject()`, `softDeleteProject()`, `restoreProject()`, `findOrganizationMembership()`, `getProjectModuleUsageCounts()`, `getProjectStats()`, `getProjectUsageCounters()`, `buildProjectAssignments()`, `mapProject()`, `mapProjectWithCounts()`
- **Tables Touched:** `organization_members`, `projects`, `project_api_keys`, `project_usage`, `project_usage_daily`
- **Transactions:** ✅ Uses Database Transactions


### EnvironmentRepository
- **Source File:** `src/modules/projects/environments/environment.repository.ts`
- **Methods:** `listEnvironments()`, `findEnvironment()`, `createEnvironment()`, `updateEnvironment()`, `deleteEnvironment()`, `mapEnv()`
- **Tables Touched:** None
- **Transactions:** ❌ Simple Queries Only


### MemberRepository
- **Source File:** `src/modules/projects/members/member.repository.ts`
- **Methods:** `withTransaction()`, `findOrganizationMembership()`, `isOrganizationMember()`, `findOrganizationMembershipByEmail()`, `findInvitationById()`, `listProjectMembers()`, `findProjectMemberByUserId()`, `findProjectMemberById()`, `addProjectMember()`, `updateProjectMemberRole()`, `removeProjectMember()`, `transferOwnership()`, `findPendingInvitationByToken()`, `findPendingInvitationByEmail()`, `createInvitation()`, `updateInvitationToken()`, `acceptInvitation()`, `declineInvitation()`, `cancelInvitation()`, `expireInvitations()`, `listProjectInvitations()`, `createRole()`, `updateRole()`, `deleteRole()`, `listRoles()`, `findRoleBySlug()`, `findRoleById()`, `findRoleIdForSlug()`, `mapMember()`, `mapInvitation()`, `mapRole()`
- **Tables Touched:** `users`, `organization_members`, `project_members`
- **Transactions:** ✅ Uses Database Transactions


### ProjectSettingsRepository
- **Source File:** `src/modules/projects/settings/project-settings.repository.ts`
- **Methods:** `withTransaction()`, `findSdkConfigPlanKey()`, `createDefaultSdkConfigs()`
- **Tables Touched:** `plans`, `organization_subscriptions`
- **Transactions:** ✅ Uses Database Transactions


### SettingsRepository
- **Source File:** `src/modules/projects/settings/settings.repository.ts`
- **Methods:** `findByProjectId()`, `createDefault()`, `update()`, `mapRow()`
- **Tables Touched:** `project_settings`
- **Transactions:** ❌ Simple Queries Only


### UsageAnalyticsRepository
- **Source File:** `src/modules/projects/usage/analytics.repository.ts`
- **Methods:** `whereClause()`, `getSummary()`, `getTimeSeries()`, `getCalendarHeatmap()`, `getHourlyHeatmap()`, `getDayOfWeekHeatmap()`, `getTopList()`, `getComparison()`, `getMonthlyUsageVsPlan()`, `pickGranularity()`, `mapSummaryRow()`, `mapTimeSeriesRow()`
- **Tables Touched:** `connector_deliveries`, `project_usage_hourly`, `project_usage_daily`, `spans`, `traces`, `metrics`, `logs`, `profiles`, `errors`, `requests`
- **Transactions:** ✅ Uses Database Transactions


### ProjectUsageRepository
- **Source File:** `src/modules/projects/usage/project-usage.repository.ts`
- **Methods:** `withTransaction()`, `getProjectStats()`, `getProjectUsageCounters()`, `getProjectModuleUsageCounts()`
- **Tables Touched:** `projects`, `project_api_keys`, `project_usage_daily`
- **Transactions:** ✅ Uses Database Transactions


### UsageRepository
- **Source File:** `src/modules/projects/usage/usage.repository.ts`
- **Methods:** `incrementHourly()`, `incrementDaily()`, `getHourlyBreakdown()`, `getDailyTrend()`, `getHourlyStats()`, `mapHourlyRow()`, `mapDailyRow()`
- **Tables Touched:** `project_usage_hourly`, `project_usage_daily`
- **Transactions:** ❌ Simple Queries Only


### AlertPreferencesRepository
- **Source File:** `src/modules/projects/alerts/preferences/alert-preferences.repository.ts`
- **Methods:** `withTransaction()`, `mapMemberPreferenceRow()`, `mapProjectPreferenceRow()`, `getMemberPreferences()`, `getProjectDefaults()`, `createMemberPreference()`, `updateMemberPreference()`, `bulkSubscribe()`, `resolveRecipients()`, `seedMissingMemberPreferences()`
- **Tables Touched:** None
- **Transactions:** ✅ Uses Database Transactions


### AlertRoutesRepository
- **Source File:** `src/modules/projects/alerts/routes/alert-routes.repository.ts`
- **Methods:** `withTransaction()`, `mapRow()`, `createRoute()`, `getRoute()`, `listRoutes()`, `updateRoute()`, `deleteRoute()`, `unsetDefaultRoute()`
- **Tables Touched:** `notification_routes`
- **Transactions:** ✅ Uses Database Transactions


### ConnectorSubscriptionRepository
- **Source File:** `src/modules/projects/alerts/subscriptions/connector-subscription.repository.ts`
- **Methods:** `withTransaction()`, `listByProject()`, `findById()`, `findByProjectAndConnector()`, `create()`, `update()`, `delete()`, `resolveAlertRoutingTarget()`, `resolveAlertRoutingTargetByProjectId()`, `mapSubscription()`
- **Tables Touched:** `users`, `projects`, `project_members`, `project_api_keys`
- **Transactions:** ✅ Uses Database Transactions


---

## 6. Database Tables & Ownership Matrix


| Table Name | Role | Columns | Indexes | Foreign Keys |
|---|---|---|---|---|
| `projects` | Owner | 15 | 5 | 0 |
| `project_members` | Owner | 12 | 6 | 0 |
| `organization_audit_logs` | Reader/Writer | 23 | 6 | 0 |
| `project_api_keys` | Owner | 18 | 8 | 0 |
| `feature_flags` | Reader/Writer | 11 | 2 | 1 |
| `organization_members` | Reader/Writer | 15 | 3 | 0 |
| `project_usage` | Owner | 9 | 2 | 0 |
| `project_usage_daily` | Owner | 10 | 2 | 0 |
| `users` | Reader/Writer | 46 | 7 | 0 |
| `plans` | Reader/Writer | 12 | 5 | 1 |
| `organization_subscriptions` | Reader/Writer | 25 | 6 | 2 |
| `project_settings` | Owner | 11 | 2 | 0 |
| `connector_deliveries` | Reader/Writer | 34 | 11 | 0 |
| `project_usage_hourly` | Owner | 10 | 2 | 0 |
| `spans` | Reader/Writer | 23 | 4 | 0 |
| `traces` | Reader/Writer | 16 | 3 | 0 |
| `metrics` | Reader/Writer | 17 | 2 | 0 |
| `logs` | Reader/Writer | 12 | 3 | 0 |
| `profiles` | Reader/Writer | 14 | 2 | 0 |
| `errors` | Reader/Writer | 19 | 4 | 0 |
| `requests` | Reader/Writer | 24 | 5 | 0 |
| `notification_routes` | Reader/Writer | 16 | 2 | 0 |


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
| **Security** | 95/100 | Great | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **87/100** | **ENTERPRISE READY** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `projects` implement strict rate limiting.
- **P2:** Expand unit test coverage for `ProjectsService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.
