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
export const accessTokenBlacklistCache = new LRUCache({
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
export const userRevokeCache = new LRUCache({
    max: 100_000,
    ttl: 15 * 60 * 1000,
    ttlAutopurge: true,
});
export const loginMfaChallengeCache = new LRUCache({
    max: 50_000,
    ttl: 5 * 60 * 1000,
    ttlAutopurge: true,
});
export const stepUpChallengeCache = new LRUCache({
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
export const stepUpFreshnessCache = new LRUCache({
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
export const mfaBackupTempCache = new LRUCache({
    max: 10_000,
    ttl: 24 * 60 * 60 * 1000,
    ttlAutopurge: true,
});
export const oidcLoginStateCache = new LRUCache({
    max: 10_000,
    ttl: 10 * 60 * 1000,
    ttlAutopurge: true,
});
export const samlLoginStateCache = new LRUCache({
    max: 10_000,
    ttl: 10 * 60 * 1000,
    ttlAutopurge: true,
});
export const identityLinkStateCache = new LRUCache({
    max: 10_000,
    ttl: 10 * 60 * 1000,
    ttlAutopurge: true,
});
export const socialLoginStateCache = new LRUCache({
    max: 10_000,
    ttl: 10 * 60 * 1000,
    ttlAutopurge: true,
});
export const webauthnChallengeCache = new LRUCache({
    max: 20_000,
    ttl: 5 * 60 * 1000,
    ttlAutopurge: true,
});
// ---------------------------------------------------------------------------
// Tiny semantic helpers so service code does not poke caches directly.
// ---------------------------------------------------------------------------
export function blacklistAccessToken(sessionId) {
    accessTokenBlacklistCache.set(sessionId, 1);
}
export function isAccessTokenBlacklisted(sessionId) {
    return accessTokenBlacklistCache.has(sessionId);
}
export function revokeAllUserTokens(userId) {
    userRevokeCache.set(userId, Date.now());
}
export function getUserRevokeCutoff(userId) {
    const v = userRevokeCache.get(userId);
    return typeof v === 'number' ? v : null;
}
export function recordStepUpFreshness(sessionId) {
    stepUpFreshnessCache.set(sessionId, Date.now());
}
export function hasFreshStepUp(sessionId) {
    return stepUpFreshnessCache.has(sessionId);
}
//# sourceMappingURL=cache.js.map