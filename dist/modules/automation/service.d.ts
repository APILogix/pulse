import type { AutomationRepository } from './repository.js';
import type { AutomationAuditRepository } from './audit.js';
import type { ActionRunnerRegistry } from './action-runner.js';
import type { RequestMeta } from './types.js';
type EnqueueFn = (job: {
    type: string;
    payload: Record<string, unknown>;
}) => Promise<void>;
export declare class AutomationService {
    private readonly repo;
    private readonly audit;
    private readonly actionRunner;
    private enqueueFn;
    constructor(repo: AutomationRepository, audit: AutomationAuditRepository, actionRunner: ActionRunnerRegistry);
    setEnqueueFn(fn: EnqueueFn): void;
    /**
     * Check org membership role using hasMinRole semantics with actual org roles.
     * Viewers/members can read; only admin/owner can mutate.
     * Throws ForbiddenError (HTTP 403) on insufficient permission.
     */
    requireRole(orgId: string, userId: string, minRole: 'viewer' | 'member' | 'admin' | 'owner'): Promise<string>;
    requireReadAccess(orgId: string, userId: string): Promise<string>;
    requireWriteAccess(orgId: string, userId: string): Promise<string>;
    checkAutomationEnabled(orgId: string): Promise<void>;
    checkWorkflowLimits(orgId: string): Promise<void>;
    /**
     * Batch entitlement check: one query for all required feature keys.
     * Approval flags and template-specific keys are included in the same lookup.
     */
    batchCheckFeatures(orgId: string, triggerType: string, actionTypes: string[], actionRequiresApproval?: boolean[], additionalKeys?: string[]): Promise<string[]>;
    /** Get entitlement map for read-path enrichment (single query, no throw). */
    getEntitlementMap(orgId: string, featureKeys: string[]): Promise<Map<string, boolean>>;
    private entitlementMetadata;
    generateSlug(name: string): string;
    validateTimezone(tz: string): boolean;
    isUrlSafe(url: string): boolean;
    computeChecksum(data: unknown): string;
    listWorkflows(orgId: string, userId: string, query: {
        limit: number;
        offset: number;
        status?: string;
        workflowType?: string;
        isEnabled?: boolean;
        projectId?: string;
        tags?: string;
        search?: string;
    }): Promise<{
        data: {
            requiredFeatureKeys: string[];
            automationAvailable: boolean;
            entitlementUnavailable: boolean;
            unavailableReason: string | null;
            triggerCount: number;
            triggerType: string | null;
            actionCount: number;
            actionTypes: string[];
            actionRequiresApproval: boolean[];
            lastRunStatus: string | null;
            lastRunCreatedAt: Date | null;
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
        }[];
        total: number;
    }>;
    getWorkflow(orgId: string, userId: string, workflowId: string): Promise<{
        requiredFeatureKeys: string[];
        automationAvailable: boolean;
        entitlementUnavailable: boolean;
        unavailableReason: string | null;
        triggers: {
            id: string;
            workflowId: string;
            workflowVersionId: string | null;
            triggerKind: string;
            triggerType: string;
            sourceModule: string;
            sourceEvent: string | null;
            scheduleCron: string | null;
            timezone: string;
            isEnabled: boolean;
            dedupeKeyTemplate: string | null;
            cooldownSeconds: number;
            config: Record<string, unknown>;
            metadata: Record<string, unknown>;
            createdAt: Date;
            updatedAt: Date;
            deletedAt: Date | null;
        }[];
        workflow: import("./repository.js").WorkflowRow;
        conditions: import("./repository.js").ConditionRow[];
        actions: import("./repository.js").ActionRow[];
        activeVersion: import("./repository.js").WorkflowVersionRow | null;
    }>;
    createWorkflow(orgId: string, userId: string, input: {
        name: string;
        description?: string;
        workflowType: string;
        scope: string;
        projectId?: string;
        trigger: Record<string, unknown>;
        conditions: Record<string, unknown>[];
        actions: Record<string, unknown>[];
        safety?: Record<string, unknown>;
        tags?: string[];
        metadata?: Record<string, unknown>;
        timezone?: string;
    }, meta: RequestMeta): Promise<import("./repository.js").WorkflowRow>;
    validateActions(actions: Array<{
        actionType: string;
        riskLevel?: string;
        requiresApproval?: boolean;
        config?: Record<string, unknown>;
    }>): void;
    updateWorkflow(orgId: string, userId: string, workflowId: string, input: Record<string, unknown>, meta: RequestMeta): Promise<import("./repository.js").WorkflowRow>;
    deleteWorkflow(orgId: string, userId: string, workflowId: string, meta: RequestMeta): Promise<void>;
    enableWorkflow(orgId: string, userId: string, workflowId: string, meta: RequestMeta): Promise<import("./repository.js").WorkflowRow>;
    disableWorkflow(orgId: string, userId: string, workflowId: string, meta: RequestMeta): Promise<import("./repository.js").WorkflowRow>;
    publishWorkflow(orgId: string, userId: string, workflowId: string, activateOnPublish: boolean, meta: RequestMeta): Promise<import("./repository.js").WorkflowVersionRow>;
    manualRun(orgId: string, userId: string, workflowId: string, inputPayload: Record<string, unknown>, meta: RequestMeta & {
        idempotencyKey?: string;
    }): Promise<{
        run: import("./repository.js").RunRow;
        steps: import("./repository.js").RunStepRow[];
    }>;
    testWorkflow(orgId: string, userId: string, workflowId: string, simulatedPayload: Record<string, unknown>, dryRun: boolean, meta: RequestMeta): Promise<{
        run: import("./repository.js").RunRow;
        steps: import("./repository.js").RunStepRow[];
    } | {
        matched: boolean;
        conditionResults: {
            leftPath: string;
            operator: import("./types.js").ConditionOperator;
            actual: unknown;
            expected: unknown;
            passed: boolean;
        }[];
        dryRun: boolean;
    }>;
    ingestEvent(orgId: string, userId: string, input: {
        sourceModule: string;
        eventType: string;
        sourceEventId?: string;
        dedupeKey: string;
        payload: Record<string, unknown>;
        headers?: Record<string, string>;
        metadata?: Record<string, unknown>;
        projectId?: string;
    }, meta: RequestMeta): Promise<{
        event: import("./repository.js").InboxEventRow;
        created: boolean;
        duplicate: boolean;
    }>;
    listRuns(orgId: string, userId: string, query: {
        limit: number;
        offset: number;
        status?: string;
        workflowId?: string;
    }): Promise<{
        data: import("./repository.js").RunSummaryRow[];
        total: number;
    }>;
    getRun(orgId: string, userId: string, runId: string): Promise<import("./repository.js").RunRow>;
    getRunSteps(orgId: string, userId: string, runId: string): Promise<import("./repository.js").RunStepRow[]>;
    cancelRun(orgId: string, userId: string, runId: string, meta: RequestMeta & {
        reason?: string;
    }): Promise<import("./repository.js").RunRow>;
    retryRun(orgId: string, userId: string, runId: string, meta: RequestMeta & {
        fromStep?: string;
    }): Promise<import("./repository.js").RunRow>;
    listWorkflowRuns(orgId: string, userId: string, workflowId: string, query: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import("./repository.js").RunSummaryRow[];
        total: number;
    }>;
    listApprovals(orgId: string, userId: string, query: {
        limit: number;
        offset: number;
        status?: string;
    }): Promise<{
        data: import("./repository.js").ApprovalDetailRow[];
        total: number;
    }>;
    getApproval(orgId: string, userId: string, approvalId: string): Promise<import("./repository.js").ApprovalDetailRow>;
    approveApproval(orgId: string, userId: string, approvalId: string, reason?: string, meta?: RequestMeta, decisionPayload?: Record<string, unknown>): Promise<import("./repository.js").ApprovalRow>;
    rejectApproval(orgId: string, userId: string, approvalId: string, reason: string, meta?: RequestMeta, decisionPayload?: Record<string, unknown>): Promise<import("./repository.js").ApprovalRow>;
    listAudit(orgId: string, userId: string, query: {
        limit: number;
        offset: number;
        workflowId?: string;
        runId?: string;
        action?: string;
        actorUserId?: string;
    }): Promise<{
        data: import("./audit.js").AuditLogRow[];
        total: number;
    }>;
}
export {};
//# sourceMappingURL=service.d.ts.map