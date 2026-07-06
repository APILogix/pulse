# MASTER PROMPT: Project-Scoped Multi-Tenant Alert & Project Management Backend

## 1. Objective
Upgrade the existing enterprise notification connector backend to support **project-level scoping** for all alert routing, delivery, and member subscriptions. Introduce a full `projects` module with API key management, member roles, release tracking, and project-scoped notification routes. **Comment out / disable RemoteSDK configuration creation during project initialization** (preserve code, do not execute).

---

## 2. Database Schema (Source of Truth)

The following schema is already migrated and is non-negotiable. All backend code must map 1:1 to these tables, columns, and constraints.

### 2.1 Core Project Tables
```sql
CREATE TYPE project_status AS ENUM ('active', 'archived', 'suspended');
CREATE TYPE project_environment AS ENUM ('development', 'production');
CREATE TYPE api_key_status AS ENUM ('active', 'revoked', 'expired');

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL,
    description TEXT,
    status project_status NOT NULL DEFAULT 'active',
    default_environment project_environment NOT NULL DEFAULT 'production',
    icon VARCHAR(255),
    color VARCHAR(20),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(org_id, slug)
);

CREATE INDEX idx_projects_org ON projects(org_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_cursor ON projects(org_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_archived ON projects(archived_at) WHERE archived_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_projects_org_status ON projects(org_id, status) WHERE deleted_at IS NULL;

CREATE TABLE project_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment project_environment NOT NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix VARCHAR(20) NOT NULL,
    status api_key_status NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    revoked_by UUID REFERENCES users(id),
    revoked_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_project ON project_api_keys(project_id);
CREATE INDEX idx_api_keys_prefix ON project_api_keys(key_prefix);
CREATE INDEX idx_api_keys_status ON project_api_keys(status);
CREATE INDEX idx_api_keys_expiry ON project_api_keys(expires_at);
CREATE INDEX idx_api_keys_last_used ON project_api_keys(last_used_at);
CREATE INDEX idx_api_keys_project_env ON project_api_keys(project_id, environment) WHERE deleted_at IS NULL AND status = 'active';
CREATE INDEX idx_api_keys_revoked_cleanup ON project_api_keys(revoked_at, deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES organization_roles(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, user_id)
);

CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_project_members_role ON project_members(role_id);
CREATE INDEX idx_project_members_user_project ON project_members(user_id, project_id);

CREATE TABLE project_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    environment project_environment NOT NULL,
    version VARCHAR(100) NOT NULL,
    commit_sha VARCHAR(64),
    branch VARCHAR(150),
    released_by UUID REFERENCES users(id),
    released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_project_releases_project ON project_releases(project_id);
CREATE INDEX idx_project_releases_environment ON project_releases(environment);
CREATE INDEX idx_project_releases_version ON project_releases(project_id, version);
CREATE INDEX idx_project_releases_time ON project_releases(project_id, released_at DESC);
CREATE INDEX idx_project_releases_project_env_time ON project_releases(project_id, environment, released_at DESC);
CREATE INDEX idx_project_releases_commit ON project_releases(commit_sha) WHERE commit_sha IS NOT NULL;
```

