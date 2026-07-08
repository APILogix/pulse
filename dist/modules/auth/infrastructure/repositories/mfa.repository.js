import { withTransaction } from './transaction.js';
import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
const repositoryLogger = logger.child({ component: 'auth-repository' });
function shouldDestroyTransactionClient(error) {
    const pgCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    return (pgCode.startsWith('08') ||
        pgCode === '57P01' ||
        pgCode === '57P02' ||
        pgCode === '57P03' ||
        message.includes('Query read timeout') ||
        message.includes('Connection terminated') ||
        message.includes('Connection ended unexpectedly') ||
        message.includes('Connection terminated unexpectedly'));
}
// ============================================================================
// MFA DEVICE QUERIES
// ============================================================================
export async function findMFADevicesByUserId(userId, activeOnly = true, client) {
    const db = client || pool;
    let query = `SELECT * FROM user_mfa_devices WHERE user_id = $1`;
    if (activeOnly)
        query += ` AND is_active = TRUE`;
    query += ` ORDER BY is_primary DESC, created_at DESC`;
    const result = await db.query(query, [userId]);
    return result.rows;
}
export async function findMFADeviceById(id, userId, client) {
    const db = client || pool;
    let query = `SELECT * FROM user_mfa_devices WHERE id = $1`;
    const params = [id];
    if (userId) {
        query += ` AND user_id = $2`;
        params.push(userId);
    }
    const result = await db.query(query, params);
    return result.rows[0] || null;
}
/**
 * Find any (active or inactive) MFA device of a given type for a user.
 * Used by the setup flow so a previously-disabled device can be reactivated
 * instead of creating duplicates that conflict with future operations.
 */
export async function findAnyMFADeviceByType(userId, deviceType, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM user_mfa_devices
     WHERE user_id = $1 AND device_type = $2
     ORDER BY is_primary DESC, created_at DESC
     LIMIT 1`, [userId, deviceType]);
    return result.rows[0] || null;
}
export async function createMFADevice(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_mfa_devices (
       user_id, device_type, device_name, secret_encrypted, is_primary,
       device_metadata, display_hint, phone_number_encrypted, is_active, verified
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, FALSE)
     RETURNING *`, [
        data.user_id,
        data.device_type,
        data.device_name,
        data.secret_encrypted,
        data.is_primary,
        JSON.stringify(data.device_metadata || {}),
        data.display_hint ?? null,
        data.phone_number_encrypted ?? null,
    ]);
    return result.rows[0];
}
/**
 * Reset an existing MFA device row for a fresh setup. Called when a user
 * who previously disabled MFA decides to re-enable it.
 */
