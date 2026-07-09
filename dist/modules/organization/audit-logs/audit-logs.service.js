export class AuditLogsService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async audit(meta, data) {
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
        }
        catch (e) {
            this.deps.log.error({ err: e }, "Audit log write failed");
        }
    }
    async listAuditLogs(orgId, userId, q, filters) {
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
            })),
            meta: result.meta,
        };
    }
    async exportAuditLogs(orgId, userId, filters) {
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
        }));
    }
}
//# sourceMappingURL=audit-logs.service.js.map