# Project Module - Complete Analysis Report

## Overview

The **Project Module** is a core module in the Pulse SaaS backend that manages projects and their API keys. It follows a layered architecture with clear separation of concerns between routes, service, repository, and types.

---

## Table Structure

### 1. `projects` Table

| Column Name | Type | Constraints | Description |
|-------------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique project identifier |
| `org_id` | UUID | NOT NULL, FK → organizations(id) ON DELETE CASCADE | Organization the project belongs to |
| `name` | VARCHAR(255) | NOT NULL | Project display name |
| `slug` | VARCHAR(255) | NOT NULL, CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$') | URL-safe identifier, unique per org |
| `description` | TEXT | NULL | Optional project description |
| `status` | project_status | NOT NULL, DEFAULT 'active' | Project lifecycle status |
| `environment` | project_environment | NOT NULL, DEFAULT 'development' | Environment type |
| `production_api_prefix` | VARCHAR(20) | NULL | Prefix for production API keys |
| `development_api_prefix` | VARCHAR(20) | NULL | Prefix for development API keys |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | Soft-delete flag (currently unused, uses status) |
| `archived_at` | TIMESTAMPTZ | NULL | Timestamp when project was archived |
| `deleted_at` | TIMESTAMPTZ | NULL | Soft delete timestamp |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update timestamp |

**Indexes:**
- `idx_projects_org` - On `org_id` WHERE `deleted_at IS NULL`
- `idx_projects_active` - On `(org_id, status)` WHERE `deleted_at IS NULL`
- `idx_projects_cursor` - On `(org_id, created_at DESC, id DESC)` WHERE `deleted_at IS NULL` for keyset pagination
- UNIQUE constraint on `(org_id, slug)`

### 2. `project_api_keys` Table

| Column Name | Type | Constraints | Description |
|-------------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique API key identifier |
| `project_id` | UUID | NOT NULL, FK → projects(id) ON DELETE CASCADE | Project the key belongs to |
| `environment` | project_environment | NOT NULL | Environment type for the key |
| `key_hash` | TEXT | NOT NULL, UNIQUE | SHA-256 hash of the full API key |
| `key_prefix` | VARCHAR(32) | NOT NULL | First 16 characters for candidate lookup |
| `name` | VARCHAR(255) | NULL | Optional friendly name for the key |
| `created_by` | UUID | FK → users(id) ON DELETE SET NULL | User who created the key |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | Whether the key is active |
| `revoked_at` | TIMESTAMPTZ | NULL | When the key was revoked |
| `revoked_reason` | TEXT | NULL | Reason for revocation |
| `rotated_from_key_id` | UUID | FK → project_api_keys(id) | Previous key if this was a rotation |
| `last_used_at` | TIMESTAMPTZ | NULL | Last time the key was used |
| `last_used_ip` | INET | NULL | IP address of last usage |
| `usage_count` | BIGINT | NOT NULL, DEFAULT 0 | Total usage count |
| `expires_at` | TIMESTAMPTZ | NULL | Optional expiration timestamp |
| `metadata` | JSONB | NOT NULL, DEFAULT '{}' | Additional metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp |

**Indexes:**
- `idx_api_keys_prefix_active` - On `key_prefix` WHERE `is_active = TRUE`
- `idx_api_keys_project` - On `project_id`
- `idx_api_keys_project_active` - On `project_id` WHERE `is_active = TRUE`
- `idx_api_keys_expiry` - On `expires_at` WHERE `expires_at IS NOT NULL AND is_active = TRUE`

### 3. Enums

```sql
CREATE TYPE project_status AS ENUM ('active', 'paused', 'archived');
CREATE TYPE project_environment AS ENUM ('development', 'staging', 'production');
```

---

## Module Architecture

### File Structure

```
pulse/src/modules/projects/
├── projects.module.ts    # Fastify plugin registration
├── routes.ts             # HTTP route handlers
├── service.ts            # Business logic layer
├── repository.ts         # Database access layer
├── types.ts              # TypeScript types and Zod schemas
├── schema.ts             # Re-exports of schemas
└── utils.ts              # Helper functions and error handling
```

