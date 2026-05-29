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

import { pool } from '../../config/database.js';
import type { MFADevice, User, UserSession, UserStatus, MFAType } from './types.js';

// ============================================================================
// USER QUERIES
// ============================================================================

export async function findUserById(
  id: string,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return result.rows[0] || null;
}

export async function findUserByEmailHash(
  emailHash: string,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `SELECT * FROM users WHERE email_hash = $1 AND deleted_at IS NULL`,
    [emailHash],
  );
  return result.rows[0] || null;
}

/**
 * Find a user even when soft-deleted. Used by admin restore flows.
 */
export async function findUserByIdIncludingDeleted(
  id: string,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

export async function createUser(
  data: {
    id: string;
    email: string;
    full_name: string;
    avatar_url?: string | null;
    password?: string | null;
    accepted_terms_version?: string | null;
    accepted_privacy_version?: string | null;
    marketing_consent?: boolean;
  },
  client?: PoolClient,
): Promise<User> {
  const db = client || pool;
  const result = await db.query<User>(
    `INSERT INTO users (
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
     RETURNING *`,
    [
      data.id,
      data.email,
      data.full_name,
      data.avatar_url ?? null,
      data.password ?? null,
      data.accepted_terms_version ?? null,
      data.accepted_privacy_version ?? null,
      data.marketing_consent ?? false,
    ],
  );
  return result.rows[0]!;
}

export async function updateUser(
  id: string,
  data: Partial<
    Pick<
      User,
      'full_name' | 'avatar_url' | 'timezone' | 'locale' | 'preferred_mfa_method'
    >
  >,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const fields: string[] = [];
  const values: unknown[] = [];
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

  if (fields.length === 0) return findUserById(id, client);

  values.push(id);
  const result = await db.query<User>(
    `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${idx} AND deleted_at IS NULL
     RETURNING *`,
    values,
  );
  return result.rows[0] || null;
}

export async function softDeleteUser(
  id: string,
  reason: string | null,
  deletedBy: string | null,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE users
     SET deleted_at = NOW(), deleted_by = $2, deletion_reason = $3,
         status = 'deleted', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, deletedBy, reason],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function restoreUser(
  id: string,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `UPDATE users
     SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL,
         status = 'active', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING *`,
    [id],
  );
  return result.rows[0] || null;
}

/**
 * Suspend a user. Records the suspending admin in dedicated columns so
 * `deleted_by` / `deleted_at` remain exclusively for soft-delete semantics.
 */
export async function suspendUser(
  id: string,
  reason: string,
  suspendedBy: string,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `UPDATE users
     SET status = 'suspended',
         status_reason = $2,
         suspended_at = NOW(),
         suspended_by = $3,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, reason, suspendedBy],
  );
  return result.rows[0] || null;
}

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

export async function listUsers(
  options: ListUsersOptions,
  client?: PoolClient,
): Promise<{ users: User[]; total: number }> {
  const db = client || pool;
  const { status, limit = 20, offset = 0, search } = options;

  const where: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
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

  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM users ${whereSql}`,
    params,
  );

  const usersResult = await db.query<User>(
    `SELECT * FROM users ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  );

  return {
    users: usersResult.rows,
    total: parseInt(countResult.rows[0]!.count, 10),
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
export async function recordFailedLogin(
  id: string,
  ip: string,
  client?: PoolClient,
): Promise<{ login_attempts: number; locked_until: Date | null }> {
  const db = client || pool;
  const result = await db.query<{
    login_attempts: number;
    locked_until: Date | null;
  }>(
    `UPDATE users
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
     RETURNING login_attempts, locked_until`,
    [id, ip],
  );

  const row = result.rows[0];
  if (!row) {
    return { login_attempts: 0, locked_until: null };
  }
  return row;
}

export async function recordLogin(
  id: string,
  ip: string,
  userAgent: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users
     SET last_login_at = NOW(),
         last_login_ip = $2,
         last_login_user_agent = $3,
         login_attempts = 0,
         locked_until = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id, ip, userAgent],
  );
}

export async function updateUserPassword(
  id: string,
  passwordHash: string,
  passwordHistory: string[],
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `UPDATE users
     SET password_hash = $2,
         password_history = $3::jsonb,
         last_password_change = NOW(),
         login_attempts = 0,
         locked_until = NULL,
         updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, passwordHash, JSON.stringify(passwordHistory)],
  );
  return result.rows[0] || null;
}

