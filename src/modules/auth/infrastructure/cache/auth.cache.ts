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
import { redis } from '../../../../config/redis.js';
import { CacheFlags } from '../../../../config/cache-flags.js';
import { registerL1Cache, publishInvalidation } from '../../../../shared/cache/invalidation-bus.js';

export const authSessionCache = new LRUCache<string, any>({
  max: 50_000,
  ttl: 30_000, // 30 seconds L1
  updateAgeOnGet: false,
});

registerL1Cache('authSession', authSessionCache);

export async function getCachedAuthSession(sessionId: string): Promise<any | null> {
  const local = authSessionCache.get(sessionId);
  if (local) {
    return local;
  }
  if (CacheFlags.authRedisState) {
    try {
      const raw = await redis.get(`auth:session:${sessionId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        authSessionCache.set(sessionId, parsed);
        return parsed;
      }
    } catch {
      // Degrade gracefully
    }
  }
  return null;
}

export async function setCachedAuthSession(
  sessionId: string,
  sessionRecord: any,
  ttlSeconds: number = 30,
): Promise<void> {
  authSessionCache.set(sessionId, sessionRecord, { ttl: ttlSeconds * 1000 });
  if (CacheFlags.authRedisState) {
    try {
      await redis.set(`auth:session:${sessionId}`, JSON.stringify(sessionRecord), 'EX', ttlSeconds);
    } catch {
      // Degrade gracefully
    }
  }
}

export async function invalidateCachedAuthSession(sessionId: string): Promise<void> {
  authSessionCache.delete(sessionId);
  if (CacheFlags.authRedisState) {
    try {
      await redis.del(`auth:session:${sessionId}`);
    } catch {
      // Degrade gracefully
    }
  }
  publishInvalidation('authSession', sessionId).catch(() => {});
}

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
  switchAttempts?: number;
  lastSwitchedAt?: number;
  /** Mirrors login `remember_me` so MFA completion issues the same session TTL. */
  rememberMe: boolean;
  /** Mirrors login `trust_device`; applied only after MFA has succeeded. */
  trustDevice: boolean;
  availableMethods?: Array<{
    id: string;
    type: string;
    name: string;
    display_hint?: string | null;
    is_primary?: boolean;
    last_used_at?: Date | null;
  }>;
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
  nonce: string;
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
  provider: 'google' | 'github';
  codeVerifier?: string;
  redirectUri?: string;
  nonce?: string;
}

export const identityLinkStateCache = new LRUCache<string, IdentityLinkState>({
  max: 10_000,
  ttl: 10 * 60 * 1000,
  ttlAutopurge: true,
});

/** Passwordless social login OAuth state (public login flow). */
export interface SocialLoginState {
  provider: 'google' | 'github';
  codeVerifier?: string;
  redirectUri?: string;
  nonce?: string;
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

export async function blacklistAccessToken(sessionId: string): Promise<void> {
  accessTokenBlacklistCache.set(sessionId, 1);
  await invalidateCachedAuthSession(sessionId);
  if (CacheFlags.authRedisState) {
    try {
      await redis.set(`auth:blacklist:${sessionId}`, '1', 'EX', 15 * 60);
    } catch {
      // Degrade gracefully to local cache
    }
  }
}

export async function isAccessTokenBlacklisted(sessionId: string): Promise<boolean> {
  if (accessTokenBlacklistCache.has(sessionId)) {
    return true;
  }
  if (CacheFlags.authRedisState) {
    try {
      const exists = await redis.get(`auth:blacklist:${sessionId}`);
      if (exists) {
        // Read-through L1 cache with TTL <= 5s
        accessTokenBlacklistCache.set(sessionId, 1, { ttl: 5000 });
        return true;
      }
    } catch {
      // Degrade gracefully to local cache
    }
  }
  return false;
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  const now = Date.now();
  userRevokeCache.set(userId, now);
  if (CacheFlags.authRedisState) {
    try {
      await redis.set(`auth:cutoff:${userId}`, String(now), 'EX', 15 * 60);
    } catch {
      // Degrade gracefully to local cache
    }
  }
}

export async function getUserRevokeCutoff(userId: string): Promise<number | null> {
  const v = userRevokeCache.get(userId);
  if (typeof v === 'number') {
    return v;
  }
  if (CacheFlags.authRedisState) {
    try {
      const raw = await redis.get(`auth:cutoff:${userId}`);
      if (raw) {
        const val = Number(raw);
        if (!Number.isNaN(val)) {
          // Read-through L1 cache with TTL <= 5s
          userRevokeCache.set(userId, val, { ttl: 5000 });
          return val;
        }
      }
    } catch {
      // Degrade gracefully to local cache
    }
  }
  return null;
}

export async function recordStepUpFreshness(sessionId: string): Promise<void> {
  const now = Date.now();
  stepUpFreshnessCache.set(sessionId, now);
  if (CacheFlags.authRedisState) {
    try {
      await redis.set(`auth:mfa:freshness:${sessionId}`, String(now), 'EX', 5 * 60);
    } catch {
      // Degrade gracefully
    }
  }
}

export async function hasFreshStepUp(sessionId: string): Promise<boolean> {
  if (stepUpFreshnessCache.has(sessionId)) {
    return true;
  }
  if (CacheFlags.authRedisState) {
    try {
      const exists = await redis.get(`auth:mfa:freshness:${sessionId}`);
      if (exists) {
        stepUpFreshnessCache.set(sessionId, Number(exists) || Date.now(), { ttl: 5000 });
        return true;
      }
    } catch {
      // Degrade gracefully
    }
  }
  return false;
}
