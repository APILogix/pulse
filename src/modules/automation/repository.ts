/**
 * Automation Module — Enterprise Persistence Layer (Hardened)
 *
 * Organization-scoped repository with injectable pg Pool, parameterized SQL,
 * robust transaction helper, PostgreSQL error mapping, and SKIP LOCKED workers.
 *
 * Fixes applied:
 * - projects.org_id lookup (was using wrong column name organization_id)
 * - Domain errors imported from errors.ts (no duplicate local classes)
 * - Effective entitlement SQL uses canonical pattern (active/trialing/past_due, overrides, add-ons)
 * - Full definition retrieval with triggers/conditions/actions
 * - Draft v1 version created in createWorkflowTransaction
 * - Template normalization: triggers/conditions/actions materialized from template definition
 * - Publish clones version-bound trigger/conditions/actions
 * - Active version resolution
 * - Approval CRUD with transactional locking
 * - Stale run/step recovery
 * - Run completion aggregation
 * - Expire stale approvals
 * - Step claim uses actual action timeout_seconds and next_retry_at
 */
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { createHash } from 'crypto';
import {
  AutomationNotFoundError,
  AutomationConflictError,
  AutomationEntitlementRequiredError,
  AutomationLimitExceededError,
  AutomationApprovalExpiredError,
} from './errors.js';
import { EFFECTIVE_ENTITLEMENTS_SQL } from '../billing/entitlements/repository.js';
import type { InsertAuditParams } from './audit.js';

// ---------------------------------------------------------------------------
// Types (DTO-ready camelCase row interfaces)
// ---------------------------------------------------------------------------

export type Db = Pool | PoolClient;

