import { pool } from "../../config/database.js";
import { logger } from "../../config/logger.js";

const auditLog = logger.child({ component: 'audit-logger' });

interface AuditLogEntry {
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

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
        user_id, org_id, action, resource_type, resource_id,
        ip_address, user_agent, request_id, metadata, impersonated_by, created_at
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
      ]
    );
  } catch (error) {
    // Log via pino but don't fail the request — audit writes are best-effort
    auditLog.error({ err: error, action: entry.action }, 'Failed to write audit log');
  }
}