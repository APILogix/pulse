# Organization and Project API Route Review

## Executive Summary

This document reviews the current Organization and Project modules in the API Monitoring backend and explains how the routes should be treated from an enterprise SaaS architecture perspective.

The main conclusion is that the **Organization module should own tenant-level concerns** such as membership, access policy, SSO, SCIM, audit logs, security events, environments, and quota governance. The **Project module should own project-level concerns** such as monitored applications, project lifecycle, project status, and project-scoped ingestion API keys.

There is one important overlap: both modules currently expose API-key routes. These should not both be positioned as the same product feature. For ingestion and customer SDK usage, the canonical API-key system should be the Project API Key routes:

```text
/organizations/:orgId/projects/:projectId/api-keys
```

The Organization API Key routes should either be deprecated or renamed to a separate concept such as `service-tokens` or `management-tokens` if the business needs organization-wide machine-to-machine credentials.

## Review Scope

Reviewed implementation files:

- `src/modules/organization/routes.ts`
- `src/modules/organization/organization.module.ts`
- `src/modules/organization/organizationservice.ts`
- `src/modules/organization/repository.ts`
- `src/modules/projects/routes.ts`
- `src/modules/projects/projects.module.ts`
- `src/modules/projects/service.ts`
- `src/modules/projects/repository.ts`
- `src/modules/projects/types.ts`

Mounted route prefixes:

| Module | Mounted Prefix | Scope |
| --- | --- | --- |
| Organization | `/organizations` | Tenant-level identity, access, policy, compliance, and governance. |
| Project | `/organizations/:orgId/projects` | Project-level lifecycle, ingestion keys, and operational metadata. |

## Importance Levels

| Level | Meaning | Management Interpretation |
| --- | --- | --- |
| P0 - Critical | Required for core platform operation, tenant isolation, security, or ingestion. | Must be production-grade before launch. Breaking this blocks customers. |
| P1 - High | Required for enterprise administration, operational safety, compliance, or lifecycle management. | Should be production-grade for enterprise customers. |
| P2 - Medium | Valuable for enterprise maturity, support, automation, or admin convenience. | Can be phased, but should have clear ownership. |
| P3 - Low | Optional, future-facing, or currently ambiguous. | Should be postponed, renamed, or removed unless there is a clear product requirement. |

## Enterprise Domain Model

The clean product model should be:

```text
Organization
  Tenant/account boundary.
  Owns users, roles, invites, security policy, SSO, SCIM, audit, quotas.

Project
  Monitored application or workspace inside an organization.
  Owns project configuration, project state, and ingestion credentials.

Project API Key
  Credential used by SDKs, services, or servers to send monitoring events into one project.

Organization Service Token
  Optional future concept for organization-wide admin automation.
  Should not be confused with ingestion API keys.
```

This boundary matters because enterprise systems fail when tenant-level access control and application-level ingestion are mixed. The organization is the authorization boundary. The project is the product workspace inside that boundary.

## High-Level User and System Flows

### Flow 1: New Customer Onboarding

```text
1. User signs up and authenticates.
2. User creates an organization.
3. Backend creates tenant record and owner membership.
4. User creates first project inside the organization.
5. User creates a project API key for development or production.
6. SDK/server uses the project API key to send ingestion events.
7. Backend validates API key and maps events to org + project.
```

Relevant routes:

- `POST /organizations`
- `GET /organizations`
- `POST /organizations/:orgId/projects`
- `POST /organizations/:orgId/projects/:projectId/api-keys`

Business value:

- This is the core path from signup to first useful product event.
- Any instability here directly impacts activation and customer onboarding.
- These routes should be treated as P0.

### Flow 2: Team Member Invitation and Access Control

```text
1. Admin lists current organization members.
2. Admin creates an invitation for a new user.
3. Invitee validates the invitation token from the frontend.
4. Invitee accepts the invitation.
5. Admin can later update role, suspend, reactivate, or remove the member.
6. Every change should be audited.
```

Relevant routes:

