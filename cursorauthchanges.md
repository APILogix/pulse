# Cursor Auth Module Change Audit

**Backend version:** `2.6.1` (`package.json`, `VERSION`)  
**Developer guides:** [`docs/AUTH_MODULE.md`](docs/AUTH_MODULE.md) (reference) · [`docs/AUTH_MODULE_FLOWS.md`](docs/AUTH_MODULE_FLOWS.md) (flows)  
**Last updated:** 2026-06-01  
**Scope:** `api-monitoring-backend/src/modules/auth/*` and related auth infrastructure  
**Storage policy:** In-process **LRU only** for ephemeral auth state and auth rate limits (**no Redis** in the auth module).

---

## Version history

| Version | Summary |
| --- | --- |
| **2.6.1** | Audit fixes: health route, session detail/revoke-all, SAML SLO/metadata, API OAuth callbacks, SCIM Groups/PUT, rate limits, `docs/AUTH_MODULE.md` |
| **2.6.0** | Phase 7: SAML SLO, social passwordless login, SCIM 2.0 Users API, migration `014_auth_phase7` |
| **2.5.0** | Phase 6: SAML SP login (ACS + metadata), unified SSO router, OAuth identity linking (Google/GitHub/Microsoft), migration `013_auth_phase6` |
| **2.4.0** | Phase 5: OIDC JIT provisioning, WebAuthn step-up MFA, admin force password reset, MFA device rename, migration `012_auth_phase5` |
| **2.3.0** | Phase 4: OIDC SSO (PKCE), WebAuthn/passkeys, trusted devices, async email outbox, migration `011_auth_phase4` |
| **2.2.0** | Phase 3: email change, account unlock, delayed deletion, GDPR export, SSO discovery, org policy on login/refresh, MFA recovery intake, admin audit API, migration `010_auth_phase3` |
| **2.1.0** | Phase 2: admin lifecycle routes, security summary, LRU auth rate limits |
| **2.0.x** | Phase 0/1: backup-code fix, step-up MFA, email MFA, OTP cleanup, `remember_me` |

---

## 2.6.0 — Phase 7 (this release)

### Database

| Migration | Purpose |
| --- | --- |
| `014_auth_phase7.sql` | Session SSO columns (`sso_provider_id`, `login_method`, `saml_name_id`, `saml_session_index`); `scim_user_mappings` |

### New API routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/login/social/:provider` | Public | Start passwordless login via linked Google/GitHub/Microsoft |
| `GET` | `/auth/login/social/callback` | Public | Complete social login (issues session) |
| `POST` | `/auth/saml/logout` | User | SP-initiated SAML SLO redirect URL |
| `POST` | `/auth/saml/slo` | Public | SAML Single Logout ACS (IdP/SP POST) |
| `GET` | `/auth/scim/v2/:orgId/ServiceProviderConfig` | SCIM bearer | SCIM discovery |
| `GET` | `/auth/scim/v2/:orgId/Users` | SCIM bearer | List provisioned users |
| `POST` | `/auth/scim/v2/:orgId/Users` | SCIM bearer | Provision user + org membership |
| `PATCH` | `/auth/scim/v2/:orgId/Users/:id` | SCIM bearer | Update (active, name) |
| `DELETE` | `/auth/scim/v2/:orgId/Users/:id` | SCIM bearer | Deprovision (remove member + mapping) |

### Logout behavior

- `POST /auth/logout` now returns `{ saml_logout_url }` when the session was created via SAML (NameID stored on session).
- SP SLO URL: `SAML_SP_SLO_URL` or `{API_PUBLIC_URL}/auth/saml/slo`.

### SCIM

- Bearer tokens: same `scim_*` tokens created via `POST /organizations/:orgId/scim-tokens` (SHA-256 hash in `organization_scim_tokens`).
- External IDs stored in `scim_user_mappings`; users JIT-created with `createSsoJitUser` when email is new.

### Social login

