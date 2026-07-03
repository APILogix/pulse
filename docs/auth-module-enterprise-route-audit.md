# Auth Module Enterprise Route Audit

## Scope

Reviewed source files:

- `src/modules/auth/routes.ts`
- `src/modules/auth/service.ts`
- `src/modules/auth/repository.ts`
- `src/modules/auth/types.ts`
- `src/modules/auth/auth.module.ts`
- `src/shared/middleware/auth.ts`

Mounted prefix: `/auth`.

This review evaluates the current auth module as an enterprise SaaS authentication surface: route coverage, strengths, weaknesses, and missing routes needed before treating it as a production-grade security boundary.

## Executive Summary

The auth module already has a strong foundation. It covers email/password registration, login, email verification, password reset, password change, TOTP MFA setup, MFA challenge verification, backup codes, session refresh, session revocation, logout, current-user profile management, and admin user listing/suspension/restore.

However, it is not yet enterprise complete. The biggest gaps are organization-aware policy enforcement, SSO/SAML/OIDC login routes, WebAuthn/passkey support, verified device/trusted-device management, account unlock workflows, admin user unsuspend routes, audit-event visibility, stronger validation on a few endpoints, and complete test coverage for every route.

Highest-priority hardening:

1. Remove debug `console.log` statements from auth routes/services.
2. Add request schemas and rate limits to every sensitive route.
3. Enforce organization settings such as `enforceMfa`, `enforceSso`, and `sessionTimeoutMinutes` during login and refresh.
4. Add missing enterprise identity routes: SSO login/callback, WebAuthn/passkeys, account unlock, revoke all user sessions as admin, and admin unsuspend.
5. Add route-level integration tests for every auth route, including negative authorization cases.

## Existing Route Catalog

### Health

| Route | Status | Notes |
| --- | --- | --- |
| `GET /auth/health` | Present | Basic module health route. Should not expose internals. |

### Registration and Email Verification

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `POST /auth/register` | Present | P0 | Creates an email/password user and sends verification email. Rate-limited. |
| `POST /auth/users` | Present alias | P2 | Backward-compatible registration alias. Should be deprecated in public docs to avoid ambiguity. |
| `POST /auth/resend-verification` | Present | P1 | Uses a generic response pattern. Rate-limited. |
| `GET /auth/verify-email` | Present | P0 | Verifies token from email. Rate-limited. |

Good:

- Registration stores email verification token hashes, not raw tokens.
- Verification and reset tokens are purpose-separated before hashing.
- Email delivery failures are explicit domain errors.

Bad / risk:

- New users are created with `status = 'active'` while `email_verified = false`. The login service may block unverified users, but enterprise systems usually model this as `pending_verification` or equivalent.
- `POST /auth/users` is confusing because authenticated admin user management also lives under `/auth/users`.
- No route to change email address and verify the new email.

Missing routes:

- `POST /auth/email/verification/status` or `GET /auth/users/me/verification` - safe verification status for frontend polling.

### Login and Credential Flow

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `POST /auth/login` | Present | P0 | Password login. Returns MFA challenge when required. |
| `POST /auth/login/mfa` | Present | P0 | Completes login MFA challenge and issues session. |

Good:

- MFA-required login does not issue tokens until the challenge succeeds.
- Refresh token is set as an httpOnly cookie instead of being returned in the response body.
- Service uses hashed refresh tokens in the session store.
- Account state checks include deleted, suspended, and locked users.

Bad / risk:

- Login route itself lacks a route-level rate-limit preHandler, relying mainly on service-level rate limiting. Enterprise systems should usually have both route and identity/IP level controls.
- Debug logs remain in the service/route path.
- No SSO discovery route, SSO redirect route, or SSO callback route.
- No explicit CAPTCHA/risk challenge hook for repeated login failures.

Missing routes:

- `GET /auth/sso/discovery?email=...` - maps email/domain to SSO provider policy.
- `POST /auth/sso/login` - starts SAML/OIDC login for a provider or domain.
- `GET|POST /auth/sso/callback/:providerId` - handles IdP callback.
- `POST /auth/login/risk-challenge` - optional adaptive challenge completion.
- `POST /auth/account/unlock/request` - starts account unlock flow.
- `POST /auth/account/unlock/confirm` - confirms unlock token.