### 2.2 Notification Schema (Already Migrated -- Extended with Project Scope)
```sql
-- Existing ENUMs
CREATE TYPE connector_type AS ENUM ('slack', 'discord', 'teams', 'pagerduty', 'webhook', 'email', 'sms');
CREATE TYPE connector_status AS ENUM ('active', 'inactive', 'error', 'pending_setup');
CREATE TYPE notification_severity AS ENUM ('info', 'warning', 'error', 'critical');
CREATE TYPE delivery_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'retrying', 'cancelled');

-- Existing tables now have project_id columns
ALTER TABLE notification_routes ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE notification_dead_letter ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE connector_audit_logs ADD COLUMN IF NOT EXISTS project_id UUID;

-- New project-scoped member preference table
CREATE TABLE project_member_alert_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES notification_routes(id) ON DELETE CASCADE,
    is_subscribed BOOLEAN NOT NULL DEFAULT true,
    min_severity notification_severity NOT NULL DEFAULT 'info',
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, user_id, route_id)
);

CREATE INDEX idx_member_prefs_user ON project_member_alert_preferences(user_id, is_subscribed) WHERE is_subscribed = true;
CREATE INDEX idx_member_prefs_project_route ON project_member_alert_preferences(project_id, route_id, is_subscribed) WHERE is_subscribed = true;

-- Optional many-to-many junction (if route reusable across projects)
CREATE TABLE project_alert_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    route_id UUID NOT NULL REFERENCES notification_routes(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, route_id)
);

CREATE INDEX idx_project_alert_routes_route ON project_alert_routes(route_id) WHERE is_active = true;
```

---

## 3. Architecture & Design Principles

1. **Tenant Isolation in Service Layer**: No RLS. Every query must filter by `org_id`. Project-scoped queries must additionally filter by `project_id` or verify membership via `project_members`.
2. **Soft Deletes**: All reads must respect `deleted_at IS NULL` unless explicitly querying trash.
3. **Transactions**: Project creation, member addition, and route creation must be atomic.
4. **Audit Logging**: Every mutation to `projects`, `project_members`, `notification_routes`, and `connector_configs` must insert a row into `connector_audit_logs`.
5. **Encryption**: API key plaintext must never be stored. Store `key_hash` (bcrypt/argon2) and return the raw key **only once** at creation time.
6. **Idempotency**: All migration-safe operations. Controllers must assume tables/columns may already exist.

---

## 4. Module: Projects (`/projects`)

### 4.1 Project Service (`ProjectService`)
Implement a service class with the following methods. All methods must validate `org_id` tenancy and user permissions.

| Method | Description | Rules |
|--------|-------------|-------|
| `createProject(dto, actorId)` | Create project + default API key + add creator as owner | Slug uniqueness per org. **Comment out RemoteSDK config creation.** |
| `getProjectById(projectId, orgId)` | Fetch single project | 404 if not found or wrong org. |
| `listProjects(orgId, filters, pagination)` | Paginated list | Cursor-based (`org_id, created_at DESC, id DESC`). Filter by `status`. |
| `updateProject(projectId, dto, actorId)` | Update name, description, icon, color, default_environment | Prevent slug change if active releases exist. |
| `archiveProject(projectId, actorId)` | Soft archive | Set `archived_at`. Disable all active API keys. Disable project-scoped routes (`is_active = false`). |
| `deleteProject(projectId, actorId)` | Hard delete or soft delete | Prefer soft delete (`deleted_at`). Cascade handles children. |
| `getProjectStats(projectId)` | Aggregates: member count, release count, active key count, alert count (24h) | Read-only. |

### 4.2 Project Controller (`ProjectController`)
RESTful routes under `/api/v1/organizations/:orgId/projects`:

| Endpoint | Method | Auth | Body | Response |
|----------|--------|------|------|----------|
| `POST /` | Create | Org Admin/Owner | `{ name, slug, description?, default_environment?, icon?, color? }` | `201 { project, apiKey: { prefix, rawKey } }` |
| `GET /` | List | Org Member | Query: `status`, `cursor`, `limit` | `200 { data, nextCursor }` |
| `GET /:projectId` | Get | Project Member | -- | `200 { project, members[], stats }` |
| `PATCH /:projectId` | Update | Project Admin+ | `{ name?, description?, icon?, color?, default_environment? }` | `200 { project }` |
| `POST /:projectId/archive` | Archive | Project Admin+ | -- | `200 { success }` |
| `DELETE /:projectId` | Delete | Org Owner | -- | `204` |

