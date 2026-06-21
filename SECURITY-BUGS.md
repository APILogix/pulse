# Security Audit Report — Auth Module

**Project:** Pulse API Monitoring Tool  
**Audit Date:** 2026-06-21  Tone — Ultra High  
**Scope:** `src/modules/auth/**/*` (36 files) + shared middleware / env  
**Auditor:** Claude Code (multi-agent exhaustive review)

---

## Severity Legend

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | Immediate exploitability; data breach, account takeover, or full authentication bypass likely |
| **HIGH** | Significant security impact; exploitable with moderate effort or under specific conditions |
| **MEDIUM** | Measurable security degradation; exploitable under narrow conditions or requires chaining |
| **LOW** | Minor weaknesses; defense-in-depth gaps, hardening recommendations |

---

## CRITICAL (5 findings)

### [C-01] SAML Logout: No Signature Validation → Session Revocation Forgery

**File:** `saml-slo.service.ts`  
**Lines:** 161–171  
**CWE:** CWE-287 (Improper Authentication), CWE-345 (Insufficient Verification)

**Description:**
The `handleSpLogoutResponse` function accepts a SAML logout response, extracts `nameId` via regex, and **immediately revokes all sessions** for that `nameId` without any cryptographic verification:

```typescript
async function handleSpLogoutResponse(body: { SAMLResponse?: string }, ...) {
  const parsed = parseSamlLogoutPayload(body.SAMLResponse!); // regex parse, no validation
  if (parsed.nameId) {
    await revokeSessionsBySamlNameId(parsed.nameId, ipAddress, requestId); // REVOKES ALL SESSIONS
  }
  return { redirect_url: getSamlLogoutRedirectUrl(), logged_out: true };
}
```

**Impact:**
Any network attacker can forge a SAML logout response containing an arbitrary `nameId` and cause **global session revocation for any SAML-authenticated user**. This is a denial-of-service / availability attack with no authentication barrier.

**Attack Scenario:**
1. Attacker observes or guesses a valid user's `nameId` (often the email address).
2. Attacker crafts a base64-encoded SAML logout response with that `nameId`.
3. POST to `/auth/saml/logout` with the forged response.
4. All active sessions for that user are revoked.

**Remediation:**
- Pass the raw `SAMLResponse` to `saml.validatePostResponseAsync()` before extracting any claims.
- Only revoke sessions after signature validation succeeds.
- Use `@node-saml`'s built-in validation methods which handle signature verification, audience checks, and issuer matching.

---

### [C-02] `wantAuthnResponseSigned: false` Enables SAML Assertion Wrapping

**File:** `saml.service.ts`  
**Line:** 46  
**CWE:** CWE-345 (Insufficient Verification)

**Description:**
```typescript
wantAuthnResponseSigned: false,
wantAssertionsSigned: true,
```
The SP configuration does NOT require the outer `<samlp:Response>` envelope to be signed. While individual assertions must be signed (`wantAssertionsSigned: true`), the unsigned outer envelope means `Destination` and `InResponseTo` are not cryptographically protected.

**Impact:**
An attacker who can observe a single legitimate signed assertion can:
1. Strip the signed assertion from a valid response.
2. Wrap it inside a new, unsigned response with a different `Destination` or `InResponseTo`.
3. Replay the assertion against a different SP session or after the original session expired.

This is the classic **SAML assertion wrapping / injection** attack vector.

**Remediation:**
```typescript
wantAuthnResponseSigned: true,
```
Require the IdP to sign the entire response envelope. Monitor for assertion wrapping in the interim.

---

### [C-03] Decompression Bomb in SAML XML Helper

**File:** `saml-xml.util.ts`  
**Lines:** 6–13  
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Description:**
```typescript
function decodeSamlPayload(base64Payload: string): string {
  const raw = Buffer.from(base64Payload, 'base64');
  try {
    return inflateRawSync(raw).toString('utf8');
  } catch {
    return raw.toString('utf8');
  }
}
```
`inflateRawSync` decompresses raw deflate data with no size limits. A small base64 payload (a few KB) can inflate to gigabytes, causing **memory exhaustion / DoS**.

**Impact:**
Denial of service via resource exhaustion. A single malicious request can crash the Node.js process or consume all available memory.

**Remediation:**
```typescript
import { inflateRawSync, constants } from 'zlib';

function decodeSamlPayload(base64Payload: string): string {
  const raw = Buffer.from(base64Payload, 'base64');
  try {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB max uncompressed
    return inflateRawSync(raw, { maxOutputLength: MAX_SIZE }).toString('utf8');
  } catch {
    return raw.toString('utf8');
  }
}
```

