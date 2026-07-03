# Auth Route And Frontend Integration Matrix

This document maps each auth route to:

- purpose
- whether authentication is required
- whether fresh step-up MFA is required
- current backend behavior
- current gap or risk
- frontend implication

Auth routes are mounted under `/auth`.

## Global Frontend Rules

1. Treat `401` as unauthenticated and redirect to sign-in.
2. Treat `403` from `requireStepUp` flows as "step-up required now", not as generic permission failure.
3. Treat `202` from `/auth/login` as an MFA challenge start, not a failed login.
4. Never store refresh tokens in frontend storage. The backend uses an httpOnly cookie.
5. For email-code MFA, show a resend button with a cooldown timer.
6. For destructive security actions, disable the submit button while the request is in flight.
7. For callback routes like SSO, SAML, and social login callbacks, frontend usually does not call them directly. Browser redirects hit them.
8. For routes returning tokens after login or refresh, frontend should update in-memory auth state from the JSON response and let the cookie stay browser-managed.

## Frontend State Rules

### Login

- If `/auth/login` returns session data:
  - sign the user in
  - route to app
- If `/auth/login` returns `mfa_required: true`:
  - open MFA challenge screen
  - show current method
  - if `available_methods.length > 1`, show `Use another method`
  - if current method is `email`, show `Resend code`
  - if backup codes are supported, show `Use backup code`
  - if WebAuthn is available, show `Use security key / passkey`

### Step-Up Required

- For routes protected by `requireStepUp`, frontend should:
  - open a step-up modal or dedicated security-confirmation screen
  - let user complete TOTP, email OTP, or WebAuthn step-up
  - retry the original action after step-up succeeds

### MFA Device Management

- If user has more than one verified active MFA device:
  - show `Remove` button on each non-required device
  - show `Set as primary` on non-primary devices
- If user is trying to remove the last verified active MFA device:
  - require password confirmation UI
  - do not present this as a simple one-click remove

### MFA Disable

- Do not use a generic toggle for disable.
- UI should have:
  - `Enable MFA` action
  - separate `Disable MFA` action
- `Disable MFA` should:
  - require step-up first
  - show a high-risk warning
  - submit to `/auth/mfa/disable`

### Account Deletion

- Frontend should use a two-screen flow:
  - `Request deletion`
  - `Confirm deletion from email link`
- Do not show account as scheduled for deletion until email confirmation succeeds.

## Route Matrix

## Health

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `GET /auth/health` | Module health check | No | No | Returns auth module health payload | None | No user-facing button needed. Admin or ops only. |

## Credential And Login

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `POST /auth/login` | Email/password login | No | No | Returns session tokens on success, or `202` with `mfa_required` challenge payload when MFA is needed | Frontend must correctly handle `202` as MFA-start | Login screen must branch into MFA challenge UI. |
| `POST /auth/login/mfa` | Complete login MFA challenge | No | No | Verifies login challenge and returns session tokens | None | MFA challenge form must submit code here. Primary button: `Verify and sign in`. |
| `POST /auth/login/mfa/switch` | Switch login MFA method during challenge | No | No | Changes active challenge device/method; email switch triggers new email OTP | Frontend must preserve `challenge_id` across method changes | Show `Use another method` button only when more than one method is available. |
| `POST /auth/login/backup-code` | Complete login using backup code | No | No | Verifies backup code and returns session tokens | Backup code UX must be clearly separated from normal OTP UX | Show `Use backup code` button on MFA screen. |
| `POST /auth/logout` | Logout current session | Yes | No | Revokes current session and clears refresh cookies | None | Show `Log out` button in account menu and settings. |
| `POST /auth/sessions/refresh` | Rotate refresh token and issue new access token | No cookie-based session context needed | No | Reads signed refresh cookie, rotates session token, returns new access token | Frontend must not try to send a refresh token from local storage | Call silently on token refresh path. Not a manual button. |

## Password And Email Verification

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `POST /auth/forgot-password` | Start password reset | No | No | Enumeration-safe response; email is queued if account exists | None | Show `Forgot password` screen. Primary button: `Send reset link`. |
| `POST /auth/password/forgot` | Alias for forgot password | No | No | Same as above | Duplicate route surface | Frontend should standardize on one route only. |
| `POST /auth/reset-password` | Reset password with token | No | No | Consumes reset token and updates password | None | Reset-password page should submit new password and token. |
| `POST /auth/password/reset` | Alias for reset password | No | No | Same as above | Duplicate route surface | Frontend should standardize on one route only. |
| `POST /auth/resend-verification` | Resend email verification | No | No | Reissues verification email | None | On unverified-account screen show `Resend verification email`. |
| `GET /auth/verify-email` | Verify email from token in query | No | No | Consumes verification token | GET token redemption is supported | Frontend email-link landing page can call this or use confirm route. |
| `POST /auth/verify-email/confirm` | Verify email by posted token | No | No | Safer SPA token confirmation path | None | Preferred frontend path. Button: `Verify email`. |
| `GET /auth/password/policy` | Get effective password rules | No | No | Returns password policy payload | None | Password forms should fetch this and render live validation hints. |
| `POST /auth/password/change` | Change current password | Yes | Yes | Requires authenticated session plus fresh step-up | None | In security settings show `Change password`. Trigger step-up first, then submit form. |

