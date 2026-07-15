export declare class ConnectorAuditRepository {
    private readonly db;
    insertAuditLog(input: {
        organizationId: string;
        connectorId: string | null;
        action: string;
        actorId: string | null;
        actorType?: string;
        previousState?: Record<string, unknown> | null;
        newState?: Record<string, unknown> | null;
        changesSummary?: Record<string, unknown> | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        requestId?: string | null;
    }): Promise<void>;
    listAuditLogs(organizationId: string, connectorId: string | null, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import('../types.js').ConnectorAuditLogRow[];
        total: number;
    }>;
}
//# sourceMappingURL=audit.repository.d.ts.map