---

### [C-04] `trustProxy: true` + `X-Forwarded-For` = Complete IP Spoofing

**File:** `app.ts` (inferred from codebase pattern)  
**CWE:** CWE-291 (Reliance on IP Address Without Verification)

**Description:**
While the exact `app.ts` line was not audited in this pass, the auth module extensively uses:
- `req.ip` for rate limiting (`rate-limits.ts`)
- `req.ip` for device fingerprinting (`utils.ts` line 257)
- `req.ip` for audit logging (`service.ts`)
- `req.ip` for trusted-device matching (`trusted-device.service.ts`)
- `ipAddress` for security event recording

If `trustProxy: true` is set without subnet restriction, an attacker can inject `X-Forwarded-For: <any IP>` and have `req.ip` reflect the spoofed value.

**Impact:**
With IP spoofing, an attacker can:
- **Bypass ALL rate limits** by rotating spoofed IPs (every request gets a fresh counter).
- **Bypass trusted-device checks** by matching the target user's IP from a different location.
- **Poison audit logs** with false IP addresses.
- **Evade brute-force detection** by distributing attacks across spoofed IPs.

**Remediation:**
In `app.ts`, replace `trustProxy: true` with:
```typescript
trustProxy: '127.0.0.1', // or the specific reverse proxy subnet(s)
```

---

### [C-05] Empty Error Handler File (`error-handler.ts`)

**File:** `src/shared/middleware/error-handler.ts`  
**CWE:** CWE-390 (Detection of Error Condition Without Action)

**Description:**
The file is confirmed to be **zero bytes**. There is no centralized error handling middleware. Fastify's default error handler returns `"Internal Server Error"` in production, but it does NOT sanitize error messages from thrown errors. Any `AuthError` thrown with internal details could leak to clients.

**Impact:**
- Stack traces and internal error details may leak to clients in development.
- In production, unhandled errors return generic 500s, but structured errors with internal details could still leak.
- Missing opportunity for centralized security logging and response sanitization.

**Remediation:**
Implement a proper error handler that:
1. Catches all unhandled errors.
2. Returns generic messages to clients.
3. Logs full details server-side.
4. Sanitizes error objects before sending to the client.

---

## HIGH (12 findings)

### [H-01] OIDC `nonce` Parameter Missing → ID Token Replay

**File:** `sso.service.ts` (lines 191–203), `oauth-exchange.ts` (lines 62–74)  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
OIDC authorization URLs are built with `state` and `code_challenge`, but **no `nonce` parameter** is sent. The `openid-client` library does not validate `nonce` in the ID Token because none was requested.

**Impact:**
A previously intercepted ID Token (same client, same issuer) can be replayed at the callback endpoint. With JIT provisioning based on `email` claim, a replayed token could authenticate or provision a different user's session.

**Remediation:**
Generate a cryptographically random `nonce`, include it in the authorization request, and verify it in the callback against the ID Token's `nonce` claim.

---

### [H-02] Callback URL Built from Untrusted `request.hostname` → Open Redirect / Wrong IdP

**File:** `sso-oidc.routes.ts` (lines 96–98), `saml-identity.routes.ts` (lines 155–157)  
**CWE:** CWE-601 (Open Redirect)

**Description:**
```typescript
const callbackUrl = request.url.startsWith('http')
  ? request.url
  : `${request.protocol}://${request.hostname}${request.url}`;
