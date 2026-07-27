/**
 * Template Service – handles template listing, retrieval, and create-workflow-from-template.
 *
 * HARDENED (Phase 2):
 * - requireWriteAccess + checkAutomationEnabled + limit/project checks + risk/feature checks
 * - configOverrides supports trigger.config, action config keyed by actionKey (or validated array), and safety only
 * - Deep merge plain JSON with pollution keys blocked
 * - Never allows actionType/risk/requiresApproval/type/kind override
 * - Reparses final definition, reruns risk and all feature checks
 * - List/get enrich with requiredFeatureKeys, automationAvailable, entitlementUnavailable
 */
import type { AutomationRepository } from './repository.js';
import type { AutomationService } from './service.js';
import type { RequestMeta } from './types.js';
export declare class TemplateService {
    private readonly repo;
    private readonly workflowService;
    constructor(repo: AutomationRepository, workflowService: AutomationService);
    listTemplates(orgId: string, userId: string, query: {
        limit: number;
        offset: number;
        category?: string;
    }): Promise<{
        data: {
            templateKey: string;
            name: string;
            description: string | null;
            workflowType: string;
            category: string;
            minimumPlanTier: string | null;
            requiredFeatureKey: string | null;
            requiredFeatureKeys: string[];
            automationAvailable: boolean;
            entitlementUnavailable: boolean;
            unavailableReason: string | null;
            tags: string[];
            isFeatured: boolean;
            sortOrder: number;
            metadata: Record<string, unknown>;
        }[];
        total: number;
    }>;
    getTemplate(orgId: string, userId: string, templateKey: string): Promise<{
        template: import("./repository.js").TemplateRow;
        version: import("./repository.js").TemplateVersionRow | null;
        requiredFeatureKeys: string[];
        automationAvailable: boolean;
        entitlementUnavailable: boolean;
        unavailableReason: string | null;
    }>;
    createWorkflowFromTemplate(params: {
        orgId: string;
        userId: string;
        templateKey: string;
        name: string;
        description?: string;
        projectId?: string;
        configOverrides?: Record<string, unknown>;
        tags?: string[];
        metadata?: Record<string, unknown>;
        meta: RequestMeta;
    }): Promise<import("./repository.js").WorkflowRow>;
    /**
     * Apply configOverrides safely:
     * - Supports trigger.config (deep merge into trigger.config)
     * - Supports actions keyed by actionKey (deep merge into matching action's config)
     * - Supports safety (deep merge into safety)
     * - Blocks all immutable fields (actionType, riskLevel, requiresApproval, type, kind)
     * - Blocks prototype pollution keys
     */
    private applyConfigOverrides;
    /**
     * Safe deep merge: plain JSON objects only.
     * Blocks prototype pollution keys and immutable fields.
     */
    private safeDeepMerge;
    /**
     * Validate that no blocked keys appear in an override object.
     */
    private validateOverrideKeys;
}
//# sourceMappingURL=template.service.d.ts.map