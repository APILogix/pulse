/**
 * Automation module — action runner with a dependency-injected handler registry.
 *
 * Design guarantees:
 *   - Handler registry keyed by action type.
 *   - Per-action timeout enforcement with timer cleanup.
 *   - Deterministic idempotency key, forwarded to every integration so external
 *     side effects are deduplicated by the provider, not just by our DB rows.
 *   - Risk validation: high/critical effective risk requires prior approval.
 *   - NO ACTION EVER SILENTLY FAKES SUCCESS. An action whose backing integration
 *     is not configured returns success:false with INTEGRATION_NOT_CONFIGURED, so
 *     the step fails visibly, the run reflects it, and the user can see why.
 *
 * This last point is the behavioural change from the previous implementation,
 * where 26 of 28 action types returned `{ success: true, skipped: true }` and a
 * workflow could report "succeeded" while doing nothing at all.
 */
import type { ActionType, AutomationActionContext, AutomationActionHandler, AutomationActionResult, AutomationIntegrations } from './types.js';
/**
 * Build a stable deterministic idempotency key for an action execution.
 * CRITICAL: Omits attempt entirely so the external key is stable across retries.
 * Format: automation:{orgId}:{workflowId}:{runId}:{stepId}
 */
export declare function buildIdempotencyKey(ctx: {
    organizationId: string;
    workflowId: string;
    runId: string;
    stepId: string;
    attempt?: number;
}): string;
/**
 * Read a step's pre-execution delay from its action config, in seconds.
 *
 * Accepts either "waitSeconds" or "waitMinutes" (minutes takes the value,
 * seconds wins if both are present). This is a REAL scheduling delay: the
 * caller (createRunWithSteps) sets the step's initial next_retry_at from this
 * value, and claimNextStep() already refuses to claim a queued step whose
 * next_retry_at is in the future — so no new claim-path logic was needed.
 *
 * Exported so both workers.ts (event/schedule-triggered runs) and service.ts
 * (manual runs) apply the same delay semantics to every action type, rather
 * than special-casing it to whichever action happened to first use the word
 * "wait" in a seeded template config.
 */
export declare function readActionWaitSeconds(config: Record<string, unknown> | null | undefined): number | undefined;
export declare class ActionRunnerRegistry {
    private handlers;
    private integrations;
    constructor(integrations?: AutomationIntegrations);
    /** Register a handler for an action type */
    register(handler: AutomationActionHandler): void;
    /** Get a registered handler (or undefined) */
    getHandler(actionType: ActionType): AutomationActionHandler | undefined;
    /** List all registered action types */
    getRegisteredTypes(): ActionType[];
    /**
     * Which action types can actually perform their side effect right now, given the
     * integrations injected into this registry. Surfaced through the API so the UI can
     * tell users an action is unavailable *before* they build a workflow around it.
     */
    getAvailability(): Array<{
        actionType: ActionType;
        available: boolean;
        requires?: string;
    }>;
    /**
     * Execute an action with full safety validation:
     *  1. Check handler exists
     *  2. Validate risk/approval (max of handler-declared and context risk)
     *  3. Apply timeout with proper cleanup
     *  4. Execute handler
     */
    execute(ctx: AutomationActionContext): Promise<AutomationActionResult>;
    private registerDefaults;
    /**
     * Shared implementation for every action whose side effect is "deliver a message
     * through one of the organization's configured connectors".
     */
    private sendNotification;
    private registerNotificationActions;
    private registerIncidentActions;
    private registerAlertingActions;
    private registerAdvisoryActions;
    private registerIntegrationDependentActions;
}
/**
 * Create an ActionRunnerRegistry with optional integrations injected.
 * Prefer createAutomationIntegrations() from ./integrations.js to build the real set.
 */
export declare function createActionRunner(integrations?: AutomationIntegrations): ActionRunnerRegistry;
//# sourceMappingURL=action-runner.d.ts.map