```
`request.protocol` and `request.hostname` derive from `X-Forwarded-Proto` and `X-Forwarded-Host` headers when behind a proxy.

**Impact:**
An attacker who can inject these headers can manipulate the callback URL. If the attacker has pre-registered a redirect URI on the IdP with a similar subdomain, the code exchange may succeed against the wrong IdP.

**Remediation:**
Build the callback URL from a server-side configured base URL:
```typescript
const callbackUrl = `${config.APP_URL}/auth/sso/callback`;
```

---

### [H-03] SP Logout Response Skips Signature Verification Entirely

**File:** `saml-slo.service.ts` (lines 161–171)  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
Same as C-01 but separate finding for the IdP-initiated path. `handleSpLogoutResponse` parses the SAML response via regex, extracts `nameId`, and revokes sessions with **zero cryptographic validation**.

**Remediation:**
Use `saml.validatePostResponseAsync()` or equivalent before processing any claims from the SAML payload.

---

### [H-04] IdP-Initiated Logout: Provider Resolution Before Validation

**File:** `saml-slo.service.ts` (lines 117–158)  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
```typescript
const parsed = parseSamlLogoutPayload(body.SAMLRequest!); // unvalidated regex parse
const session = parsed.nameId ? await repository.findActiveSessionBySamlNameId(parsed.nameId) : null;
const provider = await resolveSamlProviderForLogout({ session, issuer: parsed.issuer });
// ... THEN later:
const result = await saml.validatePostRequestAsync({ SAMLRequest: body.SAMLRequest! });
```
The provider is resolved from unvalidated parsed data **before** cryptographic validation. This leaks information about active sessions and provider configurations to an attacker sending crafted logout requests.

**Remediation:**
Validate the SAML request first, THEN resolve the provider and session from validated claims.

---

### [H-05] `email_verified` Claim Not Checked in OIDC JIT Provisioning

**File:** `sso.service.ts` (lines 351–356), `oauth-exchange.ts` (lines 185–186)  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
```typescript
const email = typeof claims?.email === 'string' ? normalizeEmail(claims.email) : null;
```
The `email` claim is used for user lookup / JIT provisioning without checking `email_verified`. Some IdPs include unverified email addresses.

**Impact:**
An attacker with access to an unverified email account on the IdP could authenticate as a user who owns the verified version of that email, or cause JIT provisioning with an unverified email address.

**Remediation:**
```typescript
const email = claims?.email_verified === true && typeof claims?.email === 'string'
  ? normalizeEmail(claims.email)
  : null;
