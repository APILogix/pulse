/**
 * Auth Repository - Pure SQL queries for PostgreSQL
 * No business logic, only data access
 */

import { pool } from "../../config/database.js";
import  type { PoolClient } from 'pg';
import type  {MFADevice, UserSession,User} from './types.js';
import {  UserStatus,  SessionStatus, MFAType } from './types.js';
import { env} from '../../config/env.js';
import type { fr } from 'zod/v4/locales';
import { config } from 'process';



// ============================================
// USER QUERIES
// ============================================

export async function findUserById(id: string, client?: PoolClient): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return result.rows[0] || null;
}

export async function findUserByClerkId(clerkUserId: string, client?: PoolClient): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `SELECT * FROM users WHERE clerk_user_id = $1 AND deleted_at IS NULL`,
    [clerkUserId]
  );
  return result.rows[0] || null;
}

export async function findUserByEmailHash(emailHash: string, client?: PoolClient): Promise<User | null> {
  const db = client || pool;
const result = await db.query<User>(
  `
  SELECT 
    id,
    status,
    status_reason,
    locked_until,
    password_hash,
    login_attempts,
    mfa_enabled,
    deleted_at
  FROM users 
  WHERE email_hash = $1 
    AND deleted_at IS NULL
  `,
  [emailHash]
);
  return result.rows[0] || null;
}

export async function createUser(
  data: {
    id: string;
    email: string;
    full_name: string;
    avatar_url?: string | undefined;
    email_hash: string;
    password?: string | undefined;
  },
  client?: PoolClient
): Promise<User> {
  const db = client || pool;

  const result = await db.query<User>(
    `INSERT INTO users (
      id, email, email_hash, full_name, avatar_url, password_hash, status
    ) VALUES ($1, $2, $3, $4, $5,$6, 'active')
    RETURNING *`,
    [
      data.id, //  FIXED
      data.email,
      data.email_hash,
      data.full_name,
      data.avatar_url || null,
      data.password
    ]
  );

  return result.rows[0]!;
}

export async function findUserByEmail(
  email: string,
  client?: PoolClient,
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `SELECT * FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
    [email],
  );
  return result.rows[0] || null;
}

export async function updateUser(
  id: string,
  data: Partial<Pick<User, 'full_name' | 'avatar_url' | 'timezone' | 'locale' | 'preferred_mfa_method'>>,
  client?: PoolClient
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
    values
  );
  return result.rows[0] || null;
}

export async function softDeleteUser(
  id: string,
  reason: string | null,
  deletedBy: string | null,
  client?: PoolClient
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE users 
     SET deleted_at = NOW(), deleted_by = $2, deletion_reason = $3, status = 'deleted', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, deletedBy, reason]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function restoreUser(id: string, client?: PoolClient): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `UPDATE users 
     SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL, status = 'active', updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NOT NULL
     RETURNING *`,
    [id]
  );
  return result.rows[0] || null;
}

export async function suspendUser(
  id: string,
  reason: string,
  suspendedBy: string,
  client?: PoolClient
): Promise<User | null> {
  const db = client || pool;
  const result = await db.query<User>(
    `UPDATE users 
     SET status = 'suspended', status_reason = $2, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, reason]
  );
  return result.rows[0] || null;
}

export async function listUsers(
  options: {
    status?: UserStatus;
    limit?: number;
    offset?: number;
    search?: string;
  },
  client?: PoolClient
): Promise<{ users: User[]; total: number }> {
  const db = client || pool;
  const { status, limit = 20, offset = 0, search } = options;
  
  let whereClause = 'WHERE deleted_at IS NULL';
  const params: unknown[] = [];
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

  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) FROM users ${whereClause}`,
    params
  );

  const usersResult = await db.query<User>(
    `SELECT * FROM users ${whereClause} 
     ORDER BY created_at DESC 
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return {
    users: usersResult.rows,
    total: parseInt(countResult.rows[0]!.count, 10),
  };
}

