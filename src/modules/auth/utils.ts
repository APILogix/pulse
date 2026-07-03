/**
 * Auth utility functions.
 *
 * Responsibilities:
 *   - Sign and verify access / refresh JWTs with separate secrets and claims.
 *   - Provide cookie options for refresh-token transport.
 *   - Hash tokens for at-rest storage (refresh-token hash, email-token hash).
 *   - Provide a constant-time fake bcrypt verification used to equalize the
 *     timing of failed-login responses to defeat enumeration via timing.
 *   - Maintain password-reuse history.
 *   - Compute application-driven exponential lockout durations.
 *
 * The secrets and TTLs in this file are intentionally centralized so service
 * code does not duplicate JWT configuration.
 */
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

import { env } from '../../config/env.js';

// ---------------------------------------------------------------------------
// Token TTLs (seconds)
// ---------------------------------------------------------------------------
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Extended refresh sliding window when the user opts in at login. */
export const REMEMBER_ME_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const ABSOLUTE_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export {
  BACKUP_CODE_HEX_LENGTH,
  BACKUP_CODE_HEX_REGEX,
} from './constants.js';

export const MFA_LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60;
export const STEP_UP_CHALLENGE_TTL_SECONDS = 5 * 60;
export const STEP_UP_FRESHNESS_TTL_SECONDS = 5 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
export const MFA_DISABLE_TOKEN_TTL_SECONDS = 30 * 60; // 30 min; user must
                                                      // confirm the email link
                                                      // shortly after request.

// Refresh-token rotation grace window. If a client retries a refresh within
// this window with the previous (rotated) hash, we treat it as a network
// retry rather than a token-theft replay. Outside the window, true reuse
// detection kicks in and revokes the entire session family.
export const REFRESH_GRACE_WINDOW_MS = 30 * 1000;

const SECURE_REFRESH_COOKIE_NAME = '__Host-refresh_token';
const DEV_REFRESH_COOKIE_NAME = 'refresh_token';
const LEGACY_REFRESH_COOKIE_NAMES = [
  SECURE_REFRESH_COOKIE_NAME,
  DEV_REFRESH_COOKIE_NAME,
  '_HOST_refresh_token',
] as const;

function useSecureRefreshCookiePrefix(): boolean {
  return env.NODE_ENV !== 'development';
}

// Refresh-token cookie name. We only use the `__Host-` prefix when Secure is
// also enabled; browsers reject `__Host-` cookies over plain HTTP.
export const REFRESH_COOKIE_NAME = useSecureRefreshCookiePrefix()
  ? SECURE_REFRESH_COOKIE_NAME
  : DEV_REFRESH_COOKIE_NAME;

export function getRefreshCookieNames(): readonly string[] {
  return LEGACY_REFRESH_COOKIE_NAMES;
}