export interface WorkflowRow {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  templateId: string | null;
  name: string;
  slug: string;
  description: string | null;
  workflowType: string;
  scope: string;
  status: string;
  isEnabled: boolean;
  currentVersion: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  timezone: string;
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface WorkflowVersionRow {
  id: string;
  workflowId: string;
  version: number;
  status: string;
  definition: Record<string, unknown>;
  triggerSummary: unknown[];
  conditionSummary: unknown[];
  actionSummary: unknown[];
  publishedBy: string | null;
  publishedAt: Date | null;
  checksum: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface TriggerRow {
  id: string;
  workflowId: string;
  workflowVersionId: string | null;
  triggerKind: string;
  triggerType: string;
  sourceModule: string;
  sourceEvent: string | null;
  scheduleCron: string | null;
  timezone: string;
  webhookSecretHash: string | null;
  isEnabled: boolean;
  dedupeKeyTemplate: string | null;
  cooldownSeconds: number;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ConditionRow {
  id: string;
  workflowId: string;
  workflowVersionId: string | null;
  conditionGroup: string;
  sortOrder: number;
  leftPath: string;
  operator: string;
  rightValue: unknown;
  valueType: string;
  isRequired: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ActionRow {
  id: string;
  workflowId: string;
  workflowVersionId: string | null;
  actionKey: string;
  actionType: string;
  integrationKey: string | null;
  sortOrder: number;
  isEnabled: boolean;
  requiresApproval: boolean;
  riskLevel: string;
  timeoutSeconds: number;
  maxAttempts: number;
  retryBackoffSeconds: number;
  idempotencyKeyTemplate: string | null;
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface RunRow {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  workflowId: string;
  workflowVersionId: string;
  triggerId: string | null;
  inboxEventId: string | null;
  status: string;
  triggerType: string;
  sourceModule: string;
  sourceEventId: string | null;
  dedupeKey: string | null;
  idempotencyKey: string;
  priority: number;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  expiresAt: Date | null;
  attempt: number;
  maxAttempts: number;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunStepRow {
  id: string;
  runId: string;
  workflowId: string;
  actionId: string | null;
  stepKey: string;
  actionType: string;
  status: string;
  sortOrder: number;
  attempt: number;
  maxAttempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  nextRetryAt: Date | null;
  timeoutAt: Date | null;
  requiresApproval: boolean;
  approvalId: string | null;
  idempotencyKey: string | null;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRow {
  id: string;
  organizationId: string;
  workflowId: string;
  runId: string;
  stepId: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
  rejectedBy: string | null;
  status: string;
  riskLevel: string;
  approvalReason: string | null;
  rejectionReason: string | null;
  expiresAt: Date;
  decidedAt: Date | null;
  requestPayload: Record<string, unknown>;
  decisionPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateRow {
  id: string;
  templateKey: string;
  scope: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  workflowType: string;
  category: string;
  isActive: boolean;
  isPublic: boolean;
  isFeatured: boolean;
  minimumPlanTier: string | null;
  requiredFeatureKey: string | null;
  tags: string[];
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface TemplateVersionRow {
  id: string;
  templateId: string;
  version: number;
  isCurrent: boolean;
  definition: Record<string, unknown>;
  triggerSummary: unknown[];
  conditionSummary: unknown[];
  actionSummary: unknown[];
  createdBy: string | null;
  publishedAt: Date;
  checksum: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface InboxEventRow {
  id: string;
  organizationId: string | null;
  projectId: string | null;
  sourceModule: string;
  eventType: string;
  sourceEventId: string | null;
  dedupeKey: string;
  payload: Record<string, unknown>;
  headers: Record<string, unknown>;
  status: string;
  receivedAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  processedAt: Date | null;
  attempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
}

export interface ListQuery {
  limit: number;
  offset: number;
}

export interface WorkflowListQuery extends ListQuery {
  status?: string;
  workflowType?: string;
  isEnabled?: boolean;
  projectId?: string;
  tags?: string;
  search?: string;
}

export interface RunListQuery extends ListQuery {
  status?: string;
  workflowId?: string;
  triggerType?: string;
}

export interface WorkflowFullDefinition {
  workflow: WorkflowRow;
  triggers: TriggerRow[];
  conditions: ConditionRow[];
  actions: ActionRow[];
  activeVersion: WorkflowVersionRow | null;
}

// ---------------------------------------------------------------------------
// PostgreSQL error codes
// ---------------------------------------------------------------------------

const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';

function mapPgError(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e.code === PG_UNIQUE_VIOLATION) {
    throw new AutomationConflictError(e.constraint ? `Conflict on ${e.constraint}` : 'Unique constraint violation');
  }
  if (e.code === PG_FK_VIOLATION) {
    throw new AutomationNotFoundError(e.constraint ?? 'Referenced entity');
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Row mapper helpers (snake_case DB → camelCase DTO)
// ---------------------------------------------------------------------------

function toWorkflow(r: QueryResultRow): WorkflowRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    projectId: r.project_id,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    templateId: r.template_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    workflowType: r.workflow_type,
    scope: r.scope,
    status: r.status,
    isEnabled: r.is_enabled,
    currentVersion: r.current_version,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
    timezone: r.timezone,
    tags: r.tags ?? [],
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function toWorkflowVersion(r: QueryResultRow): WorkflowVersionRow {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    version: r.version,
    status: r.status,
    definition: r.definition ?? {},
    triggerSummary: r.trigger_summary ?? [],
    conditionSummary: r.condition_summary ?? [],
    actionSummary: r.action_summary ?? [],
    publishedBy: r.published_by,
    publishedAt: r.published_at,
    checksum: r.checksum,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  };
}

function toTrigger(r: QueryResultRow): TriggerRow {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowVersionId: r.workflow_version_id,
    triggerKind: r.trigger_kind,
    triggerType: r.trigger_type,
    sourceModule: r.source_module,
    sourceEvent: r.source_event,
    scheduleCron: r.schedule_cron,
    timezone: r.timezone,
    webhookSecretHash: r.webhook_secret_hash,
    isEnabled: r.is_enabled,
    dedupeKeyTemplate: r.dedupe_key_template,
    cooldownSeconds: r.cooldown_seconds,
    config: r.config ?? {},
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function toCondition(r: QueryResultRow): ConditionRow {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowVersionId: r.workflow_version_id,
    conditionGroup: r.condition_group,
    sortOrder: r.sort_order,
    leftPath: r.left_path,
    operator: r.operator,
    rightValue: r.right_value,
    valueType: r.value_type,
    isRequired: r.is_required,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function toAction(r: QueryResultRow): ActionRow {
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowVersionId: r.workflow_version_id,
    actionKey: r.action_key,
    actionType: r.action_type,
    integrationKey: r.integration_key,
    sortOrder: r.sort_order,
    isEnabled: r.is_enabled,
    requiresApproval: r.requires_approval,
    riskLevel: r.risk_level,
    timeoutSeconds: r.timeout_seconds,
    maxAttempts: r.max_attempts,
    retryBackoffSeconds: r.retry_backoff_seconds,
    idempotencyKeyTemplate: r.idempotency_key_template,
    config: r.config ?? {},
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function toRun(r: QueryResultRow): RunRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    projectId: r.project_id,
    workflowId: r.workflow_id,
    workflowVersionId: r.workflow_version_id,
    triggerId: r.trigger_id,
    inboxEventId: r.inbox_event_id,
    status: r.status,
    triggerType: r.trigger_type,
    sourceModule: r.source_module,
    sourceEventId: r.source_event_id,
    dedupeKey: r.dedupe_key,
    idempotencyKey: r.idempotency_key,
    priority: r.priority,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    expiresAt: r.expires_at,
    attempt: r.attempt,
    maxAttempts: r.max_attempts,
    inputPayload: r.input_payload ?? {},
    outputPayload: r.output_payload ?? {},
    errorCode: r.error_code,
    errorMessage: r.error_message,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toStep(r: QueryResultRow): RunStepRow {
  return {
    id: r.id,
    runId: r.run_id,
    workflowId: r.workflow_id,
    actionId: r.action_id,
    stepKey: r.step_key,
    actionType: r.action_type,
    status: r.status,
    sortOrder: r.sort_order,
    attempt: r.attempt,
    maxAttempts: r.max_attempts,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    nextRetryAt: r.next_retry_at,
    timeoutAt: r.timeout_at,
    requiresApproval: r.requires_approval,
    approvalId: r.approval_id,
    idempotencyKey: r.idempotency_key,
    inputPayload: r.input_payload ?? {},
    outputPayload: r.output_payload ?? {},
    errorCode: r.error_code,
    errorMessage: r.error_message,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toApproval(r: QueryResultRow): ApprovalRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    workflowId: r.workflow_id,
    runId: r.run_id,
    stepId: r.step_id,
    requestedBy: r.requested_by,
    approvedBy: r.approved_by,
    rejectedBy: r.rejected_by,
    status: r.status,
    riskLevel: r.risk_level,
    approvalReason: r.approval_reason,
    rejectionReason: r.rejection_reason,
    expiresAt: r.expires_at,
    decidedAt: r.decided_at,
    requestPayload: r.request_payload ?? {},
    decisionPayload: r.decision_payload ?? {},
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toTemplate(r: QueryResultRow): TemplateRow {
  return {
    id: r.id,
    templateKey: r.template_key,
    scope: r.scope,
    organizationId: r.organization_id,
    name: r.name,
    description: r.description,
    workflowType: r.workflow_type,
    category: r.category,
    isActive: r.is_active,
    isPublic: r.is_public,
    isFeatured: r.is_featured,
    minimumPlanTier: r.minimum_plan_tier,
    requiredFeatureKey: r.required_feature_key,
    tags: r.tags ?? [],
    sortOrder: r.sort_order,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function toTemplateVersion(r: QueryResultRow): TemplateVersionRow {
  return {
    id: r.id,
    templateId: r.template_id,
    version: r.version,
    isCurrent: r.is_current,
    definition: r.definition ?? {},
    triggerSummary: r.trigger_summary ?? [],
    conditionSummary: r.condition_summary ?? [],
    actionSummary: r.action_summary ?? [],
    createdBy: r.created_by,
    publishedAt: r.published_at,
    checksum: r.checksum,
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  };
}

function toInboxEvent(r: QueryResultRow): InboxEventRow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    projectId: r.project_id,
    sourceModule: r.source_module,
    eventType: r.event_type,
    sourceEventId: r.source_event_id,
    dedupeKey: r.dedupe_key,
    payload: r.payload ?? {},
    headers: r.headers ?? {},
    status: r.status,
    receivedAt: r.received_at,
    lockedAt: r.locked_at,
    lockedBy: r.locked_by,
    processedAt: r.processed_at,
    attempts: r.attempts,
    nextRetryAt: r.next_retry_at,
    lastError: r.last_error,
    metadata: r.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// Summary row interfaces for view-backed queries
// ---------------------------------------------------------------------------

export interface WorkflowSummaryRow extends WorkflowRow {
  triggerCount: number;
  triggerType: string | null;
  actionCount: number;
  actionTypes: string[];
  actionRequiresApproval: boolean[];
  lastRunStatus: string | null;
  lastRunCreatedAt: Date | null;
}

export interface RunSummaryRow {
  runId: string;
  workflowId: string;
  workflowName: string;
  organizationId: string | null;
  status: string;
  triggerType: string;
  sourceModule: string;
  priority: number;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  stepCount: number;
  failedStepCount: number;
  pendingApprovalCount: number;
}

export interface ApprovalDetailRow extends ApprovalRow {
  workflowName: string;
  actionType: string | null;
}

function toWorkflowSummary(r: QueryResultRow): WorkflowSummaryRow {
  return {
    ...toWorkflow(r),
    triggerCount: r.trigger_count ?? 0,
    triggerType: r.trigger_type ?? null,
    actionCount: r.action_count ?? 0,
    actionTypes: r.action_types ?? [],
    actionRequiresApproval: r.action_requires_approval ?? [],
    lastRunStatus: r.last_run_status ?? null,
    lastRunCreatedAt: r.last_run_created_at ?? null,
  };
}

function toRunSummary(r: QueryResultRow): RunSummaryRow {
  return {
    runId: r.run_id,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name,
    organizationId: r.organization_id,
    status: r.status,
    triggerType: r.trigger_type,
    sourceModule: r.source_module,
    priority: r.priority,
    queuedAt: r.queued_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    stepCount: r.step_count ?? 0,
    failedStepCount: r.failed_step_count ?? 0,
    pendingApprovalCount: r.pending_approval_count ?? 0,
  };
}

function toApprovalDetail(r: QueryResultRow): ApprovalDetailRow {
  return {
    ...toApproval(r),
    workflowName: r.workflow_name ?? '',
    actionType: r.action_type ?? null,
  };
}



// ===========================================================================
// AutomationRepository Class
// ===========================================================================

export class AutomationRepository {
  constructor(private readonly db: Pool) {}

  // -------------------------------------------------------------------------
  // Transaction helper
  // -------------------------------------------------------------------------

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Member role / Project ownership / Entitlements / Count
  // -------------------------------------------------------------------------

  async getMemberRole(orgId: string, userId: string, db: Db = this.db): Promise<string | null> {
    const r = await db.query(
      `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2 AND status = 'active'`,
      [orgId, userId],
    );
    return r.rows[0]?.role ?? null;
  }

  /**
   * Verify project belongs to org — uses canonical column projects.org_id (NOT organization_id).
   */
  async verifyProjectOwnership(orgId: string, projectId: string, db: Db = this.db): Promise<boolean> {
    const r = await db.query(
      `SELECT 1 FROM projects WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [projectId, orgId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Check boolean entitlement using canonical effective entitlements SQL
   * (active/trialing/past_due + overrides + add-ons).
   */
  async hasEntitlement(orgId: string, featureKey: string, db: Db = this.db): Promise<boolean> {
    const r = await db.query(
      `SELECT COALESCE(boolean_value, integer_value > 0, FALSE) AS has_access
       FROM (${EFFECTIVE_ENTITLEMENTS_SQL}) ent
       WHERE feature_key = $2
       LIMIT 1`,
      [orgId, featureKey],
    );
    return r.rows[0]?.has_access === true;
  }

  /**
   * Get integer entitlement limit using canonical effective entitlements SQL.
   */
  async getWorkflowLimit(orgId: string, db: Db = this.db): Promise<number> {
    const r = await db.query(
      `SELECT COALESCE(integer_value, 0)::int AS limit_val
       FROM (${EFFECTIVE_ENTITLEMENTS_SQL}) ent
       WHERE feature_key = 'limit_workflows_max'
       LIMIT 1`,
      [orgId],
    );
    return r.rows[0]?.limit_val ?? 0;
  }

  /**
   * One-query batch entitlement lookup for a set of feature keys.
   * Uses canonical EFFECTIVE_ENTITLEMENTS_SQL — no per-key N+1.
   * Returns a Map of featureKey → boolean access.
   */
  async batchCheckEntitlements(orgId: string, featureKeys: string[], db: Db = this.db): Promise<Map<string, boolean>> {
    if (featureKeys.length === 0) return new Map();
    const r = await db.query(
      `SELECT feature_key,
              COALESCE(boolean_value, integer_value > 0, FALSE) AS has_access
       FROM (${EFFECTIVE_ENTITLEMENTS_SQL}) ent
       WHERE feature_key = ANY($2::text[])`,
      [orgId, featureKeys],
    );
    const result = new Map<string, boolean>();
    for (const key of featureKeys) result.set(key, false);
    for (const row of r.rows) {
      result.set(row.feature_key, row.has_access === true);
    }
    return result;
  }

  async countOrgWorkflows(orgId: string, db: Db = this.db): Promise<number> {
    const r = await db.query(
      `SELECT COUNT(*)::int AS count FROM automation_workflows
       WHERE organization_id = $1 AND deleted_at IS NULL`,
      [orgId],
    );
    return r.rows[0]?.count ?? 0;
  }

  // -------------------------------------------------------------------------
  // Workflow list / get / full definition retrieval
  // -------------------------------------------------------------------------

  async listWorkflows(orgId: string, q: WorkflowListQuery, db: Db = this.db): Promise<{ data: WorkflowSummaryRow[]; total: number }> {
    const params: unknown[] = [orgId];
    const conditions = ['organization_id = $1'];
    if (q.status) { params.push(q.status); conditions.push(`status = $${params.length}`); }
    if (q.workflowType) { params.push(q.workflowType); conditions.push(`workflow_type = $${params.length}`); }
    if (q.isEnabled !== undefined) { params.push(q.isEnabled); conditions.push(`is_enabled = $${params.length}`); }
    if (q.projectId) { params.push(q.projectId); conditions.push(`project_id = $${params.length}`); }
    if (q.tags) {
      const tags = q.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      if (tags.length > 0) { params.push(tags); conditions.push(`tags && $${params.length}::text[]`); }
    }
    if (q.search) { params.push(`%${q.search}%`); conditions.push(`(name ILIKE $${params.length} OR slug ILIKE $${params.length})`); }
    const where = conditions.join(' AND ');

    const countR = await db.query(`SELECT COUNT(*)::int AS total FROM v_automation_workflow_summaries WHERE ${where}`, params);
    const total = countR.rows[0]?.total ?? 0;

    const dataParams = [...params, q.limit, q.offset];
    const dataR = await db.query(
      `SELECT * FROM v_automation_workflow_summaries WHERE ${where} ORDER BY updated_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    return { data: dataR.rows.map(toWorkflowSummary), total };
  }

  async getWorkflow(orgId: string, workflowId: string, db: Db = this.db): Promise<WorkflowRow | null> {
    const r = await db.query(
      `SELECT * FROM automation_workflows WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [workflowId, orgId],
    );
    return r.rows[0] ? toWorkflow(r.rows[0]) : null;
  }

  /**
   * Full workflow definition retrieval: workflow + triggers + conditions + actions + active version.
   */
  async getWorkflowFullDefinition(orgId: string, workflowId: string, db: Db = this.db): Promise<WorkflowFullDefinition | null> {
    const workflow = await this.getWorkflow(orgId, workflowId, db);
    if (!workflow) return null;

    const [triggersR, conditionsR, actionsR, versionR] = await Promise.all([
      db.query(
        `SELECT * FROM automation_triggers WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL ORDER BY created_at`,
        [workflowId],
      ),
      db.query(
        `SELECT * FROM automation_conditions WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL ORDER BY condition_group, sort_order`,
        [workflowId],
      ),
      db.query(
        `SELECT * FROM automation_actions WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL ORDER BY sort_order`,
        [workflowId],
      ),
      db.query(
        `SELECT * FROM automation_workflow_versions WHERE workflow_id = $1 AND status = 'published' ORDER BY version DESC LIMIT 1`,
        [workflowId],
      ),
    ]);

    return {
      workflow,
      triggers: triggersR.rows.map(toTrigger),
      conditions: conditionsR.rows.map(toCondition),
      actions: actionsR.rows.map(toAction),
      activeVersion: versionR.rows[0] ? toWorkflowVersion(versionR.rows[0]) : null,
    };
  }

  async getWorkflowForUpdate(workflowId: string, orgId: string, client: PoolClient): Promise<WorkflowRow | null> {
    const r = await client.query(
      `SELECT * FROM automation_workflows WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [workflowId, orgId],
    );
    return r.rows[0] ? toWorkflow(r.rows[0]) : null;
  }

  /**
   * Resolve the active (latest published) version for a workflow.
   */
  async getActiveVersion(workflowId: string, db: Db = this.db): Promise<WorkflowVersionRow | null> {
    const r = await db.query(
      `SELECT * FROM automation_workflow_versions
       WHERE workflow_id = $1 AND status = 'published'
       ORDER BY version DESC LIMIT 1`,
      [workflowId],
    );
    return r.rows[0] ? toWorkflowVersion(r.rows[0]) : null;
  }

  /**
   * Get version-bound (pinned) actions for a specific workflow version.
   */
  async getVersionActions(workflowId: string, versionId: string, db: Db = this.db): Promise<ActionRow[]> {
    const r = await db.query(
      `SELECT * FROM automation_actions
       WHERE workflow_id = $1 AND workflow_version_id = $2 AND deleted_at IS NULL
       ORDER BY sort_order`,
      [workflowId, versionId],
    );
    return r.rows.map(toAction);
  }

  /**
   * Get version-bound (pinned) conditions for a specific workflow version.
   */
  async getVersionConditions(workflowId: string, versionId: string, db: Db = this.db): Promise<ConditionRow[]> {
    const r = await db.query(
      `SELECT * FROM automation_conditions
       WHERE workflow_id = $1 AND workflow_version_id = $2 AND deleted_at IS NULL
       ORDER BY condition_group, sort_order`,
      [workflowId, versionId],
    );
    return r.rows.map(toCondition);
  }


  // -------------------------------------------------------------------------
  // Atomic creation: workflow + draft v1 + normalized trigger/conditions/actions + audit
  // -------------------------------------------------------------------------

  async createWorkflowTransaction(params: {
    orgId: string;
    projectId?: string | null;
    createdBy: string;
    name: string;
    slug: string;
    description?: string | null;
    workflowType: string;
    scope?: string;
    templateId?: string | null;
    timezone?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    safety?: Record<string, unknown>;
    trigger: {
      triggerKind: string;
      triggerType: string;
      sourceModule: string;
      sourceEvent?: string | null;
      scheduleCron?: string | null;
      timezone?: string;
      dedupeKeyTemplate?: string | null;
      cooldownSeconds?: number;
      config?: Record<string, unknown>;
    };
    conditions: Array<{
      conditionGroup?: string;
      sortOrder?: number;
      leftPath: string;
      operator: string;
      rightValue?: unknown;
      valueType?: string;
      isRequired?: boolean;
    }>;
    actions: Array<{
      actionKey: string;
      actionType: string;
      integrationKey?: string | null;
      sortOrder?: number;
      isEnabled?: boolean;
      requiresApproval?: boolean;
      riskLevel?: string;
      timeoutSeconds?: number;
      maxAttempts?: number;
      retryBackoffSeconds?: number;
      idempotencyKeyTemplate?: string | null;
      config?: Record<string, unknown>;
    }>;
    audit?: InsertAuditParams;
  }): Promise<WorkflowRow> {
    return this.withTransaction(async (client) => {
      // Insert workflow
      let workflow: WorkflowRow;
      try {
        const wfR = await client.query(
          `INSERT INTO automation_workflows
            (organization_id, project_id, created_by, updated_by, template_id, name, slug, description,
             workflow_type, scope, status, is_enabled, current_version, timezone, tags, metadata)
           VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,'draft',FALSE,1,$10,$11,$12::jsonb)
           RETURNING *`,
          [
            params.orgId, params.projectId ?? null, params.createdBy, params.templateId ?? null,
            params.name, params.slug, params.description ?? null, params.workflowType,
            params.scope ?? 'organization', params.timezone ?? 'UTC',
            params.tags ?? [], JSON.stringify(params.metadata ?? {}),
          ],
        );
        workflow = toWorkflow(wfR.rows[0]);
      } catch (err) { mapPgError(err); }

      // Create draft version 1
      const draftDefinition = {
        schemaVersion: 1,
        workflowType: params.workflowType,
        trigger: params.trigger,
        conditions: params.conditions,
        actions: params.actions,
        safety: params.safety ?? {},
      };
      const checksum = computeChecksum(draftDefinition);
      await client.query(
        `INSERT INTO automation_workflow_versions
          (workflow_id, version, status, definition, trigger_summary, condition_summary,
           action_summary, published_by, checksum)
         VALUES ($1, 1, 'draft', $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          workflow.id,
          JSON.stringify(draftDefinition),
          JSON.stringify([params.trigger]),
          JSON.stringify(params.conditions),
          JSON.stringify(params.actions.map(a => ({ actionKey: a.actionKey, actionType: a.actionType }))),
          params.createdBy,
          checksum,
        ],
      );

      // Insert normalized trigger (draft, no workflow_version_id)
      const t = params.trigger;
      await client.query(
        `INSERT INTO automation_triggers
          (workflow_id, trigger_kind, trigger_type, source_module, source_event,
           schedule_cron, timezone, dedupe_key_template, cooldown_seconds, config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
          workflow.id, t.triggerKind, t.triggerType, t.sourceModule, t.sourceEvent ?? null,
          t.scheduleCron ?? null, t.timezone ?? 'UTC', t.dedupeKeyTemplate ?? null,
          t.cooldownSeconds ?? 0, JSON.stringify(t.config ?? {}),
        ],
      );

      // Insert conditions
      for (const c of params.conditions) {
        await client.query(
          `INSERT INTO automation_conditions
            (workflow_id, condition_group, sort_order, left_path, operator, right_value, value_type, is_required)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
          [
            workflow.id, c.conditionGroup ?? 'default', c.sortOrder ?? 0,
            c.leftPath, c.operator, JSON.stringify(c.rightValue ?? null),
            c.valueType ?? 'json', c.isRequired ?? true,
          ],
        );
      }

      // Insert actions
      for (const a of params.actions) {
        await client.query(
          `INSERT INTO automation_actions
            (workflow_id, action_key, action_type, integration_key, sort_order, is_enabled,
             requires_approval, risk_level, timeout_seconds, max_attempts,
             retry_backoff_seconds, idempotency_key_template, config)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
          [
            workflow.id, a.actionKey, a.actionType, a.integrationKey ?? null,
            a.sortOrder ?? 0, a.isEnabled ?? true, a.requiresApproval ?? false,
            a.riskLevel ?? 'low', a.timeoutSeconds ?? 60, a.maxAttempts ?? 3,
            a.retryBackoffSeconds ?? 30, a.idempotencyKeyTemplate ?? null,
            JSON.stringify(a.config ?? {}),
          ],
        );
      }

      // Audit log
      if (params.audit) {
        await client.query(
          `INSERT INTO automation_audit_logs
            (organization_id, project_id, workflow_id, actor_user_id, actor_type, action,
             entity_type, entity_id, request_id, ip_address, user_agent, after_state, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::inet,$11,$12::jsonb,$13::jsonb)`,
          [
            params.orgId, params.projectId ?? null, workflow.id,
            params.audit.actorUserId ?? null, params.audit.actorType ?? 'user',
            'workflow.created', 'workflow', workflow.id,
            params.audit.requestId ?? null, params.audit.ipAddress ?? null,
            params.audit.userAgent ?? null,
            JSON.stringify({ name: workflow.name, slug: workflow.slug }),
            JSON.stringify(params.audit.metadata ?? {}),
          ],
        );
      }

      return workflow;
    });
  }


  // -------------------------------------------------------------------------
  // Transactional editable draft update including normalized definition
  // -------------------------------------------------------------------------

  async updateWorkflowDraft(params: {
    orgId: string;
    workflowId: string;
    updatedBy: string;
    name?: string;
    description?: string;
    timezone?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    trigger?: {
      triggerKind: string;
      triggerType: string;
      sourceModule: string;
      sourceEvent?: string | null;
      scheduleCron?: string | null;
      timezone?: string;
      dedupeKeyTemplate?: string | null;
      cooldownSeconds?: number;
      config?: Record<string, unknown>;
    };
    conditions?: Array<{
      conditionGroup?: string;
      sortOrder?: number;
      leftPath: string;
      operator: string;
      rightValue?: unknown;
      valueType?: string;
      isRequired?: boolean;
    }>;
    actions?: Array<{
      actionKey: string;
      actionType: string;
      integrationKey?: string | null;
      sortOrder?: number;
      isEnabled?: boolean;
      requiresApproval?: boolean;
      riskLevel?: string;
      timeoutSeconds?: number;
      maxAttempts?: number;
      retryBackoffSeconds?: number;
      idempotencyKeyTemplate?: string | null;
      config?: Record<string, unknown>;
    }>;
    audit?: InsertAuditParams;
  }): Promise<WorkflowRow> {
    return this.withTransaction(async (client) => {
      const wf = await this.getWorkflowForUpdate(params.workflowId, params.orgId, client);
      if (!wf) throw new AutomationNotFoundError('Workflow');

      // Update workflow fields
      const fields: string[] = ['updated_by = $3', 'updated_at = NOW()'];
      const values: unknown[] = [params.workflowId, params.orgId, params.updatedBy];
      let i = 4;
      if (params.name !== undefined) { values.push(params.name); fields.push(`name = $${i++}`); }
      if (params.description !== undefined) { values.push(params.description); fields.push(`description = $${i++}`); }
      if (params.timezone !== undefined) { values.push(params.timezone); fields.push(`timezone = $${i++}`); }
      if (params.tags !== undefined) { values.push(params.tags); fields.push(`tags = $${i++}`); }
      if (params.metadata !== undefined) { values.push(JSON.stringify(params.metadata)); fields.push(`metadata = $${i++}::jsonb`); }
      if (params.trigger !== undefined) { fields.push('next_run_at = NULL'); }

      const updR = await client.query(
        `UPDATE automation_workflows SET ${fields.join(', ')}
         WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
        values,
      );
      const updated = toWorkflow(updR.rows[0]);

      // Replace normalized trigger/conditions/actions if provided
      if (params.trigger) {
        await client.query(
          `UPDATE automation_triggers SET deleted_at = NOW() WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL`,
          [params.workflowId],
        );
        const t = params.trigger;
        await client.query(
          `INSERT INTO automation_triggers
            (workflow_id, trigger_kind, trigger_type, source_module, source_event,
             schedule_cron, timezone, dedupe_key_template, cooldown_seconds, config)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            params.workflowId, t.triggerKind, t.triggerType, t.sourceModule, t.sourceEvent ?? null,
            t.scheduleCron ?? null, t.timezone ?? 'UTC', t.dedupeKeyTemplate ?? null,
            t.cooldownSeconds ?? 0, JSON.stringify(t.config ?? {}),
          ],
        );
      }

      if (params.conditions) {
        await client.query(
          `UPDATE automation_conditions SET deleted_at = NOW() WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL`,
          [params.workflowId],
        );
        for (const c of params.conditions) {
          await client.query(
            `INSERT INTO automation_conditions
              (workflow_id, condition_group, sort_order, left_path, operator, right_value, value_type, is_required)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
            [
              params.workflowId, c.conditionGroup ?? 'default', c.sortOrder ?? 0,
              c.leftPath, c.operator, JSON.stringify(c.rightValue ?? null),
              c.valueType ?? 'json', c.isRequired ?? true,
            ],
          );
        }
      }

      if (params.actions) {
        await client.query(
          `UPDATE automation_actions SET deleted_at = NOW() WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL`,
          [params.workflowId],
        );
        for (const a of params.actions) {
          await client.query(
            `INSERT INTO automation_actions
              (workflow_id, action_key, action_type, integration_key, sort_order, is_enabled,
               requires_approval, risk_level, timeout_seconds, max_attempts,
               retry_backoff_seconds, idempotency_key_template, config)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
            [
              params.workflowId, a.actionKey, a.actionType, a.integrationKey ?? null,
              a.sortOrder ?? 0, a.isEnabled ?? true, a.requiresApproval ?? false,
              a.riskLevel ?? 'low', a.timeoutSeconds ?? 60, a.maxAttempts ?? 3,
              a.retryBackoffSeconds ?? 30, a.idempotencyKeyTemplate ?? null,
              JSON.stringify(a.config ?? {}),
            ],
          );
        }
      }

      // Audit
      if (params.audit) {
        await client.query(
          `INSERT INTO automation_audit_logs
            (organization_id, workflow_id, actor_user_id, actor_type, action, entity_type, entity_id,
             request_id, ip_address, before_state, after_state, metadata)
           VALUES ($1,$2,$3,$4,'workflow.updated','workflow',$5,$6,$7::inet,$8::jsonb,$9::jsonb,$10::jsonb)`,
          [
            params.orgId, params.workflowId, params.audit.actorUserId ?? null,
            params.audit.actorType ?? 'user', params.workflowId,
            params.audit.requestId ?? null, params.audit.ipAddress ?? null,
            JSON.stringify({ name: wf.name }), JSON.stringify({ name: updated.name }),
            JSON.stringify(params.audit.metadata ?? {}),
          ],
        );
      }

      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // Soft delete and enable/disable with audit support
  // -------------------------------------------------------------------------

  async softDeleteWorkflow(orgId: string, workflowId: string, audit?: InsertAuditParams, db: Db = this.db): Promise<boolean> {
    const r = await db.query(
      `UPDATE automation_workflows SET deleted_at = NOW(), status = 'archived', is_enabled = FALSE, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING id`,
      [workflowId, orgId],
    );
    if ((r.rowCount ?? 0) > 0 && audit) {
      await db.query(
        `INSERT INTO automation_audit_logs
          (organization_id, workflow_id, actor_user_id, actor_type, action, entity_type, entity_id,
           request_id, ip_address, metadata)
         VALUES ($1,$2,$3,$4,'workflow.archived','workflow',$5,$6,$7::inet,$8::jsonb)`,
        [
          orgId, workflowId, audit.actorUserId ?? null, audit.actorType ?? 'user',
          workflowId, audit.requestId ?? null, audit.ipAddress ?? null,
          JSON.stringify(audit.metadata ?? {}),
        ],
      );
    }
    return (r.rowCount ?? 0) > 0;
  }

  async setWorkflowEnabled(orgId: string, workflowId: string, enabled: boolean, audit?: InsertAuditParams, db: Db = this.db): Promise<WorkflowRow | null> {
    const status = enabled ? 'active' : 'disabled';
    const r = await db.query(
      `UPDATE automation_workflows SET is_enabled = $3, status = $4, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL RETURNING *`,
      [workflowId, orgId, enabled, status],
    );
    if (r.rows[0] && audit) {
      const action = enabled ? 'workflow.enabled' : 'workflow.disabled';
      await db.query(
        `INSERT INTO automation_audit_logs
          (organization_id, workflow_id, actor_user_id, actor_type, action, entity_type, entity_id,
           request_id, ip_address, metadata)
         VALUES ($1,$2,$3,$4,$5,'workflow',$6,$7,$8::inet,$9::jsonb)`,
        [
          orgId, workflowId, audit.actorUserId ?? null, audit.actorType ?? 'user',
          action, workflowId, audit.requestId ?? null, audit.ipAddress ?? null,
          JSON.stringify(audit.metadata ?? {}),
        ],
      );
    }
    return r.rows[0] ? toWorkflow(r.rows[0]) : null;
  }


  // -------------------------------------------------------------------------
  // Publish immutable version with checksum, cloned version-bound entities
  // -------------------------------------------------------------------------

  async publishWorkflowVersion(params: {
    orgId: string;
    workflowId: string;
    publishedBy: string;
    activateOnPublish?: boolean;
    definition: Record<string, unknown>;
    triggerSummary: unknown[];
    conditionSummary: unknown[];
    actionSummary: unknown[];
    checksum: string;
    audit?: InsertAuditParams;
  }): Promise<WorkflowVersionRow> {
    return this.withTransaction(async (client) => {
      const wf = await this.getWorkflowForUpdate(params.workflowId, params.orgId, client);
      if (!wf) throw new AutomationNotFoundError('Workflow');

      const newVersion = wf.currentVersion + 1;

      // Insert immutable version
      const vR = await client.query(
        `INSERT INTO automation_workflow_versions
          (workflow_id, version, status, definition, trigger_summary, condition_summary,
           action_summary, published_by, published_at, checksum)
         VALUES ($1,$2,'published',$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,NOW(),$8)
         RETURNING *`,
        [
          params.workflowId, newVersion,
          JSON.stringify(params.definition), JSON.stringify(params.triggerSummary),
          JSON.stringify(params.conditionSummary), JSON.stringify(params.actionSummary),
          params.publishedBy, params.checksum,
        ],
      );
      const version = toWorkflowVersion(vR.rows[0]);

      // Clone triggers → version-bound
      await client.query(
        `INSERT INTO automation_triggers
          (workflow_id, workflow_version_id, trigger_kind, trigger_type, source_module, source_event,
           schedule_cron, timezone, webhook_secret_hash, is_enabled, dedupe_key_template, cooldown_seconds, config, metadata)
         SELECT workflow_id, $2, trigger_kind, trigger_type, source_module, source_event,
                schedule_cron, timezone, webhook_secret_hash, is_enabled, dedupe_key_template, cooldown_seconds, config, metadata
         FROM automation_triggers
         WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL`,
        [params.workflowId, version.id],
      );

      // Clone conditions → version-bound
      await client.query(
        `INSERT INTO automation_conditions
          (workflow_id, workflow_version_id, condition_group, sort_order, left_path, operator, right_value, value_type, is_required, metadata)
         SELECT workflow_id, $2, condition_group, sort_order, left_path, operator, right_value, value_type, is_required, metadata
         FROM automation_conditions
         WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL`,
        [params.workflowId, version.id],
      );

      // Clone actions → version-bound
      await client.query(
        `INSERT INTO automation_actions
          (workflow_id, workflow_version_id, action_key, action_type, integration_key, sort_order, is_enabled,
           requires_approval, risk_level, timeout_seconds, max_attempts, retry_backoff_seconds,
           idempotency_key_template, config, metadata)
         SELECT workflow_id, $2, action_key, action_type, integration_key, sort_order, is_enabled,
                requires_approval, risk_level, timeout_seconds, max_attempts, retry_backoff_seconds,
                idempotency_key_template, config, metadata
         FROM automation_actions
         WHERE workflow_id = $1 AND workflow_version_id IS NULL AND deleted_at IS NULL`,
        [params.workflowId, version.id],
      );

      // Update workflow current_version; honor activateOnPublish
      const shouldActivate = params.activateOnPublish ?? false;
      if (shouldActivate) {
        await client.query(
          `UPDATE automation_workflows SET current_version = $1, status = 'active', is_enabled = TRUE, updated_at = NOW()
           WHERE id = $2`,
          [newVersion, params.workflowId],
        );
      } else {
        await client.query(
          `UPDATE automation_workflows SET current_version = $1, updated_at = NOW()
           WHERE id = $2`,
          [newVersion, params.workflowId],
        );
      }

      // Audit
      if (params.audit) {
        await client.query(
          `INSERT INTO automation_audit_logs
            (organization_id, workflow_id, actor_user_id, actor_type, action, entity_type, entity_id,
             request_id, ip_address, after_state, metadata)
           VALUES ($1,$2,$3,$4,'workflow.version_published','workflow_version',$5,$6,$7::inet,$8::jsonb,$9::jsonb)`,
          [
            params.orgId, params.workflowId, params.audit.actorUserId ?? null,
            params.audit.actorType ?? 'user', version.id,
            params.audit.requestId ?? null, params.audit.ipAddress ?? null,
            JSON.stringify({ version: newVersion, checksum: params.checksum }),
            JSON.stringify(params.audit.metadata ?? {}),
          ],
        );
      }

      return version;
    });
  }


  // -------------------------------------------------------------------------
  // Templates: list / get / current version / atomic create from template
  // -------------------------------------------------------------------------

  async listTemplates(orgId: string, q: ListQuery & { category?: string }, db: Db = this.db): Promise<{ data: TemplateRow[]; total: number }> {
    const params: unknown[] = [orgId];
    const conditions = [
      `deleted_at IS NULL`,
      `is_active = TRUE`,
      `(scope = 'platform' OR (scope = 'organization' AND organization_id = $1))`,
    ];
    if (q.category) { params.push(q.category); conditions.push(`category = $${params.length}`); }
    const where = conditions.join(' AND ');

    const countR = await db.query(`SELECT COUNT(*)::int AS total FROM automation_templates WHERE ${where}`, params);
    const total = countR.rows[0]?.total ?? 0;

    const dataParams = [...params, q.limit, q.offset];
    const dataR = await db.query(
      `SELECT * FROM automation_templates WHERE ${where} ORDER BY sort_order, name LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    return { data: dataR.rows.map(toTemplate), total };
  }

  async getTemplate(templateKey: string, orgId: string | null, db: Db = this.db): Promise<TemplateRow | null> {
    const r = await db.query(
      `SELECT * FROM automation_templates
       WHERE template_key = $1 AND deleted_at IS NULL AND is_active = TRUE
         AND (scope = 'platform' OR (scope = 'organization' AND organization_id = $2))
       ORDER BY CASE WHEN scope = 'organization' THEN 0 ELSE 1 END
       LIMIT 1`,
      [templateKey, orgId],
    );
    return r.rows[0] ? toTemplate(r.rows[0]) : null;
  }

  /** Load current versions for a page of templates in one query. */
  async getCurrentTemplateVersions(templateIds: string[], db: Db = this.db): Promise<Map<string, TemplateVersionRow>> {
    if (templateIds.length === 0) return new Map();
    const r = await db.query(
      `SELECT * FROM automation_template_versions
       WHERE template_id = ANY($1::uuid[]) AND is_current = TRUE`,
      [templateIds],
    );
    return new Map(r.rows.map((row) => {
      const version = toTemplateVersion(row);
      return [version.templateId, version] as const;
    }));
  }

  async getTemplateCurrentVersion(templateId: string, db: Db = this.db): Promise<TemplateVersionRow | null> {
    const r = await db.query(
      `SELECT * FROM automation_template_versions WHERE template_id = $1 AND is_current = TRUE LIMIT 1`,
      [templateId],
    );
    return r.rows[0] ? toTemplateVersion(r.rows[0]) : null;
  }

  /**
   * Create a fully normalized draft workflow from template definition.
   * Accepts an already validated overridden definition and materializes exactly that
   * definition/draft version/checksum. Uses cryptographic SHA-256.
   */
  async createWorkflowFromTemplate(params: {
    orgId: string;
    projectId?: string | null;
    createdBy: string;
    templateId: string;
    name: string;
    slug: string;
    description?: string | null;
    overriddenDefinition?: Record<string, unknown> | null;
    overrides?: { tags?: string[]; metadata?: Record<string, unknown>; configOverrides?: Record<string, unknown> };
    audit?: InsertAuditParams;
  }): Promise<WorkflowRow> {
    return this.withTransaction(async (client) => {
      // Fetch template
      const tR = await client.query(
        `SELECT * FROM automation_templates WHERE id = $1 AND deleted_at IS NULL AND is_active = TRUE`,
        [params.templateId],
      );
      if (!tR.rows[0]) throw new AutomationNotFoundError('Template');
      const template = toTemplate(tR.rows[0]);

      // Fetch current version
      const vR = await client.query(
        `SELECT * FROM automation_template_versions WHERE template_id = $1 AND is_current = TRUE LIMIT 1`,
        [params.templateId],
      );
      if (!vR.rows[0]) throw new AutomationNotFoundError('Template version');
      const tv = toTemplateVersion(vR.rows[0]);
      // Use overridden definition if provided, otherwise template default
      const resolvedDef = (params.overriddenDefinition ?? tv.definition) as {
        trigger?: Record<string, unknown>;
        conditions?: Array<Record<string, unknown>>;
        actions?: Array<Record<string, unknown>>;
      };
      const def = resolvedDef;

      // Create workflow
      const wfR = await client.query(
        `INSERT INTO automation_workflows
          (organization_id, project_id, created_by, updated_by, template_id, name, slug, description,
           workflow_type, scope, status, is_enabled, current_version, timezone, tags, metadata)
         VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,'organization','draft',FALSE,1,'UTC',$9,$10::jsonb)
         RETURNING *`,
        [
          params.orgId, params.projectId ?? null, params.createdBy, template.id,
          params.name, params.slug, params.description ?? template.description,
          template.workflowType, params.overrides?.tags ?? template.tags,
          JSON.stringify(params.overrides?.metadata ?? {}),
        ],
      );
      const workflow = toWorkflow(wfR.rows[0]);

      // Materialize trigger from definition
      if (def.trigger) {
        const t = def.trigger;
        await client.query(
          `INSERT INTO automation_triggers
            (workflow_id, trigger_kind, trigger_type, source_module, source_event,
             schedule_cron, timezone, dedupe_key_template, cooldown_seconds, config)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            workflow.id, t.kind ?? 'event', t.type ?? 'manual.run',
            t.sourceModule ?? 'automation', t.sourceEvent ?? null,
            t.scheduleCron ?? null, t.timezone ?? 'UTC', t.dedupeKeyTemplate ?? null,
            t.cooldownSeconds ?? 0, JSON.stringify(t.config ?? {}),
          ],
        );
      }

      // Materialize conditions from definition
      if (def.conditions && Array.isArray(def.conditions)) {
        for (let idx = 0; idx < def.conditions.length; idx++) {
          const c = def.conditions[idx]!;
          await client.query(
            `INSERT INTO automation_conditions
              (workflow_id, condition_group, sort_order, left_path, operator, right_value, value_type, is_required)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
            [
              workflow.id, (c.conditionGroup as string) ?? 'default', idx,
              c.leftPath ?? '', c.operator ?? 'eq', JSON.stringify(c.rightValue ?? null),
              (c.valueType as string) ?? 'json', c.isRequired ?? true,
            ],
          );
        }
      }

      // Materialize actions from definition
      if (def.actions && Array.isArray(def.actions)) {
        for (let idx = 0; idx < def.actions.length; idx++) {
          const a = def.actions[idx]!;
          await client.query(
            `INSERT INTO automation_actions
              (workflow_id, action_key, action_type, integration_key, sort_order, is_enabled,
               requires_approval, risk_level, timeout_seconds, max_attempts,
               retry_backoff_seconds, idempotency_key_template, config)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
            [
              workflow.id, (a.actionKey as string) ?? `action_${idx}`,
              (a.actionType as string) ?? 'noop', a.integrationKey ?? null,
              idx, a.isEnabled ?? true, a.requiresApproval ?? false,
              (a.riskLevel as string) ?? 'low', a.timeoutSeconds ?? 60,
              a.maxAttempts ?? 3, a.retryBackoffSeconds ?? 30,
              a.idempotencyKeyTemplate ?? null, JSON.stringify(a.config ?? {}),
            ],
          );
        }
      }

      // Draft v1 version — materialize exactly the resolved definition and SHA-256 checksum
      const checksum = computeChecksum(resolvedDef);
      await client.query(
        `INSERT INTO automation_workflow_versions
          (workflow_id, version, status, definition, trigger_summary, condition_summary,
           action_summary, published_by, checksum)
         VALUES ($1, 1, 'draft', $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          workflow.id, JSON.stringify(resolvedDef),
          JSON.stringify(resolvedDef.trigger ? [resolvedDef.trigger] : tv.triggerSummary),
          JSON.stringify(resolvedDef.conditions ?? tv.conditionSummary),
          JSON.stringify((resolvedDef.actions ?? []).map((a: Record<string, unknown>) => ({ actionKey: a.actionKey, actionType: a.actionType }))),
          params.createdBy, checksum,
        ],
      );

      // Audit
      if (params.audit) {
        await client.query(
          `INSERT INTO automation_audit_logs
            (organization_id, workflow_id, actor_user_id, actor_type, action, entity_type, entity_id,
             request_id, ip_address, after_state, metadata)
           VALUES ($1,$2,$3,$4,'workflow.created','workflow',$5,$6,$7::inet,$8::jsonb,$9::jsonb)`,
          [
            params.orgId, workflow.id, params.audit.actorUserId ?? null,
            params.audit.actorType ?? 'user', workflow.id,
            params.audit.requestId ?? null, params.audit.ipAddress ?? null,
            JSON.stringify({ templateKey: template.templateKey }),
            JSON.stringify(params.audit.metadata ?? {}),
          ],
        );
      }

      return workflow;
    });
  }


  // -------------------------------------------------------------------------
  // Inbox: idempotent insert, bounded SKIP LOCKED claim, recovery
  // -------------------------------------------------------------------------

  async insertInboxEvent(params: {
    organizationId: string | null;
    projectId?: string | null;
    sourceModule: string;
    eventType: string;
    sourceEventId?: string | null;
    dedupeKey: string;
    payload: Record<string, unknown>;
    headers?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }, db: Db = this.db): Promise<{ event: InboxEventRow; created: boolean }> {
    try {
      // HARDENED (defect 14): Use composite (organization_id, dedupe_key) for org-scoped events
      // to prevent cross-org dedupeKey collisions. Falls back to global dedupe_key for system events.
      // HARDENED (defect 15): Redact sensitive headers before storage.
      const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization']);
      const safeHeaders: Record<string, unknown> = {};
      if (params.headers) {
        for (const [k, v] of Object.entries(params.headers)) {
          if (SENSITIVE_HEADERS.has(k.toLowerCase())) {
            safeHeaders[k] = '[REDACTED]';
          } else {
            safeHeaders[k] = v;
          }
        }
      }

      const r = await db.query(
        `INSERT INTO automation_events_inbox
          (organization_id, project_id, source_module, event_type, source_event_id,
           dedupe_key, payload, headers, status, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'pending',$9::jsonb)
         ON CONFLICT (organization_id, dedupe_key) DO NOTHING
         RETURNING *`,
        [
          params.organizationId, params.projectId ?? null, params.sourceModule,
          params.eventType, params.sourceEventId ?? null, params.dedupeKey,
          JSON.stringify(params.payload), JSON.stringify(safeHeaders),
          JSON.stringify(params.metadata ?? {}),
        ],
      );
      if (r.rows[0]) return { event: toInboxEvent(r.rows[0]), created: true };

      // Already exists — tenant-scoped lookup, including NULL-org system events.
      const existing = await db.query(
        `SELECT * FROM automation_events_inbox
         WHERE dedupe_key = $1 AND organization_id IS NOT DISTINCT FROM $2::uuid`,
        [params.dedupeKey, params.organizationId],
      );
      if (!existing.rows[0]) {
        throw new AutomationConflictError('Inbox dedupe conflict could not be resolved');
      }
      return { event: toInboxEvent(existing.rows[0]), created: false };
    } catch (err) { mapPgError(err); }
  }

  /**
   * Claim up to `batchSize` pending events using CTE + FOR UPDATE SKIP LOCKED.
   * Also recovers stuck events locked > 5 min ago.
   */
  async claimInboxEvents(workerId: string, batchSize: number, db: Db = this.db): Promise<InboxEventRow[]> {
    const r = await db.query(
      `WITH claimable AS (
         SELECT id FROM automation_events_inbox
         WHERE (
           (status IN ('pending','retry') AND (next_retry_at IS NULL OR next_retry_at <= NOW()))
           OR (status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes')
         )
         ORDER BY received_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE automation_events_inbox e
       SET status = 'processing', locked_at = NOW(), locked_by = $2, attempts = attempts + 1
       FROM claimable c WHERE e.id = c.id
       RETURNING e.*`,
      [batchSize, workerId],
    );
    return r.rows.map(toInboxEvent);
  }

  async completeInboxEvent(eventId: string, db: Db = this.db): Promise<void> {
    await db.query(
      `UPDATE automation_events_inbox SET status = 'processed', processed_at = NOW(), locked_at = NULL, locked_by = NULL
       WHERE id = $1`,
      [eventId],
    );
  }

  async failInboxEvent(eventId: string, error: string, retryAt: Date | null, db: Db = this.db): Promise<void> {
    const newStatus = retryAt ? 'retry' : 'failed';
    await db.query(
      `UPDATE automation_events_inbox SET status = $2, last_error = $3, next_retry_at = $4, locked_at = NULL, locked_by = NULL
       WHERE id = $1`,
      [eventId, newStatus, error, retryAt],
    );
  }

  // -------------------------------------------------------------------------
  // Matching active workflows with trigger/cooldown data
  // -------------------------------------------------------------------------

  async findMatchingWorkflows(
    orgId: string,
    sourceModule: string,
    sourceEvent: string,
    db: Db = this.db,
  ): Promise<Array<WorkflowRow & { triggerId: string; cooldownSeconds: number; lastRunAt: Date | null }>> {
    const r = await db.query(
      `SELECT w.*, t.id AS trigger_id, t.cooldown_seconds
       FROM automation_workflows w
       JOIN automation_triggers t ON t.workflow_id = w.id AND t.deleted_at IS NULL
       WHERE w.organization_id = $1
         AND w.is_enabled = TRUE
         AND w.deleted_at IS NULL
         AND t.source_module = $2
         AND t.source_event = $3
         AND t.is_enabled = TRUE`,
      [orgId, sourceModule, sourceEvent],
    );
    return r.rows.map(row => ({
      ...toWorkflow(row),
      triggerId: row.trigger_id,
      cooldownSeconds: row.cooldown_seconds,
      lastRunAt: row.last_run_at,
    }));
  }


  // -------------------------------------------------------------------------
  // Run + Steps: atomic idempotent creation with safe unique constraint
  // -------------------------------------------------------------------------

  async createRunWithSteps(params: {
    organizationId: string | null;
    projectId?: string | null;
    workflowId: string;
    workflowVersionId: string;
    triggerId?: string | null;
    inboxEventId?: string | null;
    triggerType: string;
    sourceModule: string;
    sourceEventId?: string | null;
    dedupeKey?: string | null;
    idempotencyKey: string;
    priority?: number;
    maxAttempts?: number;
    inputPayload: Record<string, unknown>;
    expiresAt?: Date | null;
    steps: Array<{
      actionId?: string | null;
      stepKey: string;
      actionType: string;
      sortOrder: number;
      maxAttempts?: number;
      timeoutSeconds?: number;
      retryBackoffSeconds?: number;
      requiresApproval?: boolean;
      idempotencyKey?: string | null;
      inputPayload?: Record<string, unknown>;
      riskLevel?: string;
      config?: Record<string, unknown>;
      requiredFeatureKey?: string | null;
      metadata?: Record<string, unknown>;
    }>;
  }, providedClient?: PoolClient): Promise<{ run: RunRow; steps: RunStepRow[] }> {
    const doWork = async (client: PoolClient) => {
      let run: RunRow;
      try {
        const rR = await client.query(
          `INSERT INTO automation_runs
            (organization_id, project_id, workflow_id, workflow_version_id, trigger_id,
             inbox_event_id, status, trigger_type, source_module, source_event_id,
             dedupe_key, idempotency_key, priority, max_attempts, input_payload, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15)
           RETURNING *`,
          [
            params.organizationId, params.projectId ?? null, params.workflowId,
            params.workflowVersionId, params.triggerId ?? null, params.inboxEventId ?? null,
            params.triggerType, params.sourceModule, params.sourceEventId ?? null,
            params.dedupeKey ?? null, params.idempotencyKey, params.priority ?? 0,
            params.maxAttempts ?? 3, JSON.stringify(params.inputPayload),
            params.expiresAt ?? null,
          ],
        );
        run = toRun(rR.rows[0]);
      } catch (err) { mapPgError(err); }

      const steps: RunStepRow[] = [];
      for (const s of params.steps) {
        const stepMetadata = {
          ...(s.metadata ?? {}),
          riskLevel: s.riskLevel ?? 'low',
          config: s.config ?? {},
          timeoutSeconds: s.timeoutSeconds ?? 60,
          retryBackoffSeconds: s.retryBackoffSeconds ?? 30,
          requiredFeatureKey: s.requiredFeatureKey ?? null,
        };
        const hasKey = s.idempotencyKey != null;
        const insertSql = hasKey
          ? `INSERT INTO automation_run_steps
              (run_id, workflow_id, action_id, step_key, action_type, status, sort_order,
               max_attempts, requires_approval, idempotency_key, input_payload, metadata)
             VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10::jsonb,$11::jsonb)
             ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
             RETURNING *`
          : `INSERT INTO automation_run_steps
              (run_id, workflow_id, action_id, step_key, action_type, status, sort_order,
               max_attempts, requires_approval, idempotency_key, input_payload, metadata)
             VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10::jsonb,$11::jsonb)
             RETURNING *`;
        const sR = await client.query(insertSql, [
          run.id, params.workflowId, s.actionId ?? null, s.stepKey, s.actionType,
          s.sortOrder, s.maxAttempts ?? 3, s.requiresApproval ?? false,
          s.idempotencyKey ?? null, JSON.stringify(s.inputPayload ?? {}),
          JSON.stringify(stepMetadata),
        ]);
        if (sR.rows[0]) steps.push(toStep(sR.rows[0]));
      }

      return { run, steps };
    };

    // If a PoolClient is provided, execute directly (caller owns the transaction)
    if (providedClient) {
      return doWork(providedClient);
    }
    // Otherwise wrap in our own transaction
    return this.withTransaction(doWork);
  }

  // -------------------------------------------------------------------------
  // Runs: org-scoped list / get / cancel with step resets / retry with step resets
  // -------------------------------------------------------------------------

  async listRuns(orgId: string, q: RunListQuery, db: Db = this.db): Promise<{ data: RunSummaryRow[]; total: number }> {
    const params: unknown[] = [orgId];
    const conditions = ['organization_id = $1'];
    if (q.status) { params.push(q.status); conditions.push(`status = $${params.length}`); }
    if (q.workflowId) { params.push(q.workflowId); conditions.push(`workflow_id = $${params.length}`); }
    if (q.triggerType) { params.push(q.triggerType); conditions.push(`trigger_type = $${params.length}`); }
    const where = conditions.join(' AND ');

    const countR = await db.query(`SELECT COUNT(*)::int AS total FROM v_automation_run_summaries WHERE ${where}`, params);
    const total = countR.rows[0]?.total ?? 0;

    const dataParams = [...params, q.limit, q.offset];
    const dataR = await db.query(
      `SELECT * FROM v_automation_run_summaries WHERE ${where} ORDER BY created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    return { data: dataR.rows.map(toRunSummary), total };
  }

  async getRun(orgId: string, runId: string, db: Db = this.db): Promise<RunRow | null> {
    const r = await db.query(
      `SELECT * FROM automation_runs WHERE id = $1 AND organization_id = $2`,
      [runId, orgId],
    );
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  /**
   * Cancel run + transactionally cancel pending approvals and waiting/nonterminal steps.
   */
  async cancelRun(orgId: string, runId: string, db: Db = this.db): Promise<RunRow | null> {
    return this.withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE automation_runs SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status IN ('queued','running','waiting_approval')
         RETURNING *`,
        [runId, orgId],
      );
      if (!r.rows[0]) return null;

      // Cancel all pending approvals for this run
      await client.query(
        `UPDATE automation_approvals SET status = 'cancelled', updated_at = NOW()
         WHERE run_id = $1 AND status = 'pending'`,
        [runId],
      );

      // Cancel all queued/running/waiting steps
      await client.query(
        `UPDATE automation_run_steps SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
         WHERE run_id = $1 AND status IN ('queued','running','waiting_approval')`,
        [runId],
      );

      return toRun(r.rows[0]);
    });
  }

  /**
   * Retry run — validates fromStep belongs to this run, no earlier failed blockers.
   * max_attempts default (3) makes API retry possible.
   */
  async retryRun(orgId: string, runId: string, fromStep?: string, db: Db = this.db): Promise<RunRow | null> {
    return this.withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE automation_runs
         SET status = 'queued', attempt = attempt + 1, started_at = NULL,
             completed_at = NULL, cancelled_at = NULL, error_code = NULL, error_message = NULL, updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status IN ('failed','cancelled','timed_out')
           AND attempt < max_attempts
         RETURNING *`,
        [runId, orgId],
      );
      if (!r.rows[0]) return null;

      if (fromStep) {
        // Validate fromStep is a step in that same run
        const stepCheck = await client.query(
          `SELECT id, sort_order FROM automation_run_steps WHERE id = $1 AND run_id = $2`,
          [fromStep, runId],
        );
        if (!stepCheck.rows[0]) throw new AutomationNotFoundError('Step not found in this run');
        const fromSortOrder = stepCheck.rows[0].sort_order;

        // Check no earlier failed blockers (steps before fromStep that are failed)
        const blockerCheck = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM automation_run_steps
           WHERE run_id = $1 AND sort_order < $2 AND status IN ('failed','cancelled','timed_out')`,
          [runId, fromSortOrder],
        );
        if ((blockerCheck.rows[0]?.cnt ?? 0) > 0) {
          throw new AutomationConflictError('Earlier failed steps must be resolved before retrying from this step');
        }

        // Reset steps at or after fromStep sort_order
        await client.query(
          `UPDATE automation_run_steps
           SET status = 'queued', started_at = NULL, completed_at = NULL, next_retry_at = NULL,
               timeout_at = NULL, error_code = NULL, error_message = NULL, attempt = 1, updated_at = NOW()
           WHERE run_id = $1 AND status IN ('failed','cancelled','timed_out')
             AND sort_order >= $2`,
          [runId, fromSortOrder],
        );
      } else {
        await client.query(
          `UPDATE automation_run_steps
           SET status = 'queued', started_at = NULL, completed_at = NULL, next_retry_at = NULL,
               timeout_at = NULL, error_code = NULL, error_message = NULL, attempt = 1, updated_at = NOW()
           WHERE run_id = $1 AND status IN ('failed','cancelled','timed_out')`,
          [runId],
        );
      }

      return toRun(r.rows[0]);
    });
  }

  async listRunSteps(runId: string, orgId: string, db: Db = this.db): Promise<RunStepRow[]> {
    const r = await db.query(
      `SELECT s.* FROM automation_run_steps s
       JOIN automation_runs r ON r.id = s.run_id
       WHERE s.run_id = $1 AND r.organization_id = $2
       ORDER BY s.sort_order ASC`,
      [runId, orgId],
    );
    return r.rows.map(toStep);
  }


  // -------------------------------------------------------------------------
  // Bounded sequential step claim using actual action timeout + SKIP LOCKED
  // Disabled/deleted workflow guard, entitlement check hooks as data
  // -------------------------------------------------------------------------

  /**
   * Claim next queued step for sequential execution.
   * Ordering: lower terminal (success/skipped) permits next;
   * failed/cancelled/timed_out blocks (run should terminalize);
   * queued/running/waiting blocks.
   * Every execution attempt increments attempt exactly once.
   * Guards against disabled or deleted workflows.
   */
  async claimNextStep(runId: string, batchSize: number = 1, db: Db = this.db): Promise<RunStepRow[]> {
    const r = await db.query(
      `WITH eligible_run AS (
         SELECT r.id, r.workflow_id, r.organization_id FROM automation_runs r
         JOIN automation_workflows w ON w.id = r.workflow_id AND w.organization_id = r.organization_id
         WHERE r.id = $1
           AND r.status IN ('queued','running')
           AND w.is_enabled = TRUE
           AND w.deleted_at IS NULL
         LIMIT 1
       ),
       claimable AS (
         SELECT s.id FROM automation_run_steps s
         JOIN eligible_run er ON er.id = s.run_id
         WHERE s.run_id = $1
           AND (
             (s.status = 'queued' AND (s.next_retry_at IS NULL OR s.next_retry_at <= NOW()))
             OR (s.status = 'running' AND s.timeout_at IS NOT NULL AND s.timeout_at < NOW())
           )
           -- Block if any lower sort_order step is not in a terminal-success state
           AND NOT EXISTS (
             SELECT 1 FROM automation_run_steps blocker
             WHERE blocker.run_id = s.run_id
               AND blocker.sort_order < s.sort_order
               AND blocker.status NOT IN ('succeeded', 'skipped')
           )
         ORDER BY s.sort_order ASC
         LIMIT $2
         FOR UPDATE OF s SKIP LOCKED
       )
       UPDATE automation_run_steps s
       SET status = 'running',
           started_at = COALESCE(s.started_at, NOW()),
           timeout_at = NOW() + (INTERVAL '1 second' * COALESCE(
             (s.metadata->>'timeoutSeconds')::int,
             (SELECT a.timeout_seconds FROM automation_actions a WHERE a.id = s.action_id),
             60
           )),
           -- HARDENED: Only increment attempt on retry (when started_at already set).
           -- First claim executes as attempt 1 (the default).
           attempt = CASE WHEN s.started_at IS NOT NULL THEN s.attempt + 1 ELSE s.attempt END,
           updated_at = NOW()
       FROM claimable c WHERE s.id = c.id
       RETURNING s.*`,
      [runId, batchSize],
    );
    return r.rows.map(toStep);
  }

  // -------------------------------------------------------------------------
  // Step status updates
  // -------------------------------------------------------------------------

  async updateStepStatus(stepId: string, updates: {
    status: string;
    outputPayload?: Record<string, unknown>;
    errorCode?: string | null;
    errorMessage?: string | null;
    completedAt?: Date | null;
    nextRetryAt?: Date | null;
    attempt?: number;
  }, db: Db = this.db): Promise<RunStepRow | null> {
    const r = await db.query(
      `UPDATE automation_run_steps
       SET status = $2, output_payload = COALESCE($3::jsonb, output_payload),
           error_code = COALESCE($4, error_code), error_message = COALESCE($5, error_message),
           completed_at = COALESCE($6, completed_at), next_retry_at = $7,
           attempt = COALESCE($8, attempt), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        stepId, updates.status,
        updates.outputPayload ? JSON.stringify(updates.outputPayload) : null,
        updates.errorCode ?? null, updates.errorMessage ?? null,
        updates.completedAt ?? null, updates.nextRetryAt ?? null,
        updates.attempt ?? null,
      ],
    );
    return r.rows[0] ? toStep(r.rows[0]) : null;
  }

  async updateRunStatus(runId: string, updates: {
    status: string;
    startedAt?: Date | null;
    completedAt?: Date | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    outputPayload?: Record<string, unknown>;
  }, db: Db = this.db): Promise<RunRow | null> {
    const r = await db.query(
      `UPDATE automation_runs
       SET status = $2, started_at = COALESCE($3, started_at),
           completed_at = COALESCE($4, completed_at),
           error_code = COALESCE($5, error_code), error_message = COALESCE($6, error_message),
           output_payload = COALESCE($7::jsonb, output_payload), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        runId, updates.status, updates.startedAt ?? null, updates.completedAt ?? null,
        updates.errorCode ?? null, updates.errorMessage ?? null,
        updates.outputPayload ? JSON.stringify(updates.outputPayload) : null,
      ],
    );
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // Run completion aggregation
  // -------------------------------------------------------------------------

  /**
   * Determine run final status by aggregating step statuses.
   * Returns the computed status: 'succeeded' | 'failed' | 'cancelled' | null (still running).
   * HARDENED: timed_out counts as failure; cancelled run never aggregates to succeeded.
   */
  async aggregateRunCompletion(runId: string, db: Db = this.db): Promise<string | null> {
    const r = await db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status = 'skipped')::int AS skipped,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE status = 'timed_out')::int AS timed_out,
         COUNT(*) FILTER (WHERE status IN ('queued','running','waiting_approval'))::int AS pending
       FROM automation_run_steps WHERE run_id = $1`,
      [runId],
    );
    const row = r.rows[0];
    if (!row || row.pending > 0) return null;
    // timed_out is a terminal failure
    if (row.failed > 0 || row.timed_out > 0) return 'failed';
    if (row.cancelled > 0 && row.succeeded === 0) return 'cancelled';
    // If there are any cancelled steps alongside succeeded, still fail
    if (row.cancelled > 0) return 'failed';
    return 'succeeded';
  }

  // -------------------------------------------------------------------------
  // Stale run/step recovery
  // -------------------------------------------------------------------------

  /**
   * Recover stale runs that are stuck in 'running' with no activity.
   */
  async recoverStaleRuns(staleMinutes: number = 30, db: Db = this.db): Promise<number> {
    const r = await db.query(
      `UPDATE automation_runs
       SET status = 'failed', error_code = 'STALE_TIMEOUT', error_message = 'Run timed out (stale recovery)',
           completed_at = NOW(), updated_at = NOW()
       WHERE status = 'running'
         AND updated_at < NOW() - ($1 || ' minutes')::interval
         AND (expires_at IS NULL OR expires_at < NOW())`,
      [staleMinutes.toString()],
    );
    return r.rowCount ?? 0;
  }

  /**
   * Recover stale steps that passed their timeout_at.
   */
  async recoverStaleSteps(db: Db = this.db): Promise<number> {
    const r = await db.query(
      `UPDATE automation_run_steps
       SET status = 'failed', error_code = 'STEP_TIMEOUT', error_message = 'Step timed out',
           completed_at = NOW(), updated_at = NOW()
       WHERE status = 'running'
         AND timeout_at IS NOT NULL
         AND timeout_at < NOW()`,
    );
    return r.rowCount ?? 0;
  }


  // -------------------------------------------------------------------------
  // Approvals: create / get / list / approve / reject (transactional) / expire
  // -------------------------------------------------------------------------

  async createApproval(params: {
    organizationId: string;
    workflowId: string;
    runId: string;
    stepId?: string | null;
    requestedBy?: string | null;
    riskLevel: string;
    expiresAt: Date;
    requestPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }, db: Db = this.db): Promise<ApprovalRow> {
    const r = await db.query(
      `INSERT INTO automation_approvals
        (organization_id, workflow_id, run_id, step_id, requested_by, status,
         risk_level, expires_at, request_payload, metadata)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8::jsonb,$9::jsonb)
       RETURNING *`,
      [
        params.organizationId, params.workflowId, params.runId,
        params.stepId ?? null, params.requestedBy ?? null,
        params.riskLevel, params.expiresAt,
        JSON.stringify(params.requestPayload ?? {}),
        JSON.stringify(params.metadata ?? {}),
      ],
    );
    return toApproval(r.rows[0]);
  }


  /**
   * Atomically get/create the pending approval for a claimed step and move the
   * step/run into waiting_approval. The step row lock serializes concurrent
   * executors; the partial unique index is a second line of defense.
   */
  async createOrGetStepApproval(params: {
    organizationId: string;
    workflowId: string;
    runId: string;
    stepId: string;
    riskLevel: string;
    expiresAt: Date;
    requestPayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<{ approval: ApprovalRow; created: boolean }> {
    return this.withTransaction(async (client) => {
      const stepR = await client.query(
        `SELECT s.id, s.approval_id
         FROM automation_run_steps s
         JOIN automation_runs r ON r.id = s.run_id
         WHERE s.id = $1 AND s.run_id = $2 AND r.organization_id = $3
         FOR UPDATE OF s`,
        [params.stepId, params.runId, params.organizationId],
      );
      if (!stepR.rows[0]) throw new AutomationNotFoundError('Run step');

      let approval: ApprovalRow | null = null;
      let created = false;
      if (stepR.rows[0].approval_id) {
        const existingById = await client.query(
          `SELECT * FROM automation_approvals
           WHERE id = $1 AND organization_id = $2`,
          [stepR.rows[0].approval_id, params.organizationId],
        );
        if (existingById.rows[0]) approval = toApproval(existingById.rows[0]);
      }
      if (!approval) {
        const pending = await client.query(
          `SELECT * FROM automation_approvals
           WHERE step_id = $1 AND organization_id = $2 AND status = 'pending'
           LIMIT 1 FOR UPDATE`,
          [params.stepId, params.organizationId],
        );
        if (pending.rows[0]) {
          approval = toApproval(pending.rows[0]);
        } else {
          approval = await this.createApproval({
            organizationId: params.organizationId,
            workflowId: params.workflowId,
            runId: params.runId,
            stepId: params.stepId,
            riskLevel: params.riskLevel,
            expiresAt: params.expiresAt,
            ...(params.requestPayload !== undefined ? { requestPayload: params.requestPayload } : {}),
            ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
          }, client);
          created = true;
        }
      }

      await client.query(
        `UPDATE automation_run_steps
         SET status = 'waiting_approval', approval_id = $2, timeout_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [params.stepId, approval.id],
      );
      await client.query(
        `UPDATE automation_runs SET status = 'waiting_approval', updated_at = NOW()
         WHERE id = $1 AND organization_id = $2 AND status IN ('queued','running','waiting_approval')`,
        [params.runId, params.organizationId],
      );
      return { approval, created };
    });
  }

  async getApproval(orgId: string, approvalId: string, db: Db = this.db): Promise<ApprovalDetailRow | null> {
    const r = await db.query(
      `SELECT a.*, w.name AS workflow_name, s.action_type
       FROM automation_approvals a
       JOIN automation_workflows w ON w.id = a.workflow_id
       LEFT JOIN automation_run_steps s ON s.id = a.step_id
       WHERE a.id = $1 AND a.organization_id = $2`,
      [approvalId, orgId],
    );
    return r.rows[0] ? toApprovalDetail(r.rows[0]) : null;
  }

  async listApprovals(orgId: string, q: ListQuery & { status?: string; workflowId?: string; riskLevel?: string }, db: Db = this.db): Promise<{ data: ApprovalDetailRow[]; total: number }> {
    const params: unknown[] = [orgId];
    const conditions = ['a.organization_id = $1'];
    if (q.status) { params.push(q.status); conditions.push(`a.status = $${params.length}`); }
    if (q.workflowId) { params.push(q.workflowId); conditions.push(`a.workflow_id = $${params.length}`); }
    if (q.riskLevel) { params.push(q.riskLevel); conditions.push(`a.risk_level = $${params.length}`); }
    const where = conditions.join(' AND ');

    const countR = await db.query(
      `SELECT COUNT(*)::int AS total FROM automation_approvals a WHERE ${where}`, params);
    const total = countR.rows[0]?.total ?? 0;

    const dataParams = [...params, q.limit, q.offset];
    const dataR = await db.query(
      `SELECT a.*, w.name AS workflow_name, s.action_type
       FROM automation_approvals a
       JOIN automation_workflows w ON w.id = a.workflow_id
       LEFT JOIN automation_run_steps s ON s.id = a.step_id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    return { data: dataR.rows.map(toApprovalDetail), total };
  }

  /**
   * Approve an approval — transactional with row locking.
   * Validates pending status and not expired.
   * Persists decisionPayload. Resumes associated step and run.
   */
  async approveApproval(orgId: string, approvalId: string, approvedBy: string, reason?: string, decisionPayload?: Record<string, unknown>): Promise<ApprovalRow> {
    return this.withTransaction(async (client) => {
      // Lock the approval row
      const lockR = await client.query(
        `SELECT * FROM automation_approvals WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [approvalId, orgId],
      );
      if (!lockR.rows[0]) throw new AutomationNotFoundError('Approval');
      const approval = toApproval(lockR.rows[0]);

      if (approval.status !== 'pending') {
        throw new AutomationConflictError(`Approval is already ${approval.status}`);
      }
      if (new Date(approval.expiresAt) < new Date()) {
        throw new AutomationApprovalExpiredError(approvalId);
      }

      // Update approval with decisionPayload
      const updR = await client.query(
        `UPDATE automation_approvals
         SET status = 'approved', approved_by = $3, approval_reason = $4,
             decision_payload = $5::jsonb, decided_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [approvalId, orgId, approvedBy, reason ?? null, JSON.stringify(decisionPayload ?? {})],
      );
      const updated = toApproval(updR.rows[0]);

      // Resume step if linked
      if (updated.stepId) {
        await client.query(
          `UPDATE automation_run_steps SET status = 'queued', updated_at = NOW()
           WHERE id = $1 AND status = 'waiting_approval'`,
          [updated.stepId],
        );
      }

      // Resume run if it was waiting
      await client.query(
        `UPDATE automation_runs SET status = 'running', updated_at = NOW()
         WHERE id = $1 AND status = 'waiting_approval'`,
        [updated.runId],
      );

      return updated;
    });
  }

  /**
   * Reject an approval — transactional with row locking.
   * Validates pending status and not expired.
   * Persists decisionPayload. Fails associated step and aggregate/terminalize run.
   */
  async rejectApproval(orgId: string, approvalId: string, rejectedBy: string, reason?: string, decisionPayload?: Record<string, unknown>): Promise<ApprovalRow> {
    return this.withTransaction(async (client) => {
      const lockR = await client.query(
        `SELECT * FROM automation_approvals WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [approvalId, orgId],
      );
      if (!lockR.rows[0]) throw new AutomationNotFoundError('Approval');
      const approval = toApproval(lockR.rows[0]);

      if (approval.status !== 'pending') {
        throw new AutomationConflictError(`Approval is already ${approval.status}`);
      }
      if (new Date(approval.expiresAt) < new Date()) {
        throw new AutomationApprovalExpiredError(approvalId);
      }

      const updR = await client.query(
        `UPDATE automation_approvals
         SET status = 'rejected', rejected_by = $3, rejection_reason = $4,
             decision_payload = $5::jsonb, decided_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING *`,
        [approvalId, orgId, rejectedBy, reason ?? null, JSON.stringify(decisionPayload ?? {})],
      );
      const updated = toApproval(updR.rows[0]);

      // Fail the step
      if (updated.stepId) {
        await client.query(
          `UPDATE automation_run_steps SET status = 'failed', error_code = 'APPROVAL_REJECTED',
           error_message = $2, completed_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'waiting_approval'`,
          [updated.stepId, reason ?? 'Approval rejected'],
        );
      }

      // Aggregate and terminalize the run
      const aggR = await client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('queued','running','waiting_approval'))::int AS pending
         FROM automation_run_steps WHERE run_id = $1`,
        [updated.runId],
      );
      if ((aggR.rows[0]?.pending ?? 0) === 0) {
        await client.query(
          `UPDATE automation_runs SET status = 'failed', error_code = 'APPROVAL_REJECTED',
           error_message = 'Run failed due to rejected approval', completed_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status IN ('running','waiting_approval')`,
          [updated.runId],
        );
      }

      return updated;
    });
  }

  /**
   * Expire all stale pending approvals past their expires_at.
   * Transactionally fails steps waiting on expired approvals and aggregate/terminalize runs.
   */
  async expireStaleApprovals(db: Db = this.db): Promise<number> {
    return this.withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE automation_approvals SET status = 'expired', updated_at = NOW()
         WHERE status = 'pending' AND expires_at < NOW()
         RETURNING id, step_id, run_id`,
      );
      const expired = r.rows;

      // Fail steps waiting on expired approvals
      if (expired.length > 0) {
        const stepIds = expired.filter(e => e.step_id).map(e => e.step_id);
        if (stepIds.length > 0) {
          await client.query(
            `UPDATE automation_run_steps
             SET status = 'failed', error_code = 'APPROVAL_EXPIRED', error_message = 'Approval expired',
                 completed_at = NOW(), updated_at = NOW()
             WHERE id = ANY($1::uuid[]) AND status = 'waiting_approval'`,
            [stepIds],
          );
        }

        // Aggregate and terminalize affected runs
        const runIds = [...new Set(expired.map(e => e.run_id))];
        for (const runId of runIds) {
          const aggR = await client.query(
            `SELECT COUNT(*) FILTER (WHERE status IN ('queued','running','waiting_approval'))::int AS pending
             FROM automation_run_steps WHERE run_id = $1`,
            [runId],
          );
          if ((aggR.rows[0]?.pending ?? 0) === 0) {
            await client.query(
              `UPDATE automation_runs SET status = 'failed', error_code = 'APPROVAL_EXPIRED',
               error_message = 'Run failed due to expired approval', completed_at = NOW(), updated_at = NOW()
               WHERE id = $1 AND status IN ('running','waiting_approval')`,
              [runId],
            );
          }
        }
      }

      return r.rowCount ?? 0;
    });
  }


  // -------------------------------------------------------------------------
  // Bounded runnable-run recovery: finds stuck runs and re-queues them
  // -------------------------------------------------------------------------

  /**
   * Find and recover runs that are in 'running' state but have no active steps
   * (all steps are terminal or timed out). Bounded batch.
   * HARDENED: Marks genuinely stuck runs as failed.
   */
  async recoverRunnableRuns(batchSize: number = 50, db: Db = this.db): Promise<number> {
    const r = await db.query(
      `WITH stuck_runs AS (
         SELECT r.id FROM automation_runs r
         WHERE r.status = 'running'
           AND r.updated_at < NOW() - INTERVAL '5 minutes'
           AND NOT EXISTS (
             SELECT 1 FROM automation_run_steps s
             WHERE s.run_id = r.id AND s.status IN ('running','waiting_approval')
           )
           AND NOT EXISTS (
             SELECT 1 FROM automation_run_steps s
             WHERE s.run_id = r.id AND s.status = 'queued'
               AND (s.next_retry_at IS NULL OR s.next_retry_at <= NOW())
           )
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE automation_runs r
       SET status = 'failed', error_code = 'STALE_RECOVERY', error_message = 'No active steps remaining',
           completed_at = NOW(), updated_at = NOW()
       FROM stuck_runs sr WHERE r.id = sr.id`,
      [batchSize],
    );
    return r.rowCount ?? 0;
  }

  /**
   * Find runs that have due queued steps but no active step currently running.
   * These runs need to be re-enqueued so their next step executes.
   * Returns run IDs + org IDs for the worker to enqueue.
   * HARDENED (defect 8): Avoids marking genuinely runnable runs as stale.
   */
  async findRunnableRunsForReenqueue(batchSize: number = 50, db: Db = this.db): Promise<Array<{ runId: string; orgId: string }>> {
    const r = await db.query(
      `SELECT DISTINCT r.id AS run_id, r.organization_id AS org_id
       FROM automation_runs r
       WHERE r.status IN ('queued', 'running')
         AND r.updated_at < NOW() - INTERVAL '1 minute'
         AND NOT EXISTS (
           SELECT 1 FROM automation_run_steps s
           WHERE s.run_id = r.id AND s.status = 'running'
         )
         AND EXISTS (
           SELECT 1 FROM automation_run_steps s
           WHERE s.run_id = r.id AND s.status = 'queued'
             AND (s.next_retry_at IS NULL OR s.next_retry_at <= NOW())
         )
       LIMIT $1`,
      [batchSize],
    );
    return r.rows.map((row: any) => ({ runId: row.run_id, orgId: row.org_id }));
  }


  // -------------------------------------------------------------------------
  // Atomic workflow execution slot reservation with cooldown+hourly rate gate
  // Uses advisory xact lock to avoid COUNT race.
  // -------------------------------------------------------------------------

  /**
   * Attempt to reserve an execution slot for a workflow.
   * Enforces:
   *  - cooldownSeconds since last run
   *  - maxRunsPerHour rate limit
   * Returns true if slot reserved, false if rate limited.
   * Uses pg_advisory_xact_lock to prevent COUNT race.
   */
  async reserveExecutionSlot(params: {
    workflowId: string;
    orgId: string;
    cooldownSeconds: number;
    maxRunsPerHour: number;
  }, client: PoolClient): Promise<boolean> {
    // Advisory lock scoped to this workflow (prevents concurrent slot checks)
    const lockKey = Buffer.from(params.workflowId.replace(/-/g, '').slice(0, 16), 'hex');
    const lockVal = lockKey.readBigInt64BE(0);
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockVal]);

    // Check cooldown
    if (params.cooldownSeconds > 0) {
      const coolR = await client.query(
        `SELECT 1 FROM automation_runs
         WHERE workflow_id = $1 AND organization_id = $2
           AND created_at > NOW() - ($3 || ' seconds')::interval
         LIMIT 1`,
        [params.workflowId, params.orgId, params.cooldownSeconds.toString()],
      );
      if ((coolR.rowCount ?? 0) > 0) return false;
    }

    // Check hourly rate
    if (params.maxRunsPerHour > 0) {
      const rateR = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM automation_runs
         WHERE workflow_id = $1 AND organization_id = $2
           AND created_at > NOW() - INTERVAL '1 hour'`,
        [params.workflowId, params.orgId],
      );
      if ((rateR.rows[0]?.cnt ?? 0) >= params.maxRunsPerHour) return false;
    }

    return true;
  }


  // -------------------------------------------------------------------------
  // Atomic bounded schedule claim/update
  // -------------------------------------------------------------------------

  /**
   * @deprecated Use runScheduleSweep in workers.ts instead. Retained for API compatibility only.
   * This standalone method is NOT transactionally safe on its own.
   */
  async claimDueSchedules(_batchSize: number = 20, _db: Db = this.db): Promise<Array<{ workflowId: string; triggerId: string; orgId: string; scheduleCron: string; timezone: string }>> {
    // HARDENED (defect 2): This method was misleading — schedule sweep is now fully transactional
    // in workers.ts. Return empty to avoid accidental use.
    return [];
  }

  /**
   * Update next_run_at for a workflow after schedule execution.
   */
  async updateWorkflowNextRunAt(workflowId: string, nextRunAt: Date | null, db: Db = this.db): Promise<void> {
    await db.query(
      `UPDATE automation_workflows SET next_run_at = $2, updated_at = NOW() WHERE id = $1`,
      [workflowId, nextRunAt],
    );
  }


  // -------------------------------------------------------------------------
  // Immutable audit insert/list (delegated convenience wrappers)
  // -------------------------------------------------------------------------

  async insertAuditLog(params: InsertAuditParams, db: Db = this.db): Promise<void> {
    await db.query(
      `INSERT INTO automation_audit_logs
        (organization_id, project_id, workflow_id, run_id, step_id, approval_id,
         actor_user_id, actor_type, action, entity_type, entity_id,
         request_id, ip_address, user_agent, before_state, after_state, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::inet,$14,$15::jsonb,$16::jsonb,$17::jsonb)`,
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
  }

  async listAuditLogs(
    orgId: string,
    q: ListQuery & { workflowId?: string; runId?: string; action?: string },
    db: Db = this.db,
  ): Promise<{ data: Array<Record<string, unknown>>; total: number }> {
    const params: unknown[] = [orgId];
    const conditions = ['organization_id = $1'];
    if (q.workflowId) { params.push(q.workflowId); conditions.push(`workflow_id = $${params.length}`); }
    if (q.runId) { params.push(q.runId); conditions.push(`run_id = $${params.length}`); }
    if (q.action) { params.push(q.action); conditions.push(`action = $${params.length}`); }
    const where = conditions.join(' AND ');

    const countR = await db.query(`SELECT COUNT(*)::int AS total FROM automation_audit_logs WHERE ${where}`, params);
    const total = countR.rows[0]?.total ?? 0;

    const dataParams = [...params, q.limit, q.offset];
    const dataR = await db.query(
      `SELECT * FROM automation_audit_logs WHERE ${where}
       ORDER BY occurred_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );
    return { data: dataR.rows, total };
  }
}

// ===========================================================================
// Utility: cryptographic SHA-256 checksum with canonical stable JSON
// ===========================================================================

/**
 * Canonical stable JSON serialization — deterministic key order via recursive sort.
 * Excludes volatile DB fields (id, created_at, updated_at, deleted_at and their camelCase variants).
 */
const EXCLUDED_KEYS = new Set(['id', 'created_at', 'updated_at', 'deleted_at', 'createdAt', 'updatedAt', 'deletedAt']);

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const sorted = Object.keys(value as Record<string, unknown>).filter(k => !EXCLUDED_KEYS.has(k)).sort();
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}

/**
 * Compute cryptographic SHA-256 checksum using canonical stable JSON.
 * Excludes DB IDs and timestamps for semantic equivalence.
 */
export function computeChecksum(data: unknown): string {
  const canonical = stableStringify(data);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