## User Self-Service

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `POST /auth/register` | Register a user | No | No | Always returns generic creation message; verification email is sent if email is unused | Intentional anti-enumeration behavior | Registration screen must always show neutral success message. |
| `POST /auth/users` | Alias for register | No | No | Same as above | Duplicate route surface | Frontend should standardize on one route only. |
| `GET /auth/users/me` | Current profile | Yes | No | Returns current user profile | None | Load on app boot and profile page. |
| `PATCH /auth/users/me` | Update current profile | Yes | No | Updates allowed profile fields | User email update flow was intentionally removed | Profile screen should not expose email-change UI. |
| `DELETE /auth/users/me` | Delete current user directly | Yes | Yes | Immediate user deletion path exists | Overlaps with safer scheduled deletion flow | Frontend should prefer scheduled deletion flow, not this direct route. Hide unless intentionally supported. |
| `GET /auth/users/me/security-summary` | Security summary | Yes | No | Returns security posture details | None | Security settings page should load this first. |
| `GET /auth/users/me/verification` | Email verification status | Yes | No | Returns verification state | None | Show `Verified` or `Verify your email` badge and CTA. |
| `GET /auth/users/me/export` | Export user data | Yes | Yes | Returns exportable user data | Potentially large payload | Show under privacy settings. Button: `Export my data`. Require step-up. |
| `POST /auth/users/me/delete/request` | Start scheduled account deletion | Yes | Yes | Sends confirmation email; deletion is not scheduled yet | No dedicated resend route found | Preferred frontend deletion entrypoint. Button: `Send deletion confirmation email`. |
| `POST /auth/users/me/delete/confirm` | Confirm scheduled account deletion | No | No | Confirms email token and schedules deletion | No resend route exposed | Email confirmation page should show final warning and confirmation result. |

## User Policy, Recovery, Unlock, Discovery

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `GET /auth/policy/effective` | Get effective auth policy for current user | Yes | No | Returns merged policy, including org-enforced auth settings | None | Security settings should use this to hide unsupported MFA methods. |
| `GET /auth/sso/discovery` | Discover SSO requirement by email | No | No | Returns SSO discovery result for email | None | Login page should call this after email entry for enterprise domains. |
| `POST /auth/account/unlock/request` | Request account unlock email | No | No | Sends unlock email if account exists and is locked | Enumeration-safe style behavior | Locked-account screen should show `Send unlock email`. |
| `POST /auth/account/unlock/confirm` | Confirm account unlock by token | No | No | Unlocks account from email token | None | Unlock confirmation page should show `Account unlocked` and `Go to sign in`. |
| `POST /auth/mfa/recovery/request` | Request MFA recovery path | Yes | Yes | Starts MFA recovery request flow | Recovery process details must be clearly explained in UI | Show only in security settings or dedicated recovery UI. |

## Admin User Routes

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `GET /auth/users` | List users | Yes admin | No | Returns paginated users | None | Admin user management table. |
| `GET /auth/users/:id` | Get user detail | Yes admin | No | Returns target user profile | None | Admin user detail page. |
| `POST /auth/users/:id/restore` | Restore soft-deleted user | Yes admin | No | Restores deleted user | None | Admin action button: `Restore user`. |
| `POST /auth/users/:id/suspend` | Suspend user | Yes admin | No | Suspends target user | High-impact action | Show confirmation modal with reason field. |
| `POST /auth/users/:id/unsuspend` | Unsuspend user | Yes admin | No | Re-enables suspended user | None | Button: `Unsuspend user`. |
| `POST /auth/users/:id/lock` | Lock user account | Yes admin | No | Locks target account | High-impact security action | Button: `Lock account` with reason input. |
| `POST /auth/users/:id/unlock` | Unlock user account | Yes admin | No | Unlocks target account | None | Button: `Unlock account`. |
| `DELETE /auth/users/:id/sessions` | Revoke all sessions for user | Yes admin | No | Revokes all sessions for target user | High-impact action | Button: `Sign out user from all devices`. |
| `GET /auth/users/:id/audit-events` | View audit events | Yes admin | No | Returns paginated audit events | None | Admin audit timeline UI. |
| `POST /auth/users/:id/password/reset` | Force password reset | Yes admin | No | Triggers admin-forced password reset flow | None | Button: `Force password reset`. |

