# Enterprise Auth Implementation Plan

## Objective

Bring the backend to an enterprise-grade baseline without introducing Redis in the initial stage. The system should rely on:

- Postgres for durable and shared state
- In-memory LRU caches only for short-lived single-process state
- explicit schema ownership and canonical naming
- deterministic migration bootstrap and upgrade paths

## Non-Goals for Phase 1

- No Redis adoption for auth, SSO, MFA, or rate limiting
- No broad feature expansion until schema and security issues are corrected
- No multi-service split before the auth runtime is stable

## Canonical Naming Standard

### Directory Naming

- Preferred canonical SQL directory: `src/db/postgres/canonical_migrations`
- Legacy compatibility directory: `src/db/postgres/migrations2`

### Migration File Naming

Use:

`NNN_domain_action_subject.up.sql`

Examples:

- `001_auth_create_core_tables.up.sql`
- `002_auth_create_notification_connectors.up.sql`
- `006_org_create_core_tables.up.sql`

Avoid:

- version suffixes like `_v2`
- vague names like `add_module`
- mixed domain naming inside one filename

### Table Naming

Use:

- plural snake_case table names
- domain prefixes only where needed to avoid ambiguity
- explicit relationship names

Examples:

- `users`
- `user_sessions`
- `user_mfa_devices`
- `organization_members`
- `organization_sso_providers`

Avoid:

- temporary names
- versioned table names
- unclear “compat” names in canonical schema unless they are explicitly legacy

## Delivery Phases

### Phase 0: Naming and Migration Governance

1. Introduce `canonical_migrations` as the target source-of-truth directory.
2. Keep `migrations2` as a temporary compatibility alias during transition.
3. Update the migration runner to resolve the canonical directory first and fall back to the legacy one.
4. Add a migration bootstrap test against an empty database.
5. Rename migration files to the canonical naming convention only after bootstrap tests pass.

### Phase 1: Critical Schema and Auth Runtime Fixes

1. Fix the fresh-bootstrap dependency break where auth creates tables that reference organizations before the organizations schema exists.
2. Fix the OIDC schema/code mismatch by adding the missing OIDC provider columns.
3. Fix the generated-column write bug in `updateUserEmail`.
4. Restore strict credentialed CORS allowlisting.
5. Reinstate a global rate-limit backstop.

### Phase 2: Durable Workflow Hardening

1. Make auth email outbox processing transaction-safe for multiple workers.
2. Keep durable queue and outbox state in Postgres.
3. Keep ephemeral auth state in process only where single-node behavior is acceptable.
4. Document each in-memory cache with failure mode, TTL, and eviction impact.

### Phase 3: Enterprise-Grade Auth Refactor

1. Split the auth service into bounded service files:
   - `registration`
   - `login`
   - `sessions`
   - `password`
   - `mfa`
   - `email_flows`
   - `sso`
2. Split the repository by aggregate/table family.
3. Remove `SELECT *` on hot paths.
4. Add targeted integration tests for:
   - register
   - verify email
   - login
   - refresh
   - logout
   - password reset
   - MFA enable/disable
   - OIDC callback

## Redis-Free Enterprise Pattern

### Approved in Phase 1

- In-memory LRU for:
  - MFA challenges
  - OIDC/SAML login state
  - per-process revocation hints
  - per-process auth route limits
- Postgres for:
  - sessions
  - refresh rotation state
  - audit logs
  - email outbox
  - security events
  - durable cleanup work

### Rules

1. If loss of state would break security or correctness across processes, store it in Postgres.
2. If state only improves latency or UX and is safe to lose, it may stay in-memory.
3. Every in-memory cache must have:
   - bounded size
   - bounded TTL
   - explicit fallback path
   - documented multi-instance limitation

## Immediate Work Queue

1. Make migration-path naming canonical and deterministic.
2. Repair schema bootstrap blockers.
3. Repair OIDC runtime breakages.
4. Close CORS and rate-limit exposure.
5. Harden outbox concurrency.

## Success Criteria

- Fresh database bootstrap succeeds from the canonical migration chain.
- Email change, OIDC login, refresh rotation, and password reset all pass integration tests.
- Auth remains Redis-free.
- Canonical migration naming is documented and enforced by tooling.