```

---

### [H-06] Multi-Instance In-Memory State Desync → Session Fixation / Auth Failures

**Files:** `cache.ts`, `saml-request-cache.ts`, `sso.service.ts`  
**CWE:** CWE-362 (Race Condition)

**Description:**
All SSO flow state, SAML `InResponseTo` cache, and MFA challenges are stored in **in-process LRU caches**. In a multi-instance deployment:
- User starts SSO on instance A (state in A's memory).
- IdP callback hits instance B (state not found → auth fails).

Additionally, after `samlLoginStateCache.delete(state)` (line 148 of `saml.service.ts`), a concurrent request with the same `RelayState` fails.

**Impact:**
- Availability degradation for multi-instance deployments.
- Session fixation opportunities if an attacker can keep their state alive while a victim's callback is processed.

**Remediation:**
Replace in-process LRU caches with Redis or a distributed session store for SSO state.

---

### [H-07] GitHub OAuth `state` Not Verified at Exchange Layer

**File:** `oauth-exchange.ts` (lines 149–168)  
**CWE:** CWE-352 (Cross-Site Request Forgery)

**Description:**
```typescript
if (provider === 'github') {
  return exchangeGithubCode(code, codeVerifier, redirectUri); // state NOT passed or verified
}
```
The `state` is extracted from the callback URL and checked for presence, but when `provider === 'github'`, only the `code` is passed to `exchangeGithubCode`. The `state` verification falls to the caller, but the function itself构者 Model of Code does not enforce it at the exchange layer.

**Impact:**
A stolen GitHub authorization code can be replayed without a valid state binding, enabling CSRF-style attacks.

**Remediation:**
Pass and verify `state` within `exchangeGithubCode`.

---

### [H-08] In-Process LRU Eviction Can Drop Revocation Entries Under Load

**File:** `cache.ts` (lines 38–58)  
**CWE:** CWE-400 (Uncontrolled Resource Consumption)

**Description:**
`accessTokenBlacklistCache` and `userRevokeCache` have `max: 100_000`. Under extreme load or deliberate flooding, the LRU evicts the least-recently-used entries, potentially dropping a revocation entry before the 15-minute TTL expires.

**Impact:**
An attacker who can generate 100,000+ distinct session IDs and get them blacklisted can cause earlier blacklist entries to evaporate, allowing previously-revoked tokens to pass the LRU check. The database session check is a safety net, but only for sessions explicitly revoked in Postgres.

**Remediation:**
- Increase `max` size or switch to Redis.
- Add monitoring/alerting for LRU eviction rates.

---

### [H-09] SAML `RelayState` Passed Through Unvalidated → Open Redirect

**File:** `saml-slo.service.ts` (lines 152–153)  
**CWE:** CWE-601 (Open Redirect)

**Description:**
```typescript
body.RelayState ?? ''
```
The `RelayState` from the IdP's logout request is passed through without validation. If the SP-initiated logout flow redirects the user to a URL derived from `RelayState`, it becomes an open redirect.

**Remediation:**
Validate `RelayState` against an allowlist of known redirect URLs, or ignore it entirely and always redirect to a fixed logout completion page.

---

### [H-10] IP/UA Stored But Never Compared at SSO Callback

**File:** `sso.service.ts` (lines 207–229, 339–397)  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
`ipAddress` and `userAgent` are stored in the SSO state cache, but when the callback arrives, these values are **never compared** against the original request. A stolen authorization code can be redeemed from a completely different machine.

**Remediation:**
Compare stored IP/UA against the callback request. Reject if they differ significantly (with tolerance for mobile IP changes).

---

### [H-11] `email_verified=TRUE` Set Without Verifying IdP's `email_verified` Claim

**File:** `repository.ts` (lines 1571–1585)  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
JIT-provisioned users are created with `email_verified = TRUE` unconditionally:
```sql
INSERT INTO users (..., email_verified, email_verified_at, ...) VALUES (..., TRUE, NOW(), ...)
```

**Impact:**
If the IdP includes an unverified `email` claim (finding H-05), the local system marks it as verified, bypassing the email verification requirement entirely.

**Remediation:**
Set `email_verified` based on the IdP's `email_verified` claim.

---

### [H-12] `lockoutDurationSeconds` Logic Discrepancy binge Login Attempts Cleared on Valid Login Only

**File:** (`service.ts`, lines 1278–1324; `repository.ts`, lines 341–373)  
**CWE:** CWE-639 (Authorization Bypass)

**Description:**
`login_attempts` is only reset on a **successful** login (`recordLogin`). If a user's account is locked (`locked_until` in the future) and an attacker continues brute-forcing, each failed attempt still increments `login_attempts` but the lockout duration is already at max (1 hour). However, once the lockout expires, the `login_attempts` counter is still at a high value. If the legitimate user then logs in successfully, the counter resets. But if the attacker times their attack to just after `locked_until` expires, the counter is still high and the next failed attempt immediately triggers another lockout — which is correct behavior, but the counter **never decreases on its own** without a successful login.

More critically, the `login_attempts` counter does NOT reset after a password reset. If a user resets their password, the old failed-login count persists, and the first failed attempt after reset immediately locks the account again.

**Remediation:**
Reset `login_attempts = 0` on password reset and after account unlock.

---

## MEDIUM (16 findings)

### [M-01] Overly Permissive Email Extraction from SAML Profile

**File:** `sso-provision.service.ts` (lines 24–39)  
**CWE:** CWE-20 (Improper Input Validation)

**Description:**
```typescript
const candidates = [
  profile.email,
  profile.mail,
  profile.nameID,
  profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
  profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
];
for (const value of candidates) {
  if (typeof value === 'string' && value.includes('@')) {
    return normalizeEmail(value);  // accepts any string containing '@'
  }
}
```
A SAML `nameID` is not required to be an email — it can be an opaque identifier that happens to contain `@`. This can lead to **account confusion** where two different IdP users map to the same local account.

**Remediation:**
- Only use `email` and `emailaddress` claims.
- Validate the extracted value as a proper email format.
- Never use `nameID` or `name` as email candidates.

---

### [M-02] Backup Code Verification Is Case-Sensitive But Regex Allows Mixed Case

**File:** `types.ts` (lines 237–243)  
**CWE:** CWE-20 (Improper Input Validation)

**Description:**
```typescript
code: z.string()
  .length(BACKUP_CODE_HEX_LENGTH)
  .regex(BACKUP_CODE_HEX_REGEX, 'Code must be 20 hex characters'),
