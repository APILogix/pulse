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
// TRANSACTION HELPERS
// ============================================================================

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let transactionError: unknown;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    transactionError = e;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      repositoryLogger.warn(
        { err: rollbackError, originalError: e },
        'Failed to rollback auth transaction; preserving original error',
      );
    }
    throw e;
  } finally {
    if (transactionError && shouldDestroyTransactionClient(transactionError)) {
      client.release(
        transactionError instanceof Error
          ? transactionError
          : new Error('Destroying transaction client after connection-level failure'),
      );
    } else {
      client.release();
    }
  }
}
