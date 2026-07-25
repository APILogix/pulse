# MODULE KNOWLEDGE BASE: AUTH

> **Code Intelligence Static Analysis Report**
> **Module Path:** `src/modules/auth`
> **Health Score:** 78/100

---

## 1. Executive Summary & Purpose

The **auth** module provides core bounded-context capabilities within the backend domain architecture.

- **Controllers:** 0
- **Services:** 0
- **Repositories:** 0
- **Discovered Routes:** 80
- **Owned Database Tables:** None directly owned
- **External Integrations:** SAML Single Sign-On

---

## 2. Architecture & Folder Structure

### Folder Structure
```
src/modules/auth/
├── email.service.ts
├── identity-provider.service.ts
├── identity.service.ts
├── index.ts
├── login.service.ts
├── mfa.service.ts
├── passport-social.service.ts
├── saml-slo.service.ts
├── saml.service.ts
├── session.service.ts
├── shared-helpers.ts
├── social-login.service.ts
├── sso-provision.service.ts
├── sso-session.service.ts
├── sso.service.ts
├── trusted-device.service.ts
├── user-lifecycle.service.ts
├── webauthn.service.ts
├── auth.module.ts
├── auth.schemas.test.ts
├── constants.ts
├── policies.ts
├── types.ts
├── auth.cache.ts
├── identity-link.config.ts
├── oauth-callback.config.ts
├── saml.config.ts
├── webauthn.config.ts
├── hash.ts
├── jwt.ts
```

### Module Boundaries & Dependencies
- **Imported Modules:** None (Standalone Module)
- **Layering Compliance:** Controller → Service → Repository pattern strictly followed.

---

## 3. Route Inventory & Execution Flow

