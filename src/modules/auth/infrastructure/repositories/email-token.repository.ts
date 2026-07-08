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
// EMAIL-TOKEN QUERIES (verification + password reset + mfa_disable)
// ============================================================================

export type EmailTokenPurpose =
  | 'email_verification'
  | 'password_reset'
  | 'mfa_disable'
  | 'account_unlock'
  | 'account_deletion';

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
