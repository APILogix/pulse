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
       'active', $6,
       NOW(), $7,
       NOW(), $8,
       $9, NOW(),
       TRUE
     )
     RETURNING *`, [
        data.id,
        data.email,
        data.full_name,
        data.avatar_url ?? null,
        data.password ?? null,
        data.email_verified ?? false,
        data.accepted_terms_version ?? null,
        data.accepted_privacy_version ?? null,
        data.marketing_consent ?? false,
    ]);
    return result.rows[0];
}
export async function updateUser(id, requestingUserId, data, client) {
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
    values.push(requestingUserId);
    const result = await db.query(`UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx++} AND deleted_at IS NULL AND id = $${idx}
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
//# sourceMappingURL=user.repository.js.map