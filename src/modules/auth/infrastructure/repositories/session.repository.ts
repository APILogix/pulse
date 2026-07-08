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

import { pool } from '../../../../config/database.js';
import { logger } from '../../../../config/logger.js';
import type { MFADevice, User, UserSession, UserStatus, MFAType } from '../../domain/types.js';

const repositoryLogger = logger.child({ component: 'auth-repository' });

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
    sso_provider_id?: string | null;
    sso_provider_type?: string | null;
    login_method?: string | null;
    saml_name_id?: string | null;
    saml_session_index?: string | null;
  },
  client?: PoolClient,
): Promise<UserSession> {
  const db = client || pool;
  const result = await db.query<UserSession>(
    `INSERT INTO user_sessions (
       id, user_id, refresh_token_hash, access_token_jti, device_fingerprint,
       device_name, device_type, ip_address, user_agent, expires_at,
       absolute_expires_at, mfa_verified_at, mfa_expires_at,
       sso_provider_id, sso_provider_type, login_method, saml_name_id, saml_session_index, status
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8::inet, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, 'active'
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
      data.sso_provider_id ?? null,
      data.sso_provider_type ?? null,
      data.login_method ?? null,
      data.saml_name_id ?? null,
      data.saml_session_index ?? null,
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
  userId: string,
  reason: string,
  terminatedBy?: string,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(),
         termination_reason = $2, terminated_by = $3
     WHERE id = $1 AND user_id = $4`,
    [id, reason, terminatedBy || null, userId],
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

export async function revokeAllSessionsForUser(
  userId: string,
  reason: string,
  client?: PoolClient,
): Promise<number> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET status = 'revoked', terminated_at = NOW(), termination_reason = $2
     WHERE user_id = $1 AND status = 'active'`,
    [userId, reason],
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
  userId: string,
  oldHash: string,
  newHash: string,
  newExpiresAt: Date,
  client?: PoolClient,
): Promise<boolean> {
  const db = client || pool;
  const result = await db.query(
    `UPDATE user_sessions
     SET refresh_token_hash = $4,
         previous_refresh_token_hash = $3,
         previous_refresh_rotated_at = NOW(),
         expires_at = $5,
         last_active_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND refresh_token_hash = $3
       AND status = 'active'`,
    [sessionId, userId, oldHash, newHash, newExpiresAt],
  );
  return (result.rowCount ?? 0) === 1;
}

export async function touchSessionActivity(
  sessionId: string,
  userId: string,
  client?: PoolClient,
): Promise<void> {
  const db = client || pool;
  await db.query(
    `UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
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
       AND COALESCE(terminated_at, expires_at) < NOW() - ($1::interval)`,
    [`${olderThanDays} days`],
  );
  return result.rowCount ?? 0;
}