### 4.3 Project Members Service (`ProjectMemberService`)
| Method | Rules |
|--------|-------|
| `addMember(projectId, userId, roleId, actorId)` | Check `project_members` uniqueness. Verify `userId` belongs to same `org_id`. |
| `removeMember(projectId, userId, actorId)` | Cannot remove last owner. |
| `listMembers(projectId)` | Join with `users` and `organization_roles`. |
| `updateMemberRole(projectId, userId, newRoleId, actorId)` | At least one owner must remain. |

**Controller endpoints:**
- `POST /api/v1/projects/:projectId/members`
- `GET /api/v1/projects/:projectId/members`
- `DELETE /api/v1/projects/:projectId/members/:userId`
- `PATCH /api/v1/projects/:projectId/members/:userId/role`

### 4.4 Project API Keys Service (`ProjectApiKeyService`)
| Method | Rules |
|--------|-------|
| `createKey(projectId, environment, name, description?, expiresAt?, actorId)` | Generate secure random key. Hash it with bcrypt. Return raw key **once** in response. Prefix first 8 chars. |
| `listKeys(projectId, environment?)` | Exclude `key_hash`. Show `key_prefix`, `status`, `last_used_at`. |
| `revokeKey(keyId, actorId)` | Set `status = 'revoked'`, `revoked_at`, `revoked_by`. |
| `rotateKey(keyId, actorId)` | Revoke old, create new with same metadata. |
| `validateKey(prefix, rawKey)` | Compare bcrypt hash. Update `last_used_at`. Return `{ projectId, environment, orgId }`. |

**Controller endpoints:**
- `POST /api/v1/projects/:projectId/api-keys`
- `GET /api/v1/projects/:projectId/api-keys`
- `POST /api/v1/api-keys/:keyId/revoke`
- `POST /api/v1/api-keys/:keyId/rotate`

### 4.5 Project Releases Service (`ProjectReleaseService`)
| Method | Rules |
|--------|-------|
| `recordRelease(projectId, environment, version, commitSha?, branch?, metadata?, actorId?)` | Upsert guard: if `(project_id, environment, version)` exists, update `released_at`. |
| `listReleases(projectId, environment?, limit?)` | Order by `released_at DESC`. |

**Controller endpoints:**
- `POST /api/v1/projects/:projectId/releases`
- `GET /api/v1/projects/:projectId/releases`

---

## 5. Module: Project-Scoped Alert Routes (`/projects/:projectId/alert-routes`)

### 5.1 New Service: `ProjectAlertRouteService`
This is the **core** of the upgrade. It bridges `projects` and `notification_routes`.

| Method | Logic |
|--------|-------|
| `createRoute(projectId, orgId, dto, actorId)` | Insert into `notification_routes` with `project_id` set. Validate `target_connector_ids` belong to same `org_id`. If `is_default = true`, unset previous default for this `project_id` + `connector_type`. |
| `getRoute(routeId, projectId, orgId)` | Fetch route. Verify `project_id` matches or is NULL (org-wide). |
| `listRoutes(projectId, orgId, filters)` | Return routes where `project_id = $1 OR project_id IS NULL`. Allow filtering by `is_active`, `connector_type`. |
| `updateRoute(routeId, dto, actorId)` | Partial update. If changing `target_connector_ids`, validate ownership. |
| `deleteRoute(routeId, actorId)` | Soft delete (`deleted_at`). Log to `connector_audit_logs`. |
| `toggleRoute(routeId, isActive, actorId)` | Set `is_active`. |

### 5.2 New Controller: `ProjectAlertRouteController`
Base path: `/api/v1/projects/:projectId/alert-routes`

| Endpoint | Method | Auth | Body |
|----------|--------|------|------|
| `POST /` | Create | Project Admin+ | `{ name, description, event_types[], severity_levels[], source_services[], target_connector_ids[], priority?, throttle?, schedule?, is_active? }` |
| `GET /` | List | Project Member | Query: `is_active`, `connector_type` |
| `GET /:routeId` | Get | Project Member | -- |
| `PATCH /:routeId` | Update | Project Admin+ | Partial DTO |
| `DELETE /:routeId` | Delete | Project Admin+ | -- |
| `POST /:routeId/toggle` | Toggle | Project Admin+ | `{ is_active: boolean }` |