---

## Routes

All routes are registered under the prefix: `/organizations/:orgId/projects`

### Project Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/` | `listProjects` | List all projects in an organization |
| POST | `/` | `createProject` | Create a new project |
| GET | `/:projectId` | `getProject` | Get a single project by ID |
| PATCH | `/:projectId` | `updateProject` | Update project properties |
| DELETE | `/:projectId` | `deleteProject` | Delete a project |
| POST | `/:projectId/archive` | `archiveProject` | Archive a project |
| POST | `/:projectId/unarchive` | `unarchiveProject` | Unarchive a project |
| POST | `/:projectId/pause` | `pauseProject` | Pause a project |
| POST | `/:projectId/resume` | `resumeProject` | Resume a paused project |
| GET | `/:projectId/stats` | `getProjectStats` | Get project statistics |

### API Key Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/:projectId/api-keys` | `listApiKeys` | List API keys for a project |
| POST | `/:projectId/api-keys` | `createApiKey` | Create a new API key |
| GET | `/:projectId/api-keys/:apiKeyId` | `getApiKey` | Get a single API key |
| PATCH | `/:projectId/api-keys/:apiKeyId` | `updateApiKey` | Update API key properties |
| DELETE | `/:projectId/api-keys/:apiKeyId` | `deleteApiKey` | Delete an API key |
| POST | `/:projectId/api-keys/:apiKeyId/rotate` | `rotateApiKey` | Rotate an API key |
| POST | `/:projectId/api-keys/:apiKeyId/enable` | `enableApiKey` | Enable an API key |
| POST | `/:projectId/api-keys/:apiKeyId/disable` | `disableApiKey` | Disable an API key |
| GET | `/:projectId/api-keys/:apiKeyId/usage` | `getApiKeyUsage` | Get API key usage stats |

---

## Middleware

### 1. Authentication Middleware (`authenticate`)

**Source:** `src/shared/middleware/auth.ts`

Every project route uses `authenticate` as a preHandler:

```typescript
{ preHandler: [authenticate] }
```

**Flow:**
1. Extracts Bearer token from `Authorization` header
2. Verifies JWT signature, algorithm, issuer, audience, and `type === 'access'`
3. Checks if token JTI is blacklisted (in-process LRU cache)
4. Validates user-wide revocation cutoff (password change, suspension, etc.)
5. Loads session from database, verifies it's active and not expired
6. Verifies session belongs to the JWT user
7. Loads user record, checks not deleted and not suspended
8. Attaches `request.user` with id, email, isAdmin, sessionId, mfaVerified, stepUpFresh

**Attached User Object:**
```typescript
request.user = {
  id: string;
  email: string;
  isAdmin: boolean;
  sessionId: string;
  mfaVerified: boolean;
  stepUpFresh: boolean;
}
```

### 2. Error Handling Wrapper (`withErrorHandling`)

**Source:** `src/modules/projects/routes.ts`

Wraps every route handler to provide consistent error responses:

```typescript
function withErrorHandling(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, "Projects route failed");
      return handleProjectError(error, reply);
    }
  };
}
```

---

## Service Layer

**Source:** `src/modules/projects/service.ts`

### Key Responsibilities

1. **Authorization Validation**
   - `requireOrganizationAccess()` - Verifies user is an active member of the organization
   - `requireProjectAccess()` - Verifies project belongs to org and user has access

2. **Project CRUD Operations**
   - `listProjects()` - Lists projects with filtering, sorting, pagination
   - `createProject()` - Creates project with auto-generated unique slug
   - `getProject()` - Retrieves single project
   - `updateProject()` - Updates project with status transition validation
   - `deleteProject()` - Deletes project with cache eviction

3. **Project Lifecycle Management**
   - `archiveProject()` - Sets status to 'archived'
   - `unarchiveProject()` - Transitions from 'archived' to 'active'
   - `pauseProject()` - Sets status to 'paused'
   - `resumeProject()` - Transitions from 'paused' to 'active'