- `GET /organizations/:orgId/members`
- `POST /organizations/:orgId/invitations`
- `GET /organizations/invitations/validate`
- `POST /organizations/invitations/accept`
- `PATCH /organizations/:orgId/members/:userId/role`
- `POST /organizations/:orgId/members/:userId/suspend`
- `POST /organizations/:orgId/members/:userId/reactivate`
- `DELETE /organizations/:orgId/members/:userId`

Business value:

- Enterprise customers require controlled access management.
- Role changes and removals are security-sensitive.
- This is the foundation for RBAC and tenant isolation.

### Flow 3: Enterprise Security Policy Setup

```text
1. Organization owner opens security/settings page.
2. Backend returns current tenant policy.
3. Owner enables MFA enforcement, SSO enforcement, session timeout, retention, or data region.
4. Backend stores policy and writes audit/security events.
5. Future auth/session behavior should respect these org-level settings.
```

Relevant routes:

- `GET /organizations/:orgId/settings`
- `PATCH /organizations/:orgId/settings`
- `GET /organizations/:orgId/security-events`
- `GET /organizations/:orgId/audit-logs`

Business value:

- These routes are key for enterprise readiness.
- Settings such as MFA, SSO, data region, and retention are compliance/security controls.
- Updates must be permissioned, audited, and tested.

### Flow 4: SSO and SCIM Enterprise Provisioning

```text
1. Enterprise admin configures SSO provider for the organization.
2. Admin optionally enables SSO enforcement in organization settings.
3. Admin creates SCIM token for identity provider provisioning.
4. Identity provider provisions/deprovisions users.
5. Admin rotates or revokes SCIM tokens when required.
```

Relevant routes:

- `GET /organizations/:orgId/sso`
- `POST /organizations/:orgId/sso`
- `PATCH /organizations/:orgId/sso/:ssoId`
- `DELETE /organizations/:orgId/sso/:ssoId`
- `GET /organizations/:orgId/scim-tokens`
- `POST /organizations/:orgId/scim-tokens`
- `DELETE /organizations/:orgId/scim-tokens/:tokenId`

Business value:

- These are common enterprise procurement requirements.
- They may not be required for MVP, but they are important for larger customers.
- They should remain organization-scoped, not project-scoped.

### Flow 5: Project Lifecycle Management

```text
1. User selects an organization.
2. User lists projects in that organization.
3. User creates or opens a project.
4. User updates project metadata or environment settings.
5. Admin may pause, resume, archive, unarchive, or delete a project.
6. Backend records audit events for lifecycle changes.
```

Relevant routes:

- `GET /organizations/:orgId/projects`
- `POST /organizations/:orgId/projects`
- `GET /organizations/:orgId/projects/:projectId`
- `PATCH /organizations/:orgId/projects/:projectId`
- `POST /organizations/:orgId/projects/:projectId/pause`
- `POST /organizations/:orgId/projects/:projectId/resume`
- `POST /organizations/:orgId/projects/:projectId/archive`
- `POST /organizations/:orgId/projects/:projectId/unarchive`
- `DELETE /organizations/:orgId/projects/:projectId`

Business value:

- Projects are the main customer workspace.
- Project lifecycle routes support production operations and cleanup.
- They must be consistently permissioned through org membership.

### Flow 6: Project API Key Lifecycle and Ingestion

```text
1. User creates a project API key for development or production.
2. Backend returns the full key once.
3. Backend stores only hashed key material and metadata.
4. Backend caches key hash -> project config for ingestion.
5. SDK/server sends events using the key.
6. Ingestion validates key and maps event to project.
7. Admin can list, disable, enable, rotate, delete, or inspect usage.
```

Relevant routes:

- `GET /organizations/:orgId/projects/:projectId/api-keys`
- `POST /organizations/:orgId/projects/:projectId/api-keys`
- `GET /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId`
- `PATCH /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId`
- `POST /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/disable`
- `POST /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/enable`
- `POST /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/rotate`
- `DELETE /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId`
- `GET /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/usage`

Business value:

- This is the credential system that powers ingestion.
- It is security-critical because leaked keys allow unauthorized event submission.
- These routes should be P0/P1 and should be thoroughly tested.

## Organization Route Catalog

