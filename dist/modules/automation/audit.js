function toAuditRow(r) {
    return {
        id: r.id,
        organizationId: r.organization_id,
        projectId: r.project_id,
        workflowId: r.workflow_id,
        runId: r.run_id,
        stepId: r.step_id,
        approvalId: r.approval_id,
        actorUserId: r.actor_user_id,
        actorType: r.actor_type,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        requestId: r.request_id,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        beforeState: r.before_state ?? null,
        afterState: r.after_state ?? null,
        metadata: r.metadata ?? {},
        occurredAt: r.occurred_at,
    };
}
export const AUTOMATION_AUDIT_LOG_COLUMNS = `
  id, organization_id, project_id, workflow_id, run_id, step_id, approval_id,
  actor_user_id, actor_type, action, entity_type, entity_id, request_id,
  ip_address, user_agent, before_state, after_state, metadata, occurred_at
`;
export class AutomationAuditRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Insert an immutable audit log entry.
     * Safe for use inside a transaction (pass PoolClient as db).
     */
    async insertAuditLog(params, db = this.db) {
        const r = await db.query(`INSERT INTO automation_audit_logs
        (organization_id, project_id, workflow_id, run_id, step_id, approval_id,
         actor_user_id, actor_type, action, entity_type, entity_id,
         request_id, ip_address, user_agent, before_state, after_state, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::inet,$14,$15::jsonb,$16::jsonb,$17::jsonb)
       RETURNING ${AUTOMATION_AUDIT_LOG_COLUMNS}`, [
            params.organizationId,
            params.projectId ?? null,
            params.workflowId ?? null,
            params.runId ?? null,
            params.stepId ?? null,
            params.approvalId ?? null,
            params.actorUserId ?? null,
            params.actorType ?? 'user',
            params.action,
            params.entityType,
            params.entityId ?? null,
            params.requestId ?? null,
            params.ipAddress ?? null,
            params.userAgent ?? null,
            params.beforeState ? JSON.stringify(params.beforeState) : null,
            params.afterState ? JSON.stringify(params.afterState) : null,
            JSON.stringify(params.metadata ?? {}),
        ]);
        return toAuditRow(r.rows[0]);
    }
    /**
     * List audit logs for an organization, with optional filters.
     */
    async listAuditLogs(orgId, q, db = this.db) {
        const params = [orgId];
        const conditions = ['organization_id = $1'];
        if (q.workflowId) {
            params.push(q.workflowId);
            conditions.push(`workflow_id = $${params.length}`);
        }
        if (q.runId) {
            params.push(q.runId);
            conditions.push(`run_id = $${params.length}`);
        }
        if (q.action) {
            params.push(q.action);
            conditions.push(`action = $${params.length}`);
        }
        if (q.actorUserId) {
            params.push(q.actorUserId);
            conditions.push(`actor_user_id = $${params.length}`);
        }
        const where = conditions.join(' AND ');
        const countR = await db.query(`SELECT COUNT(*)::int AS total FROM automation_audit_logs WHERE ${where}`, params);
        const total = countR.rows[0]?.total ?? 0;
        const dataParams = [...params, q.limit, q.offset];
        const dataR = await db.query(`SELECT ${AUTOMATION_AUDIT_LOG_COLUMNS} FROM automation_audit_logs WHERE ${where}
       ORDER BY occurred_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams);
        return { data: dataR.rows.map(toAuditRow), total };
    }
}
//# sourceMappingURL=audit.js.map