## MFA Setup, Challenge, Devices, Disable

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `POST /auth/mfa/setup` | Start MFA setup | Yes | No | Supports email and TOTP setup; email sends OTP, TOTP returns secret and QR info | Generic setup route does not enroll WebAuthn; that is separate | Security settings should show separate cards for `Authenticator app`, `Email code`, and `Security key`. |
| `POST /auth/mfa/verify-setup` | Finish MFA setup | Yes | No | Verifies setup code and enables device | None | Setup screen must show final code-entry step. Button: `Verify and enable`. |
| `POST /auth/mfa/challenge` | Start step-up MFA challenge | Yes | No | Issues step-up challenge for sensitive actions | None | Use before password change, delete flows, disable MFA, backup-code regeneration, and risky settings changes. |
| `POST /auth/mfa/verify` | Complete step-up challenge | Yes | No | Verifies code and marks session step-up fresh | None | Step-up modal button: `Continue`. |
| `POST /auth/mfa/email/resend` | Resend email OTP for setup or challenge | Yes | No | Sends fresh email OTP | Cooldown must be enforced in UI to avoid spammy UX | Show `Resend code` only for email MFA. |
| `GET /auth/mfa/devices` | List MFA devices | Yes | No | Returns device list with name, type, primary flag, verification state, display hint | None | Security page should render device cards. |
| `PATCH /auth/mfa/devices/:id` | Rename MFA device | Yes | No | Renames MFA device | None | Show edit icon on device card. |
| `DELETE /auth/mfa/devices/:id` | Remove MFA device | Yes | Yes | Removes device; if removing last active verified device, password confirmation is required | Frontend must special-case last-device removal UI | Show `Remove` button. If only one verified device remains, require password field in confirm modal. |
| `PATCH /auth/mfa/devices/:id/primary` | Set primary MFA device | Yes | Yes | Marks device as primary | None | Show `Set as primary` on non-primary devices. Hide on primary device. |
| `POST /auth/mfa/backup-codes` | Regenerate backup codes | Yes | Yes | Generates and returns replacement backup codes | Sensitive one-time visibility output | Show `Regenerate backup codes` with warning modal. Then force user to save them. |
| `PATCH /auth/mfa/toggle` | Enable MFA | Yes | No | Enable-only route; not a real toggle-off path | Route name can mislead frontend | Label button as `Enable MFA`, not `Toggle MFA`. |
| `POST /auth/mfa/disable` | Disable MFA directly | Yes | Yes | Disables MFA directly after authenticated, fresh step-up flow | Comments in code still reference older confirm-link flow | Use this as the actual disable action. Button: `Disable MFA`. Show strong warning. |
| `POST /auth/mfa/disable/request` | Legacy alias for disable | Yes | Yes | Currently calls same direct disable service | Naming no longer matches behavior | Frontend should not use this route. Prefer `/auth/mfa/disable`. |
| `POST /auth/mfa/disable/confirm` | Old confirmation-link endpoint | No | No | Returns `410`, no longer supported | Old frontend implementations will break | Frontend must not call this route anymore. |

## WebAuthn And Passkeys

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `POST /auth/mfa/webauthn/register/options` | Start security-key registration | Yes | No | Returns WebAuthn registration options | Browser WebAuthn support required | Show `Add security key` button only on supported browsers. |
| `POST /auth/mfa/webauthn/register/verify` | Finish security-key registration | Yes | Yes | Verifies attestation and stores hardware key | Requires step-up before completing enrollment | Enrollment flow must step-up first if session is not fresh. |
| `POST /auth/login/mfa/webauthn/options` | Start login MFA passkey flow | No | No | Returns login MFA WebAuthn options from challenge id | None | On MFA login screen show `Use security key / passkey`. |
| `POST /auth/login/mfa/webauthn/verify` | Finish login MFA passkey flow | No | No | Verifies WebAuthn assertion and returns session tokens | None | Complete passkey browser ceremony, then sign in. |
| `POST /auth/mfa/step-up/webauthn/options` | Start WebAuthn step-up | Yes | No | Returns step-up WebAuthn options | None | On security-confirm modal, show `Use security key` option. |
| `POST /auth/mfa/step-up/webauthn/verify` | Finish WebAuthn step-up | Yes | No | Verifies step-up WebAuthn assertion | None | After success, retry blocked sensitive action. |

## Trusted Devices

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `GET /auth/trusted-devices` | List trusted devices | Yes | No | Returns trusted-device list | None | Security page section: `Trusted devices`. |
| `POST /auth/trusted-devices` | Trust current device | Yes | Yes | Marks current device trusted after step-up | None | Show `Trust this device` checkbox or post-login action after successful step-up. |
| `DELETE /auth/trusted-devices/:id` | Revoke trusted device | Yes | No | Removes trusted-device trust | None | Show `Revoke` button on each trusted device row. |