### Organization Lifecycle

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| Create Organization | `POST /organizations` | P0 - Critical | Creates tenant/account container. | Must create owner membership and audit the tenant creation. |
| List User Organizations | `GET /organizations` | P0 - Critical | Lists organizations the user can access. | Required for org switcher, dashboard routing, and tenant isolation. |
| Get Organization | `GET /organizations/:id` | P0 - Critical | Loads one tenant's metadata. | Must verify caller membership before returning details. |
| Update Organization | `PATCH /organizations/:id` | P1 - High | Updates tenant profile fields. | Should be admin/owner only and audited. |
| Delete Organization | `DELETE /organizations/:id` | P1 - High | Removes or soft-deletes tenant. | Should require owner, possibly MFA, and strong audit logging. |
| Archive Organization | `POST /organizations/:id/archive` | P1 - High | Suspends tenant without deletion. | Useful for non-payment, abuse, or customer-requested pause. |
| Restore Organization | `POST /organizations/:id/restore` | P1 - High | Restores archived/deleted tenant. | Should be restricted and audited. |
| Transfer Organization Ownership | `POST /organizations/:id/transfer-ownership` | P0 - Critical | Moves owner role to another user. | Very sensitive. Should require owner permission and possibly re-auth/MFA. |

### Settings and Policy

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| Get Settings | `GET /organizations/:orgId/settings` | P1 - High | Reads tenant-wide security/compliance settings. | Drives admin UI and policy visibility. |
| Update Settings | `PATCH /organizations/:orgId/settings` | P0 - Critical | Changes MFA, SSO, session, region, retention, and project visibility policy. | Security-sensitive. Must be owner/admin only and audited with before/after changes. |

### Members and RBAC

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List Members | `GET /organizations/:orgId/members` | P0 - Critical | Lists tenant users and roles. | Required for access review and admin UX. |
| Get Member | `GET /organizations/:orgId/members/:userId` | P1 - High | Reads one member record. | Useful for support, role review, and profile pages. |
| Update Member Role | `PATCH /organizations/:orgId/members/:userId/role` | P0 - Critical | Changes RBAC role. | Must prevent privilege escalation and owner self-demotion mistakes. |
| Remove Member | `DELETE /organizations/:orgId/members/:userId` | P0 - Critical | Revokes user access. | Must prevent removing the last owner. |
| Suspend Member | `POST /organizations/:orgId/members/:userId/suspend` | P1 - High | Temporarily disables access. | Important for incident response. |
| Reactivate Member | `POST /organizations/:orgId/members/:userId/reactivate` | P1 - High | Restores suspended access. | Should write audit trail. |
| Leave Organization | `POST /organizations/:orgId/leave` | P1 - High | User leaves tenant voluntarily. | Must prevent last owner from leaving without transfer. |

### Invitations

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List Invitations | `GET /organizations/:orgId/invitations` | P1 - High | Shows pending/past invites. | Prevents stale invitations and supports admin review. |
| Create Invitation | `POST /organizations/:orgId/invitations` | P0 - Critical | Invites new member with role. | Must validate inviter permission and target role. |
| Resend Invitation | `POST /organizations/:orgId/invitations/:invitationId/resend` | P2 - Medium | Sends invitation email again. | Useful operational convenience. |
| Revoke Invitation | `DELETE /organizations/:orgId/invitations/:invitationId` | P1 - High | Cancels a pending invite. | Important to stop unintended future access. |
| Accept Invitation | `POST /organizations/invitations/accept` | P0 - Critical | Adds user to organization. | Must validate token, expiry, and current user identity. |
| Decline Invitation | `POST /organizations/invitations/:id/decline` | P2 - Medium | Rejects invitation. | Useful for cleanup and user control. |
| Validate Invitation Token | `GET /organizations/invitations/validate` | P1 - High | Checks invite token before accept. | Public route; must not leak sensitive tenant/user data. |

### Environments

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List Environments | `GET /organizations/:orgId/environments` | P1 - High | Lists org-level environments. | Useful for dev/staging/prod and region separation. |
| Create Environment | `POST /organizations/:orgId/environments` | P1 - High | Creates environment metadata. | Should be admin-only. |
| Update Environment | `PATCH /organizations/:orgId/environments/:envId` | P2 - Medium | Updates environment metadata. | Useful but not core to ingestion if project keys already model environment. |

