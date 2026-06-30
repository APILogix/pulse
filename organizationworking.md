# Organization Module - Complete Architecture

## Overview

The Organization module provides **multi-tenant workspace isolation** for the Pulse platform. Each organization is a self-contained tenant with its own members, projects, settings, and billing. The module handles organization CRUD, member management (invite/role-based access), project isolation, and organization-level policy enforcement.

---

## PostgreSQL Tables

### Core Tables (from `migrations/010_organizations.sql`)

#### `organizations`
Primary organization entity.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | VARCHAR(255) | Organization display name |
| `slug` | VARCHAR(100) | URL-friendly identifier, unique |
| `owner_id` | UUID | FK to `users.id`, organization owner |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |
| `deleted_at` | TIMESTAMPTZ | Soft delete timestamp (nullable) |

**Indexes:**
- `idx_organizations_slug` on `slug` (unique)
- `idx_organizations_owner` on `owner_id`

---

#### `organization_members`
Membership join table linking users to organizations with roles.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `org_id` | UUID | FK to `organizations.id` |
| `user_id` | UUID | FK to `users.id` |
| `role` | VARCHAR(50) | Member role: `owner`, `admin`, `member`, `viewer` |
| `status` | VARCHAR(20) | Membership status: `active`, `pending`, `suspended` |
| `joined_at` | TIMESTAMPTZ | When membership was activated |
| `invited_by` | UUID | FK to `users.id`, who invited this member |
| `created_at` | TIMESTAMPTZ | Invitation/creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**Constraints:**
- `UNIQUE(org_id, user_id)` - User can only be a member once per org

**Indexes:**
- `idx_org_members_org` on `org_id`
- `idx_org_members_user` on `user_id`
- `idx_org_members_status` on `status`

---

#### `organization_settings`
Organization-level configuration and policy flags.

| Column | Type | Description |
|--------|------|-------------|
| `org_id` | UUID | FK to `organizations.id`, PK |
| `enforce_sso` | BOOLEAN | Require SSO for all members |
| `enforce_mfa` | BOOLEAN | Require MFA for all members |
| `session_timeout_minutes` | INTEGER | Session duration limit |
| `mfa_allowed_methods` | TEXT[] | Permitted MFA methods (migration 005) |
| `mfa_primary_method_preference` | VARCHAR(50) | Preferred primary MFA method |
| `mfa_backup_codes_required` | BOOLEAN | Require backup codes on enrollment |
| `mfa_grace_period_days` | INTEGER | Days before MFA enforcement kicks in |
| `mfa_max_devices_per_user` | INTEGER | Device cap per user (default 10) |
| `mfa_allow_sms_fallback` | BOOLEAN | Allow SMS as fallback method |
| `mfa_allow_email_fallback` | BOOLEAN | Allow email as fallback method |
| `mfa_remember_device_days` | INTEGER | Days to trust a device (default 30) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

**MFA policy columns** added in `migrations2/005_add_mfa_system.up.sql`.

---

#### `organization_invitations`
Pending invitations for new members.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `org_id` | UUID | FK to `organizations.id` |
| `email` | VARCHAR(255) | Invitee email address |
| `role` | VARCHAR(50) | Role to assign on acceptance |
| `token` | VARCHAR(255) | Unique invitation token (hashed) |
| `invited_by` | UUID | FK to `users.id` |
| `expires_at` | TIMESTAMPTZ | Invitation expiration |
| `accepted_at` | TIMESTAMPTZ | When accepted (nullable) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

**Indexes:**
- `idx_org_invitations_token` on `token` (unique)
- `idx_org_invitations_email` on `email`

---

### Related Tables

#### `projects` (from `migrations/011_projects.sql`)
Projects belong to organizations and provide a secondary level of isolation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `org_id` | UUID | FK to `organizations.id` |
| `name` | VARCHAR(255) | Project name |
| `slug` | VARCHAR(100) | URL-friendly identifier |
| `description` | TEXT | Project description |
| `created_by` | UUID | FK to `users.id` |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |
| `deleted_at` | TIMESTAMPTZ | Soft delete timestamp |

---

## Routes (Fastify)

All routes prefixed with `/api/v1/organizations`.

### Organization CRUD

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/` | List organizations for current user | User |
| `POST` | `/` | Create new organization | User |
| `GET` | `/:id` | Get organization details | Member |
| `PATCH` | `/:id` | Update organization | Admin+ |
| `DELETE` | `/:id` | Soft delete organization | Owner |

### Member Management

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/:id/members` | List organization members | Member |
| `POST` | `/:id/members` | Invite member to organization | Admin+ |
| `PATCH` | `/:id/members/:memberId` | Update member role/status | Admin+ |
| `DELETE` | `/:id/members/:memberId` | Remove member from organization | Admin+ |
| `POST` | `/:id/members/accept` | Accept invitation (token-based) | Public |
| `POST` | `/:id/leave` | Leave organization | Member |

