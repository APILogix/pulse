import { pool } from '../../config/database.js';
// ============================================================================
// USER QUERIES
// ============================================================================
export async function findUserById(id, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return result.rows[0] || null;
}
export async function findUserByEmailHash(emailHash, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users WHERE email_hash = $1 AND deleted_at IS NULL`, [emailHash]);
    return result.rows[0] || null;
}
/**
 * Find a user even when soft-deleted. Used by admin restore flows.
 */
export async function findUserByIdIncludingDeleted(id, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return result.rows[0] || null;
}
export async function createUser(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO users (
       id, email, full_name, avatar_url, password_hash,
       status, email_verified,
       accepted_terms_at, accepted_terms_version,
       accepted_privacy_at, accepted_privacy_version,
       marketing_consent, marketing_consent_updated_at,
       data_processing_consent
     ) VALUES (
       $1, $2, $3, $4, $5,
       'active', FALSE,
       NOW(), $6,
       NOW(), $7,
       $8, NOW(),
       TRUE
     )
     RETURNING *`, [
        data.id,
        data.email,
        data.full_name,
        data.avatar_url ?? null,
        data.password ?? null,
        data.accepted_terms_version ?? null,
        data.accepted_privacy_version ?? null,
        data.marketing_consent ?? false,
    ]);
    return result.rows[0];
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
        // null is a meaningful value — clears the avatar.
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
     SET deleted_at = NOW(), deleted_by = $2, deletion_reason = $3,
         status = 'deleted', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`, [id, deletedBy, reason]);
    return (result.rowCount ?? 0) > 0;
}
export async function restoreUser(id, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL,
         status = 'active', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING *`, [id]);
    return result.rows[0] || null;
}
/**
 * Suspend a user. Records the suspending admin in dedicated columns so
 * `deleted_by` / `deleted_at` remain exclusively for soft-delete semantics.
 */
export async function suspendUser(id, reason, suspendedBy, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET status = 'suspended',
         status_reason = $2,
         suspended_at = NOW(),
         suspended_by = $3,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [id, reason, suspendedBy]);
    return result.rows[0] || null;
}
/**
 * Restore a suspended user to active status. Does not revive soft-deleted users.
 */
export async function unsuspendUser(id, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET status = 'active',
         status_reason = NULL,
         suspended_at = NULL,
         suspended_by = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL
       AND status = 'suspended'
     RETURNING *`, [id]);
    return result.rows[0] || null;
}
/**
 * Admin-initiated account lock (distinct from brute-force lockout).
 * Sets `locked_until` far in the future until explicitly unlocked.
 */
export async function adminLockUser(id, reason, lockedBy, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET locked_until = NOW() + INTERVAL '10 years',
         status_reason = $2,
         updated_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL
       AND status != 'deleted'
     RETURNING *`, [id, `[admin_lock:${lockedBy}] ${reason}`]);
    return result.rows[0] || null;
}
/**
 * Clear admin/brute-force lock state and failed-login counters.
 */
