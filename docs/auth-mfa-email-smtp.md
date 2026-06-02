# Auth MFA and SMTP Email

## MFA Flow

### TOTP MFA

1. The authenticated user calls `POST /auth/mfa/setup` with `type: "totp"` and a device name.
2. The API creates an unverified MFA device, generates a TOTP secret, creates one-time backup codes (20 hex characters each), and returns the QR code data URL.
3. The user scans the QR code in an authenticator app.
4. The user calls `POST /auth/mfa/verify-setup` with the device id and current 6-digit TOTP code.
5. The API validates the TOTP code, marks the device verified, stores hashed backup codes, enables MFA, and sends an MFA-enabled security email.
6. Future logins return `mfa_required: true` with a `challenge_id`. The user completes `POST /auth/login/mfa` with a 6-digit code, or `POST /auth/login/backup-code` with a 20-character hex backup code.

### Email MFA

1. The authenticated user calls `POST /auth/mfa/setup` with `type: "email"` and a device name.
2. The API emails a 6-digit OTP (10-minute TTL, stored hashed in `email_mfa_otps`).
3. The user calls `POST /auth/mfa/verify-setup` with the device id and OTP.
4. Login and step-up challenges email a fresh OTP automatically. Use `POST /auth/mfa/email/resend` to request another code (rate limited: 3 per 15 minutes per device).

### Step-Up MFA

1. The authenticated user calls `POST /auth/mfa/challenge`.
2. The API selects the primary verified MFA device (email devices trigger an OTP email).
3. The user calls `POST /auth/mfa/verify` with the challenge id and 6-digit code.
4. Sensitive routes (`POST /auth/password/change`, `DELETE /auth/users/me`, MFA device removal, backup-code regeneration, MFA disable request) require fresh step-up via `requireStepUp`.

### MFA Disable (two-step)

1. `POST /auth/mfa/disable/request` — requires step-up freshness and a valid TOTP/email OTP; sends a confirmation link.
2. `POST /auth/mfa/disable/confirm` — consumes the email token and disables MFA.

### Backup Codes

Backup codes are 20 hex characters (80 bits). They are generated during MFA setup and shown once. Only SHA-256 hashes are stored. Use `POST /auth/login/backup-code` during an active login MFA challenge.

## SMTP Configuration

Add these values to `.env`:

```env
APP_NAME=API Monitoring
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=smtp-user
SMTP_PASS=smtp-password
SMTP_FROM_EMAIL=security@example.com
SMTP_FROM_NAME=API Monitoring Security
```

Email links (verification, password reset, MFA disable) use `FRONTEND_URL` so they open in the SPA.

## Auth Rate Limits (in-process LRU)

Per-route limits are defined in `src/modules/auth/rate-limits.ts` using `lru-rate-limit.ts` (no Redis). Counters are per Node process; the global limiter in `app.ts` still applies at the IP level.

| Scope | Max | Window |
| --- | --- | --- |
| login | 10 | 15 min (per IP + email hash) |
| login-mfa / backup-code | 15 | 15 min |
| register | 5 | 1 hour |
| forgot-password / resend-verification | 5 | 1 hour |
| mfa-email-resend | 3 | 15 min (per user + device) |
| sessions/refresh | 60 | 15 min |

## Unified Email Token Table

All email-link flows use `email_verifications`:

- Signup email verification
- Password reset
- MFA disable confirmation

Raw tokens are never stored. Purpose-bound SHA-256 hashes prevent cross-flow replay.

## Email Templates

Templates live in `src/shared/email/templates.ts`.

## Routes That Send Email

- `POST /auth/register`, `POST /auth/resend-verification`
- `POST /auth/forgot-password` (and `/password/forgot` alias)
- Login for unverified users (silent re-send)
- Email MFA setup, login, step-up, and `POST /auth/mfa/email/resend`
- `POST /auth/mfa/disable/request`
- MFA enabled/disabled notifications