// ============================================================================
// SECURITY EVENTS
// ============================================================================

export type SecurityEventType =
  | 'brute_force_attempt'
  | 'suspicious_ip'
  | 'impossible_travel'
  | 'credential_stuffing'
  | 'account_takeover'
  | 'privilege_escalation'
  | 'mfa_disable_requested'
  | 'refresh_token_reuse';

export async function recordSecurityEvent(
  data: {
    event_type: SecurityEventType;
    severity: number; // 1..10
    user_id: string | null;
    ip_address: string;
    user_agent?: string | null;
    description: string;
    evidence?: Record<string, unknown>;
    action_taken?: string | null;
    blocked_until?: Date | null;
  },
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `INSERT INTO security_events (
       event_type, severity, user_id, ip_address, user_agent,
       description, evidence, action_taken, blocked_until
     ) VALUES ($1, $2, $3, $4::inet, $5, $6, $7::jsonb, $8, $9)`,
    [
      data.event_type,
      data.severity,
      data.user_id,
      data.ip_address,
      data.user_agent ?? null,
      data.description,
      JSON.stringify(data.evidence ?? {}),
      data.action_taken ?? null,
      data.blocked_until ?? null,
    ],
  );
}

// ============================================================================
// MFA DEVICE QUERIES
// ============================================================================

export async function findMFADevicesByUserId(
  userId: string,
  activeOnly = true,
  client?: PoolClient,
): Promise<MFADevice[]> {
  const db = client || pool;
  let query = `SELECT * FROM user_mfa_devices WHERE user_id = $1`;
  if (activeOnly) query += ` AND is_active = TRUE`;
  query += ` ORDER BY is_primary DESC, created_at DESC`;
  const result = await db.query<MFADevice>(query, [userId]);
  return result.rows;
}

export async function findMFADeviceById(
  id: string,
  userId?: string,
  client?: PoolClient,
): Promise<MFADevice | null> {
  const db = client || pool;
  let query = `SELECT * FROM user_mfa_devices WHERE id = $1`;
  const params: unknown[] = [id];
  if (userId) {
    query += ` AND user_id = $2`;
    params.push(userId);
  }
  const result = await db.query<MFADevice>(query, params);
  return result.rows[0] || null;
}

/**
 * Find any (active or inactive) MFA device of a given type for a user.
 * Used by the setup flow so a previously-disabled device can be reactivated
 * instead of creating duplicates that conflict with future operations.
 */
export async function findAnyMFADeviceByType(
  userId: string,
  deviceType: MFAType,
  client?: PoolClient,
): Promise<MFADevice | null> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `SELECT * FROM user_mfa_devices
     WHERE user_id = $1 AND device_type = $2
     ORDER BY is_primary DESC, created_at DESC
     LIMIT 1`,
    [userId, deviceType],
  );
  return result.rows[0] || null;
}

export async function createMFADevice(
  data: {
    user_id: string;
    device_type: MFAType;
    device_name: string;
    secret_encrypted: string | null;
    is_primary: boolean;
    device_metadata?: Record<string, unknown>;
  },
  client?: PoolClient,
): Promise<MFADevice> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `INSERT INTO user_mfa_devices (
       user_id, device_type, device_name, secret_encrypted, is_primary,
       device_metadata, is_active, verified
     ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE)
     RETURNING *`,
    [
      data.user_id,
      data.device_type,
      data.device_name,
      data.secret_encrypted,
      data.is_primary,
      JSON.stringify(data.device_metadata || {}),
    ],
  );
  return result.rows[0]!;
}

/**
 * Reset an existing MFA device row for a fresh setup. Called when a user
 * who previously disabled MFA decides to re-enable it.
 */
