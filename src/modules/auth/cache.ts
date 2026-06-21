/**
 * In-process LRU caches for the auth module.
 *
 * The auth module is intentionally Redis-free per project decision (bootstrap
 * mode). Every piece of short-lived auth state (login MFA challenges, step-up
 * challenges, temporary backup-code blobs during MFA setup, access-token
 * blacklist, user-wide revocation cutoffs, step-up freshness, and per-route
 * rate-limit counters via lru-rate-limit.ts) lives in-process.
 *
 * Tradeoffs you MUST understand:
 *   - State is per-process. With multiple Node instances behind a load
 *     balancer, an MFA challenge issued by node A is not visible to node B.
 *     Use sticky sessions OR run the API as a single instance until you
 *     reintroduce Redis. The auth module's rotation/replay-detection of
 *     refresh tokens is still safe because that state lives in Postgres.
 *   - State does NOT survive restarts. After a deploy, in-flight MFA
 *     challenges are lost; users must restart the login flow. Access-token
 *     blacklists also reset; tokens that were revoked but not yet expired
 *     would be accepted again until the underlying session row is checked
 *     by `authenticate()` (which still reads `user_sessions` from Postgres
 *     and rejects revoked sessions). This makes the loss strictly a quality
 *     issue, not a security regression.
 *
 * All TTLs match the previous Redis values to keep behavior identical from
 * the user's perspective.
 */
import { LRUCache } from 'lru-cache';

/**
 * Per-session access-token blacklist.
 * key   = sessionId (JWT jti)
 * value = `1` (presence is the signal; absence means not blacklisted)
 *
 * TTL: 15 minutes — matches the access-token lifetime. After expiry the
 * blacklist entry is harmless to drop because the token can no longer pass
 * JWT verification.
 */