### Settings & Policy

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/:id/settings` | Get organization settings | Member |
| `PATCH` | `/:id/settings` | Update organization settings | Admin+ |
| `GET` | `/:id/policy` | Get effective auth policy for user | Member |

---

## Repository Functions

**File:** `src/modules/organization/repository.ts`

### Organization CRUD

```typescript
// Find organization by ID
findOrganizationById(id: string): Promise<Organization | null>

// Find organization by slug
findOrganizationBySlug(slug: string): Promise<Organization | null>

// List organizations for a user (via membership)
listOrganizationsForUser(userId: string): Promise<Organization[]>

// Create organization (also creates owner membership)
createOrganization(data: {
  name: string;
  slug: string;
  ownerId: string;
}): Promise<Organization>

// Update organization
updateOrganization(id: string, data: Partial<Organization>): Promise<Organization>

// Soft delete organization
deleteOrganization(id: string): Promise<void>
```

### Member Management

```typescript
// List members of an organization
listOrganizationMembers(orgId: string): Promise<OrganizationMember[]>

// Find membership by org + user
findOrganizationMember(orgId: string, userId: string): Promise<OrganizationMember | null>

// Create membership (internal, used by invite/accept)
createOrganizationMember(data: {
  orgId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  invitedBy?: string;
}): Promise<OrganizationMember>

// Update membership
updateOrganizationMember(id: string, data: Partial<OrganizationMember>): Promise<OrganizationMember>

// Remove membership
deleteOrganizationMember(id: string): Promise<void>
```

### Invitations

```typescript
// Create invitation
createInvitation(data: {
  orgId: string;
  email: string;
  role: MemberRole;
  invitedBy: string;
}): Promise<OrganizationInvitation>

// Find invitation by token
findInvitationByToken(token: string): Promise<OrganizationInvitation | null>

// Accept invitation (marks accepted_at, creates membership)
acceptInvitation(token: string, userId: string): Promise<OrganizationMember>

// Delete invitation
deleteInvitation(id: string): Promise<void>
```

### Settings

```typescript
// Get organization settings
getOrganizationSettings(orgId: string): Promise<OrganizationSettings | null>

// Update organization settings
updateOrganizationSettings(orgId: string, data: Partial<OrganizationSettings>): Promise<OrganizationSettings>
```

---

## Service Layer

**File:** `src/modules/organization/organizationservice.ts`

The service layer encapsulates business logic and authorization checks:

### Authorization Matrix

| Action | Owner | Admin | Member | Viewer |
|--------|-------|-------|--------|--------|
| View organization | ✅ | ✅ | ✅ | ✅ |
| Update organization | ✅ | ✅ | ❌ | ❌ |
| Delete organization | ✅ | ❌ | ❌ | ❌ |
| Invite members | ✅ | ✅ | ❌ | ❌ |
| Update member role | ✅ | ✅ | ❌ | ❌ |
| Remove member | ✅ | ✅ | ❌ | ❌ |
| Leave organization | ✅ | ✅ | ✅ | ✅ |
| Update settings | ✅ | ✅ | ❌ | ❌ |

### Key Service Functions

```typescript
// Create organization with owner membership
async createOrganization(userId: string, data: CreateOrgInput): Promise<Organization>

// Invite user by email (sends invitation email)
async inviteMember(orgId: string, inviterId: string, email: string, role: MemberRole): Promise<OrganizationInvitation>

// Accept invitation (validates token, creates membership)
async acceptInvitation(token: string, userId: string): Promise<OrganizationMember>

// Remove member with authorization check
async removeMember(orgId: string, memberId: string, requesterId: string): Promise<void>

// Transfer ownership
async transferOwnership(orgId: string, newOwnerId: string, requesterId: string): Promise<void>
```

---

## Integration with Other Modules

### Auth Module
- **Organization context injection:** `request.orgId` is set by middleware based on the user's active organization
- **SSO enforcement:** `organization_settings.enforce_sso` checked during login
- **MFA enforcement:** `organization_settings.enforce_mfa` and related policy columns consumed by `policy.service.ts`

### Projects Module
- Projects are scoped to organizations via `org_id`
- Project access requires organization membership

### Billing Module
- Billing is organization-scoped
- Subscription plans and quotas apply per organization

### Connectors Module
- Notification connectors can be organization-scoped (e.g., org-specific Slack webhook)

---

## Multi-Tenancy Pattern

The application uses **application-level isolation** (not database-level RLS):

1. **Request Context:** `org_id` is resolved from the request (header, path param, or user's default org) and attached to the Fastify request object.

2. **Service Layer Enforcement:** Every query includes `org_id` filtering at the service/repository level.

3. **Authorization:** Role-based access control (RBAC) is enforced at the service layer using membership roles.

4. **No RLS:** Row-Level Security is intentionally disabled (see `migrations2/001_auth_canonical_consolidated.up.sql` BUGFIX #4 note) because:
   - The codebase never sets `app.current_org_id` session variable
   - Application-level isolation provides equivalent security
   - RLS adds query overhead and debugging complexity

---

## TypeScript Types

**File:** `src/modules/organization/types.ts`

```typescript
export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MemberStatus = 'active' | 'pending' | 'suspended';