4. **API Key Management**
   - `listApiKeys()` - Lists API keys with filtering
   - `createApiKey()` - Creates API key with hash storage, warms LRU cache
   - `getApiKey()` - Retrieves API key metadata
   - `updateApiKey()` - Updates name/expiration
   - `deleteApiKey()` - Deletes key with cache eviction
   - `rotateApiKey()` - Transactional rotation (deactivate old, create new)
   - `enableApiKey()` / `disableApiKey()` - Toggle active state
   - `validateApiKey()` - Used by ingestion to validate incoming API keys

### Caching Strategy

The service maintains an in-process LRU cache for API key resolution:

**Cache Key:** SHA-256 hash of the API key

**Cached Value:**
```typescript
interface CachedProjectConfig {
  id: string;           // Project ID
  orgId: string;        // Organization ID
  name: string;         // Project name
  environment: string;  // Environment type
  rateLimitPerSecond: number;
  rateLimitPerMinute: number;
  allowedEventTypes: string[];
  isActive: boolean;    // Whether project is active
  apiKeyId: string;     // API key ID
}
```

**Cache Operations:**
- `cacheApiKeyConfig()` - Warms cache on API key creation
- `evictApiKeyConfig()` - Evicts single key on disable/revoke/delete
- `evictProjectApiKeys()` - Evicts all project keys on pause/archive/delete

**Default Rate Limits:**
```typescript
const DEFAULT_API_KEY_RATE_LIMITS = {
  perSecond: 1000,
  perMinute: 10000,
};
```

### Audit Logging

All mutating operations record audit entries:

```typescript
await this.audit("project.created", "project", project.id, orgId, userId, meta, {
  name: project.name,
  environment: project.environment,
});
```

**Audit Actions:**
- `project.created`
- `project.updated`
- `project.deleted`
- `project.api_key_created`
- `project.api_key_revoked`

---

## Repository Layer

**Source:** `src/modules/projects/repository.ts`

### Database Operations

#### Project Operations

| Method | Description |
|--------|-------------|
| `findOrganizationMembership()` | Get org membership for user |
| `listProjects()` | List projects with filters and pagination |
| `createProject()` | Insert new project |
| `findProjectBySlug()` | Find project by org and slug |
| `findProjectById()` | Find project by org and ID |
| `updateProject()` | Update project fields |
| `deleteProject()` | Delete project |
| `getProjectStats()` | Get API key counts |

#### API Key Operations

| Method | Description |
|--------|-------------|
| `listApiKeys()` | List API keys with filters |
| `createApiKey()` | Insert new API key |
| `countActiveApiKeys()` | Count active keys for environment |
| `findApiKeyById()` | Find key by ID (public fields) |
| `findApiKeyRecordById()` | Find key by ID (includes hash) |
| `updateApiKey()` | Update key name/expiration |
| `setApiKeyActiveState()` | Toggle key active state |
| `deleteApiKey()` | Delete API key |
| `touchApiKeyLastUsed()` | Update last_used_at timestamp |
| `listApiKeyHashesByProject()` | Get all key hashes for cache eviction |
| `findActiveApiKeyCandidatesByPrefix()` | Find active keys by prefix (for validation) |

### Transaction Support

```typescript
async withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T>
```

Used for atomic operations like API key rotation.

### Row Mapping

Repository maps snake_case database rows to camelCase TypeScript objects:

```typescript
private mapProject(row: ProjectRow): Project
private mapProjectWithCounts(row: ProjectRow): ProjectListItem
private mapApiKey(row: ApiKeyRow): ProjectApiKey
private mapApiKeyRecord(row: ApiKeyRow): ProjectApiKeyRecord
```

---

## Types and Schemas

**Source:** `src/modules/projects/types.ts`

### Zod Schemas