export async function resetMFADeviceForReSetup(
  id: string,
  data: {
    device_name: string;
    secret_encrypted: string | null;
    is_primary: boolean;
    device_metadata?: Record<string, unknown>;
  },
  client?: PoolClient,
): Promise<MFADevice | null> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `UPDATE user_mfa_devices
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
     RETURNING *`,
    [
      id,
      data.device_name,
      data.secret_encrypted,
      data.is_primary,
      JSON.stringify(data.device_metadata || {}),
    ],
  );
  return result.rows[0] || null;
}

export async function verifyMFADevice(
  id: string,
  backupCodesHash: string[] | null,
  client?: PoolClient,
): Promise<MFADevice | null> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `UPDATE user_mfa_devices
     SET verified = TRUE, verified_at = NOW(),
         backup_codes_hash = $2,
         is_active = TRUE,
         disabled_at = NULL,
         disabled_reason = NULL,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, backupCodesHash ? JSON.stringify(backupCodesHash) : '[]'],
  );
  return result.rows[0] || null;
}

export async function updateMFADevicePrimary(
  userId: string,
  deviceId: string,
  client?: PoolClient,
): Promise<void> {
  const exec = async (db: PoolClient) => {
    await db.query(
      `UPDATE user_mfa_devices
       SET is_primary = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND is_primary = TRUE AND id <> $2`,
      [userId, deviceId],
    );
    await db.query(
      `UPDATE user_mfa_devices
       SET is_primary = TRUE, updated_at = NOW()
       WHERE id = $2 AND user_id = $1`,
      [userId, deviceId],
    );
  };

  if (client) {
    await exec(client);
    return;
  }
  await withTransaction(async (tx) => exec(tx));
}

export async function disableMFADevice(
  id: string,
  reason: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_mfa_devices
     SET is_active = FALSE,
         is_primary = FALSE,
         disabled_at = NOW(),
         disabled_reason = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [id, reason],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function disableAllMFADevices(
  userId: string,
  reason: string,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_mfa_devices
     SET is_active = FALSE,
         is_primary = FALSE,
         disabled_at = NOW(),
         disabled_reason = $2,
         updated_at = NOW()
     WHERE user_id = $1 AND is_active = TRUE`,
    [userId, reason],
  );
  return result.rowCount ?? 0;
}

export async function updateUserMFAEnabled(
  userId: string,
  enabled: boolean,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users
     SET mfa_enabled = $2,
         mfa_enforced_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, enabled],
  );
}

export async function updateBackupCodesGenerated(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users
     SET mfa_backup_codes_generated_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [userId],
  );
}

export async function updateMFADeviceBackupCodes(
  deviceId: string,
  backupCodesHash: string[] | null,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_mfa_devices
     SET backup_codes_hash = $2, updated_at = NOW()
     WHERE id = $1`,
    [deviceId, backupCodesHash ? JSON.stringify(backupCodesHash) : '[]'],
  );
}

export async function setBackupCodesForAllUserDevices(
  userId: string,
  backupCodesHash: string[],
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_mfa_devices
     SET backup_codes_hash = $2::jsonb, updated_at = NOW()
     WHERE user_id = $1 AND verified = TRUE`,
    [userId, JSON.stringify(backupCodesHash)],
  );
}

