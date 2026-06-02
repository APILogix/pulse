# Auth Module — End-to-End Flows

**Version:** 2.6.1  
**Companion doc:** [`AUTH_MODULE.md`](./AUTH_MODULE.md) (routes, files, env vars)  
**Code:** `src/modules/auth/`, `src/modules/scim/`

This document explains **what happens step by step** when a user or system interacts with auth. Read it when onboarding, debugging a login issue, or designing a frontend integration.

---

## How this doc differs from `AUTH_MODULE.md`

| Document | Best for |
|----------|----------|
| **AUTH_MODULE.md** | Lookup: routes, tables, env vars, file map |
| **AUTH_MODULE_FLOWS.md** (this file) | Understanding sequences, decisions, and state |

---

## 1. Token and session model

Every successful sign-in creates **one row** in `user_sessions` and two tokens:

| Artifact | Where it lives | Lifetime | Purpose |
|----------|----------------|----------|---------|
| **Access JWT** | JSON response body | ~15 min | `Authorization: Bearer …` on API calls |
| **Refresh JWT** | httpOnly cookie `__Host-refresh_token` | 24h (or 30d with `remember_me`) | `POST /auth/sessions/refresh` only |

The access JWT’s `jti` claim equals the **session UUID**. That same ID is stored in Postgres.

```mermaid
stateDiagram-v2
  [*] --> Active: issueSessionForUser()
  Active --> Active: refreshAccessToken() rotates refresh hash
  Active --> Revoked: logout / revoke / policy / admin
  Revoked --> [*]: authenticate() rejects (DB status + LRU blacklist)
```

**After login**, the browser should:

1. Store the access token in memory (or secure storage).
2. Rely on the **cookie** for refresh — do not persist refresh token in `localStorage`.

---

## 2. Every authenticated API request

All routes using the `authenticate` middleware follow the same gate (`shared/middleware/auth.ts`):

```mermaid
sequenceDiagram
  participant C as Client
  participant M as authenticate middleware
  participant LRU as LRU caches
  participant DB as PostgreSQL

  C->>M: Authorization Bearer access_jwt
  M->>M: Verify JWT signature, type=access
  M->>LRU: Blacklisted session jti?
  alt blacklisted
    M-->>C: 401 SESSION_INVALID
  end
  M->>LRU: User-wide revoke cutoff vs token iat?
  alt revoked
    M-->>C: 401 SESSION_INVALID
  end
  M->>DB: findSessionById(jti) status=active?
  alt inactive or expired
    M-->>C: 401 SESSION_INVALID / EXPIRED
  end
  M->>DB: findUserById — active, not deleted?
  M->>M: Attach request.user
  M-->>C: Handler runs
```

**Step-up routes** add `requireStepUp`: the session must have a recent entry in `stepUpFreshnessCache` (after `POST /auth/mfa/verify` or WebAuthn step-up).

---

## 3. Registration and email verification

```mermaid
sequenceDiagram
  participant U as User
  participant API as POST /auth/register
  participant S as service.registerUser
  participant DB as Postgres
  participant E as auth-email / outbox

  U->>API: email, password, name, terms
  API->>S: validate password policy
  S->>DB: INSERT users (email_verified=false)
  S->>DB: INSERT email_verification token hash
  S->>E: Send verification link (FRONTEND_URL)
  API-->>U: 201 user profile (no session yet)

  Note over U,E: User clicks email link
  U->>API: GET /auth/verify-email?token=...
  API->>DB: consume token, set email_verified=true
  API-->>U: success message
```

**Important:** Unverified users who try password login get the same `INVALID_CREDENTIALS` response as a wrong password (anti-enumeration). A new verification email may be sent silently.

**Status check (no enumeration):** `GET /auth/users/me/verification` (authenticated) returns `{ email_verified, email_verified_at }`.

---

## 4. Password login (full path)

### 4.1 High-level decision

```mermaid
flowchart TD
  A[POST /auth/login] --> B{User exists?}
  B -->|no| Z[401 INVALID_CREDENTIALS]
  B -->|yes| C{Password OK?}
  C -->|no| Z
  C -->|yes| D{Org enforce_sso?}
  D -->|yes| E[403 SSO_REQUIRED]
  D -->|no| F{Org enforce_mfa and user mfa off?}
  F -->|yes| G[403 MFA_REQUIRED]
  F -->|no| H{User mfa_enabled?}
  H -->|no| I[issueSessionForUser]
  H -->|yes| J{Trusted device?}
  J -->|yes| I
  J -->|no| K[Return MFA challenge_id]
  I --> L[Set refresh cookie + access token]
  K --> M[Client completes MFA flow]
  M --> I
```