export interface OrganizationMember {
  id: string;
  org_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  joined_at: Date | null;
  invited_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationSettings {
  org_id: string;
  enforce_sso: boolean;
  enforce_mfa: boolean;
  session_timeout_minutes: number | null;
  mfa_allowed_methods: string[];
  mfa_primary_method_preference: string | null;
  mfa_backup_codes_required: boolean;
  mfa_grace_period_days: number;
  mfa_max_devices_per_user: number;
  mfa_allow_sms_fallback: boolean;
  mfa_allow_email_fallback: boolean;
  mfa_remember_device_days: number;
}

export interface OrganizationInvitation {
  id: string;
  org_id: string;
  email: string;
  role: MemberRole;
  token: string;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  created_at: Date;
}
```

---

## Error Handling

The module uses custom error classes from `auth/types.ts`:

```typescript
// Organization not found
throw new AuthError('Organization not found', AuthErrorCodes.ORG_NOT_FOUND, 404);

// User is not a member
throw new AuthError('Not a member of this organization', AuthErrorCodes.FORBIDDEN, 403);

// Insufficient role
throw new AuthError('Admin access required', AuthErrorCodes.FORBIDDEN, 403);

// Slug already taken
throw new AuthError('Organization slug already exists', AuthErrorCodes.VALIDATION_ERROR, 400);
```

---

## Maintenance / Cleanup Cron (no Redis)

Background housekeeping runs as **Postgres-backed pg-boss cron jobs** — no Redis. pg-boss delivers each scheduled job to exactly one consumer, so cleanup runs once even across multiple worker/cron processes (the API runs in PM2 cluster mode, so it must never host the scheduler).

**Files**
- `src/modules/organization/cleanup.ts` — pure sweep orchestration (`runHourlyOrgCleanup`, `runDailyOrgCleanup`).
- `src/modules/organization/queue.ts` — `registerOrganizationCleanupWorkers()`: registers the pg-boss workers + cron schedules.
- `src/modules/organization/repository.ts` — bulk-sweep SQL (`expireStalePendingInvitations`, `purgeTerminalInvitations`, `revokeExpiredApiKeys`, `revokeExpiredScimTokens`, `purgeSentEmailOutbox`, `purgeFailedEmailOutbox`, `purgeExpiredAuditLogs`).

**Schedules**

| Job | Cron | Work |
|-----|------|------|
| `org.cleanup.hourly` | `0 * * * *` | Expire stale pending invitations; revoke expired API keys + SCIM tokens |
| `org.cleanup.daily` | `30 3 * * *` | Purge terminal invitations (>90d), drained email outbox (sent >14d / failed >30d), audit logs past each org's `audit_log_retention_days` (sensitive logs retained) |

**Where it runs (best practice)**
- **Default:** inside the dedicated worker process (`src/workers/main.ts`), the established home for background work.
- **Optional isolation:** a standalone cron process (`src/workers/cron.ts`) via `npm run start:cron` / `npm run dev:cron`. When using it, start the worker with `ORG_CRON_ENABLED=false` so the schedule is owned in exactly one place.

## SDK Remote Config (migration 007)

Org/project-scoped remote configuration that SDKs fetch at runtime, with auto-versioning, immutable history, rollback, and rollout tracking. No Redis — the resolve path is cached in-process (`sdkConfigCache`, 30s TTL).

**Schema** — `migrations2/007_add_sdk_config_module.up.sql`: `sdk_configs` (one live row per scope, version++ in place), `sdk_config_versions` (append-only history), `sdk_config_deployments` (rollout tracking).

**Code** — `sdk-config.types.ts`, `sdk-config.repository.ts`, `sdk-config.service.ts` (admin+ RBAC, SHA-256 canonical-JSON `version_hash`, change diffs, audit logging), `sdk-config.routes.ts`.

**Routes** (under `/organizations`):

| Method | Path | Auth |
|--------|------|------|
| GET | `/:orgId/sdk-configs` | Member |
| POST | `/:orgId/sdk-configs` | Admin+ |
| GET | `/:orgId/sdk-configs/resolve` | Member (cached) |
| GET | `/:orgId/sdk-configs/:configId` | Member |
| PATCH | `/:orgId/sdk-configs/:configId` | Admin+ |
| POST | `/:orgId/sdk-configs/:configId/rollback` | Admin+ |
| GET | `/:orgId/sdk-configs/:configId/versions` | Member |
| GET | `/:orgId/sdk-configs/:configId/versions/:version` | Member |
| GET | `/:orgId/sdk-configs/:configId/deployments` | Member |
| POST | `/:orgId/sdk-configs/:configId/versions/:version/ack` | Member |

Note: the master prompt's public `GET /sdk/config` (SDK-key auth) is intentionally deferred — API-key auth is a separate module per the architecture ("NO API KEYS IN THIS MODULE").

## Future Enhancements

1. **Organization switching API:** Allow users to switch active organization context
2. **Audit logging:** Track organization-level changes in dedicated audit log
3. **Organization quotas:** Enforce limits on members, projects per organization
4. **Domain-based SSO:** Auto-associate users to organizations by email domain
5. **Nested organizations:** Support for sub-organizations / teams