export async function updateMFADeviceLastUsed(
  deviceId: string,
  ipAddress: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_mfa_devices
     SET last_used_at = NOW(),
         last_used_ip = $2::inet,
         updated_at = NOW()
     WHERE id = $1`,
    [deviceId, ipAddress],
  );
}

// ============================================================================
// EMAIL-TOKEN QUERIES (verification + password reset + mfa_disable)
// ============================================================================

export type EmailTokenPurpose =
  | 'email_verification'
  | 'password_reset'
  | 'mfa_disable';

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
export async function createEmailVerification(
  data: {
    user_id: string;
    email: string;
    token_hash: string;
    purpose: EmailTokenPurpose;
    expires_at: Date;
  },
  client?: PoolClient,
): Promise<EmailVerificationRecord> {
  const db = client || pool;

  await db.query(
    `UPDATE email_verifications
     SET verified_at = NOW()
     WHERE user_id = $1 AND email = $2 AND purpose = $3 AND verified_at IS NULL`,
    [data.user_id, data.email, data.purpose],
  );

  const result = await db.query<EmailVerificationRecord>(
    `INSERT INTO email_verifications (user_id, email, token_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, email, purpose) DO UPDATE SET
       token_hash = EXCLUDED.token_hash,
       expires_at = EXCLUDED.expires_at,
       verified_at = NULL,
       created_at = NOW()
     RETURNING id, user_id, email, token_hash, purpose, expires_at, verified_at, created_at`,
    [data.user_id, data.email, data.token_hash, data.purpose, data.expires_at],
  );
  return result.rows[0]!;
}

/**
 * Atomic consume. Returns the row only if it was previously unconsumed and
 * not expired. Concurrent callers see at most one success.
 */
export async function consumeEmailVerificationToken(
  tokenHash: string,
  purpose: EmailTokenPurpose,
  client?: PoolClient,
): Promise<EmailVerificationRecord | null> {
  const db = client || pool;
  const result = await db.query<EmailVerificationRecord>(
    `UPDATE email_verifications
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
     RETURNING id, user_id, email, token_hash, purpose, expires_at, verified_at, created_at`,
    [tokenHash, purpose],
  );
  return result.rows[0] || null;
}

export async function findEmailVerificationByTokenHash(
  tokenHash: string,
  purpose: EmailTokenPurpose,
  client?: PoolClient,
): Promise<EmailVerificationRecord | null> {
  const db = client || pool;
  const result = await db.query<EmailVerificationRecord>(
    `SELECT id, user_id, email, token_hash, purpose, expires_at, verified_at, created_at
     FROM email_verifications
     WHERE token_hash = $1 AND purpose = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash, purpose],
  );
  return result.rows[0] || null;
}

export async function invalidateAllUserTokens(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE email_verifications
     SET verified_at = NOW()
     WHERE user_id = $1 AND verified_at IS NULL`,
    [userId],
  );
}

export async function markEmailAsVerified(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users
     SET email_verified = TRUE,
         email_verified_at = COALESCE(email_verified_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [userId],
  );
}

export async function deleteExpiredEmailTokens(
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `DELETE FROM email_verifications
     WHERE (verified_at IS NOT NULL AND verified_at < NOW() - INTERVAL '30 days')
        OR (verified_at IS NULL AND expires_at < NOW() - INTERVAL '7 days')`,
  );
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
export async function createEmailMfaOtp(
  userId: string,
  deviceId: string,
  codeHash: string,
  ttlSeconds: number,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  // Invalidate any prior active OTP for this device.
  await db.query(
    `UPDATE email_mfa_otps SET used_at = NOW()
     WHERE device_id = $1 AND used_at IS NULL`,
    [deviceId],
  );
  await db.query(
    `INSERT INTO email_mfa_otps (user_id, device_id, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval)`,
    [userId, deviceId, codeHash, ttlSeconds.toString()],
  );
}

/**
 * Atomically consume an email MFA OTP. Returns true if the code matched a
 * row that was not yet used and not expired. Concurrent callers see at most
 * one success.
 */
export async function consumeEmailMfaOtp(
  deviceId: string,
  codeHash: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE email_mfa_otps
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
     RETURNING id`,
    [deviceId, codeHash],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function deleteExpiredEmailMfaOtps(
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `DELETE FROM email_mfa_otps
     WHERE expires_at < NOW() - INTERVAL '1 day'`,
  );
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
export async function createSession(
  data: {
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
  },
  client?: PoolClient,
): Promise<UserSession> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `INSERT INTO user_sessions (
       id, user_id, refresh_token_hash, access_token_jti, device_fingerprint,
       device_name, device_type, ip_address, user_agent, expires_at,
       absolute_expires_at, mfa_verified_at, mfa_expires_at, status
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8::inet, $9, $10,
       $11, $12, $13, 'active'
     )
     RETURNING *`,
    [
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
    ],
  );
  return result.rows[0]!;
}

/**
 * Look up a session whose current OR previous refresh-token hash matches the
 * presented value. Constrained by `(id, user_id)` so we only ever return the
 * exact session the JWT claims it belongs to.
 */
