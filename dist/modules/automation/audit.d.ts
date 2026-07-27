/**
 * Automation Module — Immutable Audit Log persistence.
 *
 * Insert-only: no updates or deletes allowed outside of migration fixes.
 * Organization-scoped list with parameterized SQL.
 */
import type { Pool, PoolClient } from 'pg';
import type { AuditAction } from './types.js';
export type AuditDb = Pool | PoolClient;
export interface AuditLogRow {
    id: string;
    organizationId: string | null;
    projectId: string | null;
    workflowId: string | null;
    runId: string | null;
    stepId: string | null;
    approvalId: string | null;
    actorUserId: string | null;
    actorType: string;
    action: string;
    entityType: string;
    entityId: string | null;
    requestId: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    beforeState: Record<string, unknown> | null;
    afterState: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    occurredAt: Date;
}
export interface AuditListQuery {
    limit: number;
    offset: number;
    workflowId?: string;
    runId?: string;
    action?: string;
    actorUserId?: string;
}
export interface InsertAuditParams {
    organizationId: string | null;
    projectId?: string | null;
    workflowId?: string | null;
    runId?: string | null;
    stepId?: string | null;
    approvalId?: string | null;
    actorUserId?: string | null;
    actorType?: string;
    action: AuditAction | string;
    entityType: string;
    entityId?: string | null;
    requestId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
}
export declare class AutomationAuditRepository {
    private readonly db;
    constructor(db: Pool);
    /**
     * Insert an immutable audit log entry.
     * Safe for use inside a transaction (pass PoolClient as db).
     */
    insertAuditLog(params: InsertAuditParams, db?: AuditDb): Promise<AuditLogRow>;
    /**
     * List audit logs for an organization, with optional filters.
     */
    listAuditLogs(orgId: string, q: AuditListQuery, db?: AuditDb): Promise<{
        data: AuditLogRow[];
        total: number;
    }>;
}
//# sourceMappingURL=audit.d.ts.map