#### Parameter Schemas
- `OrgIdParamsSchema` - Validates `orgId` UUID
- `ProjectParamsSchema` - Validates `orgId` and `projectId`
- `ApiKeyParamsSchema` - Validates `orgId`, `projectId`, `apiKeyId`

#### Query Schemas
- `ListProjectsQuerySchema` - status, environment, search, pagination, sorting
- `ListApiKeysQuerySchema` - environment, isActive, includeInactive, pagination

#### Body Schemas
- `CreateProjectBodySchema` - name, description, environment, prefixes
- `UpdateProjectBodySchema` - Partial update fields
- `CreateApiKeyBodySchema` - environment, name, expiresAt
- `UpdateApiKeyBodySchema` - name, expiresAt
- `RotateApiKeyBodySchema` - name, expiresAt, gracePeriodHours

### TypeScript Interfaces

```typescript
// Core project type
interface Project {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  description: string | null;
  status: ProjectStatus;
  environment: ProjectEnvironment;
  productionApiPrefix: string | null;
  developmentApiPrefix: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// API key types
interface ProjectApiKey {
  id: string;
  projectId: string;
  keyPrefix: string;
  environment: ProjectEnvironment;
  name: string | null;
  isActive: boolean;
  createdBy: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

interface ProjectApiKeyRecord extends ProjectApiKey {
  keyHash: string;  // Only available internally, never exposed to API
}
```

---

## Utility Functions

**Source:** `src/modules/projects/utils.ts`

### Error Handling

```typescript
class ProjectError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  )
}

function handleProjectError(error: unknown, reply: FastifyReply): FastifyReply
```

**Error Codes:**
- `PROJECT_SLUG_EXISTS` (409)
- `PROJECT_NOT_FOUND` (404)
- `PROJECT_INVALID_TRANSITION` (400)
- `INSUFFICIENT_PERMISSIONS` (403)
- `API_KEY_NOT_FOUND` (404)
- `API_KEY_LIMIT_EXCEEDED` (400)
- `API_KEY_REVOKED` (400)
- `API_KEY_EXPIRED` (400)
- `API_KEY_CONFLICT` (409)
- `VALIDATION_ERROR` (422)

### Role Hierarchy

```typescript
const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  billing: 3,
  member: 2,
  viewer: 1,
};

function hasRequiredRole(role: OrgRole, requiredRole: OrgRole): boolean
```

### Slug Generation

```typescript
function slugifyProjectName(name: string): string
```
- Converts to lowercase
- Replaces non-alphanumeric with hyphens
- Truncates to 48 characters
- Falls back to `project-{random}` if empty

### API Key Cryptography

```typescript
function hashApiKey(rawKey: string): string
  // SHA-256 hex digest

function createApiKey(environment: ProjectEnvironment): {
  fullKey: string;    // pk_live_xxx or pk_dev_xxx
  keyPrefix: string;  // First 16 characters
  keyHash: string;    // SHA-256 hash
}

function extractApiKeyPrefix(rawKey: string): string | null
  // Extracts first 16 chars for candidate lookup

function constantTimeEqualHex(left: string, right: string): boolean
  // Timing-safe comparison to prevent timing attacks
```

### Status Transitions

```typescript
function validateStatusTransition(current: ProjectStatus, next: ProjectStatus): boolean
```

**Valid Transitions:**
- `active` → `paused`, `archived`
- `paused` → `active`, `archived`
- `archived` → `active`

---

## Module Registration

**Source:** `src/modules/projects/projects.module.ts`

```typescript
async function projectsModule(fastify: FastifyInstance): Promise<void> {
  const repository = new ProjectsRepository();
  const service = new ProjectsService(repository, fastify.log);

  fastify.decorate('projects', {
    repository,
    service,
  });

  await fastify.register(projectsRoutes, {
    prefix: '/organizations/:orgId/projects',
  });
}

export const registerProjectsModule = fp(projectsModule, {
  name: 'projects-module',
});
```

