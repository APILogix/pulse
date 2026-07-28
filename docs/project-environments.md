# Project environments

Project environments are user-facing deployment scopes. An API key authenticates a client and selects one environment by UUID; SDKs continue to configure the environment by its editable slug. Product behavior uses `EnvironmentType`, never slug text.

## Canonical schema

`project_environments` contains only:

- `id`, `organization_id`, `project_id`
- `name`, `slug`, `type`, `description`, `color`
- `is_default`, `is_active`
- `created_at`, `updated_at`, `deleted_at`

Creator columns are intentionally absent because immutable audit records already capture actors. Runtime rate limits, event allowlists, payload caps, network policy, and alert destinations belong to API-key, organization, ingestion, or alerting modules—not environments.

## Environment types

The PostgreSQL `project_environment_type` enum and TypeScript `EnvironmentType` enum contain:

- `production`
- `pre_production`
- `staging`
- `pre_staging`
- `development`
- `testing`
- `preview`
- `pre_deployment`
- `custom`

New projects receive Production, Staging, Development, Testing, and Preview. Predefined form templates fill name, slug, color, and description, but users may edit every generated value. Custom environments are never seeded automatically.

## Validation and invariants

- Slugs match `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Colors are exactly six-digit HEX values such as `#2563EB`.
- Non-deleted slugs are unique within a project.
- A project has at most one active default environment.
- The default environment must be active.
- The current default cannot be deactivated or deleted; set another active default first.
- The last active environment cannot be deactivated or deleted.
- Restored environments become active and non-default.
- Only `custom` environments consume the custom-environment billing allowance.

## API lifecycle

All routes are scoped beneath `/organizations/:orgId/projects/:projectId` and require authentication.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/environments` | List active/non-deleted environments. |
| `GET` | `/environments?includeDeleted=true` | Include soft-deleted rows for management and restore. |
| `GET` | `/environments/:environmentId` | Read one non-deleted environment. |
| `POST` | `/environments` | Create from useful identity/type fields only. |
| `PATCH` | `/environments/:environmentId` | Update name, slug, type, description, color, or active/default state. |
| `POST` | `/environments/:environmentId/set-default` | Atomically replace the current default. |
| `POST` | `/environments/:environmentId/deactivate` | Deactivate after lifecycle checks. |
| `DELETE` | `/environments/:environmentId` | Soft-delete after lifecycle checks. |
| `POST` | `/environments/:environmentId/restore` | Restore as active and non-default. |

Reads require organization membership. Mutations require project `admin` or `owner` role. Every mutation writes an organization audit event; project database history triggers also retain control-plane history.

## Kept indexes

- `uq_project_environments_active_slug (project_id, slug) WHERE deleted_at IS NULL`: enforces the SDK-facing slug namespace and accelerates project/slug resolution.
- `uq_project_environments_default (project_id) WHERE is_default AND is_active AND deleted_at IS NULL`: enforces one active default.
- `uq_project_environments_tenant_id (id, project_id, organization_id)`: required by composite tenant-safe foreign keys from API keys, releases, usage, alerting, and SDK configuration.
- `idx_project_environments_org_type (organization_id, type) WHERE deleted_at IS NULL`: supports entitlement counts and organization-level type filtering.
- `idx_project_environments_project_list (project_id, is_active, type, name) WHERE deleted_at IS NULL`: supports the management list and its status/type filters.

The primary key remains the lookup path for direct environment ID reads. No indexes exist for removed configuration or creator columns.

## SDK and ingestion ownership

The slug remains the SDK-facing identifier, while `type` is the independent business classification. API keys retain `environment_id`. Published SDK configuration remains owned by one `project_environment_sdk_configs` head per environment with immutable revisions. Ingestion rate limits come from API-key overrides and organization/platform defaults; no environment policy fallback exists.