## Sessions

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `GET /auth/sessions` | List current user sessions | Yes | No | Returns current and other sessions | Device label quality depends on backend parsing | Sessions page should show `Current session` badge and `Sign out` actions for others. |
| `GET /auth/sessions/:id` | Session detail | Yes | No | Returns detail for one session | None | Optional session-detail drawer or page. |
| `DELETE /auth/sessions` | Revoke all sessions | Yes | No | Revokes all sessions, including current one; clears refresh cookies | User will effectively log out | Button: `Sign out from all devices`. Confirm strongly. |
| `DELETE /auth/sessions/others` | Revoke all other sessions | Yes | No | Keeps current session, revokes the rest | None | Preferred safety action. Button: `Sign out from other devices`. |
| `DELETE /auth/sessions/:id` | Revoke one session | Yes | No | Revokes one non-current session | None | Show `Sign out` on each non-current session row. Hide for current session. |

## SSO, SAML, Social Login

| Route | Purpose | Auth Required | Step-Up Required | Current Behavior | Gap / Risk | Frontend Implication |
|---|---|---:|---:|---|---|---|
| `POST /auth/sso/login` | Start enterprise SSO login | No | No | Starts SSO provider login flow | None | Login page should show `Continue with SSO` after discovery or org selection. |
| `GET /auth/sso/callback` | OIDC callback | No | No | Completes OIDC login, sets refresh cookie, returns tokens | Browser redirect flow only | Frontend should land on callback page and finalize session state. |
| `GET /auth/saml/metadata` | SP metadata for SAML setup | No | No | Returns metadata XML | Admin / IdP setup use only | No end-user UI button needed. |
| `POST /auth/saml/acs` | SAML assertion consumer service | No | No | Completes SAML login, sets refresh cookie, returns tokens | Browser POST binding flow only | No manual frontend button; handled by IdP redirect/post. |
| `POST /auth/saml/logout` | Start SAML logout for current user | Yes | No | Completes SP-initiated SAML logout path | SAML-specific | Show only for SAML-backed sessions if product wants IdP logout. |
| `POST /auth/saml/slo` | Receive SAML SLO callback/request | No | No | Handles IdP-initiated or response logout flow | Infrastructure route | No manual frontend call. |
| `POST /auth/login/social/:provider` | Start social login | No | No | Starts Google, GitHub, or Microsoft login flow | Provider must be valid | Show provider buttons on sign-in screen. |
| `GET /auth/login/social/callback` | Social login callback | No | No | Completes social login, sets refresh cookie, returns tokens | Browser redirect flow only | Frontend callback page should complete sign-in UX. |

## Backend-Only Or Special Integration Notes

- `/auth/mfa/disable/request`
  - present in backend
  - should not be used by new frontend code
- `/auth/mfa/disable/confirm`
  - present in backend
  - intentionally unsupported
  - frontend must remove any old link-confirm disable flow
- `/auth/password/forgot` and `/auth/password/reset`
  - backend aliases
  - frontend should pick one canonical route family and keep it consistent
- `/auth/users/me`
  - email change should not be exposed in frontend since that flow was intentionally removed
- `/auth/users/me/delete/request`
  - should be the primary deletion UX
  - direct `DELETE /auth/users/me` should usually stay hidden from normal product UI

## Recommended Frontend Buttons And Screens

### Sign-In Screen

- `Sign in`
- `Forgot password`
- `Continue with Google`
- `Continue with GitHub`
- `Continue with Microsoft`
- `Continue with SSO`

### MFA Challenge Screen

- `Verify and sign in`
- `Use another method`
- `Use backup code`
- `Use security key / passkey`
- `Resend code`

### Security Settings Screen

- `Enable MFA`
- `Disable MFA`
- `Add authenticator app`
- `Add email MFA`
- `Add security key`
- `Set as primary`
- `Rename`
- `Remove`
- `Regenerate backup codes`
- `Trust this device`
- `Sign out from other devices`
- `Sign out from all devices`
- `Export my data`
- `Send deletion confirmation email`

### Account Deletion Screen

- Step 1 button: `Send deletion confirmation email`
- After submit:
  - show `Check your email to confirm account deletion`
  - do not mark deletion as scheduled yet
- Confirmation page from email:
  - show deletion date
  - show irreversible warning
  - show final state after success

## Current Highest-Value Frontend Decisions

1. Use `/auth/mfa/disable`, not `/auth/mfa/disable/request` and never `/auth/mfa/disable/confirm`.
2. Treat MFA disable as a separate dangerous action, not as a simple toggle-off.
3. Prefer scheduled deletion flow over direct `DELETE /auth/users/me`.
4. Show method switching and resend actions in login MFA flow.
5. Require password confirmation UI when removing the final active MFA device.