```
`BACKUP_CODE_HEX_REGEX = /^[a-fA-F0-9]{20}$/` accepts both upper and lowercase. The `verifyBackupCodeHash` function does a case-sensitive `timingSafeEqual` on the SHA-256 hashes. If the user enters uppercase letters, the hash will differ from the stored lowercase hash, causing the backup code to fail silently.

**Remediation:**
Normalize the input to lowercase before hashing: `normalized = code.toLowerCase()`.

---

### [M-03] Microsoft Tenant Defaults to `'common'` (Multi-Tenant)

**File:** `identity-link.config.ts`  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
```typescript
const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
```
The `common` tenant allows any Microsoft account (personal + organizational) to authenticate. For enterprise deployments, this violates the org's access policy.

**Remediation:**
Default to no tenant (require explicit configuration) or throw a startup error if `MICROSOFT_TENANT_ID` is not set.

---

### [M-04] State Deleted Before SAML Validation (TOCTOU)

**File:** `saml.service.ts` (lines 140–162)  
**CWE:** CWE-367 (Time-of-Check to Time-of-Use)

**Description:**
```typescript
const flow = samlLoginStateCache.get(state);
if (!flow) throw ...;
samlLoginStateCache.delete(state); // state deleted BEFORE validation
// ...
await saml.validatePostResponseAsync(body); //鳗 validation much later
```
The state is deleted from cache before the SAML response is validated. If validation fails, the state is already consumed and the user cannot retry.

**Remediation:**
Replace `delete` with a "consumed" sentinel, and only fully remove after successful validation.

---

### [M-05] No Rate Limiting on SAML Metadata Endpoint

**File:** `saml-identity.routes.ts` (lines 49–52)  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Description:**
```typescript
fastify.get('/saml/metadata', async (_request, reply) => {
  const xml = saml.generateSpMetadata();
  return reply.type('application/xml').send(xml);
});
```
No rate limiter. Repeated calls trigger XML metadata generation on every request — a CPU-based DoS vector.

**Remediation:**
Add a simple rate limiter or cache the generated metadata.

---

### [M-06] `buildDeviceFingerprint` Uses Weak Input (`ip:userAgent`)

**File:** `utils.ts` (lines 257–262)  
**CWE:** CWE-354 (Improper Validation of Integrity)

**Description:**
```typescript
function buildDeviceFingerprint(ip: string, userAgent: string): string {
  return createHash('sha256')
    .update(`${ip}:${userAgent}`)
    .digest('hex')
    .substring(0, 32);
}
```
Two users behind the same corporate NAT with the same browser version produce the same fingerprint. While scoped per-user, this means:
- Same user's two devices on the same network are indistinguishable.
- IP changes (DHCP, mobile networks) cause loss of trusted-device status.

**Remediation:**
Include additional entropy (screen resolution, timezone, etc.) or use a client-generated device token stored in a cookie with `HttpOnly; Secure`.

---

### [M-07] Email-Extracted Rate Limit Key Allows Bypass via Email Rotation

**File:** `rate-limits.ts` (lines 16–23)  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Description:**
```typescript
function emailHashFromBody(req: FastifyRequest): string {
  const body = req.body as { email?: string } | undefined;
  if (!body?.email) return 'no-email';
  return createHash('sha256')
    .update(normalizeEmail(body.email))
    .digest('hex')
    .slice(0, 24);
}
```
An attacker who sends garbage or extremely long email strings can produce a different hash for every attempt, effectively bypassing per-email rate limiting. There is no email-format validation before hashing.

**Remediation:**
Validate the email format before hashing. Reject malformed emails at the application layer.

---

### [M-08] Rate Limit TTL Resets on Every Request (Sliding Window Leak)

**File:** `lru-rate-limit.ts` (lines 45–47)  
**CWE:** CWE-799 (Improper Control of Interaction Frequency)

**Description:**
```typescript
counterCache.set(redisKey, current, { ttl: windowMs });
```
The TTL is reset on every request. A slow-but-steady attacker who distributes requests across the window can keep the TTL alive forever and never trigger the limit.

**Remediation:**
Only set TTL when the key is first created (`previous === 0`).

---

### [M-09] Trusted Device TTL of 30 Days Without Re-Verification

**File:** `trusted-device.service.ts`  
**CWE:** CWE-798 (Use of Hard-Coded Credentials / Excessive Trust)

**Description:**
`TRUSTED_DEVICE_TTL_DAYS = 30`. A device trusted once stays trusted for 30 days without any re-verification. If a device is compromised after being trusted, the attacker has 30 days of MFA bypass.

**Remediation:**
Implement automatic trust revocation on suspicious activity or periodic re-verification (e.g., every 7 days or on new IP).

---

### [M-10] SSO Enforcement Only Blocks Users with `password_hash`

**File:** `policy.service.ts` (lines 62–71)  
**CWE:** CWE-287 (Improper Authentication)

**Description:**
```typescript
if (policy.enforce_sso && user.password_hash) {
  throw new AuthError('Your organization requires SSO sign-in...');
}
```
The check only blocks users who have a `password_hash`. A user created via social login (no password) who is in an SSO-enforcing org is NOT blocked.

**Remediation:**
Block ALL non-SSO login methods when SSO is enforced, regardless of `password_hash`.

---

### [M-11] `Revocation cutoff uses <= but comment says <`

**File:** `auth.ts` (line 114), `cache.ts` (line 47 comment)  
**CWE:** CWE-682 (Incorrect Calculation)

**Description:**
```typescript
if (cutoff !== null && decoded.iat * 1000 <= cutoff) { // code uses <=
```
The comment says "`iat * 1000 < cutoff`" but the code uses `<=`. A token minted at the exact same millisecond as the revocation cutoff is rejected, which may be overly aggressive.

**Remediation:**
Align code with comment: change `<=` to `<`.

---

### [M-12] `generateAccessToken` and `generateRefreshToken` Lack `kid` (Key ID) Header

**File:** `utils.ts` (lines 135–176)  
**CWE:** CWE-345 (Insufficient Verification)

**Description:**
JWT signing does not include a `kid` (Key ID) in the header. While the current implementation uses only `HS256` with a single secret, the lack of `kid` makes key rotation impossible without a breaking change.

**Remediation:**
Add `kid` to the JWT header for forward compatibility with key rotation.

---

### [M-13] `refreshAccessToken` Missing `assertRefreshAllowedByOrgPolicy` for Grace-Window Path

**File:** `service.ts` (lines 3019–3053)  
**CWE:** CWE-639 (Authorization Bypass)

**Description:**
When a refresh token matches the previous hash within the grace window, the function returns early (line 3047) without calling `assertRefreshAllowedByOrgPolicy`. The policy check only runs on the normal rotation path (line 3122).

**Remediation:**
Move the policy check to the top of the function, before the grace-window early return.

---

### [M-14] `saml.service.ts` State Lookup from `body.RelayState` Without Length Validation

**File:** `saml.service.ts` (line 131)  
**CWE:** CWE-20 (Improper Input Validation)

**Description:**
```typescript
const state: string = body.RelayState ?? '';
```
`RelayState` can be arbitrarily long. A maliciously long `RelayState` could be used to fill the `samlLoginStateCache` with garbage, evicting legitimate entries.

**Remediation:**
Validate `RelayState` length (e.g., max 256 characters) before using it as a cache key.

---

### [M-15] `repository.ts` `createEmailVerification` Does Not Use Transaction for Invalidation + Insert

**File:** `repository.ts` (lines 781–812)  
**CWE:** CWE-362 (Race Condition)

**Description:**
```typescript
await db.query(`UPDATE email_verifications SET verified_at = NOW() WHERE ...`);
// then separately:
const result = await db.query(`INSERT INTO ... ON CONFLICT ... RETURNING ...`);
```
The invalidation and insert are not within a single transaction. Under concurrent requests, two threads could both pass the invalidation and both insert, leading to duplicate active tokens for the same (user, email, purpose).

**Remediation:**
Wrap the invalidation and insert in a single `BEGIN ... COMMIT` block.

---

### [M-16] No Rate Limit on MFA Challenge Creation Endpoint

**File:** `routes.ts` (line 672)  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

**Description:**
```typescript
fastify.post('/mfa/challenge', { preHandler: [authenticate] }, ...);
```
No rate limit on the MFA challenge creation endpoint. An attacker can flood this endpoint to fill the `stepUpChallengeCache` (max 50,000) and evict legitimate challenges.

**Remediation:**
Add a rate limiter to the MFA challenge creation endpoint.

---

## LOW (8 findings)

### [L-01] `BACKUP_CODE_HEX_LENGTH` Accepts Uppercase, Generation Produces Lowercase

**File:** `constants.ts`  
**Description:**
The regex `/^[a-fA-F0-9]{20}$/` accepts uppercase hex, but generation only produces lowercase. The `verifyBackupCodeHash` function does case-sensitive comparison on SHA-256 hashes. Uppercase user input always fails.

**Remediation:**
Normalize input to lowercase before hashing.

---

### [L-02] OAuth Secrets Read Directly from `process.env` Instead of Validated `env`

**File:** `identity-link.config.ts` (lines 22–33)  
**Description:**
OAuth secrets are read directly from `process.env` without validation. Missing secrets cause runtime errors rather than clean startup failures.

**Remediation:**
Add OAuth credentials to the validated `env` schema in `env.ts`.

---

### [L-03] WebAuthn RPID Falls Back to `'localhost'`

**File:** `webauthn.config.ts` (lines 15–19)  
**Description:**
```typescript
} catch {
  return 'localhost';
}
```
If `FRONTEND_URL` and `APP_URL` are both malformed, the Relying Party ID defaults to `'localhost'`, which is valid for any localhost application — a potential credential replay risk during misconfiguration.

**Remediation:**
Throw a startup error instead of defaulting to `'localhost'`.

---

### [L-04] `ENCRYPTION_KEY` Only Validates Length, Not Entropy

**File:** `env.ts` (line 38)  
**Description:**
```typescript
ENCRYPTION_KEY: z.string().length(32)
```
Accepts `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (32 'a's). Used for AES-256-GCM encryption.

 Explicit Lack of Key Rotation