- Requires prior account link (`user_linked_identities`).
- Enumeration-safe: unknown/unlinked subjects return `INVALID_CREDENTIALS` (401).
- Shared OAuth PKCE via `oauth-exchange.ts` + `socialLoginStateCache` (LRU).

### Error codes

`SOCIAL_LOGIN_FAILED`, `SCIM_UNAUTHORIZED`, `SCIM_NOT_FOUND`, `SCIM_CONFLICT`

### New modules

- `saml-slo.service.ts`, `social-login.service.ts`, `oauth-exchange.ts`
- `src/modules/scim/scim.service.ts`, `scim.middleware.ts`
- `provisioning.routes.ts`

---

## 2.5.0 — Phase 6

### Database

| Migration | Purpose |
| --- | --- |
| `013_auth_phase6.sql` | `user_linked_identities` for OAuth account linking |

### Dependencies

- `@node-saml/node-saml` — SAML 2.0 SP (signed assertions, InResponseTo LRU cache)

### New API routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/auth/saml/metadata` | Public | SP metadata XML for IdP configuration |
| `POST` | `/auth/saml/acs` | Public | SAML Assertion Consumer Service |
| `GET` | `/auth/identity-providers` | User | List linked Google/GitHub/Microsoft accounts |
| `POST` | `/auth/identity-providers/:provider/link` | User + step-up | Start OAuth link (`google` \| `github` \| `microsoft`) |
| `GET` | `/auth/identity-providers/callback` | Public | Complete OAuth link |
| `DELETE` | `/auth/identity-providers/:id` | User + step-up | Unlink external identity |

### SSO router (`POST /auth/sso/login`)

- Resolves provider by `provider_id` or email domain.
- Routes to **OIDC** (PKCE) or **SAML** (HTTP-Redirect) based on `organization_sso_providers.provider_type`.
- Shared JIT provisioning via `sso-provision.service.ts` (OIDC + SAML).

### SAML enterprise controls

- IdP cert + issuer + SSO URL from org provider row (`entity_id`, `sso_url`, `x509_certificate`).
- `validateInResponseTo: always` with LRU `samlRequestIdCache` (no Redis).
- Optional SP signing: `SAML_SP_PRIVATE_KEY`, `SAML_SP_CERTIFICATE`.
- ACS URL: `SAML_SP_ACS_URL` or `{API_PUBLIC_URL}/auth/saml/acs`.

### OAuth account linking (env-gated)

| Variable | Provider |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | Microsoft |
| `MICROSOFT_TENANT_ID` | Azure AD tenant (default `common`) |

Callback: `{API_PUBLIC_URL}/auth/identity-providers/callback` (register in each OAuth app).

### Discovery response additions

- `saml_login_ready`
- `configured_link_providers[]`

### Error codes

`SSO_NOT_CONFIGURED`, `SAML_NOT_CONFIGURED`, `SAML_RESPONSE_INVALID`, `IDENTITY_PROVIDER_NOT_CONFIGURED`, `IDENTITY_ALREADY_LINKED`, `IDENTITY_LINK_FAILED`

### New modules

| File | Role |
| --- | --- |
| `saml.service.ts` | SAML login + ACS + metadata |
| `sso-provision.service.ts` | Shared JIT + email extraction |
| `sso-session.service.ts` | Session issuance + audit after SSO |
| `identity-link.service.ts` | Social OAuth linking |
| `identity-link.config.ts` | Env-based provider config |
| `saml.config.ts` / `saml-request-cache.ts` | SP URLs + InResponseTo LRU |
| `saml-identity.routes.ts` | HTTP wiring |

---

## 2.4.0 — Phase 5

### Database

| Migration | Purpose |
| --- | --- |
| `012_auth_phase5.sql` | `organization_sso_providers.oidc_jit_provision`, `oidc_jit_default_role` |

