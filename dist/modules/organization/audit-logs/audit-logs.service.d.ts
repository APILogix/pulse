import type { FastifyBaseLogger } from "fastify";
import type { AuditLogsRepository } from "./audit-logs.repository.js";
import type { OrgMemberRow, OrgRole, CursorPaginationQuery } from "../types.js";
import type { CreateAuditLogRecord, AuditLogFilters } from "./audit-logs.schema.js";
export interface OrganizationAuditRequestMeta {
    actorUserId: string;
    actorEmail: string | null;
    actorIp: string;
    actorUserAgent: string | null;
    actorSessionId: string | null;
    requestId: string;
    httpMethod: string;
    endpoint: string;
}
export interface AuditLogDto {
    id: string;
    projectId: string | null;
    actorUserId: string | null;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    entityName: string | null;
    changedFields: string[] | null;
    status: string;
    isSensitive: boolean;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export interface AuditLogsServiceDependencies {
    repository: AuditLogsRepository;
    requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
    log: FastifyBaseLogger;
}
export declare class OrganizationAuditService {
    private readonly deps;
    constructor(deps: AuditLogsServiceDependencies);
    audit(meta: OrganizationAuditRequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & {
        orgId: string;
    }): Promise<void>;
    listAuditLogs(orgId: string, userId: string, q: CursorPaginationQuery, filters?: AuditLogFilters): Promise<{
        data: AuditLogDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
            totalCount: number;
        };
    }>;
    exportAuditLogs(orgId: string, userId: string, filters?: AuditLogFilters): Promise<(AuditLogDto & {
        oldValues: unknown;
        newValues: unknown;
        changedFields: unknown;
    })[]>;
}
//# sourceMappingURL=audit-logs.service.d.ts.map