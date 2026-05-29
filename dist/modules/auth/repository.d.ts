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
import type { MFADevice, User, UserSession, UserStatus, MFAType } from './types.js';
export declare function findUserById(id: string, client?: PoolClient): Promise<User | null>;
export declare function findUserByEmailHash(emailHash: string, client?: PoolClient): Promise<User | null>;
/**
 * Find a user even when soft-deleted. Used by admin restore flows.
 */
export declare function findUserByIdIncludingDeleted(id: string, client?: PoolClient): Promise<User | null>;
export declare function createUser(data: {
    id: string;
    email: string;
    full_name: string;
    avatar_url?: string | null;
    password?: string | null;
    accepted_terms_version?: string | null;
    accepted_privacy_version?: string | null;
    marketing_consent?: boolean;
}, client?: PoolClient): Promise<User>;
export declare function updateUser(id: string, data: Partial<Pick<User, 'full_name' | 'avatar_url' | 'timezone' | 'locale' | 'preferred_mfa_method'>>, client?: PoolClient): Promise<User | null>;
export declare function softDeleteUser(id: string, reason: string | null, deletedBy: string | null, client?: PoolClient): Promise<boolean>;
export declare function restoreUser(id: string, client?: PoolClient): Promise<User | null>;
/**
 * Suspend a user. Records the suspending admin in dedicated columns so
 * `deleted_by` / `deleted_at` remain exclusively for soft-delete semantics.
 */
export declare function suspendUser(id: string, reason: string, suspendedBy: string, client?: PoolClient): Promise<User | null>;
/**
 * Cursor-paginated user list for the admin endpoint. Cursor is a tuple of
 * (created_at, id) so it is stable when many rows share a created_at.
 */
export interface ListUsersOptions {
    status?: UserStatus;
    limit?: number;
    offset?: number;
    search?: string;
}
export declare function listUsers(options: ListUsersOptions, client?: PoolClient): Promise<{
    users: User[];
    total: number;
}>;
/**
 * Atomic failed-login update.
 *
 * Increments `login_attempts` in the database itself so concurrent failed
 * attempts cannot race and produce an under-counted value. The lockout
 * schedule is encoded as a SQL CASE that mirrors `lockoutDurationSeconds()`
 * in utils.ts, which keeps the application and database in agreement.
 *
 * Returns the resulting `(login_attempts, locked_until)` so the service can
 * decide whether to emit a `security_events` row for the lockout.
 */
export declare function recordFailedLogin(id: string, ip: string, client?: PoolClient): Promise<{
    login_attempts: number;
    locked_until: Date | null;
}>;
export declare function recordLogin(id: string, ip: string, userAgent: string, client?: PoolClient): Promise<void>;
export declare function updateUserPassword(id: string, passwordHash: string, passwordHistory: string[], client?: PoolClient): Promise<User | null>;
export type SecurityEventType = 'brute_force_attempt' | 'suspicious_ip' | 'impossible_travel' | 'credential_stuffing' | 'account_takeover' | 'privilege_escalation' | 'mfa_disable_requested' | 'refresh_token_reuse';
export declare function recordSecurityEvent(data: {
    event_type: SecurityEventType;
    severity: number;
    user_id: string | null;
    ip_address: string;
    user_agent?: string | null;
    description: string;
    evidence?: Record<string, unknown>;
    action_taken?: string | null;
    blocked_until?: Date | null;
}, client?: PoolClient): Promise<void>;
export declare function findMFADevicesByUserId(userId: string, activeOnly?: boolean, client?: PoolClient): Promise<MFADevice[]>;
export declare function findMFADeviceById(id: string, userId?: string, client?: PoolClient): Promise<MFADevice | null>;
/**
 * Find any (active or inactive) MFA device of a given type for a user.
 * Used by the setup flow so a previously-disabled device can be reactivated
 * instead of creating duplicates that conflict with future operations.
 */