### Organization API Keys

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List Organization API Keys | `GET /organizations/:orgId/api-keys` | P3 - Low currently | Lists org-level keys. | Ambiguous overlap with project keys. Should be renamed or removed unless scoped as service tokens. |
| Create Organization API Key | `POST /organizations/:orgId/api-keys` | P3 - Low currently | Creates org-level raw key. | Should not be used for ingestion. Needs scopes and clearer product definition. |
| Revoke Organization API Key | `DELETE /organizations/:orgId/api-keys/:keyId` | P3 - Low currently | Revokes org-level key. | Keep only if org service tokens remain. |
| Rotate Organization API Key | `POST /organizations/:orgId/api-keys/:keyId/rotate` | P3 - Low currently | Rotates org-level key. | Current service implementation rotates with fixed defaults; needs hardening before production. |

### SSO Providers

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List SSO Providers | `GET /organizations/:orgId/sso` | P1 - High | Lists tenant identity providers. | Enterprise customer requirement. |
| Create SSO Provider | `POST /organizations/:orgId/sso` | P1 - High | Adds SAML/OIDC config. | Must protect secrets/certificates and audit changes. |
| Update SSO Provider | `PATCH /organizations/:orgId/sso/:ssoId` | P1 - High | Updates provider config. | Needed for certificate rotation and IdP URL changes. |
| Delete SSO Provider | `DELETE /organizations/:orgId/sso/:ssoId` | P1 - High | Removes provider config. | Should consider impact if SSO enforcement is active. |

### SCIM Tokens

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List SCIM Tokens | `GET /organizations/:orgId/scim-tokens` | P2 - Medium | Lists provisioning tokens. | Useful for enterprise provisioning admin. |
| Create SCIM Token | `POST /organizations/:orgId/scim-tokens` | P2 - Medium | Creates token for identity provider provisioning. | Token should be shown once and stored hashed. |
| Revoke SCIM Token | `DELETE /organizations/:orgId/scim-tokens/:tokenId` | P2 - Medium | Disables provisioning token. | Needed for rotation and incident response. |

### Security, Audit, and Quotas

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List Security Events | `GET /organizations/:orgId/security-events` | P1 - High | Shows security events for tenant. | Important for admin visibility and incident response. |
| List Audit Logs | `GET /organizations/:orgId/audit-logs` | P0 - Critical | Shows audit history. | Enterprise-grade compliance feature. Should be immutable and filterable. |
| Export Audit Logs | `GET /organizations/:orgId/audit-logs/export` | P1 - High | Exports audit logs. | Useful for SIEM/compliance. Should support date ranges and formats. |
| List Quota Requests | `GET /organizations/:orgId/quota-requests` | P2 - Medium | Lists quota increase requests. | Useful for sales/support reviewed quota model. |
| Create Quota Request | `POST /organizations/:orgId/quota-requests` | P2 - Medium | Customer requests higher quota. | Good for controlled growth. |
| Approve Quota Request | `POST /organizations/:orgId/quota-requests/:requestId/approve` | P2 - Medium | Admin approves request. | Should be internal/admin only. |
| Reject Quota Request | `POST /organizations/:orgId/quota-requests/:requestId/reject` | P2 - Medium | Admin rejects request. | Should record reason/notes. |

### Utility

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| Check Slug Availability | `GET /organizations/slug-available/:slug` | P2 - Medium | Checks if org slug is available. | Public route; should be rate limited to avoid enumeration abuse. |

## Project Route Catalog