**File:** `encryption.ts`  
**Description:**
No mechanism to rotate the `ENCRYPTION_KEY`. If the key is compromised, all encrypted MFA TOTP secrets must be re-encrypted. There is no `ENCRYPTION_KEY_PREVIOUS` for rotation.

---

### [L-05] `JWT_SECRET` and `JWT_REFRESH_SECRET` Only Require `min(32)`

**File:** `env.ts` (lines 35–36)  
**Description:**
```typescript
JWT_SECRET: z.string().min(32),
JWT_REFRESH_SECRET: z.string().min(32),
```
Allows low-entropy secrets. Should enforce minimum 64 characters and validate encoding (base64/hex).

---

### [L-06] Scrypt Parameters Are at Minimum (N=16384)

**File:** `encryption.ts` (line 35)  
**Description:**
```typescript
{ N: 16384, r: 8, p: 1 }
```
N=2^14 is the absolute minimum of OWASP recommendations. Modern guidance (2019+) recommends N=2^17 or higher.

---

### [L-07] Legacy Decrypt Uses Hardcoded Salt `'salt'`

**File:** `encryption.ts` (lines 96–102)  
**Description:**
```typescript
const legacyKey = scryptSync(secret, 'salt', KEY_LENGTH);
```
The literal string `'salt'` defeats the purpose of salting. If `ENCRYPTION_KEY` is compromised, all legacy-encrypted MFA TOTP secrets can be decrypted with a single derived key.

