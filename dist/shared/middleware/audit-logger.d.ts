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
/**
 * Schedule an audit-log write without blocking the caller. Always emits a
 * structured log line with the audit payload so the audit trail is preserved
 * even when the audit_logs table write fails.
 */
export declare function logAudit(entry: AuditLogEntry): void;
//# sourceMappingURL=audit-logger.d.ts.map