### 4.2 Sequence (with MFA)

```mermaid
sequenceDiagram
  participant U as User
  participant API as Auth API
  participant S as service.ts
  participant LRU as loginMfaChallengeCache
  participant DB as Postgres

  U->>API: POST /auth/login
  API->>S: loginWithEmailPassword()
  S->>DB: verify password, check lock/suspend
  S->>S: assertLoginAllowedByOrgPolicy()
  alt MFA required and not trusted
    S->>LRU: store challenge_id + user/device context
    API-->>U: mfa_required, challenge_id
    U->>API: POST /auth/login/mfa OR webauthn verify
    API->>S: verify code / passkey
    S->>LRU: delete challenge
  end
  S->>S: issueSessionForUser()
  S->>DB: INSERT user_sessions
  API-->>U: access_token + Set-Cookie refresh
```

### 4.3 Trusted device skip

If the user previously called `POST /auth/trusted-devices` (requires step-up) and the device fingerprint matches, MFA is skipped on password login for **30 days** (`trusted-device.service.ts`).

---

## 5. Choosing a sign-in method (frontend)

Before showing a login form, call:

`GET /auth/sso/discovery?email=user@company.com`

Response drives the UI:

| Field | Meaning |
|-------|---------|
| `oidc_login_ready` | Domain has OIDC IdP → show “Sign in with SSO” |
| `saml_login_ready` | Domain has SAML IdP → same button, backend picks SAML |
| `sso_available` | List of org providers (metadata for picker) |
| `social_login_ready` | Google/GitHub/Microsoft configured on server |
| `linked_social_providers` | Which social buttons this **email** can use (already linked) |
| `configured_link_providers` | Which providers exist globally (for “link account” settings) |

```mermaid
flowchart LR
  D[discovery] --> O[POST /auth/sso/login]
  D --> P[POST /auth/login]
  D --> SL[POST /auth/login/social/:provider]
  O --> OIDC[OIDC redirect]
  O --> SAML[SAML redirect]
```

---

## 6. Enterprise SSO — OIDC flow

**Start:** `POST /auth/sso/login` with `email` or `provider_id`  
**Service:** `sso.service.ts` (PKCE)

```mermaid
sequenceDiagram
  participant U as Browser
  participant API as API
  participant SSO as sso.service
  participant LRU as oidcLoginStateCache
  participant IdP as OIDC IdP

  U->>API: POST /auth/sso/login
  SSO->>LRU: state, code_verifier, provider, remember_me
  SSO-->>U: authorization_url
  U->>IdP: Redirect login
  IdP->>API: GET /auth/sso/callback?code&state
  API->>SSO: completeSsoCallback()
  SSO->>LRU: load + delete state
  SSO->>IdP: exchange code (PKCE)
  SSO->>SSO: resolveSsoUser() JIT if enabled
  SSO->>SSO: finalizeEnterpriseSsoLogin()
  Note over SSO: assertLoginAllowedByOrgPolicy, issueSession
  API-->>U: tokens + refresh cookie
```

**Callback URL (register at IdP):** `{API_PUBLIC_URL}/auth/sso/callback`

**JIT provisioning:** When `oidc_jit_provision` is true on the org provider, unknown emails create a user + org membership (`sso-provision.service.ts`). Domain must match provider `domain` when set.

---

## 7. Enterprise SSO — SAML flow

**Start:** Same `POST /auth/sso/login` — router delegates to `saml.service.ts` when `provider_type === 'saml'` or domain matches SAML provider.

```mermaid
sequenceDiagram
  participant U as Browser
  participant API as API
  participant SAML as saml.service
  participant LRU as samlLoginStateCache
  participant IdP as SAML IdP

  U->>API: POST /auth/sso/login
  SAML->>LRU: RelayState / request context
  SAML-->>U: HTTP Redirect to IdP SSO URL
  U->>IdP: Authenticate
  IdP->>API: POST /auth/saml/acs SAMLResponse
  API->>SAML: completeSamlAcs()
  SAML->>SAML: validate signature, InResponseTo (LRU)
  SAML->>SAML: resolveSsoUser() + JIT
  SAML->>SAML: finalizeEnterpriseSsoLogin(samlNameId, sessionIndex)
  API-->>U: tokens + refresh cookie
```

