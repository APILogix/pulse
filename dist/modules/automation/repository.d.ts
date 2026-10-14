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
import type { Pool, PoolClient } from 'pg';
import type { InsertAuditParams } from './audit.js';
export declare const AUTOMATION_WORKFLOW_COLUMNS = "id, organization_id, project_id, created_by, updated_by, template_id, name, slug, description, workflow_type, scope, status, is_enabled, current_version, last_run_at, next_run_at, timezone, tags, metadata, created_at, updated_at, deleted_at";
export declare const AUTOMATION_WORKFLOW_SUMMARY_COLUMNS = "id, organization_id, project_id, created_by, updated_by, template_id, name, slug, description, workflow_type, scope, status, is_enabled, current_version, last_run_at, next_run_at, timezone, tags, metadata, created_at, updated_at, deleted_at, trigger_count, trigger_type, action_count, action_types, action_requires_approval, last_run_status, last_run_created_at";
export declare const AUTOMATION_TRIGGER_COLUMNS = "id, workflow_id, workflow_version_id, trigger_kind, trigger_type, source_module, source_event, schedule_cron, timezone, webhook_secret_hash, is_enabled, dedupe_key_template, cooldown_seconds, config, metadata, created_at, updated_at, deleted_at";
export declare const AUTOMATION_CONDITION_COLUMNS = "id, workflow_id, workflow_version_id, condition_group, sort_order, left_path, operator, right_value, value_type, is_required, metadata, created_at, updated_at, deleted_at";
export declare const AUTOMATION_ACTION_COLUMNS = "id, workflow_id, workflow_version_id, action_key, action_type, integration_key, sort_order, is_enabled, requires_approval, risk_level, timeout_seconds, max_attempts, retry_backoff_seconds, idempotency_key_template, config, metadata, created_at, updated_at, deleted_at";
export declare const AUTOMATION_WORKFLOW_VERSION_COLUMNS = "id, workflow_id, version, status, definition, trigger_summary, condition_summary, action_summary, published_by, published_at, checksum, metadata, created_at";
export declare const AUTOMATION_TEMPLATE_COLUMNS = "id, template_key, scope, organization_id, name, description, workflow_type, category, is_active, is_public, is_featured, minimum_plan_tier, required_feature_key, tags, sort_order, metadata, created_at, updated_at, deleted_at";
export declare const AUTOMATION_TEMPLATE_VERSION_COLUMNS = "id, template_id, version, is_current, definition, trigger_summary, condition_summary, action_summary, created_by, published_at, checksum, metadata, created_at";
export declare const AUTOMATION_EVENT_INBOX_COLUMNS = "id, organization_id, project_id, source_module, event_type, source_event_id, dedupe_key, payload, headers, status, received_at, locked_at, locked_by, processed_at, attempts, next_retry_at, last_error, metadata";
export declare const AUTOMATION_RUN_COLUMNS = "id, organization_id, project_id, workflow_id, workflow_version_id, trigger_id, inbox_event_id, status, trigger_type, source_module, source_event_id, dedupe_key, idempotency_key, priority, queued_at, started_at, completed_at, cancelled_at, expires_at, attempt, max_attempts, input_payload, output_payload, error_code, error_message, metadata, created_at, updated_at";
export declare const AUTOMATION_RUN_SUMMARY_COLUMNS = "run_id, workflow_id, workflow_name, organization_id, status, trigger_type, source_module, priority, queued_at, started_at, completed_at, created_at, step_count, failed_step_count, pending_approval_count";
export declare const AUTOMATION_RUN_STEP_COLUMNS = "id, run_id, workflow_id, action_id, step_key, action_type, status, sort_order, attempt, max_attempts, started_at, completed_at, next_retry_at, timeout_at, requires_approval, approval_id, idempotency_key, input_payload, output_payload, error_code, error_message, metadata, created_at, updated_at";
export declare const AUTOMATION_RUN_STEP_COLUMNS_WITH_S = "s.id, s.run_id, s.workflow_id, s.action_id, s.step_key, s.action_type, s.status, s.sort_order, s.attempt, s.max_attempts, s.started_at, s.completed_at, s.next_retry_at, s.timeout_at, s.requires_approval, s.approval_id, s.idempotency_key, s.input_payload, s.output_payload, s.error_code, s.error_message, s.metadata, s.created_at, s.updated_at";
export declare const AUTOMATION_APPROVAL_COLUMNS = "id, organization_id, workflow_id, run_id, step_id, requested_by, approved_by, rejected_by, status, risk_level, approval_reason, rejection_reason, expires_at, decided_at, request_payload, decision_payload, metadata, created_at, updated_at";
export declare const AUTOMATION_AUDIT_LOG_COLUMNS = "id, organization_id, project_id, workflow_id, run_id, step_id, approval_id, actor_user_id, actor_type, action, entity_type, entity_id, request_id, ip_address, user_agent, before_state, after_state, metadata, occurred_at";
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
export declare class AutomationRepository {
    private readonly db;
    constructor(db: Pool);
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    getMemberRole(orgId: string, userId: string, db?: Db): Promise<string | null>;
    /**
     * Verify project belongs to org — uses canonical column projects.org_id (NOT organization_id).
     */
    verifyProjectOwnership(orgId: string, projectId: string, db?: Db): Promise<boolean>;
    /**
     * Check boolean entitlement using canonical EntitlementsService.
     */
    hasEntitlement(orgId: string, featureKey: string, _db?: Db): Promise<boolean>;
    /**
     * Get integer entitlement limit using canonical EntitlementsService.
     */
    getWorkflowLimit(orgId: string, _db?: Db): Promise<number>;
    /**
     * Batch entitlement lookup for a set of feature keys using canonical EntitlementsService.
     */
    batchCheckEntitlements(orgId: string, featureKeys: string[], _db?: Db): Promise<Map<string, boolean>>;
    countOrgWorkflows(orgId: string, db?: Db): Promise<number>;
    listWorkflows(orgId: string, q: WorkflowListQuery, db?: Db): Promise<{
        data: WorkflowSummaryRow[];
        total: number;
    }>;
    getWorkflow(orgId: string, workflowId: string, db?: Db): Promise<WorkflowRow | null>;
    /**
     * Full workflow definition retrieval: workflow + triggers + conditions + actions + active version.
     */
    getWorkflowFullDefinition(orgId: string, workflowId: string, db?: Db): Promise<WorkflowFullDefinition | null>;
    getWorkflowForUpdate(workflowId: string, orgId: string, client: PoolClient): Promise<WorkflowRow | null>;
    /**
     * Resolve the active (latest published) version for a workflow.
     */
    getActiveVersion(workflowId: string, db?: Db): Promise<WorkflowVersionRow | null>;
    /**
     * Get version-bound (pinned) actions for a specific workflow version.
     */
    getVersionActions(workflowId: string, versionId: string, db?: Db): Promise<ActionRow[]>;
    /**
     * Get version-bound (pinned) conditions for a specific workflow version.
     */
    getVersionConditions(workflowId: string, versionId: string, db?: Db): Promise<ConditionRow[]>;
    createWorkflowTransaction(params: {
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
    }): Promise<WorkflowRow>;
    updateWorkflowDraft(params: {
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
    }): Promise<WorkflowRow>;
    softDeleteWorkflow(orgId: string, workflowId: string, audit?: InsertAuditParams, db?: Db): Promise<boolean>;
    setWorkflowEnabled(orgId: string, workflowId: string, enabled: boolean, audit?: InsertAuditParams, db?: Db): Promise<WorkflowRow | null>;
    publishWorkflowVersion(params: {
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
    }): Promise<WorkflowVersionRow>;
    listTemplates(orgId: string, q: ListQuery & {
        category?: string;
    }, db?: Db): Promise<{
        data: TemplateRow[];
        total: number;
    }>;
    getTemplate(templateKey: string, orgId: string | null, db?: Db): Promise<TemplateRow | null>;
    /** Load current versions for a page of templates in one query. */
    getCurrentTemplateVersions(templateIds: string[], db?: Db): Promise<Map<string, TemplateVersionRow>>;
    getTemplateCurrentVersion(templateId: string, db?: Db): Promise<TemplateVersionRow | null>;
    /**
     * Create a fully normalized draft workflow from template definition.
     * Accepts an already validated overridden definition and materializes exactly that
     * definition/draft version/checksum. Uses cryptographic SHA-256.
     */
    createWorkflowFromTemplate(params: {
        orgId: string;
        projectId?: string | null;
        createdBy: string;
        templateId: string;
        name: string;
        slug: string;
        description?: string | null;
        overriddenDefinition?: Record<string, unknown> | null;
        overrides?: {
            tags?: string[];
            metadata?: Record<string, unknown>;
            configOverrides?: Record<string, unknown>;
        };
        audit?: InsertAuditParams;
    }): Promise<WorkflowRow>;
    insertInboxEvent(params: {
        organizationId: string | null;
        projectId?: string | null;
        sourceModule: string;
        eventType: string;
        sourceEventId?: string | null;
        dedupeKey: string;
        payload: Record<string, unknown>;
        headers?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    }, db?: Db): Promise<{
        event: InboxEventRow;
        created: boolean;
    }>;
    /**
     * Claim up to `batchSize` pending events using bounded candidate CTEs + FOR UPDATE SKIP LOCKED.
     * Splits due events and stale recovery into separate index-friendly branches to eliminate
     * sequential table scans on 1-second worker polling ticks (AUT-Q012).
     */
    claimInboxEvents(workerId: string, batchSize: number, db?: Db): Promise<InboxEventRow[]>;
    completeInboxEvent(eventId: string, db?: Db): Promise<void>;
    failInboxEvent(eventId: string, error: string, retryAt: Date | null, db?: Db): Promise<void>;
    findMatchingWorkflows(orgId: string, sourceModule: string, sourceEvent: string, db?: Db): Promise<Array<WorkflowRow & {
        triggerId: string;
        cooldownSeconds: number;
        lastRunAt: Date | null;
    }>>;
    createRunWithSteps(params: {
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
            /**
             * Seconds to wait after run creation before this step becomes claimable.
             * Real scheduling delay (e.g. "escalate to PagerDuty only if still
             * unresolved after N minutes"), not an action-specific concern — it is
             * applied here, once, regardless of actionType, by setting the step's
             * initial next_retry_at. claimNextStep() already treats a queued step
             * with a future next_retry_at as not-yet-claimable, so no claim-path
             * change is needed.
             */
            initialDelaySeconds?: number | undefined;
        }>;
    }, providedClient?: PoolClient): Promise<{
        run: RunRow;
        steps: RunStepRow[];
    }>;
    listRuns(orgId: string, q: RunListQuery, db?: Db): Promise<{
        data: RunSummaryRow[];
        total: number;
    }>;
    getRun(orgId: string, runId: string, db?: Db): Promise<RunRow | null>;
    /**
     * Cancel run + transactionally cancel pending approvals and waiting/nonterminal steps.
     */
    cancelRun(orgId: string, runId: string, db?: Db): Promise<RunRow | null>;
    /**
     * Retry run — validates fromStep belongs to this run, no earlier failed blockers.
     * max_attempts default (3) makes API retry possible.
     */
    retryRun(orgId: string, runId: string, fromStep?: string, db?: Db): Promise<RunRow | null>;
    listRunSteps(runId: string, orgId: string, db?: Db): Promise<RunStepRow[]>;
    /**
     * Claim next queued step for sequential execution.
     * Ordering: lower terminal (success/skipped) permits next;
     * failed/cancelled/timed_out blocks (run should terminalize);
     * queued/running/waiting blocks.
     * Every execution attempt increments attempt exactly once.
     * Guards against disabled or deleted workflows.
     */
    claimNextStep(runId: string, batchSize?: number, db?: Db): Promise<RunStepRow[]>;
    updateStepStatus(stepId: string, updates: {
        status: string;
        outputPayload?: Record<string, unknown>;
        errorCode?: string | null;
        errorMessage?: string | null;
        completedAt?: Date | null;
        nextRetryAt?: Date | null;
        attempt?: number;
    }, db?: Db): Promise<RunStepRow | null>;
    updateRunStatus(runId: string, updates: {
        status: string;
        startedAt?: Date | null;
        completedAt?: Date | null;
        errorCode?: string | null;
        errorMessage?: string | null;
        outputPayload?: Record<string, unknown>;
    }, db?: Db): Promise<RunRow | null>;
    /**
     * Determine run final status by aggregating step statuses.
     * Returns the computed status: 'succeeded' | 'failed' | 'cancelled' | null (still running).
     * HARDENED: timed_out counts as failure; cancelled run never aggregates to succeeded.
     */
    aggregateRunCompletion(runId: string, db?: Db): Promise<string | null>;
    /**
     * Recover stale runs that are stuck in 'running' with no activity.
     */
    recoverStaleRuns(staleMinutes?: number, db?: Db): Promise<number>;
    /**
     * Recover stale steps that passed their timeout_at.
     */
    recoverStaleSteps(db?: Db): Promise<number>;
    createApproval(params: {
        organizationId: string;
        workflowId: string;
        runId: string;
        stepId?: string | null;
        requestedBy?: string | null;
        riskLevel: string;
        expiresAt: Date;
        requestPayload?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    }, db?: Db): Promise<ApprovalRow>;
    /**
     * Atomically get/create the pending approval for a claimed step and move the
     * step/run into waiting_approval. The step row lock serializes concurrent
     * executors; the partial unique index is a second line of defense.
     */
    createOrGetStepApproval(params: {
        organizationId: string;
        workflowId: string;
        runId: string;
        stepId: string;
        riskLevel: string;
        expiresAt: Date;
        requestPayload?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
    }): Promise<{
        approval: ApprovalRow;
        created: boolean;
    }>;
    getApproval(orgId: string, approvalId: string, db?: Db): Promise<ApprovalDetailRow | null>;
    listApprovals(orgId: string, q: ListQuery & {
        status?: string;
        workflowId?: string;
        riskLevel?: string;
    }, db?: Db): Promise<{
        data: ApprovalDetailRow[];
        total: number;
    }>;
    /**
     * Approve an approval — transactional with row locking.
     * Validates pending status and not expired.
     * Persists decisionPayload. Resumes associated step and run.
     */
    approveApproval(orgId: string, approvalId: string, approvedBy: string, reason?: string, decisionPayload?: Record<string, unknown>): Promise<ApprovalRow>;
    /**
     * Reject an approval — transactional with row locking.
     * Validates pending status and not expired.
     * Persists decisionPayload. Fails associated step and aggregate/terminalize run.
     */
    rejectApproval(orgId: string, approvalId: string, rejectedBy: string, reason?: string, decisionPayload?: Record<string, unknown>): Promise<ApprovalRow>;
    /**
     * Expire all stale pending approvals past their expires_at.
     * Transactionally fails steps waiting on expired approvals and aggregate/terminalize runs.
     */
    expireStaleApprovals(db?: Db): Promise<number>;
    /**
     * Find and recover runs that are in 'running' state but have no active steps
     * (all steps are terminal or timed out). Bounded batch.
     * HARDENED: Marks genuinely stuck runs as failed.
     */
    recoverRunnableRuns(batchSize?: number, db?: Db): Promise<number>;
    /**
     * Find runs that have due queued steps but no active step currently running.
     * These runs need to be re-enqueued so their next step executes.
     * Returns run IDs + org IDs for the worker to enqueue.
     * HARDENED (defect 8): Avoids marking genuinely runnable runs as stale.
     */
    findRunnableRunsForReenqueue(batchSize?: number, db?: Db): Promise<Array<{
        runId: string;
        orgId: string;
    }>>;
    /**
     * Attempt to reserve an execution slot for a workflow.
     * Enforces:
     *  - cooldownSeconds since last run
     *  - maxRunsPerHour rate limit
     * Returns true if slot reserved, false if rate limited.
     * Uses pg_advisory_xact_lock to prevent COUNT race.
     */
    reserveExecutionSlot(params: {
        workflowId: string;
        orgId: string;
        cooldownSeconds: number;
        maxRunsPerHour: number;
    }, client: PoolClient): Promise<boolean>;
    /**
     * @deprecated Use runScheduleSweep in workers.ts instead. Retained for API compatibility only.
     * This standalone method is NOT transactionally safe on its own.
     */
    claimDueSchedules(_batchSize?: number, _db?: Db): Promise<Array<{
        workflowId: string;
        triggerId: string;
        orgId: string;
        scheduleCron: string;
        timezone: string;
    }>>;
    /**
     * Update next_run_at for a workflow after schedule execution.
     */
    updateWorkflowNextRunAt(workflowId: string, nextRunAt: Date | null, db?: Db): Promise<void>;
    insertAuditLog(params: InsertAuditParams, db?: Db): Promise<void>;
    listAuditLogs(orgId: string, q: ListQuery & {
        workflowId?: string;
        runId?: string;
        action?: string;
    }, db?: Db): Promise<{
        data: Array<Record<string, unknown>>;
        total: number;
    }>;
}
export declare function stableStringify(value: unknown): string;
/**
 * Compute cryptographic SHA-256 checksum using canonical stable JSON.
 * Excludes DB IDs and timestamps for semantic equivalence.
 */
export declare function computeChecksum(data: unknown): string;
//# sourceMappingURL=repository.d.ts.map