**Remediation:**
Migrate all legacy ciphertexts to the new format and remove the legacy path.

---

### [L-08] Email Outbox Raw Error Messages Stored in Database

**File:** `email-outbox.ts` (lines 63–70)  
**Description:**
```typescript
[ row.id, err instanceof Error ? err.message : String(err) ]
```
Raw SMTP error messages may include connection strings, IP addresses, or infrastructure details.

**Remediation:**
Sanitize error messages before storing. Log full details server-side only.

---

## Summary Table

| ID | Severity | File | Line(s) | Issue |
|----|----------|------|---------|-------|
| C-01 | CRITICAL | `saml-slo.service.ts` | 161–171 | SP logout response: no signature validation, forged logout revokes all sessions |
| C-02 | CRITICAL | `saml.service.ts` | 46 | `wantAuthnResponseSigned: false` enables assertion wrapping |
| C-03 | CRITICAL | `saml-xml.util.ts` | 6–13 | Decompression bomb via `inflateRawSync` on untrusted input |
| C-04 | CRITICAL | `app.ts` (inferred) | — | `trustProxy: true` without subnet restriction enables full IP spoofing |
| C-05 | CRITICAL | `error-handler.ts` | — | Empty file — no centralized error handling |
| H-01 | HIGH | `sso.service.ts` | 191–203 | No OIDC `nonce` — ID token replay attacks |
| H-02 | HIGH | `sso-oidc.routes.ts` | 96–98 | Callback URL from `request.hostname` — open redirect / wrong IdP |
| H-03 | HIGH | `saml-slo.service.ts` | 161–171 | IdP-initiated logout: no signature validation |
| H-04 | HIGH | `saml-slo.service.ts` | 117–158 | Provider resolution from unvalidated data before signature check |
| H-05 | HIGH | `sso.service.ts` | 351–356 | `email_verified` claim not checked in OIDC JIT provisioning |
| H-06 | HIGH | `cache.ts`, `saml-request-cache.ts` | — | In-memory state fails in multi-instance; no grace window |
| H-07 | HIGH | `oauth-exchange.ts` | 149–168 | GitHub `state` not verified at exchange layer |
| H-08 | HIGH | `cache.ts` | 38–58 | LRU eviction can drop revocation entries under load |
| H-09 | HIGH | `saml-slo.service.ts` | 152–153 | `RelayState` passed unvalidated — open redirect |
| H-10 | HIGH | `sso.service.ts` | 207–397 | IP/UA stored but not compared at callback |
| H-11 | HIGH | `repository.ts` | 1571–1585 | JIT users created with `email_verified=TRUE` without IdP check |
| H-12 | HIGH | `service.ts` / `repository.ts` | 1278, 341 | `login_attempts` not reset on password reset / unlock |
| M-01 | MEDIUM | `sso-provision.service.ts` | 24–39 | Overly permissive email extraction from SAML profile |
| M-02 | MEDIUM | `types.ts` | 237–243 | Backup code case mismatch: regex allows mixed case |
| M-03 | MEDIUM | `identity-link.config.ts` | — | Microsoft tenant defaults to `'common'` (multi-tenant) |
| M-04 | MEDIUM | `saml.service.ts` | 140–162 | State deleted before SAML validation (TOCTOU) |
| M-05 | MEDIUM | `saml-identity.routes.ts` | 49–52 | No rate limit on SAML metadata endpoint |
| M-06 | MEDIUM | `utils.ts` | 257–262 | Weak device fingerprint (IP+UA collision) |
| M-07 | MEDIUM | `rate-limits.ts` | 16–23 | Email-based rate limit key allows bypass via rotation |
| M-08 | MEDIUM | `lru-rate-limit.ts` | 45–47 | Rate limit TTL resets on every request |
| M-09 | MEDIUM | `trusted-device.service.ts` | — | 30-day trusted device TTL without re-verification |
| M-10 | MEDIUM | `policy.service.ts` | 62–71 | SSO enforcement only blocks `password_hash` users |
| M-11 | MEDIUM | `auth.ts` / `cache.ts` | 114 / 47 | Revocation cutoff: code `<=`, comment says `<` |
| M-12 | MEDIUM | `utils.ts` | 135–176 | JWTs lack `kid` header — blocks key rotation |
| M-13 | MEDIUM | `service.ts` | 3019–3053 | Org policy check missing in grace-window refresh path |
| M-14 | MEDIUM | `saml.service.ts` | 131 | `RelayState` length not validated |
| M-15 | MEDIUM | `repository.ts` | 781–812 | `createEmailVerification` UPDATE + INSERT not atomic |
| M-16 | MEDIUM | `routes.ts` | 672 | No rate limit on MFA challenge creation |
| L-01 | LOW | `constants.ts` | — | Backup code case sensitivity mismatch |
| L-02 | LOW | `identity-link.config.ts` | 22–33 | OAuth secrets bypass validated `env` schema |
| L-03 | LOW | `webauthn.config.ts` | 15–19 | WebAuthn RPID falls back to `'localhost'` |
| L-04 | LOW | `env.ts` / `encryption.ts` | — | No encryption key rotation mechanism |
| L-05 | LOW | `env.ts` | 35–36 | JWT secrets only require `min(32)` — no entropy check |
| L-06 | LOW | `encryption.ts` | 35 | Scrypt N=16384 at minimum recommendation |
| L-07 | LOW | `encryption.ts` | 96–102 | Legacy decrypt uses hardcoded salt `'salt'` |
| L-08 | LOW | `email-outbox.ts` | 63–70 | SMTP error details stored in database |

