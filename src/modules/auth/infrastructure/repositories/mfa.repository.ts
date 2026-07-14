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
import { withTransaction } from './transaction.js';

import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
import type { MFADevice, User, UserSession, UserStatus, MFAType } from '../../domain/types.js';

const repositoryLogger = logger.child({ component: 'auth-repository' });

const MFA_DEVICE_SELECT = `
  id,
  user_id,
  CASE
    WHEN type::text = 'webauthn' THEN 'hardware_key'
    WHEN type::text = 'backup_code' THEN 'backup_codes'
    ELSE type::text
  END AS device_type,
  type::text AS type,
  device_type AS mfa_device_type,
  device_name,
  secret_encrypted,
  phone_e164,
  email,
  credential_id,
  public_key,
  sign_count,
  is_verified,
  verified_at,
  last_used_at,
  last_used_ip,
  is_primary,
  is_active,
  disabled_at,
  disabled_reason,
  device_metadata,
  created_at,
  updated_at,
  CASE WHEN is_active THEN NULL ELSE COALESCE(disabled_at, updated_at) END AS deleted_at,
  NULL::text AS display_hint,
  NULL::text AS phone_number_encrypted,
  NULL::jsonb AS backup_codes_hash,
  0::integer AS failed_attempts,
  NULL::timestamptz AS last_failed_at,
  0::integer AS use_count
`;

function toDbMfaType(deviceType: MFAType | 'hardware_key' | 'backup_codes'): string {
  if (deviceType === 'hardware_key') return 'webauthn';
  if (deviceType === 'backup_codes') return 'backup_code';
  return deviceType;
}

function shouldDestroyTransactionClient(error: unknown): boolean {
  const pgCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = error instanceof Error ? error.message : String(error);

  return (
    pgCode.startsWith('08') ||
    pgCode === '57P01' ||
    pgCode === '57P02' ||
    pgCode === '57P03' ||
    message.includes('Query read timeout') ||
    message.includes('Connection terminated') ||
    message.includes('Connection ended unexpectedly') ||
    message.includes('Connection terminated unexpectedly')
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
  let query = `SELECT ${MFA_DEVICE_SELECT} FROM user_mfa_devices WHERE user_id = $1`;
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
  let query = `SELECT ${MFA_DEVICE_SELECT} FROM user_mfa_devices WHERE id = $1`;
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
    `SELECT ${MFA_DEVICE_SELECT} FROM user_mfa_devices
     WHERE user_id = $1 AND type = $2::mfa_type
     ORDER BY is_primary DESC, created_at DESC
     LIMIT 1`,
    [userId, toDbMfaType(deviceType)],
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
    display_hint?: string | null;
    phone_number_encrypted?: string | null;
  },
  client?: PoolClient,
): Promise<MFADevice> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `INSERT INTO user_mfa_devices (
       user_id, type, device_type, device_name, secret_encrypted, is_primary,
       device_metadata, is_active, is_verified
     ) VALUES ($1, $2::mfa_type, $3, $4, $5, $6, $7, TRUE, FALSE)
     RETURNING ${MFA_DEVICE_SELECT}`,
    [
      data.user_id,
      toDbMfaType(data.device_type),
      data.device_type === 'hardware_key' ? 'hardware_key' : data.device_type,
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
  userId: string,
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
         is_verified = FALSE,
         verified_at = NULL,
         disabled_at = NULL,
         disabled_reason = NULL,
         device_metadata = $5,
         last_used_at = NULL,
         last_used_ip = NULL,
         sign_count = 0,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $6
     RETURNING ${MFA_DEVICE_SELECT}`,
    [
      id,
      data.device_name,
      data.secret_encrypted,
      data.is_primary,
      JSON.stringify(data.device_metadata || {}),
      userId,
    ],
  );
  return result.rows[0] || null;
}

export async function verifyMFADevice(
  id: string,
  userId: string,
  client?: PoolClient,
): Promise<MFADevice | null> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `UPDATE user_mfa_devices
     SET is_verified = TRUE, verified_at = NOW(),
         is_active = TRUE,
         disabled_at = NULL,
         disabled_reason = NULL,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING ${MFA_DEVICE_SELECT}`,
    [id, userId],
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
  await withTransaction(async (tx: PoolClient) => exec(tx));
}

export async function disableMFADevice(
  id: string,
  userId: string,
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
     WHERE id = $1 AND user_id = $3`,
    [id, reason, userId],
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
  userId: string,
  backupCodesHash: string[] | null,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  repositoryLogger.debug({ deviceId, userId, count: backupCodesHash?.length ?? 0 }, 'backup codes are stored in user_backup_codes');
}

export async function setBackupCodesForAllUserDevices(
  userId: string,
  backupCodesHash: string[],
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  repositoryLogger.debug({ userId, count: backupCodesHash.length }, 'backup codes are stored in user_backup_codes');
}

export async function updateMFADeviceLastUsed(
  deviceId: string,
  userId: string,
  ipAddress: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_mfa_devices
     SET last_used_at = NOW(),
         last_used_ip = $2::inet,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $3`,
    [deviceId, ipAddress, userId],
  );
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
     VALUES ($1, $2, $3, NOW() + ($4::interval))`,
    [userId, deviceId, codeHash, `${ttlSeconds} seconds`],
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


export async function countUnusedBackupCodes(userId: string, client?: PoolClient): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `SELECT COUNT(*) as count FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  return parseInt(result.rows[0].count, 10);
}

export async function generateBackupCodesForUser(userId: string, count: number = 10, client?: PoolClient): Promise<{ plain: string[], hashed: string[] }> {
  const db = client || pool;
  const result = await db.query(
    `SELECT code_plaintext, code_hash FROM generate_backup_codes_for_user($1, $2)`,
    [userId, count]
  );
  return {
    plain: result.rows.map(r => r.code_plaintext),
    hashed: result.rows.map(r => r.code_hash)
  };
}

export async function deleteAllUnusedBackupCodes(userId: string, client?: PoolClient): Promise<void> {
  const db = client || pool;
  await db.query(
    `DELETE FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
}

export async function getUnusedBackupCodes(userId: string, client?: PoolClient): Promise<any[]> {
  const db = client || pool;
  const result = await db.query(
    `SELECT id, code_hash FROM user_backup_codes WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
  return result.rows;
}

export async function markBackupCodeUsed(codeId: string, userId: string, ipAddress: string, client?: PoolClient): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_backup_codes SET used_at = NOW(), used_from_ip = $3 WHERE id = $1 AND user_id = $2`,
    [codeId, userId, ipAddress]
  );
}
