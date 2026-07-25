import { pool } from '../../config/database.js';
export async function getUserAccount(userId) {
    const result = await pool.query(`SELECT id, display_name, full_name, email, email_verified, email_verified_at,
            avatar_url, timezone, locale, marketing_emails, product_updates,
            password_hash, mfa_enabled
       FROM users
      WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    return result.rows[0] ?? null;
}
export async function getVerifiedMfaDevices(userId) {
    const result = await pool.query(`SELECT
       CASE
         WHEN type::text = 'webauthn' THEN 'security_key'
         WHEN type::text = 'backup_code' THEN 'backup_codes'
         ELSE type::text
       END AS method,
       device_name AS name,
       is_verified AS verified,
       is_primary AS is_default
     FROM user_mfa_devices
     WHERE user_id = $1 AND is_active = TRUE AND is_verified = TRUE
     ORDER BY is_primary DESC, created_at DESC`, [userId]);
    return result.rows;
}
export async function countBackupCodes(userId) {
    const result = await pool.query(`SELECT COUNT(*) AS count
       FROM user_backup_codes
      WHERE user_id = $1 AND used_at IS NULL`, [userId]);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}
export async function countActiveSessions(userId) {
    const result = await pool.query(`SELECT COUNT(*) AS count
       FROM user_sessions
      WHERE user_id = $1
        AND status = 'active'
        AND expires_at > now()
        AND absolute_expires_at > now()`, [userId]);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}
export async function countTrustedDevices(userId) {
    const result = await pool.query(`SELECT COUNT(*) AS count
       FROM user_trusted_devices
      WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}
export async function countPasskeys(userId) {
    const result = await pool.query(`SELECT COUNT(*) AS count
       FROM user_mfa_devices
      WHERE user_id = $1
        AND is_active = TRUE
        AND is_verified = TRUE
        AND type::text = 'webauthn'`, [userId]);
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}
export async function getRecentActivity(userId) {
    const result = await pool.query(`SELECT event_type, description, location, ip_address::text, created_at
       FROM user_security_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 5`, [userId]);
    return result.rows;
}
export async function updateUserProfile(userId, data) {
    const result = await pool.query(`UPDATE users
        SET display_name = $2,
            full_name = COALESCE($3, full_name),
            avatar_url = $4,
            timezone = $5,
            locale = $6,
            marketing_emails = $7,
            product_updates = $8,
            marketing_consent = $7,
            marketing_consent_updated_at = now(),
            updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, display_name, full_name, email, email_verified, email_verified_at,
                avatar_url, timezone, locale, marketing_emails, product_updates,
                password_hash, mfa_enabled`, [
        userId,
        data.display_name,
        data.full_name,
        data.avatar_url,
        data.timezone,
        data.locale,
        data.marketing_emails,
        data.product_updates,
    ]);
    return result.rows[0] ?? null;
}
export async function removeAvatar(userId) {
    const result = await pool.query(`UPDATE users
        SET avatar_url = NULL, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, display_name, full_name, email, email_verified, email_verified_at,
                avatar_url, timezone, locale, marketing_emails, product_updates,
                password_hash, mfa_enabled`, [userId]);
    return result.rows[0] ?? null;
}
export async function scheduleAccountDeletion(userId) {
    const result = await pool.query(`UPDATE users
        SET deletion_requested_at = now(),
            deletion_scheduled_at = now() + interval '30 days',
            deleted_at = now() + interval '30 days',
            updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING deleted_at`, [userId]);
    return result.rows[0] ?? null;
}
export async function cancelAccountDeletion(userId) {
    const result = await pool.query(`UPDATE users
        SET deletion_requested_at = NULL,
            deletion_scheduled_at = NULL,
            deleted_at = NULL,
            updated_at = now()
      WHERE id = $1 AND deletion_requested_at IS NOT NULL`, [userId]);
    return (result.rowCount ?? 0) > 0;
}
export async function revokeAllOtherSessions(userId, currentSessionId) {
    const result = await pool.query(`UPDATE user_sessions
        SET status = 'revoked',
            terminated_at = now(),
            termination_reason = 'User signed out all other devices'
      WHERE user_id = $1 AND id <> $2 AND status = 'active'`, [userId, currentSessionId]);
    return result.rowCount ?? 0;
}
export async function getUserDataExport(userId) {
    const [user, mfa, sessions, securityEvents, trustedDevices, backupCodes, linkedAccounts] = await Promise.all([
        pool.query(`SELECT id, display_name, full_name, email, email_verified, avatar_url, timezone, locale, marketing_emails, product_updates, created_at FROM users WHERE id = $1`, [userId]),
        pool.query(`SELECT id, type::text AS method, device_name, is_verified, is_primary, created_at, last_used_at FROM user_mfa_devices WHERE user_id = $1`, [userId]),
        pool.query(`SELECT id, device_name, device_type, ip_address::text, created_at, last_active_at, expires_at, status FROM user_sessions WHERE user_id = $1`, [userId]),
        pool.query(`SELECT event_type, description, device_info, ip_address::text, location, metadata, created_at FROM user_security_events WHERE user_id = $1 ORDER BY created_at DESC`, [userId]),
        pool.query(`SELECT id, device_name, device_type, os, browser, ip_address::text, location, trusted_at, last_used_at, revoked_at FROM user_trusted_devices WHERE user_id = $1`, [userId]),
        pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE used_at IS NULL)::int AS unused FROM user_backup_codes WHERE user_id = $1`, [userId]),
        pool.query(`SELECT id, provider, provider_user_id, linked_at FROM user_linked_identities WHERE user_id = $1 AND unlinked_at IS NULL`, [userId]).catch(() => ({ rows: [] })),
    ]);
    return {
        exported_at: new Date().toISOString(),
        user: user.rows[0] ?? null,
        mfa_devices: mfa.rows,
        sessions: sessions.rows,
        security_events: securityEvents.rows,
        trusted_devices: trustedDevices.rows,
        backup_codes: backupCodes.rows[0] ?? { total: 0, unused: 0 },
        linked_accounts: linkedAccounts.rows,
    };
}
//# sourceMappingURL=repository.js.map