### New API routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/mfa/step-up/webauthn/options` | User | Passkey options after `POST /auth/mfa/challenge` |
| `POST` | `/auth/mfa/step-up/webauthn/verify` | User | Complete step-up with passkey |
| `PATCH` | `/auth/mfa/devices/:id` | User | Rename MFA device |
| `POST` | `/auth/users/:id/password/reset` | Admin | Force reset email + revoke all sessions |

### Behavior

- **OIDC JIT**: When `oidc_jit_provision=true` on the org SSO provider, unknown IdP emails create an active user (email pre-verified), add org membership (`joined_method=sso_auto_provision`), default role from `oidc_jit_default_role` (default `member`). Email domain must match provider `domain` when set.
- **WebAuthn step-up**: Primary `hardware_key` devices use dedicated endpoints instead of 6-digit `POST /auth/mfa/verify`.
- **Admin force reset**: Revokes sessions, emails password-reset link, audits `user.admin_password_reset`.

### Error codes

`JIT_PROVISIONING_DISABLED`, `SSO_DOMAIN_MISMATCH`

---

## 2.3.0 — Phase 4

### Database

| Migration | Purpose |
| --- | --- |
| `011_auth_phase4.sql` | OIDC columns on `organization_sso_providers`, `user_trusted_devices`, `auth_email_outbox` |

### Dependencies

- `@simplewebauthn/server` — passkey registration and login MFA
- `openid-client` — OIDC authorization code + PKCE

### New API routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/sso/login` | Public | Start OIDC flow (`email` or `provider_id`) |
| `GET` | `/auth/sso/callback` | Public | Complete OIDC; sets refresh cookie |
| `POST` | `/auth/mfa/webauthn/register/options` | User | Passkey registration options |
| `POST` | `/auth/mfa/webauthn/register/verify` | User + step-up | Verify attestation; enable MFA |
| `POST` | `/auth/login/mfa/webauthn/options` | Public | Login MFA passkey options |
| `POST` | `/auth/login/mfa/webauthn/verify` | Public | Complete login with passkey |
| `GET` | `/auth/trusted-devices` | User | List active trusted devices |
| `POST` | `/auth/trusted-devices` | User + step-up | Trust current fingerprint (30 days) |
| `DELETE` | `/auth/trusted-devices/:id` | User | Revoke trusted device |

### Behavior

- **OIDC SSO**: PKCE state in LRU (`oidcLoginStateCache`); existing users only (no JIT provisioning).
- **SSO discovery**: `oidc_login_ready: true` when domain has a configured OIDC provider.
- **WebAuthn**: credentials stored as `hardware_key` MFA devices; login MFA uses dedicated endpoints when primary device is a passkey.
- **Trusted devices**: matching fingerprint skips MFA on password login; optional `trust_device` on login body.
- **Async email**: `AUTH_EMAIL_ASYNC=true` queues to `auth_email_outbox`; worker sends via `processAuthEmailOutbox()`.
- **Auth emails**: `service.ts` / `identity.service.ts` use `authEmail.send()` (sync or outbox).

### New modules

| File | Role |
| --- | --- |
| `sso.service.ts` | OIDC start + callback |
| `webauthn.service.ts` | Passkey register / login MFA |
| `trusted-device.service.ts` | Trust list / revoke / login skip |
| `sso-oidc.routes.ts` | HTTP wiring |
| `auth-email.ts` / `email-outbox.ts` | Email transport abstraction |
| `webauthn.config.ts` | RP ID / origin from env |

### Environment

| Variable | Purpose |
| --- | --- |
| `AUTH_EMAIL_ASYNC` | `true` → Postgres outbox instead of inline SMTP |
| `WEBAUTHN_RP_ID` | Relying party ID (default: hostname of `FRONTEND_URL`) |
| `WEBAUTHN_RP_NAME` | Display name (default: `APP_NAME`) |

### Error codes

`OIDC_NOT_CONFIGURED`, `OIDC_CALLBACK_INVALID`, `WEBAUTHN_CHALLENGE_INVALID`

### Deferred

- SAML login
- OIDC JIT user provisioning
- WebAuthn step-up for in-session actions

---

## 2.2.0 — Phase 3

