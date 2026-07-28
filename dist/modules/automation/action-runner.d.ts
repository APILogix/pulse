/**
 * Automation module – action runner with dependency-injected handler registry.
 *
 * Features:
 *   - Handler registry keyed by action type.
 *   - Per-action timeout enforcement.
 *   - Deterministic idempotency context.
 *   - Risk validation (high/critical require prior approval).
 *   - Safe initial handlers that call real integrations when injected
 *     and return explicit safe not_implemented/skipped outputs otherwise.
 *   - Never fakes destructive behavior.
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
     * Execute an action with full safety validation:
     *  1. Check handler exists
     *  2. Validate risk/approval (compare handler-declared risk and context risk using max)
     *  3. Apply timeout with proper cleanup
     *  4. Execute handler
     */
    execute(ctx: AutomationActionContext): Promise<AutomationActionResult>;
    private registerDefaults;
}
/**
 * Create an ActionRunnerRegistry with optional integrations injected.
 */
export declare function createActionRunner(integrations?: AutomationIntegrations): ActionRunnerRegistry;
//# sourceMappingURL=action-runner.d.ts.map