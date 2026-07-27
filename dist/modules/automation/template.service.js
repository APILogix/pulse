import { TemplateDefinitionSchema } from './schemas.js';
import { collectRequiredFeatureKeys, batchCheckEntitlementsFromMap, FEATURE_KEYS, } from './entitlements.js';
import { AutomationNotFoundError, AutomationEntitlementRequiredError, AutomationValidationError, } from './errors.js';
/** Fields that configOverrides CANNOT change (immutable template properties) */
const BLOCKED_OVERRIDE_KEYS = new Set([
    'actionType', 'action_type',
    'riskLevel', 'risk_level',
    'requiresApproval', 'requires_approval',
    'triggerType', 'trigger_type',
    'triggerKind', 'trigger_kind',
    'type', 'kind',
]);
/** JSON pollution keys that MUST be blocked in deep merge */
const POLLUTION_KEYS = new Set([
    '__proto__', 'constructor', 'prototype',
    '__defineGetter__', '__defineSetter__',
    '__lookupGetter__', '__lookupSetter__',
]);
export class TemplateService {
    repo;
    workflowService;
    constructor(repo, workflowService) {
        this.repo = repo;
        this.workflowService = workflowService;
    }
    async listTemplates(orgId, userId, query) {
        await this.workflowService.requireReadAccess(orgId, userId);
        const { data, total } = await this.repo.listTemplates(orgId, query);
        // Batch entitlement lookup (one query, not N+1)
        const featureKeys = [...new Set(data.filter(t => t.requiredFeatureKey).map(t => t.requiredFeatureKey))];
        const entMap = featureKeys.length > 0
            ? await this.repo.batchCheckEntitlements(orgId, featureKeys)
            : new Map();
        const enriched = data.map((t) => {
            let isAvailable = true;
            let unavailableReason = null;
            if (t.requiredFeatureKey) {
                const has = entMap.get(t.requiredFeatureKey) ?? false;
                if (!has) {
                    isAvailable = false;
                    unavailableReason = `Requires entitlement: ${t.requiredFeatureKey}`;
                }
            }
            return {
                templateKey: t.templateKey,
                name: t.name,
                description: t.description,
                workflowType: t.workflowType,
                category: t.category,
                minimumPlanTier: t.minimumPlanTier,
                requiredFeatureKey: t.requiredFeatureKey,
                requiredFeatureKeys: t.requiredFeatureKey ? [t.requiredFeatureKey] : [],
                automationAvailable: isAvailable,
                entitlementUnavailable: !isAvailable,
                unavailableReason,
                tags: t.tags,
                isFeatured: t.isFeatured,
                sortOrder: t.sortOrder,
                metadata: t.metadata,
            };
        });
        return { data: enriched, total };
    }
    async getTemplate(orgId, userId, templateKey) {
        await this.workflowService.requireReadAccess(orgId, userId);
        const template = await this.repo.getTemplate(templateKey, orgId);
        if (!template)
            throw new AutomationNotFoundError('Template');
        const version = await this.repo.getTemplateCurrentVersion(template.id);
        // Enrich with availability metadata
        let isAvailable = true;
        let unavailableReason = null;
        if (template.requiredFeatureKey) {
            const has = await this.repo.hasEntitlement(orgId, template.requiredFeatureKey);
            if (!has) {
                isAvailable = false;
                unavailableReason = `Requires entitlement: ${template.requiredFeatureKey}`;
            }
        }
        // Collect all required feature keys from template definition
        let requiredFeatureKeys = template.requiredFeatureKey ? [template.requiredFeatureKey] : [];
        if (version?.definition) {
            const def = version.definition;
            const triggerType = def?.trigger?.type ?? 'manual.run';
            const actionTypes = (def?.actions ?? []).map(a => a.actionType ?? 'noop');
            requiredFeatureKeys = collectRequiredFeatureKeys(triggerType, actionTypes);
        }
        return {
            template,
            version,
            requiredFeatureKeys,
            automationAvailable: isAvailable,
            entitlementUnavailable: !isAvailable,
            unavailableReason,
        };
    }
    async createWorkflowFromTemplate(params) {
        const { orgId, userId, templateKey, name, meta } = params;
        // HARDENED: require write access + automation enabled + limits
        await this.workflowService.requireWriteAccess(orgId, userId);
        await this.workflowService.checkAutomationEnabled(orgId);
        await this.workflowService.checkWorkflowLimits(orgId);
        // Verify template exists
        const template = await this.repo.getTemplate(templateKey, orgId);
        if (!template)
            throw new AutomationNotFoundError('Template');
        // Check template entitlement (risk/feature check)
        if (template.requiredFeatureKey) {
            const has = await this.repo.hasEntitlement(orgId, template.requiredFeatureKey);
            if (!has)
                throw new AutomationEntitlementRequiredError(template.requiredFeatureKey);
        }
        // Fetch current version
        const tv = await this.repo.getTemplateCurrentVersion(template.id);
        if (!tv)
            throw new AutomationNotFoundError('Template version');
        // Validate definition shape
        const parsed = TemplateDefinitionSchema.safeParse(tv.definition);
        if (!parsed.success) {
            throw new AutomationValidationError('Template definition is invalid', {
                errors: parsed.error.issues,
            });
        }
        // Project ownership check
        if (params.projectId) {
            const owns = await this.repo.verifyProjectOwnership(orgId, params.projectId);
            if (!owns)
                throw new AutomationValidationError('Project does not belong to this organization');
        }
        // HARDENED: Apply configOverrides safely using deep merge with pollution blocking
        let resolvedDefinition = tv.definition;
        if (params.configOverrides && Object.keys(params.configOverrides).length > 0) {
            resolvedDefinition = this.applyConfigOverrides(JSON.parse(JSON.stringify(tv.definition)), params.configOverrides);
            // Reparse final definition after overrides
            const reparsed = TemplateDefinitionSchema.safeParse(resolvedDefinition);
            if (!reparsed.success) {
                throw new AutomationValidationError('Definition invalid after applying configOverrides', {
                    errors: reparsed.error.issues,
                });
            }
        }
        // Rerun risk validation on final resolved definition
        const finalDef = resolvedDefinition;
        if (finalDef.actions) {
            for (const action of finalDef.actions) {
                const risk = action.riskLevel ?? 'low';
                if ((risk === 'high' || risk === 'critical') && !action.requiresApproval) {
                    throw new AutomationValidationError(`Action ${action.actionType} with risk ${risk} must require approval`);
                }
                if (action.actionType === 'webhook.call' && !action.requiresApproval) {
                    throw new AutomationValidationError('webhook.call always requires approval under server policy');
                }
            }
        }
        // Batch feature check on resolved definition
        const triggerType = finalDef.trigger?.type ?? 'manual.run';
        const actionTypes = (finalDef.actions ?? []).map(a => a.actionType ?? 'noop');
        await this.workflowService.batchCheckFeatures(orgId, triggerType, actionTypes);
        // Generate slug
        const slug = this.workflowService.generateSlug(name);
        // Create workflow from template with resolved definition
        const workflow = await this.repo.createWorkflowFromTemplate({
            orgId,
            projectId: params.projectId ?? null,
            createdBy: meta.actorUserId,
            templateId: template.id,
            name,
            slug,
            description: params.description ?? template.description ?? null,
            overriddenDefinition: resolvedDefinition,
            overrides: { tags: params.tags ?? [], metadata: params.metadata ?? {} },
            audit: {
                organizationId: orgId,
                actorUserId: meta.actorUserId,
                actorType: 'user',
                action: 'workflow.created',
                entityType: 'workflow',
                requestId: meta.requestId,
                ipAddress: meta.actorIp,
                userAgent: meta.actorUserAgent,
                metadata: { fromTemplate: templateKey },
            },
        });
        return workflow;
    }
    /**
     * Apply configOverrides safely:
     * - Supports trigger.config (deep merge into trigger.config)
     * - Supports actions keyed by actionKey (deep merge into matching action's config)
     * - Supports safety (deep merge into safety)
     * - Blocks all immutable fields (actionType, riskLevel, requiresApproval, type, kind)
     * - Blocks prototype pollution keys
     */
    applyConfigOverrides(definition, overrides) {
        // Validate top-level override keys are not blocked
        this.validateOverrideKeys(overrides);
        // Apply trigger.config overrides
        if (overrides.trigger && typeof overrides.trigger === 'object' && overrides.trigger !== null) {
            const triggerOverride = overrides.trigger;
            this.validateOverrideKeys(triggerOverride);
            const trigger = (definition.trigger ?? {});
            if (triggerOverride.config && typeof triggerOverride.config === 'object') {
                trigger.config = this.safeDeepMerge((trigger.config ?? {}), triggerOverride.config);
            }
            definition.trigger = trigger;
        }
        // Apply action config overrides keyed by actionKey
        if (overrides.actions && typeof overrides.actions === 'object' && overrides.actions !== null) {
            const actions = (definition.actions ?? []);
            if (Array.isArray(overrides.actions)) {
                // Array form: each item must have actionKey to match
                for (const override of overrides.actions) {
                    if (!override || typeof override !== 'object')
                        continue;
                    this.validateOverrideKeys(override);
                    const key = override.actionKey;
                    if (!key)
                        throw new AutomationValidationError('Each action override must specify actionKey');
                    const target = actions.find(a => a.actionKey === key);
                    if (target && override.config && typeof override.config === 'object') {
                        target.config = this.safeDeepMerge((target.config ?? {}), override.config);
                    }
                }
            }
            else {
                // Object keyed by actionKey
                const overrideMap = overrides.actions;
                for (const [actionKey, actionOverride] of Object.entries(overrideMap)) {
                    if (POLLUTION_KEYS.has(actionKey))
                        continue;
                    if (!actionOverride || typeof actionOverride !== 'object')
                        continue;
                    this.validateOverrideKeys(actionOverride);
                    const target = actions.find(a => a.actionKey === actionKey);
                    if (target) {
                        const ao = actionOverride;
                        if (ao.config && typeof ao.config === 'object') {
                            target.config = this.safeDeepMerge((target.config ?? {}), ao.config);
                        }
                    }
                }
            }
            definition.actions = actions;
        }
        // Apply safety overrides
        if (overrides.safety && typeof overrides.safety === 'object' && overrides.safety !== null) {
            const safetyOverride = overrides.safety;
            this.validateOverrideKeys(safetyOverride);
            definition.safety = this.safeDeepMerge((definition.safety ?? {}), safetyOverride);
        }
        return definition;
    }
    /**
     * Safe deep merge: plain JSON objects only.
     * Blocks prototype pollution keys and immutable fields.
     */
    safeDeepMerge(target, source) {
        const result = { ...target };
        for (const [key, value] of Object.entries(source)) {
            if (POLLUTION_KEYS.has(key))
                continue;
            if (BLOCKED_OVERRIDE_KEYS.has(key)) {
                throw new AutomationValidationError(`configOverrides cannot override immutable field: "${key}"`);
            }
            if (value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                typeof result[key] === 'object' &&
                result[key] !== null &&
                !Array.isArray(result[key])) {
                result[key] = this.safeDeepMerge(result[key], value);
            }
            else {
                result[key] = value;
            }
        }
        return result;
    }
    /**
     * Validate that no blocked keys appear in an override object.
     */
    validateOverrideKeys(obj) {
        for (const key of Object.keys(obj)) {
            if (POLLUTION_KEYS.has(key)) {
                throw new AutomationValidationError(`Prototype pollution key blocked: "${key}"`);
            }
            if (BLOCKED_OVERRIDE_KEYS.has(key)) {
                throw new AutomationValidationError(`configOverrides cannot override immutable field: "${key}". ` +
                    'actionType, riskLevel, requiresApproval, type, and kind are fixed by the template.');
            }
        }
    }
}
//# sourceMappingURL=template.service.js.map