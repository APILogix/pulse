/**
 * Auth Repository - Pure SQL queries for PostgreSQL
 * No business logic, only data access
 */
import { pool } from "../../config/database.js";
import { UserStatus, SessionStatus, MFAType } from './types.js';
import { env } from '../../config/env.js';
import { config } from 'process';
// ============================================
// USER QUERIES
// ============================================
export async function findUserById(id, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return result.rows[0] || null;
}
export async function findUserByClerkId(clerkUserId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users WHERE clerk_user_id = $1 AND deleted_at IS NULL`, [clerkUserId]);
    return result.rows[0] || null;
}
export async function findUserByEmailHash(emailHash, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users WHERE email_hash = $1 AND deleted_at IS NULL`, [emailHash]);
    return result.rows[0] || null;
}
export async function createUser(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO users (
      id, email, email_hash, full_name, avatar_url, password_hash, status
    ) VALUES ($1, $2, $3, $4, $5,$6, 'active')
    RETURNING *`, [
        data.id, //  FIXED
        data.email,
        data.email_hash,
        data.full_name,
        data.avatar_url || null,
        data.password
    ]);
    return result.rows[0];
}
export async function findUserByEmail(email, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`, [email]);
    return result.rows[0] || null;
}
export async function updateUser(id, data, client) {
    const db = client || pool;
    const fields = [];
    const values = [];
    let idx = 1;
    if (data.full_name !== undefined) {
        fields.push(`full_name = $${idx++}`);
        values.push(data.full_name);
    }
    if (data.avatar_url !== undefined) {
        fields.push(`avatar_url = $${idx++}`);
        values.push(data.avatar_url);
    }
    if (data.timezone !== undefined) {
        fields.push(`timezone = $${idx++}`);
        values.push(data.timezone);
    }
    if (data.locale !== undefined) {
        fields.push(`locale = $${idx++}`);
        values.push(data.locale);
    }
    if (data.preferred_mfa_method !== undefined) {
        fields.push(`preferred_mfa_method = $${idx++}`);
        values.push(data.preferred_mfa_method);
    }
    if (fields.length === 0)
        return findUserById(id, client);
    values.push(id);
    const result = await db.query(`UPDATE users SET ${fields.join(', ')}, updated_at = NOW() 
     WHERE id = $${idx} AND deleted_at IS NULL 
     RETURNING *`, values);
    return result.rows[0] || null;
}
export async function softDeleteUser(id, reason, deletedBy, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users 
     SET deleted_at = NOW(), deleted_by = $2, deletion_reason = $3, status = 'deleted', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`, [id, deletedBy, reason]);
    return (result.rowCount ?? 0) > 0;
}
export async function restoreUser(id, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users 
     SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL, status = 'active', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING *`, [id]);
    return result.rows[0] || null;
}
export async function suspendUser(id, reason, suspendedBy, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users 
     SET status = 'suspended', status_reason = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [id, reason]);
    return result.rows[0] || null;
}
export async function listUsers(options, client) {
    const db = client || pool;
    const { status, limit = 20, offset = 0, search } = options;
    let whereClause = 'WHERE deleted_at IS NULL';
    const params = [];
    let idx = 1;
    if (status) {
        whereClause += ` AND status = $${idx++}`;
        params.push(status);
    }
    if (search) {
        whereClause += ` AND (full_name ILIKE $${idx} OR email ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
    }
    const countResult = await db.query(`SELECT COUNT(*) FROM users ${whereClause}`, params);
    const usersResult = await db.query(`SELECT * FROM users ${whereClause} 
     ORDER BY created_at DESC 
     LIMIT $${idx++} OFFSET $${idx++}`, [...params, limit, offset]);
    return {
        users: usersResult.rows,
        total: parseInt(countResult.rows[0].count, 10),
    };
}
export async function updateLoginAttempts(id, attempts, client) {
    const db = client || pool;
    await db.query(`UPDATE users SET login_attempts = $2, updated_at = NOW() WHERE id = $1`, [id, attempts]);
}
export async function recordLogin(id, ip, userAgent, client) {
    const db = client || pool;
    await db.query(`UPDATE users 
     SET last_login_at = NOW(), last_login_ip = $2, last_login_user_agent = $3, 
         login_attempts = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1`, [id, ip, userAgent]);
}
export async function updateUserPassword(id, passwordHash, passwordHistory, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET password_hash = $2,
         password_history = $3::jsonb,
         last_password_change = NOW(),
         login_attempts = 0,
         locked_until = NULL,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [id, passwordHash, JSON.stringify(passwordHistory)]);
    return result.rows[0] || null;
}
// ============================================
// MFA DEVICE QUERIES
// ============================================
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
export async function createMFADevice(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_mfa_devices (
      user_id, device_type, device_name, secret_encrypted, is_primary, 
      device_metadata, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    RETURNING *`, [
        data.user_id,
        data.device_type,
        data.device_name,
        data.secret_encrypted,
        data.is_primary,
        JSON.stringify(data.device_metadata || {}),
    ]);
    return result.rows[0];
}
export async function verifyMFADevice(id, backupCodesHash, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices 
     SET verified = TRUE, verified_at = NOW(), backup_codes_hash = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`, [id, backupCodesHash ? JSON.stringify(backupCodesHash) : null]);
    return result.rows[0] || null;
}
export async function updateMFADevicePrimary(userId, deviceId, client) {
    const db = client || pool;
    // Use transaction to ensure only one primary
    await db.query('BEGIN');
    try {
        // Remove primary from all others
        await db.query(`UPDATE user_mfa_devices SET is_primary = FALSE, updated_at = NOW() 
       WHERE user_id = $1 AND is_primary = TRUE`, [userId]);
        // Set new primary
        await db.query(`UPDATE user_mfa_devices SET is_primary = TRUE, updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`, [deviceId, userId]);
        await db.query('COMMIT');
    }
    catch (e) {
        await db.query('ROLLBACK');
        throw e;
    }
}
export async function disableMFADevice(id, reason, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices 
     SET is_active = FALSE, disabled_at = NOW(), disabled_reason = $2, updated_at = NOW()
     WHERE id = $1`, [id, reason]);
    return (result.rowCount ?? 0) > 0;
}
export async function deleteMFADevice(id, client) {
    const db = client || pool;
    const result = await db.query(`DELETE FROM user_mfa_devices WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
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
    await db.query(`UPDATE users SET mfa_backup_codes_generated_at = NOW(), updated_at = NOW() WHERE id = $1`, [userId]);
}
// ============================================
// PASSWORD RESET / VERIFICATION QUERIES
// ============================================
export async function createPasswordReset(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, token_hash, expires_at`, [data.user_id, data.token_hash, data.expires_at]);
    return result.rows[0];
}
export async function findPasswordResetByToken(tokenHash, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, token_hash, expires_at, used_at
     FROM password_resets
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`, [tokenHash]);
    return result.rows[0] || null;
}
export async function markPasswordResetUsed(id, usedIp, client) {
    const db = client || pool;
    await db.query(`UPDATE password_resets
     SET used_at = NOW(), used_ip = $2
     WHERE id = $1`, [id, usedIp]);
}
export async function invalidatePasswordResetsForUser(userId, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE password_resets
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    return result.rowCount ?? 0;
}
export async function updateMFADeviceBackupCodes(deviceId, backupCodesHash, client) {
    const db = client || pool;
    await db.query(`UPDATE user_mfa_devices
     SET backup_codes_hash = $2, updated_at = NOW()
     WHERE id = $1`, [deviceId, backupCodesHash ? JSON.stringify(backupCodesHash) : null]);
}
export async function createEmailVerification(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO email_verifications (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, email, token_hash, expires_at`, [data.user_id, data.email, data.token_hash, data.expires_at]);
    return result.rows[0];
}
export async function findEmailVerificationByToken(tokenHash, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, email, token_hash, expires_at, verified_at
     FROM email_verifications
     WHERE token_hash = $1 AND verified_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`, [tokenHash]);
    return result.rows[0] || null;
}
export async function markEmailVerificationUsed(id, client) {
    const db = client || pool;
    await db.query(`UPDATE email_verifications
     SET verified_at = NOW()
     WHERE id = $1`, [id]);
}
export async function markEmailAsVerified(userId, client) {
    const db = client || pool;
    await db.query(`UPDATE users
     SET email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
     WHERE id = $1`, [userId]);
}
// ============================================
// SESSION QUERIES
// ============================================
export async function createSession(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_sessions (
      user_id, refresh_token_hash, access_token_jti, device_fingerprint,
      device_name, device_type, ip_address, user_agent, expires_at, absolute_expires_at,
      mfa_verified_at, mfa_expires_at, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
    RETURNING *`, [
        data.user_id,
        data.refresh_token_hash,
        data.access_token_jti,
        data.device_fingerprint,
        data.device_name,
        data.device_type,
        data.ip_address,
        data.user_agent,
        data.expires_at,
        data.absolute_expires_at,
        data.mfa_verified_at || null,
        data.mfa_expires_at || null,
    ]);
    return result.rows[0];
}
export async function findSessionByRefreshToken(tokenHash, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM user_sessions 
     WHERE refresh_token_hash = $1 AND status = 'active'`, [tokenHash]);
    return result.rows[0] || null;
}
export async function findSessionById(id, userId, client) {
    const db = client || pool;
    let query = `SELECT * FROM user_sessions WHERE id = $1`;
    const params = [id];
    if (userId) {
        query += ` AND user_id = $2`;
        params.push(userId);
    }
    const result = await db.query(query, params);
    return result.rows[0] || null;
}
export async function listActiveSessionsByUser(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM user_sessions 
     WHERE user_id = $1 AND status = 'active'
     ORDER BY last_active_at DESC`, [userId]);
    return result.rows;
}
export async function revokeSession(id, reason, terminatedBy, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions 
     SET status = 'revoked', terminated_at = NOW(), termination_reason = $2, terminated_by = $3
     WHERE id = $1`, [id, reason, terminatedBy || null]);
    return (result.rowCount ?? 0) > 0;
}
export async function revokeAllOtherSessions(userId, currentSessionId, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions 
     SET status = 'revoked', terminated_at = NOW(), termination_reason = 'User revoked all other sessions'
     WHERE user_id = $1 AND id != $2 AND status = 'active'`, [userId, currentSessionId]);
    return result.rowCount ?? 0;
}
export async function updateSessionActivity(id, accessTokenJti, client) {
    const db = client || pool;
    await db.query(`UPDATE user_sessions 
     SET last_active_at = NOW(), access_token_jti = $2
     WHERE id = $1`, [id, accessTokenJti]);
}
export async function cleanupExpiredSessions(client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions 
     SET status = 'expired', termination_reason = 'Automatic cleanup of expired session'
     WHERE status = 'active' 
       AND (expires_at < NOW() OR absolute_expires_at < NOW())`);
    return result.rowCount ?? 0;
}
// ============================================
// TRANSACTION HELPERS
// ============================================
export async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=repository.js.map