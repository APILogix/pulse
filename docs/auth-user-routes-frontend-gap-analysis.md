# Auth User Routes Frontend Gap Analysis

This document filters the auth backend down to **user-facing routes only** and compares them against the current frontend in `pulse_fe`.

Scope:

- include self-service user auth and account-security routes
- exclude admin-only routes
- exclude backend-only callback endpoints that users do not navigate to directly unless they require a frontend landing page

## Implementation Status

Implemented in this pass:

- account deletion request is exposed as a destructive dialog inside `/settings/privacy`
- account deletion email confirmation lands on `/account/delete/confirm`
- trusted devices are exposed at `/settings/trusted-devices`
- MFA recovery is exposed at `/settings/mfa-recovery`
- account data export is exposed at `/settings/privacy`
- social login buttons now call `POST /auth/login/social/:provider`
- OAuth/OIDC/SAML callbacks now redirect to the SPA callback page after setting the refresh cookie
- SPA callback completion is handled by `/auth/callback`
- security center links were replaced with valid settings routes
- security center now consumes `GET /auth/users/me/security-summary`
- stale frontend API methods for removed email-change and user-managed identity-provider routes were removed

---

## 1. User-Facing Backend Routes

## Public auth routes

- `POST /auth/login`
- `POST /auth/login/mfa`
- `POST /auth/login/mfa/switch`
- `POST /auth/login/backup-code`
- `POST /auth/forgot-password`
- `POST /auth/password/forgot`
- `POST /auth/reset-password`
- `POST /auth/password/reset`
- `POST /auth/resend-verification`
- `GET /auth/verify-email`
- `POST /auth/verify-email/confirm`
- `GET /auth/password/policy`
- `GET /auth/sso/discovery`
- `POST /auth/account/unlock/request`
- `POST /auth/account/unlock/confirm`
- `POST /auth/sso/login`
- `POST /auth/login/social/:provider`

## Authenticated user routes

- `GET /auth/users/me`
- `PATCH /auth/users/me`
- `DELETE /auth/users/me`
- `GET /auth/users/me/security-summary`
- `GET /auth/users/me/verification`
- `GET /auth/users/me/export`
- `POST /auth/users/me/delete/request`
- `POST /auth/users/me/delete/confirm`
- `GET /auth/policy/effective`
- `POST /auth/mfa/recovery/request`
- `POST /auth/password/change`
- `POST /auth/mfa/setup`
- `POST /auth/mfa/verify-setup`
- `POST /auth/mfa/challenge`
- `POST /auth/mfa/verify`
- `POST /auth/mfa/email/resend`
- `GET /auth/mfa/devices`
- `PATCH /auth/mfa/devices/:id`
- `DELETE /auth/mfa/devices/:id`
- `PATCH /auth/mfa/devices/:id/primary`
- `POST /auth/mfa/backup-codes`
- `PATCH /auth/mfa/toggle`
- `POST /auth/mfa/disable`
- `POST /auth/mfa/disable/request`
- `POST /auth/mfa/webauthn/register/options`
- `POST /auth/mfa/webauthn/register/verify`
- `POST /auth/login/mfa/webauthn/options`
- `POST /auth/login/mfa/webauthn/verify`
- `POST /auth/mfa/step-up/webauthn/options`
- `POST /auth/mfa/step-up/webauthn/verify`
- `GET /auth/trusted-devices`
- `POST /auth/trusted-devices`
- `DELETE /auth/trusted-devices/:id`
- `GET /auth/sessions`
- `GET /auth/sessions/:id`
- `DELETE /auth/sessions`
- `DELETE /auth/sessions/others`
- `DELETE /auth/sessions/:id`
- `POST /auth/sessions/refresh`
- `POST /auth/logout`

## Backend callback / handoff routes

These are not normal frontend pages, but they still matter because the browser lands on them during auth flows:

- `GET /auth/sso/callback`
- `GET /auth/login/social/callback`
- `GET /auth/saml/metadata`
- `POST /auth/saml/acs`
- `POST /auth/saml/logout`
- `POST /auth/saml/slo`

---

## 2. Current Frontend Auth Surfaces In `pulse_fe`

## Public routes present

- `/auth/login`
- `/auth/register`
- `/auth/forgot-password`
- `/auth/reset-password`
- `/auth/verify-email`
- `/auth/login/mfa`
- `/auth/login/backup-code`
- `/auth/unlock`
- `/auth/unlock/confirm`
- `/auth/login/sso`

## Protected routes present

- `/settings/profile`
- `/settings/password`
- `/settings/mfa`
- `/settings/sessions`
- `/settings/backup-codes`
- `/settings/security`
- `/auth/sessions`
- `/auth/step-up`

## Auth APIs already implemented in frontend

The frontend API layer is broader than the page layer. It already includes methods for:

