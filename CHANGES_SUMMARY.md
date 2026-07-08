# Auth Security Audit — Changed Files Summary

**Generated:** 2026-01-26
**Total files changed:** 7

---

## Changed Files

| # | File | Change Type | Bug(s) Fixed |
|---|------|-------------|-------------|
| 1 | `src/config/env.ts` | Security hardening | BUG-002: Added `AUTH_TOKEN_SECRET` env var validation |
| 2 | `src/modules/auth/infrastructure/crypto/hash.ts` | Security hardening | BUG-002: Replaced `createHash` with `createHmac` for token hashing |
| 3 | `src/modules/auth/presentation/cookies.ts` | Security hardening | BUG-006: `sameSite` changed from conditional to `'strict'` |
| 4 | `src/modules/auth/presentation/routes/password.routes.ts` | Security + correctness | BUG-003: Added `requireStepUp` + explicit `isAdmin` param on password change |
| 5 | `src/modules/auth/application/services/login.service.ts` | Security hardening | BUG-008: Added `timingSafeFakePasswordCompare()` in locked account path |
| 6 | `src/modules/auth/application/services/session.service.ts` | Security hardening | BUG-009/010: Added device fingerprint validation on refresh |
| 7 | `src/modules/auth/application/services/shared-helpers.ts` | Security hardening | BUG-012: Replaced SHA-256 with bcrypt for backup code hashing |
| 8 | `SECURITY_AUDIT_CHANGES.md` | Documentation | Full audit trail + response pattern inconsistencies + 8 remaining bugs |

---

## Summary of Changes

### 1. `src/config/env.ts`
- Added `AUTH_TOKEN_SECRET: z.string().min(32)` to env schema
- Updated `assertSecretsAreDistinct()` to check 5 distinct secrets (was 4)

### 2. `src/modules/auth/infrastructure/crypto/hash.ts`
- `hashToken()`: changed from `createHash('sha256')` to `createHmac('sha256', AUTH_TOKEN_SECRET)`
- No schema change needed — HMAC output is same hex string format as before

### 3. `src/modules/auth/presentation/cookies.ts`
- `sameSite` attribute: changed from `(secure ? 'none' : 'lax')` to `'strict'` unconditionally
- Prevents all cross-site cookie send attempts (CSRF prevention on refresh token)

### 4. `src/modules/auth/presentation/routes/password.routes.ts`
- `POST /password/change`: added `requireStepUp` middleware to enforce re-authentication
- Added `r.user.isAdmin` param to `changePassword()` service call to prevent privilege escalation
- BUG-003 comments added inline

### 5. `src/modules/auth/application/services/login.service.ts`
- `loginWithEmailPassword()`: in the locked-account branch, added `timingSafeFakePasswordCompare()` before returning error
- Equalizes timing between locked vs. non-existent email to prevent user enumeration via timing attack
- BUG-008 comments added inline

### 6. `src/modules/auth/application/services/session.service.ts`
- `refreshAccessToken()`: added device fingerprint check before issuing new tokens
- Compares `buildDeviceFingerprint(ip, userAgent)` against stored `session.device_fingerprint`
- Revokes session if fingerprint changed (token theft detection)
- BUG-009/010 comments added inline

### 7. `src/modules/auth/application/services/shared-helpers.ts`
- `generateBackupCodes()`: replaced `createHash('sha256')` with `bcrypt.hash(code, 10)`
- `verifyBackupCodeHash()`: replaced SHA-256 + `timingSafeEqual` with `bcrypt.compareSync()`
- BUG-012 comments added inline

### 8. `SECURITY_AUDIT_CHANGES.md` (this file)
- Documents all 6 fixes with rationale, migration notes, and verification checklist
- Documents 3 response pattern inconsistencies (low severity, functional)
- Documents 8 remaining unfixed bugs with severity and fix guidance

---

## Not Changed (Skipped)

| Bug | Reason |
|-----|--------|
| BUG-001 | Rate limiter disabled; requires Redis unavailable in current architecture |

---

## Files NOT Changed (flagged in audit but not modified)

| Bug | File | Reason |
|-----|------|--------|
| BUG-004 | `auth.domain/errors.ts` | SESSION_EXPIRED logic; medium risk, needs service-layer change |
| BUG-005 | `auth.infrastructure/repositories/auth.repository.ts` line 47 | Hardcoded lockout attempts; needs org policy integration |
| BUG-007 | `login.service.ts` | TOCTOU race on locked account + wrong password; needs restructure |
| BUG-011 | `auth.domain/errors.ts` | INVALID_CREDENTIALS message differentiation; user enumeration |
| BUG-013 | `session.service.ts` line 430 | SESSION_NOT_FOUND vs token reuse; needs error code split |
| BUG-014 | `mfa.service.ts` | MFA device count TOCTOU race |
| BUG-015 | `shared-helpers.ts` | `randomBytes(6)` too small for backup codes; upgrade to 16+ |

---

## New Environment Variable Required

```bash
AUTH_TOKEN_SECRET=<random 32+ character string>
```

Add to:
- `.env` and `.env.example`
- All CI/CD secret stores (GitHub Actions, Vercel, Render, etc.)
- Local `.env.local` for dev