**SP metadata for IdP admin:** `GET /auth/saml/metadata` (requires `SAML_SP_CERTIFICATE`).

**Session fields for logout:** `saml_name_id`, `saml_session_index`, `sso_provider_id` on `user_sessions`.

---

## 8. Social login (passwordless)

**Prerequisite:** User already linked provider via identity linking (while logged in).

```mermaid
sequenceDiagram
  participant U as User
  participant API as API
  participant SL as social-login.service
  participant LRU as socialLoginStateCache
  participant OAuth as Google/GitHub/Microsoft

  U->>API: POST /auth/login/social/google
  SL->>LRU: state, PKCE verifier
  SL-->>U: authorization_url
  U->>OAuth: Consent
  OAuth->>API: GET /auth/login/social/callback
  SL->>LRU: load flow
  SL->>SL: exchangeOAuthCallback()
  SL->>DB: findLinkedIdentityByProviderSubject
  alt not linked
    API-->>U: 401 INVALID_CREDENTIALS
  end
  SL->>SL: issueSessionForUser(login_method=social_*)
  API-->>U: tokens + cookie
```

**Callback URL:** `{API_PUBLIC_URL}/auth/login/social/callback`

---

## 9. Identity linking (authenticated)

Used from account settings — **not** a login method by itself.

```mermaid
sequenceDiagram
  participant U as Logged-in user
  participant API as API
  participant IL as identity-link.service
  participant LRU as identityLinkStateCache

  U->>API: POST /auth/identity-providers/google/link (+ step-up)
  IL->>LRU: userId, verifier, state
  IL-->>U: authorization_url
  Note over U: OAuth completes
  U->>API: GET /auth/identity-providers/callback
  IL->>DB: INSERT user_linked_identities
  API-->>U: link confirmed
```

**Callback URL:** `{API_PUBLIC_URL}/auth/identity-providers/callback`

---

## 10. Session refresh and logout

### 10.1 Refresh

```mermaid
sequenceDiagram
  participant U as Client
  participant API as POST /auth/sessions/refresh
  participant S as refreshAccessToken

  U->>API: Cookie refresh_token (signed)
  API->>S: verify JWT, hash, find session
  S->>S: detect refresh reuse → revoke all if stolen
  S->>S: assertSessionAllowedByOrgPolicy (idle timeout)
  S->>DB: rotate refresh_token_hash
  API-->>U: new access_token + new cookie
```

### 10.2 Logout (password / OIDC / social session)

```mermaid
sequenceDiagram
  participant U as User
  participant API as POST /auth/logout
  participant S as service.logout

  U->>API: Bearer access + cookie
  alt SAML session
    API->>S: completeSamlLogoutForUser
    S->>DB: revoke session
    S->>LRU: blacklist access jti
    API-->>U: saml_logout_url → redirect to IdP
  else normal
    S->>DB: revoke session
    S->>LRU: blacklist
    API-->>U: saml_logout_url null
  end
  API->>API: Clear refresh cookie
```

### 10.3 SAML single logout (IdP-initiated)

IdP POSTs `SAMLRequest` to `POST /auth/saml/slo`:

1. Parse XML → `NameID`, `Issuer` (`saml-xml.util.ts`).
2. Resolve SAML provider (session or `entity_id`).
3. Validate request, revoke all sessions with that `saml_name_id`.
4. Return `SAMLResponse` redirect to IdP.

---

## 11. Step-up MFA (in-session sensitive actions)

Required for: password change, MFA disable, device removal, email change, account deletion export, identity link/unlink, etc.

```mermaid
flowchart TD
  A[Sensitive route] --> B{stepUpFresh on session?}
  B -->|yes| C[Allow handler]
  B -->|no| D[403 STEP_UP_REQUIRED]
  D --> E[POST /auth/mfa/challenge]
  E --> F[POST /auth/mfa/verify TOTP/email]
  F --> G[stepUpFreshnessCache set 5 min]
  G --> A
  H[Passkey primary device] --> I[POST /mfa/step-up/webauthn/options]
  I --> J[POST /mfa/step-up/webauthn/verify]
  J --> G
```

---

## 12. Organization policy enforcement

Policy is loaded from **all active org memberships**; strictest rule wins (`policy.service.ts`).

| Policy flag | When checked | Effect |
|-------------|--------------|--------|
| `enforce_sso` | After password login succeeds | Block if user has password (`SSO_REQUIRED`) |
| `enforce_mfa` | After primary auth | Block if MFA not enabled (`MFA_REQUIRED`) |
| `session_timeout_minutes` | On refresh | Revoke if `last_active_at` too old |

