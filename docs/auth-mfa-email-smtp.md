# Auth MFA and SMTP Email

## MFA Flow

### TOTP MFA

1. The authenticated user calls `POST /auth/mfa/setup` with `type: "totp"` and a device name.
2. The API creates an unverified MFA device, generates a TOTP secret, creates one-time backup codes, and returns the QR code data URL.
3. The user scans the QR code in an authenticator app.
4. The user calls `POST /auth/mfa/verify-setup` with the device id and current 6-digit TOTP code.
5. The API validates the TOTP code, marks the device verified, stores hashed backup codes, enables MFA, and sends an MFA-enabled security email.
6. Future logins return `mfa_required: true` with a login challenge id. The user completes `POST /auth/login/mfa` with the TOTP code.

### Email MFA

Email MFA is not implemented. The service rejects `POST /auth/mfa/setup` with `type: "email"` before creating a device, because the current verification path is TOTP-only. Implement email MFA as a separate challenge flow before enabling this type.

### Step-Up MFA

1. The authenticated user calls `POST /auth/mfa/challenge`.
2. The API selects the primary verified MFA device.
3. If the device is TOTP, the user enters the current authenticator code.
4. The user calls `POST /auth/mfa/verify` with the challenge id and code.

### Backup Codes

Backup codes are generated during MFA setup and shown once. They are stored only as SHA-256 hashes. A valid backup code is consumed on use.

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

Use `SMTP_SECURE=true` for implicit TLS providers, usually port `465`. Use `SMTP_SECURE=false` for STARTTLS providers, usually port `587`.

## Unified Email Token Table

All email-link flows use `email_verifications` as the source of truth:

- Signup email verification
- Resend verification
- Password reset
- Future email token-link flows

Raw tokens are never stored. The application stores a SHA-256 hash that includes the route purpose, so a password-reset token cannot be used on the verify-email route. Creating a new token for the same user and email upserts the row and invalidates the previous token.

## Email Templates

Templates live in `src/shared/email/templates.ts`. The current templates cover:

- Email verification
- Password reset
- MFA setup/login/step-up codes
- MFA enabled/disabled security notifications

## Routes That Send Email

- `POST /auth/register`: sends email verification.
- `POST /auth/users`: backward-compatible registration alias.
- `POST /auth/resend-verification`: sends a fresh email verification link.
- `POST /auth/forgot-password`: sends password reset.
- `POST /auth/password/forgot`: backward-compatible password reset alias.
- `PATCH /auth/mfa/toggle`: sends MFA status notification when state changes.
- `POST /auth/mfa/disable`: sends MFA disabled notification.