### Database

| Migration | Purpose |
| --- | --- |
| `010_auth_phase3.sql` | `users.deletion_scheduled_at` for grace-period account deletion |

New email token purposes (application-level, `VARCHAR` column): `email_change`, `account_unlock`, `account_deletion`.

### New API routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/auth/password/policy` | Public | Password complexity rules for UI |
| `GET` | `/auth/policy/effective` | User | Merged org MFA/SSO/session timeout policy |
| `GET` | `/auth/sso/discovery?email=` | Public | SSO providers for email domain |
| `POST` | `/auth/account/unlock/request` | Public | Email unlock link for locked accounts |
| `POST` | `/auth/account/unlock/confirm` | Public | Consume unlock token |
| `POST` | `/auth/email/change/request` | User + step-up | Confirm new email via link |
| `POST` | `/auth/email/change/confirm` | Public | Apply new email |
| `GET` | `/auth/users/me/export` | User + step-up | GDPR-oriented JSON export |
| `POST` | `/auth/users/me/delete/request` | User + step-up | Email to confirm scheduled deletion |
| `POST` | `/auth/users/me/delete/confirm` | Public | Schedule deletion (7-day grace) |
| `POST` | `/auth/mfa/recovery/request` | User + step-up | Security event + audit for support |
| `GET` | `/auth/users/:id/audit-events` | Admin | Paginated audit log for user |

### Organization policy enforcement

- **`policy.service.ts`**: resolves strictest policy across active org memberships.
- **Login** (password path + after MFA): blocks if org `enforce_sso` (password users) or `enforce_mfa` (MFA not enabled).
- **Refresh**: re-checks policy; enforces org idle `session_timeout_minutes` against `last_active_at`.

Error codes: `SSO_REQUIRED`, `EMAIL_IN_USE`, `DELETION_ALREADY_SCHEDULED`.

### New modules

| File | Role |
| --- | --- |
| `identity.service.ts` | Email change, unlock, deletion, export, SSO discovery, MFA recovery |
| `identity.routes.ts` | HTTP wiring for Phase 3 routes |
| `policy.service.ts` | Password policy + effective org auth policy |
| `lru-rate-limit.ts` | In-process rate limits (bootstrap; no Redis) |

### Worker

- **`auth-cleanup.processor.ts`**: runs `processDueAccountDeletions()` after grace period elapses.

### Email templates

- `emailChangeConfirmTemplate`
- `accountUnlockTemplate`
- `accountDeletionConfirmTemplate`

---


## 2.1.0 — Phase 2

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/auth/users/me/security-summary` | Security posture |
| `POST` | `/auth/users/:id/unsuspend` | Admin unsuspend |
| `POST` | `/auth/users/:id/lock` | Admin lock |
| `POST` | `/auth/users/:id/unlock` | Admin unlock |
| `DELETE` | `/auth/users/:id/sessions` | Admin revoke all sessions |

LRU rate limits replaced Redis for auth-scoped throttling.

---

## 2.0.x — Phase 0 & 1

- Backup codes: **20 hex** characters end-to-end.
- Email verification links use `FRONTEND_URL`.
- `remember_me`: 30-day refresh TTL.
- Step-up MFA on sensitive routes.
- Email MFA OTP cleanup in hourly worker.

---

## Operational checklist

1. Run migration: `npm run db:migrate` (includes `010`–`013` auth migrations).
2. For SAML: configure org provider (`provider_type=saml`) and register SP metadata from `GET /auth/saml/metadata`.
3. For social linking: set OAuth client env vars and register callback URL in each provider console.
2. Set `FRONTEND_URL` for email deep links (`/security/email/confirm`, `/account/unlock`, `/account/delete/confirm`).
3. Run auth cleanup worker for scheduled deletions.
4. Single API instance recommended while using LRU-only MFA/rate-limit state.

---

## Maintainer references

- `docs/auth-module-enterprise-route-audit.md`
- `docs/auth-mfa-email-smtp.md`