SSO logins (OIDC/SAML/social) call `assertLoginAllowedByOrgPolicy` before issuing a session.

---

## 13. SCIM provisioning (IdP → your app)

**Auth:** `Authorization: Bearer scim_…` (token from org admin UI)  
**Mounts:** `/scim/v2/:orgId/...` and `/auth/scim/v2/:orgId/...`

```mermaid
sequenceDiagram
  participant IdP as Okta/Azure AD
  participant API as SCIM API
  participant SCIM as scim.service
  participant DB as Postgres

  IdP->>API: POST /Users userName, externalId
  API->>SCIM: createUser()
  SCIM->>DB: createSsoJitUser if new email
  SCIM->>DB: organization_members + scim_user_mappings
  API-->>IdP: 201 SCIM User

  IdP->>API: PATCH /Users/:id active=false
  SCIM->>DB: deactivate org member

  IdP->>API: GET /Groups/admin
  SCIM-->>IdP: members = users with role admin
```

**Groups** are read-only views of org roles: `member`, `admin`, `owner`.

---

## 14. Account lifecycle flows

| Flow | Start | Confirm | Outcome |
|------|-------|---------|---------|
| Forgot password | `POST /auth/password/forgot` | `POST /auth/password/reset` | New password; all sessions revoked |
| Account unlock | `POST /auth/account/unlock/request` | `POST /auth/account/unlock/confirm` | Clears `locked_until` |
| Email change | `POST /auth/email/change/request` (+ step-up) | `POST /auth/email/change/confirm` | Updates email |
| Account deletion | `POST /auth/users/me/delete/request` | `POST /auth/users/me/delete/confirm` | Schedules deletion (7-day grace); worker purges |
| MFA recovery | `POST /auth/mfa/recovery/request` | Manual support | Security event + audit only |

Token confirm endpoints share `tokenConfirmRateLimit` (LRU per IP).

---

## 15. Ephemeral state (LRU) — what lives where

| Cache | Key | TTL | Used in flow |
|-------|-----|-----|----------------|
| `loginMfaChallengeCache` | challenge_id | 5 min | Password login MFA |
| `stepUpChallengeCache` | challenge_id | 5 min | Step-up verify |
| `stepUpFreshnessCache` | session_id | 5 min | After step-up success |
| `oidcLoginStateCache` | state | 10 min | OIDC SSO |
| `socialLoginStateCache` | state | 10 min | Social login |
| `identityLinkStateCache` | state | 10 min | Link account |
| `samlLoginStateCache` | state | 10 min | SAML login |
| `accessTokenBlacklistCache` | session_id | 15 min | Logout / revoke |
| `userRevokeCache` | user_id | 15 min | Password reset, etc. |

**Not in LRU:** refresh tokens, sessions, users — always Postgres.

---

## 16. Frontend integration checklist

1. **Discovery** — `GET /auth/sso/discovery?email=` on email blur.
2. **Login** — branch on `mfa_required`; store `challenge_id` only in memory.
3. **Tokens** — access in memory; refresh via cookie + `POST /auth/sessions/refresh` before expiry.
4. **Logout** — `POST /auth/logout`; if `saml_logout_url` present, redirect browser to IdP.
5. **401 handling** — on `SESSION_INVALID`, redirect to login; try one refresh if access expired.
6. **Step-up** — on `STEP_UP_REQUIRED`, run MFA challenge flow then retry original request.
7. **OAuth apps** — register API callback URLs from `oauth-callback.config.ts` (not SPA URL unless you proxy).

---

## 17. Debugging guide

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| MFA challenge “expired” after deploy | LRU lost on restart | User re-logs in; expected in multi-instance without sticky sessions |
| OIDC “invalid state” | Wrong node / expired state | Same as above; verify `API_PUBLIC_URL` |
| OAuth redirect mismatch | Callback URL not registered | IdP console vs `oauth-callback.config.ts` |
| SAML ACS error | Cert/issuer/ACS URL | IdP config vs `organization_sso_providers` |
| SSO works but password blocked | `enforce_sso` | `GET /auth/policy/effective` |
| Refresh fails immediately | Cookie path / Secure / domain | Browser devtools → Application → Cookies |
| SCIM 401 | Wrong org in URL or revoked token | `organization_scim_tokens` |

---

*For route tables and file index, see [`AUTH_MODULE.md`](./AUTH_MODULE.md). For release history, see `cursorauthchanges.md`.*