- login, register, logout, refresh
- forgot/reset password
- email verification + resend
- password change
- MFA setup, verify, challenge, resend, device list, rename, remove, primary, backup-code regeneration
- MFA disable
- sessions list and revoke
- SSO discovery and start
- account unlock request and confirm
- account deletion request and confirm
- MFA recovery request
- trusted devices
- WebAuthn registration and login/step-up

This means the main problem is **missing UI/page coverage**, not missing FE API client coverage.

---

## 3. What Is Already Covered Well

These backend user routes already have a real frontend surface:

### Good coverage

- login
- register
- forgot password
- reset password by token
- verify email by token
- resend verification from verify-email screen
- login MFA challenge
- login backup code
- SSO login start page
- account unlock request
- account unlock confirm
- current user profile editing
- change password
- MFA device management
- MFA setup and verification
- backup codes regeneration
- step-up MFA
- sessions listing and session revoke

### Covered but routed through settings panels instead of standalone pages

- `GET /auth/users/me`
- `PATCH /auth/users/me`
- `POST /auth/password/change`
- `GET /auth/mfa/devices`
- `DELETE /auth/mfa/devices/:id`
- `PATCH /auth/mfa/devices/:id/primary`
- `POST /auth/mfa/backup-codes`
- `GET /auth/sessions`
- `DELETE /auth/sessions/others`
- `DELETE /auth/sessions/:id`

---

## 4. Missing Frontend Pages

These are the **real missing end-user pages or flows**.

## A. Missing high-priority pages

### 1. Account deletion request page

Backend support:

- `POST /auth/users/me/delete/request`
- `POST /auth/users/me/delete/confirm`

Frontend status:

- API exists
- no route
- no page
- no settings entry

Why this is missing:

- users currently have no product UI to start the deletion flow
- backend supports scheduled deletion via email confirmation, but frontend does not expose it

Required frontend page:

- route suggestion: `/settings/delete-account`
- include:
  - risk warning
  - optional reason field
  - `Send deletion confirmation email` button
  - success state: `Check your email to confirm deletion`

### 2. Account deletion confirmation landing page

Backend support:

- `POST /auth/users/me/delete/confirm`

Backend email link behavior:

- confirmation URL is built to the frontend path `/account/delete/confirm?token=...`

Frontend status:

- this route does not exist

Impact:

- account deletion email links will not complete in the frontend

Required frontend page:

- route: `/account/delete/confirm`
- behavior:
  - read token from query
  - call confirm deletion API
  - show scheduled deletion date
  - show success/failure state

### 3. Trusted devices page

Backend support:

- `GET /auth/trusted-devices`
- `POST /auth/trusted-devices`
- `DELETE /auth/trusted-devices/:id`

Frontend status:

- API exists
- no route
- no page
- no settings section

Impact:

- users cannot view or revoke trusted devices
- users cannot explicitly trust the current device from settings

Required frontend page:

- route suggestion: `/settings/trusted-devices`
- include:
  - device list
  - `Trust this device`
  - `Revoke` per device

### 4. MFA recovery request page

Backend support:

- `POST /auth/mfa/recovery/request`

Frontend status:

- API exists
- no page
- no action entry point

Impact:

- user cannot initiate supported MFA recovery from the UI

Required frontend page:

- route suggestion: `/settings/mfa-recovery`
- include:
  - explanation of what recovery does
  - reason/details field if needed
  - `Request MFA recovery` button

### 5. Personal data export page

Backend support:

- `GET /auth/users/me/export`

Frontend status:

- API exists
- no page
- no settings entry

Impact:

- privacy/compliance feature is invisible to users

Required frontend page:

- route suggestion: `/settings/data-export`
- include:
  - description of exported data
  - `Export my data` button
  - download/result state

## B. Missing or weak public auth entry flows

### 6. Social login start is not actually wired

Backend support:

- `POST /auth/login/social/:provider`

Frontend status:

- API method exists
- login/register pages show social buttons
- buttons do not call the API

Evidence:

- `LoginPage.tsx` renders GitHub button only as static button
- `RegisterPage.tsx` renders GitHub and Google buttons only as static buttons

Impact:

- social login looks available but is non-functional

Required frontend work:

- wire provider buttons to `authApi.socialLogin(provider)`
- redirect browser to returned provider authorization URL

### 7. SSO callback completion UX is missing or contract-mismatched

Backend support:

- `GET /auth/sso/callback`

Frontend status:

- start page exists: `/auth/login/sso`
- no frontend callback page

Risk:

- if browser lands directly on backend callback and backend responds JSON rather than redirecting to frontend, the user sees a raw JSON response instead of app navigation

What must be decided:

- either backend callback must redirect to frontend
- or frontend needs a callback landing page that receives a handoff token/session result

### 8. Social login callback completion UX is missing

Backend support:

- `GET /auth/login/social/callback`

Frontend status:

- no callback page
- social start is not wired anyway

Impact:

