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

export class AuditLogsService {
  constructor(private readonly deps: AuditLogsServiceDependencies) {}

  async audit(meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & { orgId: string }) {
    try {
      await this.deps.repository.createAuditLog({
        ...data,
        actorUserId: meta.actorUserId,
        actorEmail: meta.actorEmail,
        actorIp: meta.actorIp,
        actorUserAgent: meta.actorUserAgent,
        actorSessionId: meta.actorSessionId,
        requestId: meta.requestId,
        httpMethod: meta.httpMethod,
        endpoint: meta.endpoint,
      });
    } catch (e) {
      this.deps.log.error({ err: e }, "Audit log write failed");
    }
  }

  async listAuditLogs(orgId: string, userId: string, q: CursorPaginationQuery, filters?: { action?: string; entityType?: string; actorUserId?: string }) {
    await this.deps.requireMember(orgId, userId, "admin");
    const result = await this.deps.repository.listAuditLogs(orgId, q, filters);
    return {
      data: result.data.map(a => ({
        id: a.id,
        actorUserId: a.actor_user_id,
        actorEmail: a.actor_email,
        action: a.action,
        entityType: a.entity_type,
        entityId: a.entity_id,
        entityName: a.entity_name,
        status: a.status,
        createdAt: a.created_at,
      }) as AuditLogDto),
      meta: result.meta,
    };
  }

  async exportAuditLogs(orgId: string, userId: string, filters?: { action?: string; entityType?: string; actorUserId?: string; startDate?: string; endDate?: string }) {
    await this.deps.requireMember(orgId, userId, "admin");
    const rows = await this.deps.repository.exportAuditLogs(orgId, filters);
    return rows.map(a => ({
      id: a.id,
      actorUserId: a.actor_user_id,
      actorEmail: a.actor_email,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      entityName: a.entity_name,
      oldValues: a.old_values,
      newValues: a.new_values,
      changedFields: a.changed_fields,
      status: a.status,
      createdAt: a.created_at,
    }) as AuditLogDto & { oldValues: unknown; newValues: unknown; changedFields: unknown });
  }
}
