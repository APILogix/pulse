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

function toAuditRow(r: Record<string, unknown>): AuditLogRow {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string | null,
    projectId: r.project_id as string | null,
    workflowId: r.workflow_id as string | null,
    runId: r.run_id as string | null,
    stepId: r.step_id as string | null,
    approvalId: r.approval_id as string | null,
    actorUserId: r.actor_user_id as string | null,
    actorType: r.actor_type as string,
    action: r.action as string,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string | null,
    requestId: r.request_id as string | null,
    ipAddress: r.ip_address as string | null,
    userAgent: r.user_agent as string | null,
    beforeState: (r.before_state as Record<string, unknown>) ?? null,
    afterState: (r.after_state as Record<string, unknown>) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    occurredAt: r.occurred_at as Date,
  };
}

export class AutomationAuditRepository {
  constructor(private readonly db: Pool) {}

  /**
   * Insert an immutable audit log entry.
   * Safe for use inside a transaction (pass PoolClient as db).
   */
  async insertAuditLog(params: InsertAuditParams, db: AuditDb = this.db): Promise<AuditLogRow> {
    const r = await db.query(
      `INSERT INTO automation_audit_logs
        (organization_id, project_id, workflow_id, run_id, step_id, approval_id,
         actor_user_id, actor_type, action, entity_type, entity_id,
         request_id, ip_address, user_agent, before_state, after_state, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::inet,$14,$15::jsonb,$16::jsonb,$17::jsonb)
       RETURNING *`,
      [
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
      ],
    );
    return toAuditRow(r.rows[0]);
  }

  /**
   * List audit logs for an organization, with optional filters.
   */
  async listAuditLogs(
    orgId: string,
    q: AuditListQuery,
    db: AuditDb = this.db,
  ): Promise<{ data: AuditLogRow[]; total: number }> {
    const params: unknown[] = [orgId];
    const conditions = ['organization_id = $1'];

    if (q.workflowId) { params.push(q.workflowId); conditions.push(`workflow_id = $${params.length}`); }
    if (q.runId) { params.push(q.runId); conditions.push(`run_id = $${params.length}`); }
    if (q.action) { params.push(q.action); conditions.push(`action = $${params.length}`); }
    if (q.actorUserId) { params.push(q.actorUserId); conditions.push(`actor_user_id = $${params.length}`); }

    const where = conditions.join(' AND ');

    const countR = await db.query(
      `SELECT COUNT(*)::int AS total FROM automation_audit_logs WHERE ${where}`,
      params,
    );
    const total = countR.rows[0]?.total ?? 0;

    const dataParams = [...params, q.limit, q.offset];
    const dataR = await db.query(
      `SELECT * FROM automation_audit_logs WHERE ${where}
       ORDER BY occurred_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    return { data: dataR.rows.map(toAuditRow), total };
  }
}
