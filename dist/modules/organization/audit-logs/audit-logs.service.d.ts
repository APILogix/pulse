import type { FastifyBaseLogger } from "fastify";
import type { AuditLogsRepository } from "./audit-logs.repository.js";
import type { RequestMeta, OrgMemberRow, OrgRole, CursorPaginationQuery } from "../types.js";
import type { CreateAuditLogRecord } from "./audit-logs.schema.js";
export interface AuditLogDto {
    id: string;
    actorUserId: string | null;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    entityName: string | null;
    status: string;
    createdAt: Date;
}
export interface AuditLogsServiceDependencies {
    repository: AuditLogsRepository;
    requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
    log: FastifyBaseLogger;
}
export declare class AuditLogsService {
    private readonly deps;
    constructor(deps: AuditLogsServiceDependencies);
    audit(meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & {
        orgId: string;
    }): Promise<void>;
    listAuditLogs(orgId: string, userId: string, q: CursorPaginationQuery, filters?: {
        action?: string;
        entityType?: string;
        actorUserId?: string;
    }): Promise<{
        data: AuditLogDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
    exportAuditLogs(orgId: string, userId: string, filters?: {
        action?: string;
        entityType?: string;
        actorUserId?: string;
        startDate?: string;
        endDate?: string;
    }): Promise<(AuditLogDto & {
        oldValues: unknown;
        newValues: unknown;
        changedFields: unknown;
    })[]>;
}
//# sourceMappingURL=audit-logs.service.d.ts.map