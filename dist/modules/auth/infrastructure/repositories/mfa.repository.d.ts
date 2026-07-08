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
import type { MFADevice, MFAType } from '../../domain/types.js';
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
    display_hint?: string | null;
    phone_number_encrypted?: string | null;
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
//# sourceMappingURL=mfa.repository.d.ts.map