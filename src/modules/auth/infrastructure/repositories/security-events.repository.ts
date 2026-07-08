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
  | 'mfa_recovery_requested'
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
