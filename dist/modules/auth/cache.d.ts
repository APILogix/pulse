/**
 * In-process LRU caches for the auth module.
 *
 * The auth module is intentionally Redis-free per project decision. Every
 * piece of short-lived auth state (login MFA challenges, step-up challenges,
 * temporary backup-code blobs during MFA setup, access-token blacklist,
 * user-wide revocation cutoffs, and step-up freshness) lives in-process.
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
export declare const accessTokenBlacklistCache: LRUCache<string, 1, unknown>;
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
export declare const userRevokeCache: LRUCache<string, number, unknown>;
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
}
export declare const loginMfaChallengeCache: LRUCache<string, LoginMFAChallenge, unknown>;
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
export declare const stepUpChallengeCache: LRUCache<string, StepUpChallenge, unknown>;
/**
 * Step-up freshness key. Set when a step-up MFA challenge succeeds. Sensitive
 * routes (`POST /auth/password/change`) require this key to exist on the
 * caller's session, ensuring they re-proved possession of MFA recently.
 *
 * key   = sessionId
 * value = epoch millis when freshness was granted
 * TTL   = 5 minutes
 */
export declare const stepUpFreshnessCache: LRUCache<string, number, unknown>;
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
export declare const mfaBackupTempCache: LRUCache<string, string[], unknown>;
export declare function blacklistAccessToken(sessionId: string): void;
export declare function isAccessTokenBlacklisted(sessionId: string): boolean;
export declare function revokeAllUserTokens(userId: string): void;
export declare function getUserRevokeCutoff(userId: string): number | null;
export declare function recordStepUpFreshness(sessionId: string): void;
export declare function hasFreshStepUp(sessionId: string): boolean;
//# sourceMappingURL=cache.d.ts.map