export async function updateLoginAttempts(
  id: string,
  attempts: number,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users SET login_attempts = $2, updated_at = NOW() WHERE id = $1`,
    [id, attempts]
  );
}

export async function recordLogin(
  id: string,
  ip: string,
  userAgent: string,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users 
     SET last_login_at = NOW(), last_login_ip = $2, last_login_user_agent = $3, 
         login_attempts = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id, ip, userAgent]
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

// ============================================
// MFA DEVICE QUERIES
// ============================================

export async function findMFADevicesByUserId(
  userId: string,
  activeOnly = true,
  client?: PoolClient
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
  client?: PoolClient
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

export async function createMFADevice(
  data: {
    user_id: string;
    device_type: MFAType;
    device_name: string;
    secret_encrypted: string | null;
    is_primary: boolean;
    device_metadata?: Record<string, unknown>;
  },
  client?: PoolClient
): Promise<MFADevice> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `INSERT INTO user_mfa_devices (
      user_id, device_type, device_name, secret_encrypted, is_primary, 
      device_metadata, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)
    RETURNING *`,
    [
      data.user_id,
      data.device_type,
      data.device_name,
      data.secret_encrypted,
      data.is_primary,
      JSON.stringify(data.device_metadata || {}),
    ]
  );
  return result.rows[0]!;
}

export async function verifyMFADevice(
  id: string,
  backupCodesHash: string[] | null,
  client?: PoolClient
): Promise<MFADevice | null> {
  const db = client || pool;
  const result = await db.query<MFADevice>(
    `UPDATE user_mfa_devices 
     SET verified = TRUE, verified_at = NOW(), backup_codes_hash = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, backupCodesHash ? JSON.stringify(backupCodesHash) : null]
  );
  return result.rows[0] || null;
}

export async function updateMFADevicePrimary(
  userId: string,
  deviceId: string,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  // Use transaction to ensure only one primary
  await db.query('BEGIN');
  try {
    // Remove primary from all others
    await db.query(
      `UPDATE user_mfa_devices SET is_primary = FALSE, updated_at = NOW() 
       WHERE user_id = $1 AND is_primary = TRUE`,
      [userId]
    );
    // Set new primary
    await db.query(
      `UPDATE user_mfa_devices SET is_primary = TRUE, updated_at = NOW() 
       WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

export async function disableMFADevice(
  id: string,
  reason: string,
  client?: PoolClient
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_mfa_devices 
     SET is_active = FALSE, disabled_at = NOW(), disabled_reason = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, reason]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteMFADevice(id: string, client?: PoolClient): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `DELETE FROM user_mfa_devices WHERE id = $1`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function updateUserMFAEnabled(
  userId: string,
  enabled: boolean,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users 
     SET mfa_enabled = $2, 
         mfa_enforced_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, enabled]
  );
}

export async function updateBackupCodesGenerated(
  userId: string,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users SET mfa_backup_codes_generated_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [userId]
  );
}

// ============================================
// PASSWORD RESET / VERIFICATION QUERIES
// ============================================

export async function createPasswordReset(
  data: {
    user_id: string;
    token_hash: string;
    expires_at: Date;
  },
  client?: PoolClient,
): Promise<{ id: string; user_id: string; token_hash: string; expires_at: Date }> {
  const db = client || pool;
  const result = await db.query<{
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: Date;
  }>(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, token_hash, expires_at`,
    [data.user_id, data.token_hash, data.expires_at],
  );
  return result.rows[0]!;
}

export async function findPasswordResetByToken(
  tokenHash: string,
  client?: PoolClient,
): Promise<{ id: string; user_id: string; token_hash: string; expires_at: Date; used_at: Date | null } | null> {
  const db = client || pool;
  const result = await db.query<{
    id: string;
    user_id: string;
    token_hash: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    `SELECT id, user_id, token_hash, expires_at, used_at
     FROM password_resets
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

export async function markPasswordResetUsed(
  id: string,
  usedIp: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE password_resets
     SET used_at = NOW(), used_ip = $2
     WHERE id = $1`,
    [id, usedIp],
  );
}

export async function invalidatePasswordResetsForUser(
  userId: string,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE password_resets
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return result.rowCount ?? 0;
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
    [deviceId, backupCodesHash ? JSON.stringify(backupCodesHash) : null],
  );
}