export function getRefreshCookieValue(
  cookies: Record<string, string | undefined> | undefined,
): string | undefined {
  if (!cookies) return undefined;
  for (const name of LEGACY_REFRESH_COOKIE_NAMES) {
    const value = cookies[name];
    if (value) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// JWT issuer / audience claims (defense-in-depth against token confusion)
// ---------------------------------------------------------------------------
const JWT_ISSUER = 'pulsiv';
const JWT_AUDIENCE = 'pulsiv';

// ---------------------------------------------------------------------------
// Cryptographic helpers
// ---------------------------------------------------------------------------

/**
 * SHA-256 hash a token for at-rest storage. Refresh tokens, email-flow tokens,
 * and any other bearer credential MUST be stored as a hash so a database
 * compromise does not yield usable credentials.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure random token, hex-encoded.
 * Default 32 bytes => 256 bits of entropy => collision-free for our scale.
 */
export function generateSecureToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}

/**
 * Purpose-bind a hash for an email-flow token. Combining the purpose into
 * the hash input prevents a token issued for one flow being replayed against
 * another (verification token vs reset token vs MFA-disable token), even
 * though all three flows share the same backing table.
 */
export type EmailFlowPurpose =
  | 'email_verification'
  | 'password_reset'
  | 'mfa_disable'
  | 'account_unlock'
  | 'account_deletion';

/** TTLs for additional email-bound flows (seconds). */
export const ACCOUNT_UNLOCK_TTL_SECONDS = 60 * 60;
export const ACCOUNT_DELETION_GRACE_SECONDS = 7 * 24 * 60 * 60;
export const ACCOUNT_DELETION_TOKEN_TTL_SECONDS = 60 * 60;
export const EMAIL_FLOW_TOKEN_BYTES = 48;

export function hashEmailFlowToken(
  purpose: EmailFlowPurpose,
  token: string,
): string {
  return hashToken(`${purpose}:${token}`);
}

/**
 * Email-flow bearer links use extra entropy because the token may spend time
 * in inboxes, browsers, and link scanners before redemption.
 */
export function generateEmailFlowToken(): string {
  return generateSecureToken(EMAIL_FLOW_TOKEN_BYTES);
}

// ---------------------------------------------------------------------------
// Access / refresh token signing
// ---------------------------------------------------------------------------

export interface AccessTokenClaims {
  sub: string;
  jti: string;
  mfa_verified: boolean;
  type: 'access';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  type: 'refresh';
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export function generateAccessToken(
  userId: string,
  sessionId: string,
  mfaVerified: boolean,
): string {
  return jwt.sign(
    {
      sub: userId,
      jti: sessionId,
      mfa_verified: mfaVerified,
      type: 'access',
    },
    env.JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
  );
}

export function generateRefreshToken(
  userId: string,
  sessionId: string,
  expiresInSeconds: number = REFRESH_TOKEN_TTL_SECONDS,
): string {
  return jwt.sign(
    {
      sub: userId,
      jti: sessionId,
      type: 'refresh',
    },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: expiresInSeconds,
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  }) as RefreshTokenClaims;
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

/**
 * Refresh-token cookie configuration.
 *
 * In secure environments the cookie name is `__Host-refresh_token`, which the
 * browser only accepts when:
 *   - Secure is set
 *   - Path is "/"
 *   - Domain attribute is absent
 *
 * In development we fall back to `refresh_token` because browsers reject
 * `__Host-` cookies over plain HTTP.
 *
 * In development we relax `secure` so tests work over plain HTTP. In every
 * other environment Secure is mandatory.
 */
export function getRefreshCookieOptions(maxAgeSeconds?: number) {
  const maxAge =
    (maxAgeSeconds ?? REFRESH_TOKEN_TTL_SECONDS) * 1000;
  const secure = useSecureRefreshCookiePrefix();
  return {
    httpOnly: true,
    secure,
    sameSite: (secure ? 'none' : 'lax') as 'none' | 'lax',
    maxAge,
    path: '/',
    signed: true,
  };
}

// ---------------------------------------------------------------------------
// Password helpers
// ---------------------------------------------------------------------------

/**
 * A pre-computed bcrypt hash of an unguessable string. Used by the login
 * service to run a fake bcrypt comparison when the requested email does not
 * exist, equalizing the response timing with the legitimate-user code path.
 *
 * The hash is generated once at startup; bcrypt cost matches the production
 * cost so timing is comparable.
 */
export const FAKE_BCRYPT_HASH = bcrypt.hashSync(
  generateSecureToken(16),
  12,
);

/**
 * Constant-time-ish password verifier used during login to swallow whether or
 * not the user actually exists. Always awaits a real bcrypt compare so the
 * caller's response latency does not leak account existence.
 */
export async function timingSafeFakePasswordCompare(
  candidate: string,
): Promise<void> {
  await bcrypt.compare(candidate, FAKE_BCRYPT_HASH);
}

/**
 * Normalize an email for storage and lookup. Trims whitespace and lowercases
 * the entire string. We do not strip plus-aliases because legitimate users
 * intentionally use them, and stripping would weaken uniqueness guarantees.
 */
/** Stable device fingerprint for trusted-device and session rows. */
export function buildDeviceFingerprint(ip: string, userAgent: string): string {
  return createHash('sha256')
    .update(`${ip}:${userAgent}`)
    .digest('hex')
    .substring(0, 32);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Build the password-history array.
 *
 * Stores the most recent 5 password hashes (current + 4 previous) so the
 * service layer can refuse password reuse. De-duplicates by hash so the same
 * hash cannot crowd out distinct older entries.
 */
export function buildPasswordHistory(
  currentHistory: unknown,
  currentPasswordHash: string | null,
): string[] {
  const history = Array.isArray(currentHistory)
    ? currentHistory.filter((entry): entry is string => typeof entry === 'string')
    : [];

  const ordered = [currentPasswordHash, ...history].filter(
    (entry): entry is string => Boolean(entry),
  );

  // De-duplicate while preserving insertion order.
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const h of ordered) {
    if (!seen.has(h)) {
      seen.add(h);
      uniq.push(h);
    }
  }

  return uniq.slice(0, 5);
}

/**
 * Compute an exponential-backoff lockout duration in seconds based on the
 * number of consecutive failed login attempts. Used in place of the previous
 * trigger-based hard-suspension behavior.
 *
 * Returns 0 when no lockout is required. The same schedule is encoded in the
 * `recordFailedLogin` SQL CASE so both the application and the database
 * agree.
 */
export function lockoutDurationSeconds(failedAttempts: number): number {
  if (failedAttempts < 5) return 0;
  if (failedAttempts < 7) return 60; // 1 minute
  if (failedAttempts < 9) return 5 * 60; // 5 minutes
  if (failedAttempts < 11) return 15 * 60; // 15 minutes
  return 60 * 60; // 1 hour cap
}