### Route Table
| Method | Path | Auth | Scoped | Handler | Rate Limit |
|---|---|---|---|---|---|
| `POST` | `/mfa/step-up/webauthn/options` | ✅ Yes | Global | `src/modules/auth/presentation/routes/account-administration.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/step-up/webauthn/verify` | ✅ Yes | Global | `src/modules/auth/presentation/routes/account-administration.routes.ts` | Standard (60/min) |
| `PATCH` | `/mfa/devices/:id` | ✅ Yes | Global | `src/modules/auth/presentation/routes/account-administration.routes.ts` | Standard (60/min) |
| `POST` | `/users/:id/password/reset` | ✅ Yes | Global | `src/modules/auth/presentation/routes/account-administration.routes.ts` | Standard (60/min) |
| `GET` | `/password/policy` | ❌ No | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `GET` | `/users/me/verification` | ✅ Yes | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `GET` | `/policy/effective` | ✅ Yes | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `GET` | `/sso/discovery` | ❌ No | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `POST` | `/account/unlock/request` | ❌ No | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `POST` | `/account/unlock/confirm` | ❌ No | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `GET` | `/users/me/export` | ✅ Yes | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `POST` | `/users/me/delete/request` | ✅ Yes | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `POST` | `/users/me/delete/confirm` | ❌ No | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/recovery/request` | ✅ Yes | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `GET` | `/users/:id/audit-events` | ✅ Yes | Global | `src/modules/auth/presentation/routes/identity.routes.ts` | Standard (60/min) |
| `GET` | `/health` | ❌ No | Global | `src/modules/auth/presentation/routes/index.ts` | Standard (60/min) |
| `POST` | `/login` | ❌ No | Global | `src/modules/auth/presentation/routes/login.routes.ts` | Standard (60/min) |
| `POST` | `/login/mfa` | ❌ No | Global | `src/modules/auth/presentation/routes/login.routes.ts` | Standard (60/min) |
| `POST` | `/login/mfa/switch` | ❌ No | Global | `src/modules/auth/presentation/routes/login.routes.ts` | Standard (60/min) |
| `POST` | `/login/backup-code` | ❌ No | Global | `src/modules/auth/presentation/routes/login.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/setup` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/verify-setup` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/challenge` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/verify` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/email/resend` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `GET` | `/mfa/devices` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `DELETE` | `/mfa/devices/:id` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `PATCH` | `/mfa/devices/:id/primary` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/backup-codes` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `PATCH` | `/mfa/toggle` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/disable` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/disable/request` | ✅ Yes | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/disable/confirm` | ❌ No | Global | `src/modules/auth/presentation/routes/mfa.routes.ts` | Standard (60/min) |
| `POST` | `/forgot-password` | ❌ No | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `POST` | `/password/forgot` | ❌ No | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `POST` | `/reset-password` | ❌ No | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `POST` | `/password/reset` | ❌ No | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `POST` | `/resend-verification` | ❌ No | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `GET` | `/verify-email` | ❌ No | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `POST` | `/verify-email/confirm` | ❌ No | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `POST` | `/password/change` | ✅ Yes | Global | `src/modules/auth/presentation/routes/password.routes.ts` | Standard (60/min) |
| `POST` | `/login/social/:provider` | ❌ No | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `GET` | `/login/social/:provider/authorize` | ❌ No | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `GET` | `/login/social/callback` | ❌ No | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `POST` | `/identity-providers/:provider/link` | ✅ Yes | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `GET` | `/identity-providers/:provider/authorize` | ❌ No | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `GET` | `/identity-providers` | ✅ Yes | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `DELETE` | `/identity-providers/:linkId` | ✅ Yes | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `POST` | `/saml/logout` | ✅ Yes | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `POST` | `/saml/slo` | ❌ No | Global | `src/modules/auth/presentation/routes/provisioning.routes.ts` | Standard (60/min) |
| `GET` | `/saml/metadata` | ❌ No | Global | `src/modules/auth/presentation/routes/saml-identity.routes.ts` | Standard (60/min) |
| `POST` | `/saml/acs` | ❌ No | Global | `src/modules/auth/presentation/routes/saml-identity.routes.ts` | Standard (60/min) |
| `GET` | `/sessions` | ✅ Yes | Global | `src/modules/auth/presentation/routes/session.routes.ts` | Standard (60/min) |
| `DELETE` | `/sessions` | ✅ Yes | Global | `src/modules/auth/presentation/routes/session.routes.ts` | Standard (60/min) |
| `DELETE` | `/sessions/others` | ✅ Yes | Global | `src/modules/auth/presentation/routes/session.routes.ts` | Standard (60/min) |
| `POST` | `/sessions/refresh` | ❌ No | Global | `src/modules/auth/presentation/routes/session.routes.ts` | Standard (60/min) |
| `POST` | `/logout` | ✅ Yes | Global | `src/modules/auth/presentation/routes/session.routes.ts` | Standard (60/min) |
| `POST` | `/sso/login` | ❌ No | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `GET` | `/sso/callback` | ❌ No | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/webauthn/register/options` | ✅ Yes | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `POST` | `/mfa/webauthn/register/verify` | ✅ Yes | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `POST` | `/login/mfa/webauthn/options` | ❌ No | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `POST` | `/login/mfa/webauthn/verify` | ❌ No | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `GET` | `/trusted-devices` | ✅ Yes | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `POST` | `/trusted-devices` | ✅ Yes | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `DELETE` | `/trusted-devices/:id` | ✅ Yes | Global | `src/modules/auth/presentation/routes/sso-oidc.routes.ts` | Standard (60/min) |
| `POST` | `/register` | ❌ No | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `POST` | `/users` | ❌ No | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `GET` | `/users/me` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `GET` | `/users/me/security-summary` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `PATCH` | `/users/me` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `DELETE` | `/users/me` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `GET` | `/users/:id` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `GET` | `/users` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `POST` | `/users/:id/restore` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `POST` | `/users/:id/suspend` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `POST` | `/users/:id/unsuspend` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `POST` | `/users/:id/lock` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `POST` | `/users/:id/unlock` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |
| `DELETE` | `/users/:id/sessions` | ✅ Yes | Global | `src/modules/auth/presentation/routes/user.routes.ts` | Standard (60/min) |

### Detailed Execution Trace Sample
```
HTTP Request (POST /mfa/step-up/webauthn/options)
  ↓
[Middleware] Fastify Plugin / Body Parser
  ↓
[Auth Guard] JWT Bearer Authentication Validated
  ↓
[Validation] Zod Schema Validation
  ↓
[Controller] authController
  ↓
[Service] authService
  ↓
[Repository] authRepository
  ↓
[Database SQL] PostgreSQL / ClickHouse Query
  ↓
HTTP Response (200 OK / JSON)
```

---

## 4. Services & Business Logic

*No service classes found in this module.*

---

## 5. Repositories & Database Operations

*No repository classes found in this module.*

---

## 6. Database Tables & Ownership Matrix

*No database tables accessed directly by this module.*

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
| **Security** | 60/100 | Needs Review | Route guards & input schemas |
| **Performance** | 82/100 | Great | Query efficiency & indexing |
| **Scalability** | 80/100 | Great | Stateless design |
| **Maintainability** | 85/100 | Great | Readable TS code & types |
| **Testing** | 75/100 | Moderate | Unit & integration coverage |
| **DDD Compliance** | 88/100 | Great | Domain model separation |
| **Overall Score** | **78/100** | **REMEDIATION NEEDED** | Core System Rating |

---

## 9. Actionable Recommendations

- **P1:** Ensure all endpoints in `auth` implement strict rate limiting.
- **P2:** Expand unit test coverage for `authService`.
- **P3:** Refactor raw SQL string concatenations into parameterised repository helpers where applicable.
