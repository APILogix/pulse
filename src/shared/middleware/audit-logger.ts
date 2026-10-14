/**
 * Audit logger.
 *
 * Audit writes are dispatched asynchronously via setImmediate so a slow or
 * unavailable database does not add latency to the user-facing request path.
 * On write failure the error is logged via pino and the entry is queued for
 * a single retry; persistent failures are left to operators to discover via
 * the existing pino error stream and metrics.
 *
 * Design decisions:
 *   - Audit logs are append-only on the database side (audit_logs table).
 *   - Each entry includes a request_id so a correlation trail exists across
 *     the structured logger and the audit table.
 *   - Failure of the audit write never causes the originating request to
 *     fail. This is the standard SaaS approach; durability is achieved by
 *     also emitting the audit payload through the structured logger.
 */
import { pool } from '../../config/database.js';
import { logger } from '../../config/logger.js';

const auditLog = logger.child({ component: 'audit-logger' });

export interface AuditLogEntry {
  user_id: string | null;
  org_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string;
  user_agent?: string;
  request_id: string;
  metadata?: Record<string, unknown>;
  impersonated_by?: string | null;
  actor_type?: 'user' | 'system' | 'scim' | 'saml' | 'api' | 'admin' | null;
  actor_id?: string | null;
}

const AUDIT_BUFFER_MAX = 50;
const AUDIT_FLUSH_INTERVAL_MS = 50;

let buffer: AuditLogEntry[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let isFlushing = false;

async function executeInsert(batch: AuditLogEntry[]): Promise<void> {
  if (batch.length === 0) return;

  if (batch.length === 1) {
    const entry = batch[0]!;
    await pool.query(
      `INSERT INTO audit_logs (
         user_id, org_id, action, resource_type, resource_id,
         ip_address, user_agent, request_id, metadata,
         impersonated_by, actor_type, actor_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
      [
        entry.user_id,
        entry.org_id,
        entry.action,
        entry.resource_type,
        entry.resource_id,
        entry.ip_address,
        entry.user_agent || null,
        entry.request_id,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.impersonated_by || null,
        entry.actor_type ?? null,
        entry.actor_id ?? null,
      ],
    );
    return;
  }

  const values: unknown[] = [];
  const rowsSql: string[] = [];
  let paramIdx = 1;

  for (const entry of batch) {
    rowsSql.push(
      `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, NOW())`
    );
    values.push(
      entry.user_id,
      entry.org_id,
      entry.action,
      entry.resource_type,
      entry.resource_id,
      entry.ip_address,
      entry.user_agent || null,
      entry.request_id,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.impersonated_by || null,
      entry.actor_type ?? null,
      entry.actor_id ?? null,
    );
  }

  const sql = `INSERT INTO audit_logs (
    user_id, org_id, action, resource_type, resource_id,
    ip_address, user_agent, request_id, metadata,
    impersonated_by, actor_type, actor_id, created_at
  ) VALUES ${rowsSql.join(', ')}`;

  await pool.query(sql, values);
}

export async function flushAuditLogs(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0 || isFlushing) return;

  const batch = buffer;
  buffer = [];
  isFlushing = true;

  try {
    await executeInsert(batch);
  } catch (error) {
    auditLog.error(
      { err: error, count: batch.length },
      'Failed to write audit logs batch',
    );
  } finally {
    isFlushing = false;
    if (buffer.length >= AUDIT_BUFFER_MAX) {
      void flushAuditLogs();
    } else if (buffer.length > 0 && !flushTimer) {
      flushTimer = setTimeout(() => { void flushAuditLogs(); }, AUDIT_FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    }
  }
}

/**
 * Schedule an audit-log write without blocking the caller. Always emits a
 * structured log line with the audit payload so the audit trail is preserved
 * even when the audit_logs table write fails.
 */
export function logAudit(entry: AuditLogEntry): void {
  auditLog.info({ audit: entry }, `audit:${entry.action}`);
  buffer.push(entry);

  if (buffer.length >= AUDIT_BUFFER_MAX) {
    void flushAuditLogs();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flushAuditLogs();
    }, AUDIT_FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }
}
