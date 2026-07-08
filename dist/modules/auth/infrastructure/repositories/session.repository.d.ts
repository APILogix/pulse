/**
 * Auth repository — pure SQL access for the auth module.
 *
 * Conventions:
 *   - Every public function accepts an optional PoolClient so callers can
 *     compose multiple writes inside a single withTransaction block.
 *   - Functions never throw on "not found"; they return null/0/false so the
 *     service layer is the single owner of business-rule errors.
 *   - Sensitive bearer credentials (refresh tokens, email-flow tokens) are
 *     stored only as SHA-256 hashes; the plaintext is never persisted.
 */
import type { PoolClient } from 'pg';
import type { UserSession } from '../../domain/types.js';
/**
 * Insert a new session row. Callers MUST pre-allocate the session UUID and
 * the SHA-256 of the issued refresh JWT so the row is created in a single
 * INSERT with no placeholder/race window.
 */
export declare function createSession(data: {
    id: string;
    user_id: string;
    refresh_token_hash: string;
    access_token_jti: string | null;
    device_fingerprint: string | null;
    device_name: string | null;
    device_type: string | null;
    ip_address: string;
    user_agent: string | null;
    expires_at: Date;
    absolute_expires_at: Date;
    mfa_verified_at?: Date | null;
    mfa_expires_at?: Date | null;
    sso_provider_id?: string | null;
    sso_provider_type?: string | null;
    login_method?: string | null;
    saml_name_id?: string | null;
    saml_session_index?: string | null;
}, client?: PoolClient): Promise<UserSession>;
/**
 * Look up a session whose current OR previous refresh-token hash matches the
 * presented value. Constrained by `(id, user_id)` so we only ever return the
 * exact session the JWT claims it belongs to.
 */
export declare function findSessionByAnyRefreshTokenHash(tokenHash: string, sessionId: string, userId: string, client?: PoolClient): Promise<{
    session: UserSession;
    matchedPrevious: boolean;
} | null>;
export declare function findSessionById(id: string, userId?: string, client?: PoolClient): Promise<UserSession | null>;
export declare function listActiveSessionsByUser(userId: string, client?: PoolClient): Promise<UserSession[]>;
export declare function listOtherActiveSessionIds(userId: string, currentSessionId: string, client?: PoolClient): Promise<string[]>;
export declare function countActiveSessionsByUser(userId: string, client?: PoolClient): Promise<number>;
export declare function revokeOldestSessions(userId: string, keepCount: number, client?: PoolClient): Promise<number>;
export declare function revokeSession(id: string, reason: string, terminatedBy?: string, client?: PoolClient): Promise<boolean>;
/**
 * Revoke every active session of a user. Used by suspend, password reset,
 * MFA disable, and refresh-token reuse responses.
 */
export declare function revokeAllUserSessions(userId: string, reason: string, client?: PoolClient): Promise<number>;
/**
 * Revoke every active session except the caller's. Used by `/sessions/others`
 * and by the password-change flow.
 */
export declare function revokeAllOtherSessions(userId: string, currentSessionId: string, reason: string, client?: PoolClient): Promise<number>;
export declare function revokeAllSessionsForUser(userId: string, reason: string, client?: PoolClient): Promise<number>;
/**
 * Atomic refresh-token rotation.
 *
 * Updates the session row only if the supplied old hash still matches
 * `refresh_token_hash`. The new hash is moved into `refresh_token_hash`,
 * the old hash is recorded into `previous_refresh_token_hash`, and the
 * rotation timestamp is stamped so the service can apply a grace window for
 * legitimate retry storms.
 *
 * Returns true on success; false when CAS fails (caller treats that as a
 * concurrent rotation = potential reuse).
 */
export declare function rotateRefreshToken(sessionId: string, oldHash: string, newHash: string, newExpiresAt: Date, client?: PoolClient): Promise<boolean>;
export declare function touchSessionActivity(sessionId: string, client?: PoolClient): Promise<void>;
export declare function cleanupExpiredSessions(client?: PoolClient): Promise<number>;
export declare function purgeOldRevokedSessions(olderThanDays?: number, client?: PoolClient): Promise<number>;
//# sourceMappingURL=session.repository.d.ts.map