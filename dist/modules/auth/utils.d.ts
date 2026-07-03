export declare const ACCESS_TOKEN_TTL_SECONDS: number;
export declare const REFRESH_TOKEN_TTL_SECONDS: number;
/** Extended refresh sliding window when the user opts in at login. */
export declare const REMEMBER_ME_REFRESH_TTL_SECONDS: number;
export declare const ABSOLUTE_SESSION_TTL_SECONDS: number;
export { BACKUP_CODE_HEX_LENGTH, BACKUP_CODE_HEX_REGEX, } from './constants.js';
export declare const MFA_LOGIN_CHALLENGE_TTL_SECONDS: number;
export declare const STEP_UP_CHALLENGE_TTL_SECONDS: number;
export declare const STEP_UP_FRESHNESS_TTL_SECONDS: number;
export declare const PASSWORD_RESET_TTL_SECONDS: number;
export declare const EMAIL_VERIFICATION_TTL_SECONDS: number;
export declare const MFA_DISABLE_TOKEN_TTL_SECONDS: number;
export declare const REFRESH_GRACE_WINDOW_MS: number;
export declare const REFRESH_COOKIE_NAME: string;
export declare function getRefreshCookieNames(): readonly string[];
export declare function getRefreshCookieValue(cookies: Record<string, string | undefined> | undefined): string | undefined;
/**
 * SHA-256 hash a token for at-rest storage. Refresh tokens, email-flow tokens,
 * and any other bearer credential MUST be stored as a hash so a database
 * compromise does not yield usable credentials.
 */
export declare function hashToken(token: string): string;
/**
 * Generate a cryptographically secure random token, hex-encoded.
 * Default 32 bytes => 256 bits of entropy => collision-free for our scale.
 */
export declare function generateSecureToken(byteLength?: number): string;
/**
 * Purpose-bind a hash for an email-flow token. Combining the purpose into
 * the hash input prevents a token issued for one flow being replayed against
 * another (verification token vs reset token vs MFA-disable token), even
 * though all three flows share the same backing table.
 */
export type EmailFlowPurpose = 'email_verification' | 'password_reset' | 'mfa_disable' | 'account_unlock' | 'account_deletion';
/** TTLs for additional email-bound flows (seconds). */
export declare const ACCOUNT_UNLOCK_TTL_SECONDS: number;
export declare const ACCOUNT_DELETION_GRACE_SECONDS: number;
export declare const ACCOUNT_DELETION_TOKEN_TTL_SECONDS: number;
export declare const EMAIL_FLOW_TOKEN_BYTES = 48;
export declare function hashEmailFlowToken(purpose: EmailFlowPurpose, token: string): string;
/**
 * Email-flow bearer links use extra entropy because the token may spend time
 * in inboxes, browsers, and link scanners before redemption.
 */
export declare function generateEmailFlowToken(): string;
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
export declare function generateAccessToken(userId: string, sessionId: string, mfaVerified: boolean): string;
export declare function generateRefreshToken(userId: string, sessionId: string, expiresInSeconds?: number): string;
export declare function verifyAccessToken(token: string): AccessTokenClaims;
export declare function verifyRefreshToken(token: string): RefreshTokenClaims;
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
export declare function getRefreshCookieOptions(maxAgeSeconds?: number): {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "none" | "lax";
    maxAge: number;
    path: string;
    signed: boolean;
};
/**
 * A pre-computed bcrypt hash of an unguessable string. Used by the login
 * service to run a fake bcrypt comparison when the requested email does not
 * exist, equalizing the response timing with the legitimate-user code path.
 *
 * The hash is generated once at startup; bcrypt cost matches the production
 * cost so timing is comparable.
 */
export declare const FAKE_BCRYPT_HASH: string;
/**
 * Constant-time-ish password verifier used during login to swallow whether or
 * not the user actually exists. Always awaits a real bcrypt compare so the
 * caller's response latency does not leak account existence.
 */
export declare function timingSafeFakePasswordCompare(candidate: string): Promise<void>;
/**
 * Normalize an email for storage and lookup. Trims whitespace and lowercases
 * the entire string. We do not strip plus-aliases because legitimate users
 * intentionally use them, and stripping would weaken uniqueness guarantees.
 */
/** Stable device fingerprint for trusted-device and session rows. */
export declare function buildDeviceFingerprint(ip: string, userAgent: string): string;
export declare function normalizeEmail(email: string): string;
/**
 * Build the password-history array.
 *
 * Stores the most recent 5 password hashes (current + 4 previous) so the
 * service layer can refuse password reuse. De-duplicates by hash so the same
 * hash cannot crowd out distinct older entries.
 */
export declare function buildPasswordHistory(currentHistory: unknown, currentPasswordHash: string | null): string[];
/**
 * Compute an exponential-backoff lockout duration in seconds based on the
 * number of consecutive failed login attempts. Used in place of the previous
 * trigger-based hard-suspension behavior.
 *
 * Returns 0 when no lockout is required. The same schedule is encoded in the
 * `recordFailedLogin` SQL CASE so both the application and the database
 * agree.
 */
export declare function lockoutDurationSeconds(failedAttempts: number): number;
//# sourceMappingURL=utils.d.ts.map