export const accessTokenBlacklistCache = new LRUCache<string, 1>({
  max: 100_000,
  ttl: 15 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * Per-user revocation cutoff.
 * key   = userId
 * value = epoch millis. Any access token whose `iat * 1000 < cutoff` is
 *         rejected by the authenticate middleware. Set on password change,
 *         password reset, suspension, MFA disable.
 *
 * TTL: 15 minutes — matches access-token lifetime. After 15 minutes any
 * token issued before the cutoff has expired anyway.
 */
export const userRevokeCache = new LRUCache<string, number>({
  max: 100_000,
  ttl: 15 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * Login MFA challenge state.
 * key   = challengeId (random nanoid)
 * value = challenge payload required to complete the login.
 *
 * TTL: 5 minutes.
 */
export interface LoginMFAChallenge {
  userId: string;
  deviceId: string;
  deviceName?: string;
  deviceType?: string;
  clientDeviceType?: string;
  ipAddress: string;
  userAgent: string;
  attempts: number;
  /** Mirrors login `remember_me` so MFA completion issues the same session TTL. */
  rememberMe: boolean;
}

export const loginMfaChallengeCache = new LRUCache<string, LoginMFAChallenge>({
  max: 50_000,
  ttl: 5 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * Step-up MFA challenge state for sensitive in-session actions
 * (password change, MFA disable, MFA device removal).
 * key   = challengeId
 * value = { userId, deviceId, attempts }
 *
 * TTL: 5 minutes.
 */
export interface StepUpChallenge {
  userId: string;
  deviceId: string;
  attempts: number;
}

export const stepUpChallengeCache = new LRUCache<string, StepUpChallenge>({
  max: 50_000,
  ttl: 5 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * Step-up freshness key. Set when a step-up MFA challenge succeeds. Sensitive
 * routes (`POST /auth/password/change`) require this key to exist on the
 * caller's session, ensuring they re-proved possession of MFA recently.
 *
 * key   = sessionId
 * value = epoch millis when freshness was granted
 * TTL   = 5 minutes
 */
export const stepUpFreshnessCache = new LRUCache<string, number>({
  max: 50_000,
  ttl: 5 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * Temporary holding spot for MFA backup-code hashes between
 * `setupMFA` and `verifyMFASetup`. If verify-setup never runs, the entry
 * expires on its own.
 *
 * key   = deviceId
 * value = array of sha256 hashes of plain backup codes
 * TTL   = 24 hours (long enough that "I'll set this up later" works without
 *         abandoning the user's backup codes)
 */
export const mfaBackupTempCache = new LRUCache<string, string[]>({
  max: 10_000,
  ttl: 24 * 60 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * OIDC authorization flow state (PKCE verifier + client metadata).
 * TTL: 10 minutes.
 */
export interface OidcLoginState {
  providerId: string;
  orgId: string;
  codeVerifier: string;
  redirectUri: string;
  rememberMe: boolean;
  ipAddress: string;
  userAgent: string;
  deviceName?: string;
  clientDeviceType?: string;
}

export const oidcLoginStateCache = new LRUCache<string, OidcLoginState>({
  max: 10_000,
  ttl: 10 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * SAML SP-initiated login flow state (RelayState key).
 * TTL: 10 minutes.
 */
export interface SamlLoginState {
  providerId: string;
  orgId: string;
  rememberMe: boolean;
  ipAddress: string;
  userAgent: string;
  deviceName?: string;
  clientDeviceType?: string;
}

export const samlLoginStateCache = new LRUCache<string, SamlLoginState>({
  max: 10_000,
  ttl: 10 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * OAuth account-linking flow (authenticated user binding a social IdP).
 */
export interface IdentityLinkState {
  userId: string;
  provider: 'google' | 'github' | 'microsoft';
  codeVerifier: string;
  redirectUri: string;
}

export const identityLinkStateCache = new LRUCache<string, IdentityLinkState>({
  max: 10_000,
  ttl: 10 * 60 * 1000,
  ttlAutopurge: true,
});

/** Passwordless social login OAuth state (public login, not account linking). */
export interface SocialLoginState {
  provider: 'google' | 'github' | 'microsoft';
  codeVerifier: string;
  redirectUri: string;
  rememberMe: boolean;
  ipAddress: string;
  userAgent: string;
  deviceName?: string;
  clientDeviceType?: string;
}

export const socialLoginStateCache = new LRUCache<string, SocialLoginState>({
  max: 10_000,
  ttl: 10 * 60 * 1000,
  ttlAutopurge: true,
});

/**
 * WebAuthn ceremony challenges (registration, authentication, login MFA).
 * key = challengeId, value = { userId, type, ... }
 */
export interface WebAuthnChallengeState {
  userId: string;
  type: 'registration' | 'authentication' | 'login_mfa' | 'step_up';
  loginMfaChallengeId?: string;
  stepUpChallengeId?: string;
  deviceId?: string;
}

export const webauthnChallengeCache = new LRUCache<string, WebAuthnChallengeState>({
  max: 20_000,
  ttl: 5 * 60 * 1000,
  ttlAutopurge: true,
});

// ---------------------------------------------------------------------------
// Tiny semantic helpers so service code does not poke caches directly.
// ---------------------------------------------------------------------------

export function blacklistAccessToken(sessionId: string): void {
  accessTokenBlacklistCache.set(sessionId, 1);
}

export function isAccessTokenBlacklisted(sessionId: string): boolean {
  return accessTokenBlacklistCache.has(sessionId);
}

export function revokeAllUserTokens(userId: string): void {
  userRevokeCache.set(userId, Date.now());
}

export function getUserRevokeCutoff(userId: string): number | null {
  const v = userRevokeCache.get(userId);
  return typeof v === 'number' ? v : null;
}

export function recordStepUpFreshness(sessionId: string): void {
  stepUpFreshnessCache.set(sessionId, Date.now());
}

export function hasFreshStepUp(sessionId: string): boolean {
  return stepUpFreshnessCache.has(sessionId);
}