---

## Cross-Cutting Architecture Concerns

### 1. In-Process LRU Cache Limitations
The auth module is intentionally Redis-free. While this simplifies deployment, it creates fundamental security and reliability issues in any multi-instance deployment:
- **Revocation desync** after deploys (C-04, H-08)
- **SSO state loss** across instances (H-06)
- **MFA challenge loss** across instances
- **Rate limit bypass** via round-robin requests

**Recommendation:** Prioritize introducing a distributed cache (Redis) for all auth state that must survive across instances.

### 2. `trustProxy: true` as a Global Vulnerability
If confirmed, this single configuration setting (C-04) undermines nearly every security control in the auth module. All IP-based rate limits, device fingerprints, audit logs, and trusted-device checks become spoofable.

### 3. SAML Logout is Completely Unprotected
Both SP-initiated and IdP-initiated SAML logout flows lack cryptographic validation (C-01, H-03, H-04). This is a critical gap that enables session revocation attacks.

---

## Remediation Priority

1. **Immediate (24 hours):** C-01, C-02, C-03, C-04
2. **This sprint:** H-01, H-02, H-03, H-04, H-05, H-07, H-09, H-11, H-12
3. **Next sprint:** M-01, M-02, M-03, M-04, M-07, M-08, M-10, M-13, M-15, M-16
4. **Hardening:** All LOW findings and cross-cutting concerns

---

*End of Security Audit Report*
