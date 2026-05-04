/**
 * Auth Repository - Pure SQL queries for PostgreSQL
 * No business logic, only data access
 *
 * Flow:
 * 1. User queries read and mutate the users table while respecting soft-delete
 *    rules where relevant.
 * 2. MFA queries manage device state, primary-device selection, and backup-code
 *    hashes.
 * 3. Password/email verification queries create and consume one-time token rows.
 * 4. Session queries persist refresh-token hashes and revoke/expire sessions.
 *
 * Repository functions intentionally accept an optional PoolClient so service
 * methods can compose multiple writes inside a transaction without duplicating
 * SQL.
 */
import type { PoolClient } from 'pg';
import type { MFADevice, UserSession, User } from './types.js';
import { UserStatus, MFAType } from './types.js';
export declare function findUserById(id: string, client?: PoolClient): Promise<User | null>;
export declare function findUserByEmailHash(emailHash: string, client?: PoolClient): Promise<User | null>;
export declare function createUser(data: {
    id: string;
    email: string;
    full_name: string;
    avatar_url?: string | undefined;
    password?: string | undefined;
}, client?: PoolClient): Promise<User>;
export declare function findUserByEmail(email: string, client?: PoolClient): Promise<User | null>;
export declare function updateUser(id: string, data: Partial<Pick<User, 'full_name' | 'avatar_url' | 'timezone' | 'locale' | 'preferred_mfa_method'>>, client?: PoolClient): Promise<User | null>;
export declare function softDeleteUser(id: string, reason: string | null, deletedBy: string | null, client?: PoolClient): Promise<boolean>;
export declare function restoreUser(id: string, client?: PoolClient): Promise<User | null>;
export declare function suspendUser(id: string, reason: string, suspendedBy: string, client?: PoolClient): Promise<User | null>;
export declare function listUsers(options: {
    status?: UserStatus;
    limit?: number;
    offset?: number;
    search?: string;
}, client?: PoolClient): Promise<{
    users: User[];
    total: number;
}>;
export declare function updateLoginAttempts(id: string, attempts: number, client?: PoolClient): Promise<void>;
export declare function recordLogin(id: string, ip: string, userAgent: string, client?: PoolClient): Promise<void>;
export declare function updateUserPassword(id: string, passwordHash: string, passwordHistory: string[], client?: PoolClient): Promise<User | null>;
export declare function findMFADevicesByUserId(userId: string, activeOnly?: boolean, client?: PoolClient): Promise<MFADevice[]>;
export declare function findMFADeviceById(id: string, userId?: string, client?: PoolClient): Promise<MFADevice | null>;
export declare function createMFADevice(data: {
    user_id: string;
    device_type: MFAType;
    device_name: string;
    secret_encrypted: string | null;
    is_primary: boolean;
    device_metadata?: Record<string, unknown>;
}, client?: PoolClient): Promise<MFADevice>;
export declare function verifyMFADevice(id: string, backupCodesHash: string[] | null, client?: PoolClient): Promise<MFADevice | null>;
export declare function updateMFADevicePrimary(userId: string, deviceId: string, client?: PoolClient): Promise<void>;
export declare function disableMFADevice(id: string, reason: string, client?: PoolClient): Promise<boolean>;
export declare function deleteMFADevice(id: string, client?: PoolClient): Promise<boolean>;
export declare function updateUserMFAEnabled(userId: string, enabled: boolean, client?: PoolClient): Promise<void>;
export declare function updateBackupCodesGenerated(userId: string, client?: PoolClient): Promise<void>;
export declare function createPasswordReset(data: {
    user_id: string;
    token_hash: string;
    expires_at: Date;
}, client?: PoolClient): Promise<{
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: Date;
}>;
export declare function findPasswordResetByToken(tokenHash: string, client?: PoolClient): Promise<{
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: Date;
    used_at: Date | null;
} | null>;
export declare function markPasswordResetUsed(id: string, usedIp: string, client?: PoolClient): Promise<void>;
export declare function invalidatePasswordResetsForUser(userId: string, client?: PoolClient): Promise<number>;
export declare function updateMFADeviceBackupCodes(deviceId: string, backupCodesHash: string[] | null, client?: PoolClient): Promise<void>;
export declare function createEmailVerification(data: {
    user_id: string;
    email: string;
    token_hash: string;
    expires_at: Date;
}, client?: PoolClient): Promise<{
    id: string;
    user_id: string;
    email: string;
    token_hash: string;
    expires_at: Date;
}>;
export declare function findEmailVerificationByToken(tokenHash: string, client?: PoolClient): Promise<{
    id: string;
    user_id: string;
    email: string;
    token_hash: string;
    expires_at: Date;
    verified_at: Date | null;
} | null>;
export declare function markEmailVerificationUsed(id: string, client?: PoolClient): Promise<void>;
export declare function markEmailAsVerified(userId: string, client?: PoolClient): Promise<void>;
export declare function createSession(data: {
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
export declare function findSessionByRefreshToken(tokenHash: string, client?: PoolClient): Promise<UserSession | null>;
export declare function findSessionById(id: string, userId?: string, client?: PoolClient): Promise<UserSession | null>;
export declare function listActiveSessionsByUser(userId: string, client?: PoolClient): Promise<UserSession[]>;
export declare function revokeSession(id: string, reason: string, terminatedBy?: string, client?: PoolClient): Promise<boolean>;
export declare function revokeAllOtherSessions(userId: string, currentSessionId: string, client?: PoolClient): Promise<number>;
export declare function updateSessionActivity(id: string, accessTokenJti: string, client?: PoolClient): Promise<void>;
export declare function cleanupExpiredSessions(client?: PoolClient): Promise<number>;
export declare function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
//# sourceMappingURL=repository.d.ts.map