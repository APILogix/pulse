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
}

async function writeAudit(entry: AuditLogEntry, attempt = 1): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
         user_id, org_id, action, resource_type, resource_id,
         ip_address, user_agent, request_id, metadata,
         impersonated_by, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
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
      ],
    );
  } catch (error) {
    auditLog.error(
      { err: error, action: entry.action, attempt, entry },
      'Failed to write audit log',
    );

    // One short retry to weather transient blips, then surrender so the
    // structured log line above remains the durable record of attempt.
    if (attempt < 2) {
      setTimeout(() => {
        void writeAudit(entry, attempt + 1);
      }, 250);
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
  // Detach from the request lifecycle.
  setImmediate(() => {
    void writeAudit(entry);
  });
}