### 5.3 New Service: `ProjectMemberAlertPreferenceService`
Manages `project_member_alert_preferences`.

| Method | Logic |
|--------|-------|
| `getPreferences(projectId, userId)` | List all preferences for user in project. Auto-create defaults for all project routes if missing. |
| `updatePreference(prefId, dto)` | Update `is_subscribed`, `min_severity`, `quiet_hours`. |
| `bulkSubscribe(projectId, routeId, userIds[], actorId)` | Admin action: subscribe/unsubscribe a batch of members. |
| `resolveRecipients(projectId, routeId, severity)` | **Critical method.** Returns list of `user_id`s from `project_members` JOIN `project_member_alert_preferences` where `is_subscribed = true` AND `min_severity <= $severity`. |

### 5.4 New Controller: `ProjectMemberAlertPreferenceController`
Base path: `/api/v1/projects/:projectId/members/me/alert-preferences`

| Endpoint | Method | Auth | Body |
|----------|--------|------|------|
| `GET /` | My Prefs | Project Member | -- |
| `PATCH /:prefId` | Update | Project Member | `{ is_subscribed?, min_severity?, quiet_hours_start?, quiet_hours_end? }` |
| `POST /sync` | Sync | Project Member | Auto-generates missing preference rows for new routes |

---

## 6. Module: Alert Delivery Engine (Modified)

### 6.1 `AlertRouterService` -- Core Routing Logic
When an alert payload arrives (via API key, webhook, or internal trigger):

```typescript
async function processAlert(payload: AlertPayload) {
  // 1. Resolve project context
  const { orgId, projectId, environment, sourceService, eventType, severity } = payload;

  // 2. Match routes
  const routes = await db.query(`
    SELECT * FROM notification_routes
    WHERE organization_id = $1
      AND (project_id = $2 OR project_id IS NULL)
      AND is_active = true
      AND deleted_at IS NULL
      AND ($3 = ANY(event_types) OR event_types = '{}')
      AND ($4 = ANY(severity_levels) OR severity_levels = '{}')
      AND ($5 = ANY(source_services) OR source_services = '{}')
    ORDER BY priority DESC
  `, [orgId, projectId, eventType, severity, sourceService]);

  // 3. For each route, resolve recipients if project-scoped
  for (const route of routes) {
    const recipients = route.project_id 
      ? await preferenceService.resolveRecipients(route.project_id, route.id, severity)
      : null; // org-wide route: connector handles broadcasting (e.g., Slack channel)

    // 4. Fan out to connectors
    for (const connectorId of route.target_connector_ids) {
      await deliveryService.enqueue({
        organization_id: orgId,
        project_id: projectId,
        connector_id: connectorId,
        route_id: route.id,
        severity,
        payload,
        recipients, // NULL for org-wide, user[] for project-scoped
        correlation_id: generateUUID(),
      });
    }
  }
}
```

