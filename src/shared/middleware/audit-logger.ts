import { pool } from "../../config/database.js";

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
    // Log to console but don't fail the request
    console.error('Failed to write audit log:', error);
  }
}