**Decorated Fastify Instance:**
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    projects: {
      repository: ProjectsRepository;
      service: ProjectsService;
    };
  }
}
```

---

## LRU Cache Configuration

**Source:** `src/config/lrucashe.ts`

```typescript
export const apiKeyCache = new LRUCache<string, CachedProjectConfig>({
  max: 5000,              // Maximum 5000 cached keys
  ttl: 1000 * 60 * 30,    // 30 minutes TTL
  updateAgeOnGet: true,   // Refresh TTL on access
  allowStale: false,      // Don't return stale values
});
```

---

## Request Flow Example: Create Project

```
1. Client → POST /organizations/:orgId/projects
   │
2. authenticate middleware
   │  ├─ Validate JWT
   │  ├─ Check session
   │  └─ Attach request.user
   │
3. withErrorHandling wrapper
   │  └─ Catch and normalize errors
   │
4. Route handler
   │  ├─ Parse OrgIdParamsSchema
   │  ├─ Parse CreateProjectBodySchema
   │  └─ Call service.createProject()
   │
5. ProjectsService.createProject()
   │  ├─ requireOrganizationAccess()
   │  ├─ generateUniqueSlug()
   │  ├─ buildApiPrefixes()
   │  ├─ repository.createProject()
   │  └─ audit()
   │
6. ProjectsRepository.createProject()
   │  ├─ INSERT INTO projects
   │  ├─ Handle unique constraint violation
   │  └─ mapProject()
   │
7. Response: { success: true, data: Project }
```

---

## Security Features

1. **API Key Storage**
   - Full API key is NEVER stored in the database
   - Only SHA-256 hash is stored for verification
   - Key prefix (16 chars) stored for candidate lookup
   - Full key returned exactly once on creation

2. **Timing Attack Prevention**
   - `constantTimeEqualHex()` uses Node's `timingSafeEqual`
   - Prevents leaking information via response timing

3. **Authorization Checks**
   - Every route requires authentication
   - Organization membership is verified for every operation
   - Project ownership is verified (project must belong to org)

4. **Rate Limiting**
   - Default rate limits cached with API key
   - 1000 requests/second, 10000 requests/minute per key

5. **Audit Trail**
   - All mutations logged to `audit_logs` table
   - Includes user_id, org_id, IP, user agent, request_id
   - Async write with retry on failure

---

## Key Business Rules

1. **API Key Limits**
   - Maximum 5 active API keys per environment per project (on create)
   - Maximum 10 active API keys per environment per project (on enable)
   - Different limits for create vs enable to allow rotation

2. **Slug Uniqueness**
   - Slugs must be unique within an organization
   - Auto-generated with numeric suffix on collision

3. **Status Transitions**
   - Only valid state transitions allowed
   - Archived projects can only be unarchived
   - Paused projects can only be resumed

4. **Cache Invalidation**
   - API key cache evicted on disable, rotate, delete
   - Project key cache evicted on pause, archive, delete
   - Immediate eviction ensures revoked keys can't be used

---

## Dependencies

### Internal Dependencies
- `pg` - PostgreSQL client
- `fastify` - Web framework
- `fastify-plugin` - Plugin registration
- `zod` - Schema validation
- `lru-cache` - In-memory caching
- `jsonwebtoken` - JWT verification

### Shared Modules
- `shared/middleware/auth.ts` - Authentication
- `shared/middleware/audit-logger.ts` - Audit logging
- `config/database.js` - Database pool
- `config/logger.js` - Pino logger
- `config/lrucashe.ts` - LRU cache instances

---

## Summary

The Project Module is a well-architected module following clean architecture principles:

- **Layered Architecture**: Routes → Service → Repository
- **Security First**: API keys stored as hashes, constant-time comparison, comprehensive audit logging
- **Performance**: In-process LRU cache for API key resolution, indexed database queries
- **Error Handling**: Consistent error responses with domain-specific error codes
- **Validation**: Zod schemas for request validation with preprocessing
- **Auditability**: All mutations logged with request context

The module integrates tightly with the authentication system, organization module, and ingestion pipeline while maintaining clear boundaries and responsibilities.