export declare function findAnyMFADeviceByType(userId: string, deviceType: MFAType, client?: PoolClient): Promise<MFADevice | null>;
export declare function createMFADevice(data: {
    user_id: string;
    device_type: MFAType;
    device_name: string;
    secret_encrypted: string | null;
    is_primary: boolean;
    device_metadata?: Record<string, unknown>;
}, client?: PoolClient): Promise<MFADevice>;
/**
 * Reset an existing MFA device row for a fresh setup. Called when a user
 * who previously disabled MFA decides to re-enable it.
 */
export declare function resetMFADeviceForReSetup(id: string, data: {
    device_name: string;
    secret_encrypted: string | null;
    is_primary: boolean;
    device_metadata?: Record<string, unknown>;
}, client?: PoolClient): Promise<MFADevice | null>;
export declare function verifyMFADevice(id: string, backupCodesHash: string[] | null, client?: PoolClient): Promise<MFADevice | null>;
export declare function updateMFADevicePrimary(userId: string, deviceId: string, client?: PoolClient): Promise<void>;
export declare function disableMFADevice(id: string, reason: string, client?: PoolClient): Promise<boolean>;
export declare function disableAllMFADevices(userId: string, reason: string, client?: PoolClient): Promise<number>;
export declare function updateUserMFAEnabled(userId: string, enabled: boolean, client?: PoolClient): Promise<void>;
export declare function updateBackupCodesGenerated(userId: string, client?: PoolClient): Promise<void>;
export declare function updateMFADeviceBackupCodes(deviceId: string, backupCodesHash: string[] | null, client?: PoolClient): Promise<void>;
export declare function setBackupCodesForAllUserDevices(userId: string, backupCodesHash: string[], client?: PoolClient): Promise<void>;
export declare function updateMFADeviceLastUsed(deviceId: string, ipAddress: string, client?: PoolClient): Promise<void>;
export type EmailTokenPurpose = 'email_verification' | 'password_reset' | 'mfa_disable';
export type EmailVerificationRecord = {
    id: string;
    user_id: string;
    email: string;
    token_hash: string;
    purpose: EmailTokenPurpose;
    expires_at: Date;
    verified_at: Date | null;
    created_at?: Date;
};
/**
 * Insert a fresh email-flow token. Any prior unconsumed token for the same
 * (user, email, purpose) tuple is invalidated by setting verified_at = NOW()
 * so only the newest token is consumable.
 */
export declare function createEmailVerification(data: {
    user_id: string;
    email: string;
    token_hash: string;
    purpose: EmailTokenPurpose;
    expires_at: Date;
}, client?: PoolClient): Promise<EmailVerificationRecord>;
/**
 * Atomic consume. Returns the row only if it was previously unconsumed and
 * not expired. Concurrent callers see at most one success.
 */
export declare function consumeEmailVerificationToken(tokenHash: string, purpose: EmailTokenPurpose, client?: PoolClient): Promise<EmailVerificationRecord | null>;
export declare function findEmailVerificationByTokenHash(tokenHash: string, purpose: EmailTokenPurpose, client?: PoolClient): Promise<EmailVerificationRecord | null>;
export declare function invalidateAllUserTokens(userId: string, client?: PoolClient): Promise<void>;
export declare function markEmailAsVerified(userId: string, client?: PoolClient): Promise<void>;
export declare function deleteExpiredEmailTokens(client?: PoolClient): Promise<number>;
/**
 * Insert a fresh email MFA OTP for a device. Any prior unconsumed OTP for the
 * same device is invalidated first so only the newest code is valid.
 *
 * Only the SHA-256 hash of the 6-digit code is persisted; the plaintext is
 * emailed to the user and never stored.
 */
export declare function createEmailMfaOtp(userId: string, deviceId: string, codeHash: string, ttlSeconds: number, client?: PoolClient): Promise<void>;
/**
 * Atomically consume an email MFA OTP. Returns true if the code matched a
 * row that was not yet used and not expired. Concurrent callers see at most
 * one success.
 */
export declare function consumeEmailMfaOtp(deviceId: string, codeHash: string, client?: PoolClient): Promise<boolean>;
export declare function deleteExpiredEmailMfaOtps(client?: PoolClient): Promise<number>;
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
export declare function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
//# sourceMappingURL=repository.d.ts.map