### Password Management

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `POST /auth/forgot-password` | Present | P0 | Sends reset email with generic response. Rate-limited. |
| `POST /auth/password/forgot` | Present alias | P2 | Backward-compatible alias. |
| `POST /auth/reset-password` | Present | P0 | Resets password by token. Rate-limited. |
| `POST /auth/password/reset` | Present alias | P2 | Backward-compatible alias. |
| `POST /auth/password/change` | Present | P0 | Authenticated password change. |

Good:

- Strong password schema enforces length, uppercase, lowercase, number, and special character.
- Password reuse is checked against password history.
- Password reset responses avoid email enumeration.
- Password changes revoke existing sessions in service logic.

Bad / risk:

- `POST /auth/password/change` has no route-level rate limit.
- There is a leftover `console.log("password complte")`.
- Password policy is hard-coded. Enterprise tenants often need configurable minimum length, rotation policy, and breached-password checks.

Missing routes:

- `GET /auth/password/policy` - returns effective policy for current org/user context.
- `POST /auth/password/validate` - validates candidate password without saving, useful for UI and admin flows.
- `POST /auth/password/expire/:userId` - admin forces password change at next login.

### Current User Profile

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /auth/users/me` | Present | P0 | Returns safe current-user profile. |
| `PATCH /auth/users/me` | Present | P1 | Updates profile fields. Rate-limited. |
| `DELETE /auth/users/me` | Present | P1 | Soft-deletes current user. Rate-limited. |

Good:

- Response DTO excludes password and sensitive session/token fields.
- Soft delete requires password for password users.

Bad / risk:

- Delete-current-user should usually require fresh MFA or recent re-authentication.
- No route exposes the user's global organization memberships from auth perspective; this currently belongs to org module, which is acceptable, but auth and org onboarding flows need a clear contract.
- No privacy/data export routes.

Missing routes:

- `POST /auth/users/me/re-authenticate` - confirms password/MFA for sensitive actions.
- `GET /auth/users/me/security-summary` - returns MFA, sessions, password age, verified email, SSO link status.
- `GET /auth/users/me/export` - GDPR/enterprise data export.
- `POST /auth/users/me/delete/request` - delayed deletion flow for safer account removal.

### Admin User Management

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /auth/users` | Present | P1 | Admin list with status/search/limit/offset. |
| `GET /auth/users/:id` | Present | P1 | Admin read by ID. |
| `POST /auth/users/:id/restore` | Present | P1 | Restores deleted user. |
| `POST /auth/users/:id/suspend` | Present | P1 | Suspends user. |

Good:

- Admin routes use `authenticate` and `requireAdmin`.
- Restore and suspend actions audit sensitive changes in service logic.

Bad / risk:

- There is no matching admin unsuspend/reactivate route.
- Suspend body is not validated with Zod.
- Admin list uses offset pagination. Cursor pagination is preferable for large enterprise user tables.
- Admin global user management is separate from organization membership management. That is valid, but docs should make the distinction explicit: auth admin controls global user state; org admin controls tenant membership.

Missing routes:

- `POST /auth/users/:id/unsuspend` - restores suspended user.
- `POST /auth/users/:id/lock` - explicitly locks a user account.
- `POST /auth/users/:id/unlock` - unlocks a user account.
- `DELETE /auth/users/:id/sessions` - admin revokes all sessions for a user.
- `POST /auth/users/:id/password/reset` - admin-initiated reset email.
- `GET /auth/users/:id/audit-events` - admin support/audit visibility.

