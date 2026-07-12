# Authentication enterprise audit

Audit date: 2026-07-11. Scope: `pulse` auth module and `pulsiv_fe` authentication UI.

## Architecture

```text
SPA -> /auth/login or /auth/login/social/:provider -> auth service -> PostgreSQL
                                                         |                 |
                                                         v                 v
                                                Google / GitHub       users, identities,
                                                   callback          sessions, audit logs
                                                         |
                                                         v
                                                refresh cookie + SPA callback
                                                         |
                                                         v
                                             access JWT (memory) + protected APIs
```

## Implemented flows

| Flow | Backend path | SPA outcome | Status |
| --- | --- | --- | --- |
| Password login | `POST /auth/login`, MFA variants | dashboard after profile fetch | Pass |
| Registration | `POST /auth/register` | verification flow | Pass |
| Password reset and verification | password routes | dedicated public pages | Pass |
| Social login | social start -> provider -> callback | `/auth/callback` | Pass, Google/GitHub |
| Link identity | authenticated link start -> provider -> callback | `/settings/linked-accounts` | Pass |
| Unlink identity | `DELETE /auth/identity-providers/:linkId` | refresh linked-account query | Pass; hard delete |
| Session refresh | `POST /auth/sessions/refresh` | access JWT replacement | Pass after rotation fix |

## OAuth and identity-linking controls

| Control | Status | Notes |
| --- | --- | --- |
| State validation and one-time consumption | Pass | LRU-backed state expires after 10 minutes. |
| Provider subject uniqueness | Pass | Database uniqueness plus service lookup. |
| User/provider uniqueness | Pass | Database uniqueness plus service lookup. |
| Matching email for linking | Pass | Mismatch returns to Linked Accounts with a recovery message. |
| Atomic identity/avatar write | Pass | Identity, metadata, last-used time and provider avatar share one transaction. |
| Existing user without link | Pass | Social sign-in returns a frontend error; no user/link write occurs. |
| Provider cancellation/error | Pass | Callback redirects to the relevant SPA page. |
| Google/GitHub profile avatar | Pass | Stored in `users.avatar_url` after successful social account creation/linking. |
| OAuth user email verification | Fixed | OAuth-created users receive `email_verified = true` and `email_verified_at = NOW()` in the shared repository. |
| Microsoft button | Fixed | Removed from SPA because backend has no Microsoft provider. |
| OAuth PKCE for Google/GitHub | Missing | Passport strategies use authorization code + client secret but do not implement PKCE. Add provider-specific PKCE before supporting public/native clients. |
| Verified-email assertion | Needs verification | Ensure provider adapters explicitly inspect the provider's verified-email claim before treating email as verified. |

## Session, cookie and JWT controls

| Control | Status | Notes |
| --- | --- | --- |
| Access/refresh secret separation | Pass | Startup rejects reused crypto secrets. |
| JWT issuer, audience, algorithm, expiry | Pass | HS256 with explicit issuer/audience/type validation. |
| Session DB source of truth | Pass | Middleware checks active session, expiry and user state. |
| Refresh token hashing and rotation | Pass | Current and previous token hashes are persisted. |
| Concurrent-refresh safety | Fixed | Retry-grace responses no longer overwrite the newly rotated browser cookie. |
| Cookie transport | Pass | HTTP uses Lax/non-secure local cookie; HTTPS uses `__Host-`, Secure and SameSite=None. |
| Refresh CSRF protection | Fixed | Refresh now requires `X-CSRF-Request: 1`; trusted SPA sends it. |
| Credentialed CORS | Fixed | Replaced origin reflection with the configured allowlist. |
| Multi-instance OAuth state | Missing | In-process LRU state needs sticky sessions or Redis before multi-instance deployment. |

## Frontend redirect and state audit

| Outcome | Redirect/UI |
| --- | --- |
| Social success | `/auth/callback` -> session refresh -> dashboard |
| Social provider denied/cancelled | `/auth/callback?error=...` -> visible recovery UI |
| Existing password account, unlinked provider | callback error page with sign-in action |
| Link success | `/settings/linked-accounts?linked=provider` -> success toast and refreshed list |
| Link email conflict/account disabled/provider conflict | `/settings/linked-accounts?error=...` -> error toast |
| Last login method unlink attempt | inline API error toast |
| Refresh failure | sign-in route through refresh interceptor |

## Route audit summary

The auth route families are `login.routes`, `user.routes`, `password.routes`, `mfa.routes`, `session.routes`, `identity.routes`, `provisioning.routes`, `sso-oidc.routes`, `saml-identity.routes` and `account-administration.routes`. Their Zod validation, route rate limits, middleware protection, service delegation and audit logging should remain mandatory review gates for new endpoints.

## Remaining production work, ordered by priority

1. **High — move OAuth/MFA/step-up state from process-local LRU to Redis or require load-balancer affinity.** A restart or a callback routed to another node invalidates in-flight OAuth state.
2. **High — add explicit verified-email enforcement in provider adapters.** Do not infer verification merely from the presence of an email address.
3. **High — implement PKCE for Google/GitHub authorization-code flows.** Store verifier with the OAuth state and require it in token exchange.
4. **Medium — add E2E browser tests** for callback cookies on local HTTP and production HTTPS/cross-origin SPA deployments, duplicate callbacks, cancellation, and concurrent refresh.
5. **Medium — add dedicated UI pages** for account disabled/deleted and a session-expired recovery state rather than only generic toasts.
6. **Low — add a provider-capability endpoint** so the SPA renders only configured social providers dynamically.

## Readiness score

| Area | Score / 10 |
| --- | --- |
| Security | 7 |
| Reliability | 7 |
| UX | 7 |
| Maintainability | 7 |
| Overall authentication maturity | 7 |

The system is suitable for a controlled single-instance deployment after the implemented fixes. Complete the three high-priority items before claiming multi-instance enterprise readiness.
