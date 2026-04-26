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

1. The authenticated user calls `POST /auth/mfa/setup` with `type: "email"` and a device name.
2. The API creates an unverified email MFA device for the user's account email only.
3. The API generates a 6-digit one-time code, stores only its SHA-256 hash in Redis for 10 minutes, and sends the code by SMTP.
4. The user calls `POST /auth/mfa/verify-setup` with the device id and emailed code.
5. The API validates the Redis-backed code, marks the device verified, stores hashed backup codes, enables MFA, and sends an MFA-enabled security email.
6. Future logins using an email primary MFA device send a new one-time code during challenge creation. The code is verified by `POST /auth/login/mfa`.

### Step-Up MFA

1. The authenticated user calls `POST /auth/mfa/challenge`.
2. The API selects the primary verified MFA device.
3. If the device is TOTP, the user enters the current authenticator code.
4. If the device is email, the API sends a fresh 6-digit SMTP code and stores only its hash in Redis.
5. The user calls `POST /auth/mfa/verify` with the challenge id and code.

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

## Email Templates

Templates live in `src/shared/email/templates.ts`. The current templates cover:

- Email verification
- Password reset
- MFA setup/login/step-up codes
- MFA enabled/disabled security notifications

## Routes That Send Email

- `POST /auth/users`: sends email verification.
- `POST /auth/password/forgot`: sends password reset.
- `POST /auth/mfa/setup` with `type: "email"`: sends setup code.
- `POST /auth/login`: sends login code when primary MFA device is email.
- `POST /auth/mfa/challenge`: sends step-up code when primary MFA device is email.
- `POST /auth/mfa/disable`: sends MFA disabled notification.