### MFA

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `POST /auth/mfa/setup` | Present | P0 | Starts TOTP setup. SMS/email return not implemented. |
| `POST /auth/mfa/verify-setup` | Present | P0 | Verifies and activates device. Rate-limited. |
| `POST /auth/mfa/challenge` | Present | P0 | Creates MFA challenge. |
| `POST /auth/mfa/verify` | Present | P0 | Verifies challenge. Rate-limited. |
| `GET /auth/mfa/devices` | Present | P1 | Lists devices. |
| `DELETE /auth/mfa/devices/:id` | Present | P1 | Removes device. Rate-limited. |
| `PATCH /auth/mfa/devices/:id/primary` | Present | P1 | Sets primary device. |
| `POST /auth/mfa/backup-codes` | Present | P1 | Regenerates backup codes. Rate-limited daily. |
| `POST /auth/mfa/backup-codes/verify` | Present | P0 | Verifies backup code. Rate-limited. |
| `PATCH /auth/mfa/toggle` | Present | P1 | Enables/disables MFA idempotently. Rate-limited. |
| `POST /auth/mfa/disable` | Present | P1 | Disables MFA. |

Good:

- TOTP secret is encrypted at rest.
- Backup codes are generated as one-time values and stored hashed.
- Setup flow keeps backup-code hashes in temporary Redis state until verification.
- Last-device removal requires MFA code.

Bad / risk:

- MFA setup schema allows `sms` and `email`, but service returns `501`. This should not be exposed as supported.
- No WebAuthn/passkey support despite type enum including `hardware_key`.
- `POST /auth/mfa/disable` has no route-level rate limit.
- Some MFA routes accept unvalidated ad hoc bodies.
- `POST /auth/mfa/verify` returns only `{ user_id, mfa_verified: true }`; it does not clearly update session MFA state for step-up flows.
- Backup-code verify takes `user_id` in body and is unauthenticated. That may be needed for login recovery, but it must be clearly bound to an MFA challenge to avoid user-ID probing.

Missing routes:

- `POST /auth/mfa/webauthn/register/options`
- `POST /auth/mfa/webauthn/register/verify`
- `POST /auth/mfa/webauthn/authenticate/options`
- `POST /auth/mfa/webauthn/authenticate/verify`
- `POST /auth/mfa/recovery/start` - starts MFA recovery with strict audit/support flow.
- `POST /auth/mfa/recovery/complete`
- `PATCH /auth/mfa/devices/:id` - rename device.
- `GET /auth/mfa/policy` - effective user/org MFA policy.
- `POST /auth/mfa/step-up` - creates challenge for sensitive in-session operations.
- `POST /auth/mfa/step-up/verify` - marks current session as recently MFA verified.

### Sessions

| Route | Status | Enterprise Importance | Notes |
| --- | --- | --- | --- |
| `GET /auth/sessions` | Present | P0 | Lists active sessions. |
| `DELETE /auth/sessions/:id` | Present | P0 | Revokes one session, except current session. |
| `DELETE /auth/sessions/others` | Present | P0 | Revokes all other sessions. |
| `POST /auth/sessions/refresh` | Present | P0 | Rotates refresh token and issues access token. |
| `POST /auth/logout` | Present | P0 | Revokes current session and clears cookie. |

Good:

- Refresh token rotation is implemented.
- Refresh tokens are cookie-based and hashed in storage.
- Current session cannot be revoked by the single-session revoke route.
- Logout blacklists current access token by session ID.

Bad / risk:

- Refresh route includes debug `console.log` output.
- Refresh route is not rate-limited.
- Refresh cookie path is `/auth`; confirm this intentionally covers `/auth/sessions/refresh` and `/auth/logout`.
- There is no admin route to revoke all sessions for a target user.
- Session timeout currently appears auth-global, not org-policy-aware.

Missing routes:

- `DELETE /auth/sessions` - revoke all current user's sessions including current one.
- `GET /auth/sessions/:id` - session detail for security page.
- `POST /auth/sessions/:id/trust` - mark device trusted, if product supports trusted devices.
- `DELETE /auth/sessions/trusted-devices/:id` - remove trusted device.
- `DELETE /auth/admin/users/:userId/sessions` - admin/support revokes target user's sessions.

## Enterprise Missing Route Checklist

### P0 Before Enterprise Launch