- once social login is wired, callback completion UX still needs a browser handoff strategy

## C. Missing self-service destructive-account UI

### 9. Direct self-delete route has no frontend, which is probably correct

Backend support:

- `DELETE /auth/users/me`

Frontend status:

- API exists
- no page

Assessment:

- this is acceptable for now
- scheduled deletion route is safer and should be the user-facing one

---

## 5. Pages Present But Broken Or Miswired

## 1. Security center links point to routes that do not exist

File:

- `pulse_fe/src/modules/auth/pages/SecurityCenterPage.tsx`

Broken links:

- `/auth/profile`
- `/auth/change-password`
- `/auth/mfa-devices`
- `/auth/admin/users`

Actual registered routes are:

- `/settings/profile`
- `/settings/password`
- `/settings/mfa`
- `/settings/members` for admin

Impact:

- the Security page exists, but its cards navigate to non-existent routes

Fix:

- update links to registered settings routes

## 2. Profile page copy previously implied email change existed

File:

- `pulse_fe/src/modules/auth/components/profile/PersonalDetailsPanel.tsx`

Previous issue:

- it says email changes require verification / contact support
- backend email-change routes do not exist in the current backend auth module

Current status:

- fixed. The profile page now states email address changes are not available from account settings.

## 3. Sessions page coverage is duplicated

Files:

- `pulse_fe/src/modules/auth/pages/SessionsPage.tsx`
- `pulse_fe/src/modules/auth/components/profile/ActiveSessionsPanel.tsx`

Issue:

- there are two session-management surfaces
- one standalone page and one settings panel

Impact:

- unnecessary duplication

Fix:

- keep one canonical session-management experience

---

## 6. Frontend API Method Coverage

These APIs were previously implemented without a user-facing page or action:

- `deleteCurrentUser`
- `getUserSecuritySummary`
- `getEmailVerificationStatus`
- `getEffectivePolicy`
- `exportUserData`
- `requestAccountDeletion`
- `confirmAccountDeletion`
- `requestMfaRecovery`
- `disableMFA`
- `requestDisableMFA`
- `listTrustedDevices`
- `trustDevice`
- `revokeTrustedDevice`
- `socialLogin`

Current status:

- surfaced now: `getUserSecuritySummary`, `exportUserData`, `requestAccountDeletion`, `confirmAccountDeletion`, `requestMfaRecovery`, `disableMFA`, `listTrustedDevices`, `trustDevice`, `revokeTrustedDevice`, `socialLogin`
- intentionally not surfaced as a primary UX: `deleteCurrentUser`
- still optional future UI: `getEmailVerificationStatus`, `getEffectivePolicy`

---

## 7. Frontend API Methods That Do Not Match Current Backend

These FE methods previously existed, but did not map to active backend routes in the current auth module:

- `requestEmailChange`
- `confirmEmailChange`
- `listIdentityProviders`
- `startIdentityLink`
- `unlinkIdentity`

Current status:

- removed from the frontend auth API client in this implementation pass
- matching email-change schemas were also removed

---

## 8. Completed Page List

The following user-facing backend routes now have frontend surfaces:

### Added now

1. `Delete account request` via `/settings/privacy`
2. `Delete account confirm` landing page via `/account/delete/confirm`
3. `Trusted devices` page via `/settings/trusted-devices`
4. `MFA recovery request` page via `/settings/mfa-recovery`
5. `Data export` via `/settings/privacy`
6. `Social login` wiring from login/register screens
7. `SSO/social/SAML callback completion` via `/auth/callback`

### Fixed now

1. Security center broken links
2. Static social buttons
3. Security center now consumes the security-summary route

### Can defer

1. Dedicated verification-status page for logged-in users
2. Direct self-delete page for `DELETE /auth/users/me`

---

## 9. Recommended Frontend Page Set For Phase 1

If you want only user routes implemented for now, the clean minimum page set should be:

### Public

- `/auth/login`
- `/auth/register`
- `/auth/forgot-password`
- `/auth/reset-password`
- `/auth/verify-email`
- `/auth/login/mfa`
- `/auth/login/backup-code`
- `/auth/unlock`
- `/auth/unlock/confirm`
- `/auth/login/sso`

### Protected

- `/settings/profile`
- `/settings/password`
- `/settings/mfa`
- `/settings/sessions`
- `/settings/backup-codes`
- `/settings/trusted-devices`
- `/settings/privacy`
- `/settings/mfa-recovery`
- `/auth/step-up`

### Public email-link landings

- `/account/delete/confirm`

---

## 10. Bottom Line

The frontend now covers the core sign-in flows and the main self-service account-security surface exposed by the backend.

Remaining deliberate deferrals:

- direct self-delete UI for `DELETE /auth/users/me`, because scheduled email-confirmed deletion is the safer user-facing flow
- a dedicated verification-status page, because email status is already represented by the security summary and verify-email flow
