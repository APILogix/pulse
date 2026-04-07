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
export declare function logAudit(entry: AuditLogEntry): Promise<void>;
export {};
//# sourceMappingURL=audit-logger.d.ts.map