export async function createEmailVerification(
  data: {
    user_id: string;
    email: string;
    token_hash: string;
    expires_at: Date;
  },
  client?: PoolClient,
): Promise<{ id: string; user_id: string; email: string; token_hash: string; expires_at: Date }> {
  const db = client || pool;
  const result = await db.query<{
    id: string;
    user_id: string;
    email: string;
    token_hash: string;
    expires_at: Date;
  }>(
    `INSERT INTO email_verifications (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, email, token_hash, expires_at`,
    [data.user_id, data.email, data.token_hash, data.expires_at],
  );
  return result.rows[0]!;
}

export async function findEmailVerificationByToken(
  tokenHash: string,
  client?: PoolClient,
): Promise<{ id: string; user_id: string; email: string; token_hash: string; expires_at: Date; verified_at: Date | null } | null> {
  const db = client || pool;
  const result = await db.query<{
    id: string;
    user_id: string;
    email: string;
    token_hash: string;
    expires_at: Date;
    verified_at: Date | null;
  }>(
    `SELECT id, user_id, email, token_hash, expires_at, verified_at
     FROM email_verifications
     WHERE token_hash = $1 AND verified_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

export async function markEmailVerificationUsed(
  id: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE email_verifications
     SET verified_at = NOW()
     WHERE id = $1`,
    [id],
  );
}

export async function markEmailAsVerified(
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE users
     SET email_verified = TRUE, email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
     WHERE id = $1`,
    [userId],
  );
}

// ============================================
// SESSION QUERIES
// ============================================

export async function createSession(
  data: {
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
  client?: PoolClient
): Promise<UserSession> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `INSERT INTO user_sessions (
      user_id, refresh_token_hash, access_token_jti, device_fingerprint,
      device_name, device_type, ip_address, user_agent, expires_at, absolute_expires_at,
      mfa_verified_at, mfa_expires_at, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
    RETURNING *`,
    [
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
    ]
  );
  return result.rows[0]!;
}

export async function findSessionByRefreshToken(
  tokenHash: string,
  client?: PoolClient
): Promise<UserSession | null> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `SELECT * FROM user_sessions 
     WHERE refresh_token_hash = $1 AND status = 'active'`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

export async function findSessionById(
  id: string,
  userId?: string,
  client?: PoolClient
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
  client?: PoolClient
): Promise<UserSession[]> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `SELECT * FROM user_sessions 
     WHERE user_id = $1 AND status = 'active'
     ORDER BY last_active_at DESC`,
    [userId]
  );
  return result.rows;
}

export async function revokeSession(
  id: string,
  reason: string,
  terminatedBy?: string,
  client?: PoolClient
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions 
     SET status = 'revoked', terminated_at = NOW(), termination_reason = $2, terminated_by = $3
     WHERE id = $1`,
    [id, reason, terminatedBy || null]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revokeAllOtherSessions(
  userId: string,
  currentSessionId: string,
  client?: PoolClient
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions 
     SET status = 'revoked', terminated_at = NOW(), termination_reason = 'User revoked all other sessions'
     WHERE user_id = $1 AND id != $2 AND status = 'active'`,
    [userId, currentSessionId]
  );
  return result.rowCount ?? 0;
}

export async function updateSessionActivity(
  id: string,
  accessTokenJti: string,
  client?: PoolClient
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_sessions 
     SET last_active_at = NOW(), access_token_jti = $2
     WHERE id = $1`,
    [id, accessTokenJti]
  );
}

export async function cleanupExpiredSessions(client?: PoolClient): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions 
     SET status = 'expired', termination_reason = 'Automatic cleanup of expired session'
     WHERE status = 'active' 
       AND (expires_at < NOW() OR absolute_expires_at < NOW())`
  );
  return result.rowCount ?? 0;
}

// ============================================
// TRANSACTION HELPERS
// ============================================

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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