### Project Lifecycle

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List Projects | `GET /organizations/:orgId/projects` | P0 - Critical | Lists projects inside organization. | Required for project selection and dashboard entry. |
| Create Project | `POST /organizations/:orgId/projects` | P0 - Critical | Creates monitored application/workspace. | Should require org admin/member permission depending on product policy. |
| Get Project | `GET /organizations/:orgId/projects/:projectId` | P0 - Critical | Loads one project. | Must validate org membership and project access. |
| Update Project | `PATCH /organizations/:orgId/projects/:projectId` | P1 - High | Updates project metadata/status/environment prefixes. | Should be admin-level and audited. |
| Delete Project | `DELETE /organizations/:orgId/projects/:projectId` | P1 - High | Deletes or soft-deletes project. | Owner/admin only; should protect against accidental deletion. |
| Archive Project | `POST /organizations/:orgId/projects/:projectId/archive` | P1 - High | Marks project archived. | Safer than delete for old projects. |
| Unarchive Project | `POST /organizations/:orgId/projects/:projectId/unarchive` | P1 - High | Restores archived project. | Should audit restoration. |
| Pause Project | `POST /organizations/:orgId/projects/:projectId/pause` | P1 - High | Temporarily pauses project. | Useful for operational shutdown without data loss. |
| Resume Project | `POST /organizations/:orgId/projects/:projectId/resume` | P1 - High | Reactivates paused project. | Should audit state change. |
| Get Project Stats | `GET /organizations/:orgId/projects/:projectId/stats` | P1 - High | Returns request/key counts. | Useful for dashboard and support diagnostics. |

### Project API Keys

| Route Name | Method and Path | Importance | Purpose | Enterprise Notes |
| --- | --- | --- | --- | --- |
| List Project API Keys | `GET /organizations/:orgId/projects/:projectId/api-keys` | P0 - Critical | Lists ingestion credentials for a project. | Must not expose raw key after creation. |
| Create Project API Key | `POST /organizations/:orgId/projects/:projectId/api-keys` | P0 - Critical | Creates SDK/server ingestion key. | Full key should be shown once; hash should be stored. |
| Get Project API Key Metadata | `GET /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId` | P1 - High | Reads safe key metadata. | Useful for admin UI and audits. |
| Update Project API Key | `PATCH /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId` | P1 - High | Updates name or expiry. | Should audit changes. |
| Delete Project API Key | `DELETE /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId` | P0 - Critical | Revokes ingestion key. | Critical incident response route. |
| Rotate Project API Key | `POST /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/rotate` | P0 - Critical | Replaces key while optionally allowing grace period. | Required for secure credential lifecycle. |
| Enable Project API Key | `POST /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/enable` | P1 - High | Re-enables disabled key. | Useful for support recovery. |
| Disable Project API Key | `POST /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/disable` | P0 - Critical | Non-destructive kill switch for key. | Should be fast and audited. |
| Get Project API Key Usage | `GET /organizations/:orgId/projects/:projectId/api-keys/:apiKeyId/usage` | P1 - High | Shows key usage and last-used time. | Useful for cleanup, compliance, and incident analysis. |

## Duplicate API Surface Analysis

### Overlap

There are two API-key route families:

| API Surface | Route Family | Current Behavior |
| --- | --- | --- |
| Organization API Keys | `/organizations/:orgId/api-keys` | Creates/list/revoke/rotate organization-level keys with optional environment binding and role. |
| Project API Keys | `/organizations/:orgId/projects/:projectId/api-keys` | Creates/list/get/update/delete/rotate/enable/disable/usage for project ingestion keys. |

### Why This Is a Problem

Having two generic "API key" systems creates product and engineering ambiguity:

- Customers may not know which key should be used in SDK setup.
- Frontend and Postman collections can drift between org and project key routes.
- Security review becomes harder because there are two credential types with different behaviors.
- Ingestion currently depends on project API-key validation and cache behavior, not the organization API-key routes.
- Organization API keys currently lack the richer operational surface that project keys have, such as usage, enable/disable, and metadata reads.

### Recommended Decision

Keep **Project API Keys** as the canonical ingestion key API.

Use this for SDK/server event ingestion:

```text
/organizations/:orgId/projects/:projectId/api-keys
```

Do not use this for ingestion:

```text
/organizations/:orgId/api-keys
```

If organization-wide automation is required later, rename the org-level keys to one of:

```text
/organizations/:orgId/service-tokens
/organizations/:orgId/management-tokens
```

Those tokens should have explicit scopes such as:

- `org:read`
- `members:read`
- `members:write`
- `projects:read`
- `projects:write`
- `audit:read`
- `billing:read`

This separation makes the API enterprise-grade because credential purpose is clear:

| Credential Type | Scope | Used By | Should Access Ingestion? |
| --- | --- | --- | --- |
| Project API Key | One project | SDKs, backend services sending events | Yes |
| Organization Service Token | Organization management APIs | Automation, CI, admin integrations | No, unless explicitly scoped |
| SCIM Token | User provisioning | Identity provider | No |

## Risk and Gap Assessment

| Risk | Severity | Impact | Recommendation |
| --- | --- | --- | --- |
| Project API-key access checks are commented out in parts of `ProjectsService`. | Critical | Users may list or create project keys without proper project permission checks. | Re-enable `requireProjectAccess` for list/create before production. |
| Debug logs exist in project routes for request body and API-key creation. | High | Sensitive payloads may appear in logs. | Remove `console.log("request.body", ...)` and `console.log("apikey", ...)`. |
| Organization API keys overlap with project API keys. | High | Product confusion and security review complexity. | Deprecate or rename org keys to service tokens. |
| Organization key rotation uses fixed/default values in service implementation. | Medium | Weak operational behavior and unclear metadata after rotation. | Require explicit name/role/env/expiry or preserve existing metadata. |
| Public utility routes may allow enumeration. | Medium | Slug or invitation validation routes can leak availability patterns. | Add rate limits and generic responses where appropriate. |
| Some enterprise features may be present before complete enforcement exists. | Medium | UI/API may imply SSO/SCIM/security maturity before end-to-end enforcement. | Gate exposure behind product readiness and tests. |

## Recommended Implementation Roadmap

### Phase 1: Security Stabilization

1. Re-enable permission checks for project API-key list/create.
2. Remove debug logging from project routes.
3. Add focused tests for P0 routes:
   - Organization create/list/get.
   - Member role update/removal.
   - Project create/get/update.
   - Project API-key create/list/disable/rotate/delete.
4. Verify every mutating P0/P1 route writes audit records.

### Phase 2: API Surface Cleanup

1. Decide whether organization-level API keys are needed.
2. If not needed, remove them from public docs and collections.
3. If needed, rename to service tokens or management tokens.
4. Add scopes, usage, last-used tracking, enable/disable, metadata reads, and clear audit events for service tokens.

### Phase 3: Enterprise Readiness

1. Harden SSO and SCIM flows with token/certificate handling rules.
2. Add rate limits for public validation routes.
3. Add export format and date filtering to audit logs.
4. Add manager/admin-facing documentation for roles, permissions, and route ownership.

## Recommended Final Route Ownership

| Capability | Recommended Module | Reason |
| --- | --- | --- |
| Tenant creation and profile | Organization | Tenant-level concern. |
| Members and roles | Organization | RBAC is organization-scoped. |
| Invitations | Organization | Invitation grants tenant access. |
| SSO and SCIM | Organization | Enterprise identity is tenant-scoped. |
| Audit logs and security events | Organization | Compliance is tenant-scoped. |
| Quota requests | Organization | Limits are usually tenant/account-level. |
| Project lifecycle | Project | Projects are child resources inside tenant. |
| SDK ingestion keys | Project | Events must map to one project. |
| API-key usage | Project | Usage is meaningful per project/key. |
| Organization automation token | Organization, renamed | Only if needed for management APIs, not ingestion. |

## Final Recommendation

The current route structure is close to an enterprise-grade model, but the API-key overlap should be resolved before this becomes a public contract.

The recommended product/API position is:

```text
Organization routes manage the tenant.
Project routes manage monitored applications.
Project API keys are the only ingestion keys.
Organization-level keys should be removed, hidden, or renamed to service tokens.
```

For management review, the most important action items are:

1. Approve Project API Keys as the canonical ingestion credential system.
2. Decide whether organization-wide service tokens are part of the product roadmap.
3. Prioritize security hardening on project API-key access checks and logging.
4. Keep all P0 routes production-grade with tests, permissions, audit logs, and clear response contracts.
