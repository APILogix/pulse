/**
 * Automation Service – enterprise workflow orchestration business logic.
 *
 * HARDENED (Phase 2):
 * - Batch feature checks at create/update/publish/enable/manual run/inbox run/step
 * - Reads enrich with requiredFeatureKeys, automationAvailable, entitlementUnavailable
 * - Exact billing-seed feature keys
 * - webhook.call always requires approval (server policy)
 * - SSRF validation on webhook URLs
 * - Approver active role validation at decision time
 * - configOverrides deep merge with pollution blocking
 * - Actor user-agent in audit writes
 * - Idempotency-Key header passthrough for manual run
 */
import { createHash } from 'crypto';
import { computeChecksum as computeChecksumFn } from './repository.js';
import { readActionWaitSeconds } from './action-runner.js';
import { DANGEROUS_ACTIONS, LIMITS, ACTION_TYPES } from './types.js';
import { evaluateConditions } from './evaluator.js';
import { validateWebhookUrl } from './ssrf.js';
import { collectRequiredFeatureKeys, batchCheckEntitlementsFromMap, FEATURE_KEYS, ACTION_FEATURE_MAP, } from './entitlements.js';
import { AutomationNotFoundError, AutomationValidationError, AutomationConflictError, AutomationEntitlementRequiredError, AutomationLimitExceededError, AutomationDisabledError, AutomationPayloadTooLargeError, AutomationRunNotRetryableError, AutomationIdempotencyConflictError, AutomationForbiddenError, } from './errors.js';
export class AutomationService {
    repo;
    audit;
    actionRunner;
    enqueueFn = null;
    constructor(repo, audit, actionRunner) {
        this.repo = repo;
        this.audit = audit;
        this.actionRunner = actionRunner;
    }
    setEnqueueFn(fn) { this.enqueueFn = fn; }
    // ── Role checks ─────────────────────────────────────────────────────
    /**
     * Check org membership role using hasMinRole semantics with actual org roles.
     * Viewers/members can read; only admin/owner can mutate.
     * Throws ForbiddenError (HTTP 403) on insufficient permission.
     */
    async requireRole(orgId, userId, minRole) {
        const role = await this.repo.getMemberRole(orgId, userId);
        if (!role)
            throw new AutomationForbiddenError('Not a member of this organization');
        const hierarchy = { viewer: 20, member: 40, developer: 60, billing: 50, security: 50, admin: 80, owner: 100 };
        if ((hierarchy[role] ?? 0) < (hierarchy[minRole] ?? 0)) {
            throw new AutomationForbiddenError(`Requires ${minRole} role or higher`);
        }
        return role;
    }
    async requireReadAccess(orgId, userId) {
        return this.requireRole(orgId, userId, 'viewer');
    }
    async requireWriteAccess(orgId, userId) {
        return this.requireRole(orgId, userId, 'admin');
    }
    // ── Entitlement checks ──────────────────────────────────────────────
    async checkAutomationEnabled(orgId) {
        const has = await this.repo.hasEntitlement(orgId, FEATURE_KEYS.AUTOMATION_ENABLED);
        if (!has)
            throw new AutomationEntitlementRequiredError(FEATURE_KEYS.AUTOMATION_ENABLED);
    }
    async checkWorkflowLimits(orgId) {
        const limit = await this.repo.getWorkflowLimit(orgId);
        if (limit === -1)
            return; // unlimited
        const count = await this.repo.countOrgWorkflows(orgId);
        if (count >= limit)
            throw new AutomationLimitExceededError('limit_workflows_max', count, limit);
    }
    /**
     * Batch entitlement check: one query for all required feature keys.
     * Approval flags and template-specific keys are included in the same lookup.
     */
    async batchCheckFeatures(orgId, triggerType, actionTypes, actionRequiresApproval = [], additionalKeys = []) {
        const requiredKeys = [...new Set([
                ...collectRequiredFeatureKeys(triggerType, actionTypes, { actionRequiresApproval }),
                ...additionalKeys,
            ])];
        if (requiredKeys.length === 0)
            return [];
        const entMap = await this.repo.batchCheckEntitlements(orgId, requiredKeys);
        const missing = requiredKeys.filter((key) => !entMap.get(key));
        if (missing.length > 0)
            throw new AutomationEntitlementRequiredError(missing[0]);
        return requiredKeys;
    }
    /** Get entitlement map for read-path enrichment (single query, no throw). */
    async getEntitlementMap(orgId, featureKeys) {
        const unique = [...new Set(featureKeys)];
        if (unique.length === 0)
            return new Map();
        return this.repo.batchCheckEntitlements(orgId, unique);
    }
    entitlementMetadata(requiredFeatureKeys, entitlements) {
        const missing = requiredFeatureKeys.filter((key) => !entitlements.get(key));
        return {
            requiredFeatureKeys,
            automationAvailable: missing.length === 0,
            entitlementUnavailable: missing.length > 0,
            unavailableReason: missing.length > 0 ? `Missing entitlement: ${missing.join(', ')}` : null,
        };
    }
    // ── Slug generation ─────────────────────────────────────────────────
    generateSlug(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, LIMITS.MAX_SLUG_LENGTH);
    }
    // ── Timezone validation ─────────────────────────────────────────────
    validateTimezone(tz) {
        try {
            Intl.DateTimeFormat(undefined, { timeZone: tz });
            return true;
        }
        catch {
            return false;
        }
    }
    // ── URL safety (SSRF-validated) ──────────────────────────────────────
    isUrlSafe(url) {
        const result = validateWebhookUrl(url);
        return result.safe;
    }
    // ── Checksum (canonical, excludes DB IDs/timestamps) ──────────────────────
    computeChecksum(data) {
        // Use canonical stable JSON with recursive key-sort excluding volatile DB fields
        return computeChecksumFn(data);
    }
    // ── List workflows ──────────────────────────────────────────────────
    async listWorkflows(orgId, userId, query) {
        await this.requireReadAccess(orgId, userId);
        const result = await this.repo.listWorkflows(orgId, query);
        const requirements = result.data.map((workflow) => {
            const derived = collectRequiredFeatureKeys(workflow.triggerType ?? 'manual.run', workflow.actionTypes, { actionRequiresApproval: workflow.actionRequiresApproval });
            const stored = Array.isArray(workflow.metadata?.requiredFeatureKeys)
                ? workflow.metadata.requiredFeatureKeys.filter((key) => typeof key === 'string')
                : [];
            return [...new Set([...derived, ...stored])];
        });
        const entitlements = await this.getEntitlementMap(orgId, requirements.flat());
        return {
            ...result,
            data: result.data.map((workflow, index) => ({
                ...workflow,
                ...this.entitlementMetadata(requirements[index] ?? [], entitlements),
            })),
        };
    }
    // ── Get workflow ────────────────────────────────────────────────────
    async getWorkflow(orgId, userId, workflowId) {
        await this.requireReadAccess(orgId, userId);
        const def = await this.repo.getWorkflowFullDefinition(orgId, workflowId);
        if (!def)
            throw new AutomationNotFoundError('Workflow');
        const triggerType = def.triggers[0]?.triggerType ?? 'manual.run';
        const requiredFeatureKeys = [...new Set([
                ...collectRequiredFeatureKeys(triggerType, def.actions.map((action) => action.actionType), { actionRequiresApproval: def.actions.map((action) => action.requiresApproval) }),
                ...(Array.isArray(def.workflow.metadata?.requiredFeatureKeys)
                    ? def.workflow.metadata.requiredFeatureKeys.filter((key) => typeof key === 'string')
                    : []),
            ])];
        const entitlements = await this.getEntitlementMap(orgId, requiredFeatureKeys);
        const safeTriggers = def.triggers.map(({ webhookSecretHash: _secretHash, ...trigger }) => trigger);
        return {
            ...def,
            triggers: safeTriggers,
            ...this.entitlementMetadata(requiredFeatureKeys, entitlements),
        };
    }
    // ── Create workflow ─────────────────────────────────────────────────
    async createWorkflow(orgId, userId, input, meta) {
        await this.requireWriteAccess(orgId, userId);
        await this.checkAutomationEnabled(orgId);
        await this.checkWorkflowLimits(orgId);
        // Scope validation: public API forbids platform
        if (input.scope === 'platform') {
            throw new AutomationValidationError('Platform scope is not allowed via public API');
        }
        if (input.scope === 'project' && !input.projectId) {
            throw new AutomationValidationError('Project scope requires projectId');
        }
        if (input.projectId) {
            const owns = await this.repo.verifyProjectOwnership(orgId, input.projectId);
            if (!owns)
                throw new AutomationValidationError('Project does not belong to this organization');
        }
        // Timezone validation
        const tz = input.timezone ?? 'UTC';
        if (!this.validateTimezone(tz))
            throw new AutomationValidationError(`Invalid timezone: ${tz}`);
        // Trigger timezone
        const triggerTz = input.trigger.timezone ?? 'UTC';
        if (!this.validateTimezone(triggerTz))
            throw new AutomationValidationError(`Invalid trigger timezone: ${triggerTz}`);
        // Dangerous action / approval validation
        this.validateActions(input.actions);
        // Batch feature check for trigger + all actions
        const actionTypes = input.actions.map((a) => a.actionType);
        const actionRequiresApproval = input.actions.map((a) => a.requiresApproval === true);
        const triggerType = input.trigger.triggerType ?? input.trigger.type ?? 'manual.run';
        const requiredFeatureKeys = await this.batchCheckFeatures(orgId, triggerType, actionTypes, actionRequiresApproval);
        // Slug generation
        const slug = this.generateSlug(input.name);
        const workflowMetadata = {
            ...(input.metadata ?? {}),
            safety: input.safety ?? {},
            requiredFeatureKeys,
        };
        const workflow = await this.repo.createWorkflowTransaction({
            orgId, projectId: input.projectId ?? null, createdBy: userId,
            name: input.name, slug, description: input.description ?? null,
            workflowType: input.workflowType, scope: input.scope,
            timezone: tz, tags: input.tags ?? [], metadata: workflowMetadata,
            safety: input.safety ?? {},
            trigger: input.trigger, conditions: input.conditions,
            actions: input.actions,
            audit: {
                organizationId: orgId, actorUserId: userId, actorType: 'user',
                action: 'workflow.created', entityType: 'workflow',
                requestId: meta.requestId ?? null, ipAddress: meta.actorIp ?? null,
                userAgent: meta.actorUserAgent ?? null,
            },
        });
        return workflow;
    }
    // ── Validate actions for dangerous/approval requirements ────────────
    validateActions(actions) {
        for (const a of actions) {
            // Reject unknown or retired action types at creation time, so a workflow can
            // never be saved referencing an action the runner cannot execute. Without this
            // a typo (or a removed type from an old export) would only surface as a
            // failed run much later.
            if (!ACTION_TYPES.includes(a.actionType)) {
                throw new AutomationValidationError(`Unsupported action type "${a.actionType}". Supported types: ${ACTION_TYPES.join(', ')}`);
            }
            const risk = (a.riskLevel ?? 'low');
            if ((risk === 'high' || risk === 'critical') && !a.requiresApproval) {
                throw new AutomationValidationError(`Action ${a.actionType} with risk ${risk} must require approval`);
            }
            /**
             * webhook.call is connector-referenced only.
             *
             * Previously this demanded per-run approval and SSRF-checked an inline
             * `targetUrl`. That combination was both unusable (every webhook needed a
             * human) and weaker than it looked, because the URL lived in the workflow
             * definition. Now the destination must be a `webhook` connector the org has
             * already created, so SSRF validation happens inside the connectors
             * subsystem on every send and the secret never enters workflow config.
             */
            if (a.actionType === 'webhook.call') {
                const inlineUrl = a.config?.targetUrl ?? a.config?.url ?? '';
                if (inlineUrl) {
                    throw new AutomationValidationError('webhook.call does not accept an inline URL. Create a webhook connector and ' +
                        'reference it with "connectorId" so the destination is SSRF-validated and its ' +
                        'credentials stay encrypted.');
                }
                const connectorId = a.config?.connectorId;
                const connectorType = a.config?.connectorType;
                if (!connectorId && connectorType && connectorType !== 'webhook') {
                    throw new AutomationValidationError(`webhook.call requires a webhook connector; got connectorType "${String(connectorType)}".`);
                }
            }
            if (DANGEROUS_ACTIONS.has(a.actionType) && !a.requiresApproval) {
                throw new AutomationValidationError(`Dangerous action ${a.actionType} must require approval`);
            }
        }
    }
    // ── Update workflow ─────────────────────────────────────────────────
    async updateWorkflow(orgId, userId, workflowId, input, meta) {
        await this.requireWriteAccess(orgId, userId);
        await this.checkAutomationEnabled(orgId);
        const current = await this.repo.getWorkflowFullDefinition(orgId, workflowId);
        if (!current)
            throw new AutomationNotFoundError('Workflow');
        if (input.timezone && !this.validateTimezone(input.timezone)) {
            throw new AutomationValidationError(`Invalid timezone: ${input.timezone}`);
        }
        const finalTrigger = input.trigger ?? current.triggers[0];
        const finalActions = input.actions ?? current.actions;
        this.validateActions(finalActions);
        const triggerType = finalTrigger?.triggerType ?? finalTrigger?.type ?? 'manual.run';
        const actionTypes = finalActions.map((action) => action.actionType);
        const approvalFlags = finalActions.map((action) => action.requiresApproval === true);
        const requiredFeatureKeys = await this.batchCheckFeatures(orgId, triggerType, actionTypes, approvalFlags);
        const safety = input.safety ?? current.workflow.metadata?.safety ?? {};
        const metadata = {
            ...current.workflow.metadata,
            ...(input.metadata ?? {}),
            safety,
            requiredFeatureKeys,
        };
        return this.repo.updateWorkflowDraft({
            orgId, workflowId, updatedBy: userId,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
            ...(input.tags !== undefined ? { tags: input.tags } : {}),
            metadata,
            ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
            ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
            ...(input.actions !== undefined ? { actions: input.actions } : {}),
            audit: {
                organizationId: orgId, actorUserId: userId, actorType: 'user',
                action: 'workflow.updated', entityType: 'workflow',
                requestId: meta.requestId ?? null, ipAddress: meta.actorIp ?? null,
                userAgent: meta.actorUserAgent ?? null,
            },
        });
    }
    // ── Delete workflow ─────────────────────────────────────────────────
    async deleteWorkflow(orgId, userId, workflowId, meta) {
        await this.requireWriteAccess(orgId, userId);
        const deleted = await this.repo.softDeleteWorkflow(orgId, workflowId, {
            organizationId: orgId, actorUserId: userId, actorType: 'user',
            action: 'workflow.archived', entityType: 'workflow',
            requestId: meta.requestId, ipAddress: meta.actorIp,
        });
        if (!deleted)
            throw new AutomationNotFoundError('Workflow');
    }
    // ── Enable/disable ──────────────────────────────────────────────────
    async enableWorkflow(orgId, userId, workflowId, meta) {
        await this.requireWriteAccess(orgId, userId);
        await this.checkAutomationEnabled(orgId);
        // HARDENED: Enabling requires a published version
        const version = await this.repo.getActiveVersion(workflowId);
        if (!version)
            throw new AutomationValidationError('Cannot enable workflow without a published version');
        // Batch feature check using version definition
        const def = version.definition;
        const triggerType = def?.trigger?.type ?? 'manual.run';
        const actionTypes = (def?.actions ?? []).map(a => a.actionType ?? 'noop');
        await this.batchCheckFeatures(orgId, triggerType, actionTypes);
        const wf = await this.repo.setWorkflowEnabled(orgId, workflowId, true, {
            organizationId: orgId, actorUserId: userId, actorType: 'user',
            action: 'workflow.enabled', entityType: 'workflow',
            requestId: meta.requestId, ipAddress: meta.actorIp,
            userAgent: meta.actorUserAgent,
        });
        if (!wf)
            throw new AutomationNotFoundError('Workflow');
        return wf;
    }
    async disableWorkflow(orgId, userId, workflowId, meta) {
        await this.requireWriteAccess(orgId, userId);
        const wf = await this.repo.setWorkflowEnabled(orgId, workflowId, false, {
            organizationId: orgId, actorUserId: userId, actorType: 'user',
            action: 'workflow.disabled', entityType: 'workflow',
            requestId: meta.requestId, ipAddress: meta.actorIp,
            userAgent: meta.actorUserAgent,
        });
        if (!wf)
            throw new AutomationNotFoundError('Workflow');
        return wf;
    }
    // ── Publish ─────────────────────────────────────────────────────────
    async publishWorkflow(orgId, userId, workflowId, activateOnPublish, meta) {
        await this.requireWriteAccess(orgId, userId);
        await this.checkAutomationEnabled(orgId);
        const def = await this.repo.getWorkflowFullDefinition(orgId, workflowId);
        if (!def)
            throw new AutomationNotFoundError('Workflow');
        const definition = { trigger: def.triggers[0], conditions: def.conditions, actions: def.actions };
        const checksum = this.computeChecksum(definition);
        // Immutability: check if same checksum already published
        if (def.activeVersion && def.activeVersion.checksum === checksum) {
            throw new AutomationConflictError('No changes to publish (checksum unchanged)');
        }
        // Batch feature check for the definition being published
        const triggerType = def.triggers[0]?.triggerType ?? 'manual.run';
        const actionTypes = def.actions.map(a => a.actionType);
        await this.batchCheckFeatures(orgId, triggerType, actionTypes);
        // If activateOnPublish, also validate features at enable time
        if (activateOnPublish) {
            await this.batchCheckFeatures(orgId, triggerType, actionTypes);
        }
        const version = await this.repo.publishWorkflowVersion({
            orgId, workflowId, publishedBy: userId, activateOnPublish,
            definition, triggerSummary: def.triggers,
            conditionSummary: def.conditions, actionSummary: def.actions.map(a => ({ actionKey: a.actionKey, actionType: a.actionType })),
            checksum,
            audit: {
                organizationId: orgId, actorUserId: userId, actorType: 'user',
                action: 'workflow.version_published', entityType: 'workflow_version',
                requestId: meta.requestId, ipAddress: meta.actorIp,
                userAgent: meta.actorUserAgent,
            },
        });
        return version;
    }
    // ── Manual run ──────────────────────────────────────────────────────
    async manualRun(orgId, userId, workflowId, inputPayload, meta) {
        await this.requireWriteAccess(orgId, userId);
        await this.checkAutomationEnabled(orgId);
        const def = await this.repo.getWorkflowFullDefinition(orgId, workflowId);
        if (!def)
            throw new AutomationNotFoundError('Workflow');
        if (!def.workflow.isEnabled)
            throw new AutomationDisabledError(workflowId);
        const version = def.activeVersion ?? await this.repo.getActiveVersion(workflowId);
        if (!version)
            throw new AutomationValidationError('Workflow has no published version');
        // Batch feature check using version-bound definition
        const versionDef = version.definition;
        const triggerType = versionDef?.trigger?.type ?? 'manual.run';
        const versionActionTypes = (versionDef?.actions ?? []).map(a => a.actionType ?? 'noop');
        await this.batchCheckFeatures(orgId, triggerType, versionActionTypes);
        // Use version-bound actions (pinned), never mutable draft actions
        const versionActionsR = await this.repo.getVersionActions(workflowId, version.id);
        const actions = versionActionsR.length > 0 ? versionActionsR : def.actions;
        // Deterministic idempotency key: accepts Idempotency-Key header or generates one
        const idempotencyKey = meta.idempotencyKey
            ?? `automation:${orgId}:${workflowId}:manual.run:${userId}:${Date.now()}`;
        const steps = actions.filter(a => a.isEnabled).map((a, i) => ({
            actionId: a.id, stepKey: a.actionKey, actionType: a.actionType,
            sortOrder: i, maxAttempts: a.maxAttempts, requiresApproval: a.requiresApproval,
            timeoutSeconds: a.timeoutSeconds, retryBackoffSeconds: a.retryBackoffSeconds,
            riskLevel: a.riskLevel, config: a.config,
            requiredFeatureKey: ACTION_FEATURE_MAP[a.actionType] ?? null,
            idempotencyKey: `${idempotencyKey}:step:${a.actionKey}`,
            inputPayload,
            initialDelaySeconds: readActionWaitSeconds(a.config),
            metadata: {
                riskLevel: a.riskLevel ?? 'low',
                config: a.config ?? {},
                timeoutSeconds: a.timeoutSeconds ?? 60,
                retryBackoffSeconds: a.retryBackoffSeconds ?? 30,
                requiredFeatureKey: ACTION_FEATURE_MAP[a.actionType] ?? null,
            },
        }));
        const { run, steps: createdSteps } = await this.repo.createRunWithSteps({
            organizationId: orgId, projectId: def.workflow.projectId,
            workflowId, workflowVersionId: version.id,
            triggerType: 'manual.run', sourceModule: 'automation',
            idempotencyKey, maxAttempts: 1, inputPayload, steps,
        });
        // Always audit run.queued with actor userAgent
        await this.repo.insertAuditLog({
            organizationId: orgId, workflowId, runId: run.id,
            actorUserId: userId, actorType: 'user', action: 'run.queued', entityType: 'run',
            entityId: run.id, requestId: meta.requestId, ipAddress: meta.actorIp,
            userAgent: meta.actorUserAgent,
            metadata: { manual: true, idempotencyKey },
        });
        // Try to enqueue for durable execution
        if (this.enqueueFn) {
            try {
                await this.enqueueFn({ type: 'automation.run.execute', payload: { runId: run.id, orgId } });
            }
            catch {
                // DB is source of truth, enqueue failure logged above in audit
            }
        }
        return { run, steps: createdSteps };
    }
    // ── Test workflow (dry run) ─────────────────────────────────────────
    async testWorkflow(orgId, userId, workflowId, simulatedPayload, dryRun, meta) {
        await this.requireWriteAccess(orgId, userId);
        const def = await this.repo.getWorkflowFullDefinition(orgId, workflowId);
        if (!def)
            throw new AutomationNotFoundError('Workflow');
        // Use version-bound conditions/actions if published version exists (never mutable draft for run/test)
        let conditions;
        if (def.activeVersion) {
            const versionConditions = await this.repo.getVersionConditions(workflowId, def.activeVersion.id);
            conditions = versionConditions.map(c => ({
                conditionGroup: c.conditionGroup, sortOrder: c.sortOrder,
                leftPath: c.leftPath, operator: c.operator,
                rightValue: c.rightValue, isRequired: c.isRequired,
            }));
        }
        else {
            conditions = def.conditions.map(c => ({
                conditionGroup: c.conditionGroup, sortOrder: c.sortOrder,
                leftPath: c.leftPath, operator: c.operator,
                rightValue: c.rightValue, isRequired: c.isRequired,
            }));
        }
        const evalResult = evaluateConditions(simulatedPayload, conditions);
        if (dryRun)
            return { matched: evalResult.matched, conditionResults: evalResult.conditionResults, dryRun: true };
        // Non-dry test: actually create a run
        return this.manualRun(orgId, userId, workflowId, simulatedPayload, meta);
    }
    // ── Ingest event ────────────────────────────────────────────────────
    async ingestEvent(orgId, userId, input, meta) {
        await this.requireReadAccess(orgId, userId);
        // HARDENED: Check module entitlement before accepting events
        await this.checkAutomationEnabled(orgId);
        // Payload size check using Buffer.byteLength
        const payloadSize = Buffer.byteLength(JSON.stringify(input.payload), 'utf8');
        if (payloadSize > LIMITS.MAX_PAYLOAD_SIZE_BYTES) {
            throw new AutomationPayloadTooLargeError(payloadSize, LIMITS.MAX_PAYLOAD_SIZE_BYTES);
        }
        // HARDENED: Verify project org ownership if projectId provided
        if (input.projectId) {
            const owns = await this.repo.verifyProjectOwnership(orgId, input.projectId);
            if (!owns)
                throw new AutomationValidationError('Project does not belong to this organization');
        }
        const result = await this.repo.insertInboxEvent({
            organizationId: orgId, projectId: input.projectId ?? null,
            sourceModule: input.sourceModule, eventType: input.eventType,
            sourceEventId: input.sourceEventId ?? null, dedupeKey: input.dedupeKey,
            payload: input.payload, headers: input.headers ?? {}, metadata: input.metadata ?? {},
        });
        // Determine if this was a new insertion or existing duplicate
        const isNew = result.created;
        const duplicate = !isNew;
        // HARDENED: Audit every receipt (new or duplicate) with actor userAgent
        await this.audit.insertAuditLog({
            organizationId: orgId, actorUserId: userId, actorType: 'user',
            action: 'trigger.received', entityType: 'inbox_event',
            entityId: result.event.id, requestId: meta.requestId, ipAddress: meta.actorIp,
            userAgent: meta.actorUserAgent,
            metadata: { sourceModule: input.sourceModule, eventType: input.eventType, duplicate, created: isNew },
        });
        // HARDENED: Enqueue inbox processing ONLY for newly created events
        if (isNew && this.enqueueFn) {
            try {
                await this.enqueueFn({ type: 'automation.inbox.process', payload: { eventId: result.event.id, orgId } });
            }
            catch {
                // DB is source of truth; scheduled sweep will pick it up
            }
        }
        return { event: result.event, created: isNew, duplicate };
    }
    // ── Runs ────────────────────────────────────────────────────────────
    async listRuns(orgId, userId, query) {
        await this.requireReadAccess(orgId, userId);
        return this.repo.listRuns(orgId, query);
    }
    async getRun(orgId, userId, runId) {
        await this.requireReadAccess(orgId, userId);
        const run = await this.repo.getRun(orgId, runId);
        if (!run)
            throw new AutomationNotFoundError('Run');
        return run;
    }
    async getRunSteps(orgId, userId, runId) {
        await this.requireReadAccess(orgId, userId);
        return this.repo.listRunSteps(runId, orgId);
    }
    async cancelRun(orgId, userId, runId, meta) {
        await this.requireWriteAccess(orgId, userId);
        const run = await this.repo.cancelRun(orgId, runId);
        if (!run)
            throw new AutomationNotFoundError('Run');
        await this.repo.insertAuditLog({
            organizationId: orgId, runId: run.id, workflowId: run.workflowId,
            actorUserId: userId, action: 'run.cancelled', entityType: 'run',
            entityId: run.id, requestId: meta.requestId, ipAddress: meta.actorIp,
            userAgent: meta.actorUserAgent,
            metadata: { reason: meta.reason ?? null },
        });
        return run;
    }
    async retryRun(orgId, userId, runId, meta) {
        await this.requireWriteAccess(orgId, userId);
        const existing = await this.repo.getRun(orgId, runId);
        if (!existing)
            throw new AutomationNotFoundError('Run');
        if (!['failed', 'cancelled', 'timed_out'].includes(existing.status)) {
            throw new AutomationRunNotRetryableError(runId, `Current status: ${existing.status}`);
        }
        // Respect retry budget: API retry counts against maxAttempts
        if (existing.attempt >= existing.maxAttempts) {
            throw new AutomationRunNotRetryableError(runId, 'Max attempts reached');
        }
        const run = await this.repo.retryRun(orgId, runId, meta.fromStep);
        if (!run)
            throw new AutomationRunNotRetryableError(runId, 'Retry failed');
        await this.repo.insertAuditLog({
            organizationId: orgId, runId: run.id, workflowId: run.workflowId,
            actorUserId: userId, action: 'run.queued', entityType: 'run',
            entityId: run.id, requestId: meta.requestId, ipAddress: meta.actorIp,
            userAgent: meta.actorUserAgent,
            metadata: { retry: true, attempt: run.attempt, fromStep: meta.fromStep ?? null },
        });
        // Enqueue execution for the retried run
        if (this.enqueueFn) {
            try {
                await this.enqueueFn({ type: 'automation.run.execute', payload: { runId: run.id, orgId } });
            }
            catch {
                // DB is source of truth
            }
        }
        return run;
    }
    // ── Workflow runs (scoped to workflow) ──────────────────────────────
    async listWorkflowRuns(orgId, userId, workflowId, query) {
        await this.requireReadAccess(orgId, userId);
        return this.repo.listRuns(orgId, { ...query, workflowId });
    }
    // ── Approvals ───────────────────────────────────────────────────────
    async listApprovals(orgId, userId, query) {
        await this.requireReadAccess(orgId, userId);
        return this.repo.listApprovals(orgId, query);
    }
    async getApproval(orgId, userId, approvalId) {
        await this.requireReadAccess(orgId, userId);
        const approval = await this.repo.getApproval(orgId, approvalId);
        if (!approval)
            throw new AutomationNotFoundError('Approval');
        return approval;
    }
    async approveApproval(orgId, userId, approvalId, reason, meta, decisionPayload) {
        // HARDENED: Validate approver is still active admin/owner at decision time
        const role = await this.requireWriteAccess(orgId, userId);
        const result = await this.repo.approveApproval(orgId, approvalId, userId, reason, decisionPayload);
        await this.repo.insertAuditLog({
            organizationId: orgId, approvalId: result.id, workflowId: result.workflowId,
            runId: result.runId, actorUserId: userId, action: 'approval.approved',
            entityType: 'approval', entityId: result.id,
            requestId: meta?.requestId ?? null, ipAddress: meta?.actorIp ?? null,
            userAgent: meta?.actorUserAgent ?? null,
        });
        // HARDENED: Enqueue execute resume immediately after approval (DB is source of truth)
        if (this.enqueueFn && result.runId) {
            try {
                await this.enqueueFn({ type: 'automation.run.execute', payload: { runId: result.runId, orgId } });
            }
            catch {
                // DB is source of truth — maintenance sweep will recover
            }
        }
        return result;
    }
    async rejectApproval(orgId, userId, approvalId, reason, meta, decisionPayload) {
        // HARDENED: Validate approver is still active admin/owner at decision time
        await this.requireWriteAccess(orgId, userId);
        const result = await this.repo.rejectApproval(orgId, approvalId, userId, reason, decisionPayload);
        await this.repo.insertAuditLog({
            organizationId: orgId, approvalId: result.id, workflowId: result.workflowId,
            runId: result.runId, actorUserId: userId, action: 'approval.rejected',
            entityType: 'approval', entityId: result.id,
            requestId: meta?.requestId ?? null, ipAddress: meta?.actorIp ?? null,
            userAgent: meta?.actorUserAgent ?? null,
        });
        return result;
    }
    // ── Audit ───────────────────────────────────────────────────────────
    async listAudit(orgId, userId, query) {
        await this.requireWriteAccess(orgId, userId);
        return this.audit.listAuditLogs(orgId, query);
    }
}
//# sourceMappingURL=service.js.map