### 6.2 `DeliveryService` -- Enqueue & Attempt
- Insert into `notification_deliveries` with `project_id`.
- If `recipients` is non-null, the connector adapter (e.g., Email, Slack DM) must send individual messages. If null, send to connector's default channel/endpoint.
- Respect `quiet_hours` in the delivery worker (skip if current time in user's quiet window).
- Retry logic uses `max_retries`, `retry_backoff_base_ms`, `retry_backoff_multiplier` from `connector_configs`.
- After max retries, move to `notification_dead_letter` with `project_id`.

### 6.3 `HealthCheckService` -- Connector Health
- Poll connectors per `project_id` (or org-wide).
- Update `connector_health_checks`.
- If `consecutive_failures >= failure_threshold`, auto-disable connector (`status = 'error'`) and notify org admins.

---

## 7. CRITICAL: Comment Out RemoteSDK Config Creation

In `ProjectService.createProject()`, locate the RemoteSDK initialization block. **Preserve the code but comment it out** with the following comment:

```typescript
// [DISABLED] RemoteSDK configuration is deferred until Phase 2.
// The project is created without remote infrastructure provisioning.
// To enable: uncomment the block below and ensure RemoteSDK credentials
// are available in the environment.
/*
const remoteSdk = new RemoteSDK({ orgId: project.org_id });
await remoteSdk.configureProject({
  projectId: project.id,
  slug: project.slug,
  environment: project.default_environment,
});
*/
```

---

## 8. Enterprise-Grade Requirements

### 8.1 Validation Rules
- **Slug**: `^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 150 chars, unique per `org_id`.
- **Name**: 1-150 chars, not empty.
- **API Key Expiry**: If set, must be > 24 hours from now and < 2 years.
- **Route Targets**: All `target_connector_ids` must exist in `connector_configs` and belong to the same `organization_id`.

### 8.2 Authorization Matrix
| Role | Project Read | Project Update | Members CRUD | API Keys CRUD | Routes CRUD | Alert Prefs |
|------|-------------|----------------|--------------|---------------|-------------|-------------|
| Org Owner | Yes | Yes | Yes | Yes | Yes | Yes |
| Org Admin | Yes | Yes | Yes | Yes | Yes | Yes |
| Project Admin | Yes | Yes | Yes | Yes | Yes | Yes |
| Project Member | Yes | No | No | No | No | Self only |
| Org Member (no project) | No | No | No | No | No | No |

### 8.3 Audit Log Entries
Every mutation must log to `connector_audit_logs` with:
- `organization_id`, `project_id` (if applicable), `connector_id` (if applicable)
- `action`: `project_created`, `project_updated`, `project_archived`, `member_added`, `member_removed`, `route_created`, `route_updated`, `route_deleted`, `api_key_created`, `api_key_revoked`, `preference_updated`
- `actor_id`, `actor_type: 'user'`
- `previous_state`, `new_state`, `changes_summary` (JSONB diff)
- `ip_address`, `user_agent`, `request_id`

### 8.4 Error Handling
Use consistent error codes:
- `PROJECT_NOT_FOUND` (404)
- `PROJECT_SLUG_TAKEN` (409)
- `LAST_OWNER_CANNOT_LEAVE` (400)
- `ROUTE_CONNECTOR_NOT_FOUND` (400)
- `INVALID_API_KEY` (401)
- `QUIET_HOURS_ACTIVE` (202 -- accepted but suppressed)

---

## 9. Implementation Checklist

- [ ] **DTOs & Validation**: Create Zod/Joi schemas for all request bodies.
- [ ] **Repository Layer**: TypeORM/Prisma/raw SQL repositories for each table.
- [ ] **Service Layer**: Implement all services listed in Sections 4, 5, and 6.
- [ ] **Controller Layer**: Implement all REST endpoints with proper auth middleware.
- [ ] **Middleware**: `requireProjectMember(projectId)` middleware to guard project-scoped routes.
- [ ] **Background Worker**: Queue-based delivery worker (Bull/BullMQ/SQS) for `notification_deliveries`.
- [ ] **Migrations**: Ensure all `project_id` columns and new tables exist (already provided, but verify).
- [ ] **Tests**: Unit tests for services, integration tests for controllers, e2e for alert flow.
- [ ] **API Documentation**: OpenAPI/Swagger specs for all new endpoints.

---

## 10. Deliverables

1. **Backend Code**: All services, controllers, DTOs, repositories, and middleware.
2. **Postman Collection** or **OpenAPI Spec** covering all new endpoints.
3. **Migration Verification Script**: Idempotent SQL to confirm schema state.
4. **Architecture Diagram**: (Optional but recommended) Show flow from `AlertPayload` -> `AlertRouter` -> `ProjectMemberAlertPreference` -> `DeliveryService` -> `Connector`.

---

**End of Master Prompt**