export async function resetMFADeviceForReSetup(id, data, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices
     SET device_name = $2,
         secret_encrypted = $3,
         is_primary = $4,
         is_active = TRUE,
         verified = FALSE,
         verified_at = NULL,
         disabled_at = NULL,
         disabled_reason = NULL,
         backup_codes_hash = '[]'::jsonb,
         device_metadata = $5,
         last_used_at = NULL,
         last_used_ip = NULL,
         sign_count = 0,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`, [
        id,
        data.device_name,
        data.secret_encrypted,
        data.is_primary,
        JSON.stringify(data.device_metadata || {}),
    ]);
    return result.rows[0] || null;
}
export async function verifyMFADevice(id, backupCodesHash, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices
     SET verified = TRUE, verified_at = NOW(),
         backup_codes_hash = $2,
         is_active = TRUE,
         disabled_at = NULL,
         disabled_reason = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`, [id, backupCodesHash ? JSON.stringify(backupCodesHash) : '[]']);
    return result.rows[0] || null;
}
export async function updateMFADevicePrimary(userId, deviceId, client) {
    const exec = async (db) => {
        await db.query(`UPDATE user_mfa_devices
       SET is_primary = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND is_primary = TRUE AND id <> $2`, [userId, deviceId]);
        await db.query(`UPDATE user_mfa_devices
       SET is_primary = TRUE, updated_at = NOW()
       WHERE id = $2 AND user_id = $1`, [userId, deviceId]);
    };
    if (client) {
        await exec(client);
        return;
    }
    await withTransaction(async (tx) => exec(tx));
}
export async function disableMFADevice(id, reason, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices
     SET is_active = FALSE,
         is_primary = FALSE,
         disabled_at = NOW(),
         disabled_reason = $2,
         updated_at = NOW()
     WHERE id = $1`, [id, reason]);
    return (result.rowCount ?? 0) > 0;
}
export async function disableAllMFADevices(userId, reason, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices
     SET is_active = FALSE,
         is_primary = FALSE,
         disabled_at = NOW(),
         disabled_reason = $2,
         updated_at = NOW()
     WHERE user_id = $1 AND is_active = TRUE`, [userId, reason]);
    return result.rowCount ?? 0;
}
export async function updateUserMFAEnabled(userId, enabled, client) {
    const db = client || pool;
    await db.query(`UPDATE users
     SET mfa_enabled = $2,
         mfa_enforced_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1`, [userId, enabled]);
}
export async function updateBackupCodesGenerated(userId, client) {
    const db = client || pool;
    await db.query(`UPDATE users
     SET mfa_backup_codes_generated_at = NOW(), updated_at = NOW()
     WHERE id = $1`, [userId]);
}
export async function updateMFADeviceBackupCodes(deviceId, backupCodesHash, client) {
    const db = client || pool;
    await db.query(`UPDATE user_mfa_devices
     SET backup_codes_hash = $2, updated_at = NOW()
     WHERE id = $1`, [deviceId, backupCodesHash ? JSON.stringify(backupCodesHash) : '[]']);
}
export async function setBackupCodesForAllUserDevices(userId, backupCodesHash, client) {
    const db = client || pool;
    await db.query(`UPDATE user_mfa_devices
     SET backup_codes_hash = $2::jsonb, updated_at = NOW()
     WHERE user_id = $1 AND verified = TRUE`, [userId, JSON.stringify(backupCodesHash)]);
}
export async function updateMFADeviceLastUsed(deviceId, ipAddress, client) {
    const db = client || pool;
    await db.query(`UPDATE user_mfa_devices
     SET last_used_at = NOW(),
         last_used_ip = $2::inet,
         updated_at = NOW()
     WHERE id = $1`, [deviceId, ipAddress]);
}
// ============================================================================
// EMAIL MFA OTP QUERIES (email-based MFA device codes)
// ============================================================================
/**
 * Insert a fresh email MFA OTP for a device. Any prior unconsumed OTP for the
 * same device is invalidated first so only the newest code is valid.
 *
 * Only the SHA-256 hash of the 6-digit code is persisted; the plaintext is
 * emailed to the user and never stored.
 */
export async function createEmailMfaOtp(userId, deviceId, codeHash, ttlSeconds, client) {
    const db = client || pool;
    // Invalidate any prior active OTP for this device.
    await db.query(`UPDATE email_mfa_otps SET used_at = NOW()
     WHERE device_id = $1 AND used_at IS NULL`, [deviceId]);
    await db.query(`INSERT INTO email_mfa_otps (user_id, device_id, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)`, [userId, deviceId, codeHash, ttlSeconds.toString()]);
}
/**
 * Atomically consume an email MFA OTP. Returns true if the code matched a
 * row that was not yet used and not expired. Concurrent callers see at most
 * one success.
 */
export async function consumeEmailMfaOtp(deviceId, codeHash, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE email_mfa_otps
     SET used_at = NOW()
     WHERE id = (
       SELECT id FROM email_mfa_otps
       WHERE device_id = $1
         AND code_hash = $2
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1
     )
     RETURNING id`, [deviceId, codeHash]);
    return (result.rowCount ?? 0) === 1;
}
export async function deleteExpiredEmailMfaOtps(client) {
    const db = client || pool;
    const result = await db.query(`DELETE FROM email_mfa_otps
     WHERE expires_at < NOW() - INTERVAL '1 day'`);
    return result.rowCount ?? 0;
}
//# sourceMappingURL=mfa.repository.js.map