| Missing Capability | Suggested Route |
| --- | --- |
| SSO discovery | `GET /auth/sso/discovery` |
| SSO login start | `POST /auth/sso/login` |
| SSO callback | `GET|POST /auth/sso/callback/:providerId` |
| Organization-aware auth policy | `GET /auth/policy/effective` |
| Step-up MFA for sensitive actions | `POST /auth/mfa/step-up`, `POST /auth/mfa/step-up/verify` |
| Admin revoke user sessions | `DELETE /auth/admin/users/:userId/sessions` |
| Account unlock | `POST /auth/account/unlock/request`, `POST /auth/account/unlock/confirm` |
| Admin unsuspend user | `POST /auth/users/:id/unsuspend` |

### P1 Enterprise Hardening

| Missing Capability | Suggested Route |
| --- | --- |
| WebAuthn/passkeys | `/auth/mfa/webauthn/*` |
| Trusted devices | `/auth/trusted-devices/*` |
| Security summary | `GET /auth/users/me/security-summary` |
| Admin force password reset | `POST /auth/users/:id/password/reset` |
| Admin lock/unlock | `POST /auth/users/:id/lock`, `POST /auth/users/:id/unlock` |
| Auth audit visibility | `GET /auth/users/:id/audit-events` |

### P2 Product Maturity

| Missing Capability | Suggested Route |
| --- | --- |
| GDPR export | `GET /auth/users/me/export` |
| Delayed deletion request | `POST /auth/users/me/delete/request` |
| Password policy introspection | `GET /auth/password/policy` |
| OAuth account linking | `/auth/identity-providers/*` |

## Implementation Quality Assessment

### Good Engineering Decisions

- Clear route/service/repository split.
- Zod schemas for most request bodies.
- Domain-specific `AuthError` with structured error codes.
- Hashed email lookup for login path.
- Hashed refresh tokens and hashed one-time email/reset tokens.
- Refresh token delivered as httpOnly cookie.
- TOTP secret encrypted at rest.
- Password history prevents simple password reuse.
- Redis-backed MFA and rate-limit state.
- Audit logging exists for major lifecycle events.

### Weaknesses to Fix

- Several sensitive routes use ad hoc body casts instead of Zod schemas.
- Debug `console.log` statements remain in security-sensitive code paths.
- `requireMFA` is imported but not used on sensitive routes.
- MFA methods are advertised in schema/types before being implemented.
- Route aliases increase API surface and should be documented as deprecated.
- Admin user lifecycle is incomplete: no unsuspend, lock, unlock, revoke sessions, force reset.
- Auth module does not yet consume organization security settings.
- Test coverage is not route-complete.

## Recommended Roadmap

### Phase 1: Stabilize Current Routes

1. Remove debug logs from auth route/service files.
2. Add Zod schemas for suspend, MFA disable, backup-code generation, and any currently cast request bodies.
3. Add route-level rate limits to login, login MFA, password change, MFA disable, session refresh, and session revoke flows.
4. Add tests for every existing route's success, validation failure, unauthenticated, unauthorized, and rate-limited behavior.
5. Mark backward-compatible aliases as deprecated in API docs.

### Phase 2: Enterprise Security Controls

1. Integrate org settings into login/session refresh:
   - `enforceMfa`
   - `enforceSso`
   - `sessionTimeoutMinutes`
   - allowed identity providers
2. Add SSO discovery/login/callback routes.
3. Add step-up MFA and recent-auth enforcement for destructive operations.
4. Add admin user unsuspend, lock, unlock, force reset, and revoke-session routes.

### Phase 3: Modern Identity

1. Add WebAuthn/passkey registration and authentication.
2. Add trusted-device management if desired.
3. Add account recovery workflows for lost MFA.
4. Add auth audit/security-event read APIs for enterprise support and compliance.

## Final Recommendation

Keep the current auth module structure. It is a reasonable base. Do not call it enterprise-grade yet.

The module becomes enterprise-grade when every route has validation, rate limits, audit behavior, tests, and clear policy enforcement, and when auth is connected to organization-level identity policy. The biggest missing product capability is SSO plus org-aware MFA/session enforcement.