export async function adminUnlockUser(id, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET locked_until = NULL,
         login_attempts = 0,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [id]);
    return result.rows[0] || null;
}
export async function listUsers(options, client) {
    const db = client || pool;
    const { status, limit = 20, offset = 0, search } = options;
    const where = ['deleted_at IS NULL'];
    const params = [];
    let idx = 1;
    if (status) {
        where.push(`status = $${idx++}`);
        params.push(status);
    }
    if (search) {
        where.push(`(full_name ILIKE $${idx} OR email ILIKE $${idx})`);
        params.push(`%${search}%`);
        idx++;
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const countResult = await db.query(`SELECT COUNT(*) AS count FROM users ${whereSql}`, params);
    const usersResult = await db.query(`SELECT * FROM users ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${idx++} OFFSET $${idx++}`, [...params, limit, offset]);
    return {
        users: usersResult.rows,
        total: parseInt(countResult.rows[0].count, 10),
    };
}
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
export async function recordFailedLogin(id, ip, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET login_attempts = login_attempts + 1,
         last_failed_login_at = NOW(),
         last_failed_login_ip = $2::inet,
         locked_until = CASE
           WHEN login_attempts + 1 >= 11 THEN NOW() + INTERVAL '1 hour'
           WHEN login_attempts + 1 >= 9  THEN NOW() + INTERVAL '15 minutes'
           WHEN login_attempts + 1 >= 7  THEN NOW() + INTERVAL '5 minutes'
           WHEN login_attempts + 1 >= 5  THEN NOW() + INTERVAL '1 minute'
           ELSE locked_until
         END,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING login_attempts, locked_until`, [id, ip]);
    const row = result.rows[0];
    if (!row) {
        return { login_attempts: 0, locked_until: null };
    }
    return row;
}
export async function recordLogin(id, ip, userAgent, client) {
    const db = client || pool;
    await db.query(`UPDATE users
     SET last_login_at = NOW(),
         last_login_ip = $2,
         last_login_user_agent = $3,
         login_attempts = 0,
         locked_until = NULL,
         updated_at = NOW()
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
export async function recordSecurityEvent(data, client) {
    const db = client || pool;
    await db.query(`INSERT INTO security_events (
       event_type, severity, user_id, ip_address, user_agent,
       description, evidence, action_taken, blocked_until
     ) VALUES ($1, $2, $3, $4::inet, $5, $6, $7::jsonb, $8, $9)`, [
        data.event_type,
        data.severity,
        data.user_id,
        data.ip_address,
        data.user_agent ?? null,
        data.description,
        JSON.stringify(data.evidence ?? {}),
        data.action_taken ?? null,
        data.blocked_until ?? null,
    ]);
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
       device_metadata, is_active, verified
     ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE)
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
/**
 * Insert a fresh email-flow token. Any prior unconsumed token for the same
 * (user, email, purpose) tuple is invalidated by setting verified_at = NOW()
 * so only the newest token is consumable.
 */
export async function createEmailVerification(data, client) {
    const db = client || pool;
    await db.query(`UPDATE email_verifications
     SET verified_at = NOW()
     WHERE user_id = $1 AND email = $2 AND purpose = $3 AND verified_at IS NULL`, [data.user_id, data.email, data.purpose]);
    const result = await db.query(`INSERT INTO email_verifications (user_id, email, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, email, purpose) DO UPDATE SET
       token_hash = EXCLUDED.token_hash,
       expires_at = EXCLUDED.expires_at,
       verified_at = NULL,
       created_at = NOW()
     RETURNING id, user_id, email, token_hash, purpose, expires_at, verified_at, created_at`, [data.user_id, data.email, data.token_hash, data.purpose, data.expires_at]);
    return result.rows[0];
}
/**
 * Atomic consume. Returns the row only if it was previously unconsumed and
 * not expired. Concurrent callers see at most one success.
 */
export async function consumeEmailVerificationToken(tokenHash, purpose, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE email_verifications
     SET verified_at = NOW()
     WHERE id = (
       SELECT id FROM email_verifications
       WHERE token_hash = $1
         AND purpose = $2
         AND verified_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1
     )
     RETURNING id, user_id, email, token_hash, purpose, expires_at, verified_at, created_at`, [tokenHash, purpose]);
    return result.rows[0] || null;
}
export async function findEmailVerificationByTokenHash(tokenHash, purpose, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, email, token_hash, purpose, expires_at, verified_at, created_at
     FROM email_verifications
     WHERE token_hash = $1 AND purpose = $2
     ORDER BY created_at DESC
     LIMIT 1`, [tokenHash, purpose]);
    return result.rows[0] || null;
}
export async function invalidateAllUserTokens(userId, client) {
    const db = client || pool;
    await db.query(`UPDATE email_verifications
     SET verified_at = NOW()
     WHERE user_id = $1 AND verified_at IS NULL`, [userId]);
}
export async function markEmailAsVerified(userId, client) {
    const db = client || pool;
    await db.query(`UPDATE users
     SET email_verified = TRUE,
         email_verified_at = COALESCE(email_verified_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`, [userId]);
}
export async function deleteExpiredEmailTokens(client) {
    const db = client || pool;
    const result = await db.query(`DELETE FROM email_verifications
     WHERE (verified_at IS NOT NULL AND verified_at < NOW() - INTERVAL '30 days')
        OR (verified_at IS NULL AND expires_at < NOW() - INTERVAL '7 days')`);
    return result.rowCount ?? 0;
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
// ============================================================================
// SESSION QUERIES
// ============================================================================
/**
 * Insert a new session row. Callers MUST pre-allocate the session UUID and
 * the SHA-256 of the issued refresh JWT so the row is created in a single
 * INSERT with no placeholder/race window.
 */
export async function createSession(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_sessions (
       id, user_id, refresh_token_hash, access_token_jti, device_fingerprint,
       device_name, device_type, ip_address, user_agent, expires_at,
       absolute_expires_at, mfa_verified_at, mfa_expires_at,
       sso_provider_id, login_method, saml_name_id, saml_session_index, status
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8::inet, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, 'active'
     )
     RETURNING *`, [
        data.id,
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
        data.sso_provider_id ?? null,
        data.login_method ?? null,
        data.saml_name_id ?? null,
        data.saml_session_index ?? null,
    ]);
    return result.rows[0];
}
/**
 * Look up a session whose current OR previous refresh-token hash matches the
 * presented value. Constrained by `(id, user_id)` so we only ever return the
 * exact session the JWT claims it belongs to.
 */
export async function findSessionByAnyRefreshTokenHash(tokenHash, sessionId, userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM user_sessions
     WHERE id = $2 AND user_id = $3
       AND (refresh_token_hash = $1 OR previous_refresh_token_hash = $1)
     LIMIT 1`, [tokenHash, sessionId, userId]);
    const row = result.rows[0];
    if (!row)
        return null;
    return {
        session: row,
        matchedPrevious: row.previous_refresh_token_hash === tokenHash,
    };
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
export async function listOtherActiveSessionIds(userId, currentSessionId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id FROM user_sessions
     WHERE user_id = $1 AND id <> $2 AND status = 'active'`, [userId, currentSessionId]);
    return result.rows.map((r) => r.id);
}
export async function countActiveSessionsByUser(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT COUNT(*) AS count FROM user_sessions
     WHERE user_id = $1 AND status = 'active'`, [userId]);
    return parseInt(result.rows[0]?.count || '0', 10);
}
export async function revokeOldestSessions(userId, keepCount, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = 'Session quota exceeded'
     WHERE id IN (
       SELECT id FROM user_sessions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY last_active_at ASC
       OFFSET $2
     )`, [userId, keepCount]);
    return result.rowCount ?? 0;
}
export async function revokeSession(id, reason, terminatedBy, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = $2, terminated_by = $3
     WHERE id = $1`, [id, reason, terminatedBy || null]);
    return (result.rowCount ?? 0) > 0;
}
/**
 * Revoke every active session of a user. Used by suspend, password reset,
 * MFA disable, and refresh-token reuse responses.
 */
