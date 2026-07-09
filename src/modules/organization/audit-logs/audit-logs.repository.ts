import { BaseRepository, cursorPage } from "../shared/base.repository.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { CreateAuditLogRecord, AuditLogRow } from "./audit-logs.schema.js";

export class AuditLogsRepository extends BaseRepository {
  async createAuditLog(entry: CreateAuditLogRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO organization_audit_logs (org_id,actor_user_id,actor_email,actor_ip,actor_user_agent,actor_session_id,action,entity_type,entity_id,entity_name,request_id,http_method,endpoint,old_values,new_values,changed_fields,status,failure_reason,is_sensitive,metadata)
       VALUES ($1,$2,$3,$4::inet,$5,$6::uuid,$7,$8,$9::uuid,$10,$11::uuid,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [entry.orgId, entry.actorUserId, entry.actorEmail??null, entry.actorIp??null, entry.actorUserAgent??null, entry.actorSessionId??null,
       entry.action, entry.entityType, entry.entityId??null, entry.entityName??null, entry.requestId??null, entry.httpMethod??null,
       entry.endpoint??null, entry.oldValues?JSON.stringify(entry.oldValues):null, entry.newValues?JSON.stringify(entry.newValues):null,
       entry.changedFields??null, entry.status??'success', entry.failureReason??null, entry.isSensitive??false,
       entry.metadata?JSON.stringify(entry.metadata):'{}']
    );
  }

  async listAuditLogs(orgId: string, q: CursorPaginationQuery, filters?: { action?: string; entityType?: string; actorUserId?: string }): Promise<CursorPaginatedResponse<AuditLogRow>> {
    const params: unknown[] = [orgId];
    let where = `org_id=$1`;
    if (filters?.action) { params.push(filters.action); where += ` AND action=$${params.length}`; }
    if (filters?.entityType) { params.push(filters.entityType); where += ` AND entity_type=$${params.length}`; }
    if (filters?.actorUserId) { params.push(filters.actorUserId); where += ` AND actor_user_id=$${params.length}`; }
    if (q.cursor) { params.push(q.cursor); where += ` AND created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<AuditLogRow>(
      `SELECT id,org_id,actor_user_id,actor_email,action,entity_type,entity_id,entity_name,old_values,new_values,changed_fields,status,is_sensitive,metadata,created_at
       FROM organization_audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  async exportAuditLogs(orgId: string, filters?: { action?: string; entityType?: string; actorUserId?: string; startDate?: string; endDate?: string }): Promise<AuditLogRow[]> {
    const params: unknown[] = [orgId];
    let where = `org_id=$1`;
    if (filters?.action) { params.push(filters.action); where += ` AND action=$${params.length}`; }
    if (filters?.entityType) { params.push(filters.entityType); where += ` AND entity_type=$${params.length}`; }
    if (filters?.actorUserId) { params.push(filters.actorUserId); where += ` AND actor_user_id=$${params.length}`; }
    if (filters?.startDate) { params.push(filters.startDate); where += ` AND created_at >= $${params.length}::timestamptz`; }
    if (filters?.endDate) { params.push(filters.endDate); where += ` AND created_at <= $${params.length}::timestamptz`; }
    params.push(10000); // hard cap
    const r = await this.db.query<AuditLogRow>(
      `SELECT id,org_id,actor_user_id,actor_email,action,entity_type,entity_id,entity_name,old_values,new_values,changed_fields,status,is_sensitive,metadata,created_at
       FROM organization_audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return r.rows;
  }

  async purgeExpiredAuditLogs(): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM organization_audit_logs a
       USING organization_settings s
       WHERE a.org_id = s.org_id
         AND a.is_sensitive = FALSE
         AND a.created_at < NOW() - (s.audit_log_retention_days || ' days')::interval`
    );
    return r.rowCount ?? 0;
  }
}