export async function findSessionByAnyRefreshTokenHash(
  tokenHash: string,
  sessionId: string,
  userId: string,
  client?: PoolClient,
): Promise<{ session: UserSession; matchedPrevious: boolean } | null> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `SELECT * FROM user_sessions
     WHERE id = $2 AND user_id = $3
       AND (refresh_token_hash = $1 OR previous_refresh_token_hash = $1)
     LIMIT 1`,
    [tokenHash, sessionId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    session: row,
    matchedPrevious: row.previous_refresh_token_hash === tokenHash,
  };
}

export async function findSessionById(
  id: string,
  userId?: string,
  client?: PoolClient,
): Promise<UserSession | null> {
  const db = client || pool;
  let query = `SELECT * FROM user_sessions WHERE id = $1`;
  const params: unknown[] = [id];
  if (userId) {
    query += ` AND user_id = $2`;
    params.push(userId);
  }
  const result = await db.query<UserSession>(query, params);
  return result.rows[0] || null;
}

export async function listActiveSessionsByUser(
  userId: string,
  client?: PoolClient,
): Promise<UserSession[]> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `SELECT * FROM user_sessions
     WHERE user_id = $1 AND status = 'active'
     ORDER BY last_active_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function listOtherActiveSessionIds(
  userId: string,
  currentSessionId: string,
  client?: PoolClient,
): Promise<string[]> {
  const db = client || pool;
  const result = await db.query<{ id: string }>(
    `SELECT id FROM user_sessions
     WHERE user_id = $1 AND id <> $2 AND status = 'active'`,
    [userId, currentSessionId],
  );
  return result.rows.map((r) => r.id);
}

export async function countActiveSessionsByUser(
  userId: string,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM user_sessions
     WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  return parseInt(result.rows[0]?.count || '0', 10);
}

export async function revokeOldestSessions(
  userId: string,
  keepCount: number,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = 'Session quota exceeded'
     WHERE id IN (
       SELECT id FROM user_sessions
       WHERE user_id = $1 AND status = 'active'
       ORDER BY last_active_at ASC
       OFFSET $2
     )`,
    [userId, keepCount],
  );
  return result.rowCount ?? 0;
}

export async function revokeSession(
  id: string,
  reason: string,
  terminatedBy?: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = $2, terminated_by = $3
     WHERE id = $1`,
    [id, reason, terminatedBy || null],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Revoke every active session of a user. Used by suspend, password reset,
 * MFA disable, and refresh-token reuse responses.
 */
export async function revokeAllUserSessions(
  userId: string,
  reason: string,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = $2
     WHERE user_id = $1 AND status = 'active'`,
    [userId, reason],
  );
  return result.rowCount ?? 0;
}

/**
 * Revoke every active session except the caller's. Used by `/sessions/others`
 * and by the password-change flow.
 */
export async function revokeAllOtherSessions(
  userId: string,
  currentSessionId: string,
  reason: string,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = $3
     WHERE user_id = $1 AND id <> $2 AND status = 'active'`,
    [userId, currentSessionId, reason],
  );
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
export async function rotateRefreshToken(
  sessionId: string,
  oldHash: string,
  newHash: string,
  newExpiresAt: Date,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET refresh_token_hash = $3,
         previous_refresh_token_hash = $2,
         previous_refresh_rotated_at = NOW(),
         expires_at = $4,
         last_active_at = NOW()
     WHERE id = $1
       AND refresh_token_hash = $2
       AND status = 'active'`,
    [sessionId, oldHash, newHash, newExpiresAt],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function touchSessionActivity(
  sessionId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

export async function cleanupExpiredSessions(
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET status = 'expired',
         terminated_at = COALESCE(terminated_at, NOW()),
         termination_reason = COALESCE(termination_reason, 'Automatic cleanup of expired session')
     WHERE status = 'active'
       AND (expires_at < NOW() OR absolute_expires_at < NOW())`,
  );
  return result.rowCount ?? 0;
}

export async function purgeOldRevokedSessions(
  olderThanDays = 90,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `DELETE FROM user_sessions
     WHERE status IN ('revoked', 'expired', 'terminated_by_admin')
       AND COALESCE(terminated_at, expires_at) < NOW() - ($1 || ' days')::interval`,
    [olderThanDays.toString()],
  );
  return result.rowCount ?? 0;
}

// ============================================================================
// TRANSACTION HELPERS
// ============================================================================

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