export async function revokeAllUserSessions(userId, reason, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = $2
     WHERE user_id = $1 AND status = 'active'`, [userId, reason]);
    return result.rowCount ?? 0;
}
/**
 * Revoke every active session except the caller's. Used by `/sessions/others`
 * and by the password-change flow.
 */
export async function revokeAllOtherSessions(userId, currentSessionId, reason, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = $3
     WHERE user_id = $1 AND id <> $2 AND status = 'active'`, [userId, currentSessionId, reason]);
    return result.rowCount ?? 0;
}
export async function revokeAllSessionsForUser(userId, reason, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(), termination_reason = $2
     WHERE user_id = $1 AND status = 'active'`, [userId, reason]);
    return result.rowCount ?? 0;
}
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
export async function rotateRefreshToken(sessionId, oldHash, newHash, newExpiresAt, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions
     SET refresh_token_hash = $3,
         previous_refresh_token_hash = $2,
         previous_refresh_rotated_at = NOW(),
         expires_at = $4,
         last_active_at = NOW()
     WHERE id = $1
       AND refresh_token_hash = $2
       AND status = 'active'`, [sessionId, oldHash, newHash, newExpiresAt]);
    return (result.rowCount ?? 0) === 1;
}
export async function touchSessionActivity(sessionId, client) {
    const db = client || pool;
    await db.query(`UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId]);
}
export async function cleanupExpiredSessions(client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_sessions
     SET status = 'expired',
         terminated_at = COALESCE(terminated_at, NOW()),
         termination_reason = COALESCE(termination_reason, 'Automatic cleanup of expired session')
     WHERE status = 'active'
       AND (expires_at < NOW() OR absolute_expires_at < NOW())`);
    return result.rowCount ?? 0;
}
export async function purgeOldRevokedSessions(olderThanDays = 90, client) {
    const db = client || pool;
    const result = await db.query(`DELETE FROM user_sessions
     WHERE status IN ('revoked', 'expired', 'terminated_by_admin')
       AND COALESCE(terminated_at, expires_at) < NOW() - ($1 || ' days')::interval`, [olderThanDays.toString()]);
    return result.rowCount ?? 0;
}
// ============================================================================
// PHASE 3 — EMAIL, POLICY, AUDIT, SSO DISCOVERY
// ============================================================================
export async function updateUserEmail(userId, email, emailHash, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET email = $2,
         email_hash = $3,
         email_verified = TRUE,
         email_verified_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [userId, email, emailHash]);
    return result.rows[0] || null;
}
export async function scheduleAccountDeletion(userId, scheduledAt, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET deletion_scheduled_at = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [userId, scheduledAt]);
    return result.rows[0] || null;
}
export async function clearScheduledAccountDeletion(userId, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE users
     SET deletion_scheduled_at = NULL, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`, [userId]);
    return result.rows[0] || null;
}
export async function listUsersDueForDeletion(client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM users
     WHERE deleted_at IS NULL
       AND deletion_scheduled_at IS NOT NULL
       AND deletion_scheduled_at <= NOW()`);
    return result.rows;
}
export async function listOrgAuthPoliciesForUser(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT o.id AS org_id,
            o.name AS org_name,
            COALESCE(os.enforce_sso, FALSE) AS enforce_sso,
            COALESCE(os.enforce_mfa, FALSE) AS enforce_mfa,
            os.session_timeout_minutes
     FROM organization_members om
     JOIN organizations o ON o.id = om.org_id AND o.deleted_at IS NULL
     LEFT JOIN organization_settings os ON os.org_id = o.id
     WHERE om.user_id = $1 AND om.status = 'active'`, [userId]);
    return result.rows;
}
export async function findSsoProvidersByEmailDomain(domain, client) {
    const db = client || pool;
    const normalizedDomain = domain.trim().toLowerCase();
    const result = await db.query(`SELECT o.id AS org_id,
            o.name AS org_name,
            osp.id AS provider_id,
            osp.provider_type,
            osp.provider_name
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE
       AND LOWER(osp.domain) = $1
     ORDER BY o.name ASC`, [normalizedDomain]);
    return result.rows;
}
export async function findSsoProviderRef(providerId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_type
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE`, [providerId]);
    return result.rows[0] || null;
}
export async function findSamlProviderById(providerId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE AND provider_type = 'saml'
       AND entity_id IS NOT NULL AND sso_url IS NOT NULL
       AND x509_certificate IS NOT NULL`, [providerId]);
    return result.rows[0] || null;
}
export async function findSamlProviderByEntityId(idpEntityId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE is_active = TRUE AND provider_type = 'saml'
       AND entity_id = $1
       AND sso_url IS NOT NULL AND x509_certificate IS NOT NULL
     ORDER BY created_at ASC
     LIMIT 1`, [idpEntityId]);
    return result.rows[0] || null;
}
export async function findSamlProviderForEmailDomain(domain, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            entity_id, sso_url, x509_certificate,
            COALESCE(osp.oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(osp.oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE AND osp.provider_type = 'saml'
       AND LOWER(osp.domain) = $1
       AND osp.entity_id IS NOT NULL
       AND osp.sso_url IS NOT NULL
       AND osp.x509_certificate IS NOT NULL
     ORDER BY osp.created_at ASC
     LIMIT 1`, [domain.trim().toLowerCase()]);
    return result.rows[0] || null;
}
export async function findOidcProviderById(providerId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes,
            COALESCE(oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers
     WHERE id = $1 AND is_active = TRUE AND provider_type = 'oidc'
       AND oidc_issuer IS NOT NULL AND oidc_client_id IS NOT NULL
       AND oidc_client_secret_encrypted IS NOT NULL`, [providerId]);
    return result.rows[0] || null;
}
export async function findOidcProviderForEmailDomain(domain, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id, provider_name, provider_type, domain,
            oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes,
            COALESCE(osp.oidc_jit_provision, FALSE) AS oidc_jit_provision,
            COALESCE(osp.oidc_jit_default_role, 'member') AS oidc_jit_default_role
     FROM organization_sso_providers osp
     JOIN organizations o ON o.id = osp.org_id AND o.deleted_at IS NULL
     WHERE osp.is_active = TRUE AND osp.provider_type = 'oidc'
       AND LOWER(osp.domain) = $1
       AND osp.oidc_issuer IS NOT NULL
     ORDER BY osp.created_at ASC
     LIMIT 1`, [domain.trim().toLowerCase()]);
    return result.rows[0] || null;
}
/** SSO JIT: passwordless user with verified email from IdP. */
export async function createSsoJitUser(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO users (
       id, email, full_name, password_hash, status, email_verified, email_verified_at,
       data_processing_consent
     ) VALUES ($1, $2, $3, NULL, 'active', TRUE, NOW(), TRUE)
     RETURNING *`, [data.id, data.email, data.full_name]);
    return result.rows[0];
}
export async function addOrgMemberSsoProvision(orgId, userId, role, client) {
    const db = client || pool;
    await db.query(`INSERT INTO organization_members (
       org_id, user_id, role, status, joined_at, joined_method, last_active_at
     ) VALUES ($1, $2, $3, 'active', NOW(), 'sso_auto_provision', NOW())
     ON CONFLICT (org_id, user_id) DO UPDATE SET
       status = 'active',
       role = EXCLUDED.role,
       joined_method = COALESCE(organization_members.joined_method, EXCLUDED.joined_method),
       deactivated_at = NULL,
       deactivated_by = NULL,
       deactivation_reason = NULL,
       last_active_at = NOW()`, [orgId, userId, role]);
}
export async function updateMFADeviceName(deviceId, userId, deviceName, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_mfa_devices
     SET device_name = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = TRUE
     RETURNING *`, [deviceId, userId, deviceName]);
    return result.rows[0] || null;
}
export async function findWebAuthnDeviceByCredentialId(credentialId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM user_mfa_devices
     WHERE credential_id = $1 AND device_type = 'hardware_key'
       AND verified = TRUE AND is_active = TRUE`, [credentialId]);
    return result.rows[0] || null;
}
export async function createWebAuthnDevice(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_mfa_devices (
       user_id, device_type, device_name, credential_id, public_key,
       sign_count, verified, verified_at, is_primary, is_active
     ) VALUES ($1, 'hardware_key', $2, $3, $4, $5, TRUE, NOW(), $6, TRUE)
     RETURNING *`, [
        data.user_id,
        data.device_name,
        data.credential_id,
        data.public_key,
        data.sign_count,
        data.is_primary,
    ]);
    return result.rows[0];
}
export async function updateWebAuthnSignCount(deviceId, signCount, ipAddress, client) {
    const db = client || pool;
    await db.query(`UPDATE user_mfa_devices
     SET sign_count = $2, last_used_at = NOW(), last_used_ip = $3::inet, updated_at = NOW()
     WHERE id = $1`, [deviceId, signCount, ipAddress]);
}
export async function upsertTrustedDevice(userId, fingerprint, data, client) {
    const db = client || pool;
    await db.query(`INSERT INTO user_trusted_devices (
       user_id, device_fingerprint, device_name, ip_address, user_agent, expires_at
     ) VALUES ($1, $2, $3, $4::inet, $5, $6)
     ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET
       device_name = COALESCE(EXCLUDED.device_name, user_trusted_devices.device_name),
       last_seen_at = NOW(),
       expires_at = EXCLUDED.expires_at,
       revoked_at = NULL`, [
        userId,
        fingerprint,
        data.device_name ?? null,
        data.ip_address,
        data.user_agent,
        data.expires_at,
    ]);
}
export async function isTrustedDevice(userId, fingerprint, client) {
    const db = client || pool;
    const result = await db.query(`SELECT 1 AS ok FROM user_trusted_devices
     WHERE user_id = $1 AND device_fingerprint = $2
       AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`, [userId, fingerprint]);
    return (result.rowCount ?? 0) > 0;
}
export async function listTrustedDevices(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, device_name, device_fingerprint, trusted_at, expires_at, last_seen_at
     FROM user_trusted_devices
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY trusted_at DESC`, [userId]);
    return result.rows;
}
export async function listLinkedIdentities(userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY linked_at DESC`, [userId]);
    return result.rows;
}
export async function findLinkedIdentityByProviderSubject(provider, providerSubject, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE provider = $1 AND provider_subject = $2 AND revoked_at IS NULL`, [provider, providerSubject]);
    return result.rows[0] || null;
}
export async function findLinkedIdentityByUserProvider(userId, provider, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at
     FROM user_linked_identities
     WHERE user_id = $1 AND provider = $2 AND revoked_at IS NULL`, [userId, provider]);
    return result.rows[0] || null;
}
export async function createLinkedIdentity(data, client) {
    const db = client || pool;
    const result = await db.query(`INSERT INTO user_linked_identities (
       user_id, provider, provider_subject, provider_email, profile_metadata
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, provider, provider_subject, provider_email, linked_at, last_used_at`, [
        data.user_id,
        data.provider,
        data.provider_subject,
        data.provider_email,
        JSON.stringify(data.profile_metadata ?? {}),
    ]);
    return result.rows[0];
}
export async function findScimTokenByHash(tokenHash, orgId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT id, org_id FROM organization_scim_tokens
     WHERE org_id = $2 AND token_hash = $1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())`, [tokenHash, orgId]);
    return result.rows[0] || null;
}
export async function touchScimToken(tokenId, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_scim_tokens SET last_used_at = NOW() WHERE id = $1`, [tokenId]);
}
export async function upsertScimUserMapping(orgId, userId, externalId, client) {
    const db = client || pool;
    await db.query(`INSERT INTO scim_user_mappings (org_id, user_id, external_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, external_id) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       updated_at = NOW()`, [orgId, userId, externalId]);
}
export async function findScimMappingByExternalId(orgId, externalId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT user_id FROM scim_user_mappings WHERE org_id = $1 AND external_id = $2`, [orgId, externalId]);
    return result.rows[0] || null;
}
export async function findScimMappingByUserId(orgId, userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT external_id FROM scim_user_mappings WHERE org_id = $1 AND user_id = $2`, [orgId, userId]);
    return result.rows[0] || null;
}
export async function deleteScimUserMapping(orgId, externalId, client) {
    const db = client || pool;
    await db.query(`DELETE FROM scim_user_mappings WHERE org_id = $1 AND external_id = $2`, [orgId, externalId]);
}
export async function listScimMappingsForOrg(orgId, startIndex, count, client) {
    const db = client || pool;
    const totalRes = await db.query(`SELECT COUNT(*)::text AS count FROM scim_user_mappings WHERE org_id = $1`, [orgId]);
    const rowsRes = await db.query(`SELECT external_id, user_id FROM scim_user_mappings
     WHERE org_id = $1 ORDER BY created_at ASC
     LIMIT $2 OFFSET $3`, [orgId, count, Math.max(0, startIndex - 1)]);
    return {
        rows: rowsRes.rows,
        total: parseInt(totalRes.rows[0]?.count ?? '0', 10),
    };
}
export async function listOrgMembersForScim(orgId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT user_id, role::text AS role, status::text AS status
     FROM organization_members WHERE org_id = $1`, [orgId]);
    return result.rows;
}
export async function updateOrgMemberRole(orgId, userId, role, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_members SET role = $3::org_role
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'`, [orgId, userId, role]);
}
export async function deactivateOrgMemberScim(orgId, userId, client) {
    const db = client || pool;
    await db.query(`UPDATE organization_members
     SET status = 'removed',
         deactivated_at = NOW(),
         deactivation_reason = 'SCIM deprovision'
     WHERE org_id = $1 AND user_id = $2`, [orgId, userId]);
}
export async function listOrgMemberScimIdsByRole(orgId, role, client) {
    const db = client || pool;
    const result = await db.query(`SELECT COALESCE(m.external_id, om.user_id::text) AS scim_id
     FROM organization_members om
     LEFT JOIN scim_user_mappings m
       ON m.org_id = om.org_id AND m.user_id = om.user_id
     WHERE om.org_id = $1 AND om.role = $2::org_role AND om.status = 'active'`, [orgId, role]);
    return result.rows.map((r) => r.scim_id);
}
export async function findActiveOrgMember(orgId, userId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT user_id, role::text AS role FROM organization_members
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'`, [orgId, userId]);
    return result.rows[0] || null;
}
export async function updateLinkedIdentityLastUsed(linkId, client) {
    const db = client || pool;
    await db.query(`UPDATE user_linked_identities SET last_used_at = NOW() WHERE id = $1`, [linkId]);
}
export async function findActiveSessionBySamlNameId(nameId, client) {
    const db = client || pool;
    const result = await db.query(`SELECT * FROM user_sessions
     WHERE saml_name_id = $1 AND status = 'active'
     ORDER BY last_active_at DESC LIMIT 1`, [nameId]);
    return result.rows[0] || null;
}
export async function revokeLinkedIdentity(userId, linkId, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_linked_identities SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [linkId, userId]);
    return (result.rowCount ?? 0) > 0;
}
export async function revokeTrustedDevice(userId, deviceId, client) {
    const db = client || pool;
    const result = await db.query(`UPDATE user_trusted_devices SET revoked_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [deviceId, userId]);
    return (result.rowCount ?? 0) > 0;
}
export async function listAuditLogsForUser(userId, options, client) {
    const db = client || pool;
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const countRes = await db.query(`SELECT COUNT(*)::text AS count FROM audit_logs WHERE user_id = $1`, [userId]);
    const rowsRes = await db.query(`SELECT id, action, resource_type, resource_id, org_id,
            host(ip_address)::text AS ip_address, created_at, metadata
     FROM audit_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`, [userId, limit, offset]);
    return {
        rows: rowsRes.rows,
        total: parseInt(countRes.rows[0]?.count ?? '0', 10),
    };
}
// ============================================================================
// TRANSACTION HELPERS
// ============================================================================
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