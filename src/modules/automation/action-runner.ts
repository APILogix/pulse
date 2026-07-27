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
import type {
  ActionType,
  ActionRiskLevel,
  AutomationActionContext,
  AutomationActionHandler,
  AutomationActionResult,
  AutomationIntegrations,
} from './types.js';
import { DANGEROUS_ACTIONS } from './types.js';
import {
  AutomationApprovalRequiredError,
  AutomationActionNotSupportedError,
} from './errors.js';

// ═══════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a stable deterministic idempotency key for an action execution.
 * CRITICAL: Omits attempt entirely so the external key is stable across retries.
 * Format: automation:{orgId}:{workflowId}:{runId}:{stepId}
 */
export function buildIdempotencyKey(ctx: {
  organizationId: string;
  workflowId: string;
  runId: string;
  stepId: string;
  attempt?: number; // accepted but intentionally ignored for stability
}): string {
  return `automation:${ctx.organizationId}:${ctx.workflowId}:${ctx.runId}:${ctx.stepId}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION RUNNER REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

export class ActionRunnerRegistry {
  private handlers = new Map<ActionType, AutomationActionHandler>();
  private integrations: AutomationIntegrations;

  constructor(integrations: AutomationIntegrations = {}) {
    this.integrations = integrations;
    this.registerDefaults();
  }

  /** Register a handler for an action type */
  register(handler: AutomationActionHandler): void {
    this.handlers.set(handler.actionType, handler);
  }

  /** Get a registered handler (or undefined) */
  getHandler(actionType: ActionType): AutomationActionHandler | undefined {
    return this.handlers.get(actionType);
  }

  /** List all registered action types */
  getRegisteredTypes(): ActionType[] {
    return [...this.handlers.keys()];
  }

  /**
   * Execute an action with full safety validation:
   *  1. Check handler exists
   *  2. Validate risk/approval (compare handler-declared risk and context risk using max)
   *  3. Apply timeout with proper cleanup
   *  4. Execute handler
   */
  async execute(ctx: AutomationActionContext): Promise<AutomationActionResult> {
    const handler = this.handlers.get(ctx.actionType);
    if (!handler) {
      throw new AutomationActionNotSupportedError(ctx.actionType);
    }

    // Risk validation: use the MAX of handler-declared risk and context risk
    const RISK_HIERARCHY: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const handlerRiskLevel = RISK_HIERARCHY[handler.riskLevel] ?? 1;
    const contextRiskLevel = RISK_HIERARCHY[ctx.riskLevel] ?? 1;
    const effectiveRisk = Math.max(handlerRiskLevel, contextRiskLevel);

    if (effectiveRisk >= (RISK_HIERARCHY.high ?? 3) && !ctx.approvalGranted) {
      throw new AutomationApprovalRequiredError(ctx.actionType, ctx.riskLevel);
    }

    // Dangerous actions require approval (even if risk is medium for webhook.call)
    if (DANGEROUS_ACTIONS.has(ctx.actionType) && !ctx.approvalGranted) {
      throw new AutomationApprovalRequiredError(ctx.actionType, ctx.riskLevel);
    }

    // Execute with timeout — CLEAR timer on completion to avoid leaks
    const timeoutMs = ctx.timeoutSeconds * 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<AutomationActionResult>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Action timed out after ${ctx.timeoutSeconds}s`)),
        timeoutMs
      );
    });

    try {
      const result = await Promise.race([
        handler.execute(ctx),
        timeoutPromise,
      ]);
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFAULT HANDLER REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  private registerDefaults(): void {
    // notification.send
    this.register({
      actionType: 'notification.send',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.notificationSender) {
          const result = await this.integrations.notificationSender.send({
            organizationId: ctx.organizationId,
            channel: (ctx.config.channel as string) ?? undefined,
            message: (ctx.config.message as string) ?? `Automation notification from workflow ${ctx.workflowId}`,
            metadata: { runId: ctx.runId, stepId: ctx.stepId, actionKey: ctx.actionKey },
          });
          return {
            success: result.sent,
            output: { sent: result.sent, messageId: result.messageId ?? null },
          };
        }
        return notImplementedResult('notification.send');
      },
    });

    // approval.request
    this.register({
      actionType: 'approval.request',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.approvalRequester) {
          const result = await this.integrations.approvalRequester.requestApproval({
            organizationId: ctx.organizationId,
            workflowId: ctx.workflowId,
            runId: ctx.runId,
            stepId: ctx.stepId,
            riskLevel: ctx.riskLevel,
            actionType: ctx.actionType,
            payload: ctx.inputPayload,
          });
          return {
            success: true,
            output: { approvalId: result.approvalId, status: 'pending' },
          };
        }
        return notImplementedResult('approval.request');
      },
    });

    // connector.delivery.retry
    this.register({
      actionType: 'connector.delivery.retry',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.connectorRetrier) {
          const deliveryId = (ctx.config.deliveryId as string) ?? (ctx.inputPayload.deliveryId as string);
          if (!deliveryId) {
            return {
              success: false,
              output: { error: 'No deliveryId provided in config or payload' },
              errorCode: 'MISSING_DELIVERY_ID',
              errorMessage: 'deliveryId is required for connector.delivery.retry',
            };
          }
          const result = await this.integrations.connectorRetrier.retry({
            organizationId: ctx.organizationId,
            deliveryId,
            metadata: { runId: ctx.runId, stepId: ctx.stepId },
          });
          return {
            success: result.retried,
            output: { retried: result.retried, newDeliveryId: result.newDeliveryId ?? null },
          };
        }
        return notImplementedResult('connector.delivery.retry');
      },
    });

    // alert.silence.create
    this.register({
      actionType: 'alert.silence.create',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.alertSilenceCreator) {
          const matchers = (ctx.config.matchers as Record<string, string>) ?? {};
          const durationSeconds = (ctx.config.durationSeconds as number) ?? 3600;
          const reason = (ctx.config.reason as string) ?? `Auto-silenced by automation workflow ${ctx.workflowId}`;
          const result = await this.integrations.alertSilenceCreator.createSilence({
            organizationId: ctx.organizationId,
            matchers,
            durationSeconds,
            reason,
          });
          return {
            success: true,
            output: { silenceId: result.silenceId },
          };
        }
        return notImplementedResult('alert.silence.create');
      },
    });

    // ai.summary.generate
    this.register({
      actionType: 'ai.summary.generate',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.aiSummaryGenerator) {
          const result = await this.integrations.aiSummaryGenerator.generateSummary({
            organizationId: ctx.organizationId,
            context: ctx.inputPayload,
            type: 'summary',
          });
          return {
            success: true,
            output: { content: result.content, creditsUsed: result.creditsUsed },
          };
        }
        return notImplementedResult('ai.summary.generate');
      },
    });

    // ai.root_cause.generate
    this.register({
      actionType: 'ai.root_cause.generate',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.aiSummaryGenerator) {
          const result = await this.integrations.aiSummaryGenerator.generateSummary({
            organizationId: ctx.organizationId,
            context: ctx.inputPayload,
            type: 'root_cause',
          });
          return {
            success: true,
            output: { content: result.content, creditsUsed: result.creditsUsed },
          };
        }
        return notImplementedResult('ai.root_cause.generate');
      },
    });

    // report.export
    this.register({
      actionType: 'report.export',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.reportExporter) {
          const reportType = (ctx.config.reportType as string) ?? 'generic';
          const result = await this.integrations.reportExporter.export({
            organizationId: ctx.organizationId,
            reportType,
            config: ctx.config,
          });
          return {
            success: true,
            output: { reportId: result.reportId, url: result.url ?? null },
          };
        }
        return notImplementedResult('report.export');
      },
    });

    // rollback.recommend
    this.register({
      actionType: 'rollback.recommend',
      riskLevel: 'medium',
      execute: async (ctx) => {
        // Rollback is recommendation-only in Phase 2. Never executes destructive rollback.
        return {
          success: true,
          output: {
            recommendation: 'rollback_recommended',
            reason: (ctx.config.reason as string) ?? 'Health degradation detected',
            workflowId: ctx.workflowId,
            runId: ctx.runId,
            note: 'Phase 2: recommendation only, no destructive execution',
          },
        };
      },
    });

    // quota.notify
    this.register({
      actionType: 'quota.notify',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.notificationSender) {
          const result = await this.integrations.notificationSender.send({
            organizationId: ctx.organizationId,
            channel: 'quota',
            message: (ctx.config.message as string) ?? `Quota threshold reached for ${ctx.organizationId}`,
            metadata: { runId: ctx.runId, stepId: ctx.stepId, type: 'quota' },
          });
          return {
            success: result.sent,
            output: { sent: result.sent, messageId: result.messageId ?? null, type: 'quota_notification' },
          };
        }
        return notImplementedResult('quota.notify');
      },
    });

    // security.notify
    this.register({
      actionType: 'security.notify',
      riskLevel: 'low',
      execute: async (ctx) => {
        if (this.integrations.notificationSender) {
          const result = await this.integrations.notificationSender.send({
            organizationId: ctx.organizationId,
            channel: 'security',
            message: (ctx.config.message as string) ?? `Security event detected for ${ctx.organizationId}`,
            metadata: { runId: ctx.runId, stepId: ctx.stepId, type: 'security' },
          });
          return {
            success: result.sent,
            output: { sent: result.sent, messageId: result.messageId ?? null, type: 'security_notification' },
          };
        }
        return notImplementedResult('security.notify');
      },
    });

    // noop
    this.register({
      actionType: 'noop',
      riskLevel: 'low',
      execute: async (_ctx) => {
        return {
          success: true,
          output: { action: 'noop', note: 'No operation performed' },
        };
      },
    });

    // ── Safe explicit not_implemented handlers for all remaining actions ──
    const notImplementedActions: Array<{ type: ActionType; risk: ActionRiskLevel }> = [
      { type: 'incident.create', risk: 'medium' },
      { type: 'incident.assign_owner', risk: 'medium' },
      { type: 'incident.timeline.append', risk: 'low' },
      { type: 'incident.postmortem.generate_draft', risk: 'low' },
      { type: 'ticket.github.create', risk: 'medium' },
      { type: 'ticket.jira.create', risk: 'medium' },
      { type: 'pagerduty.trigger', risk: 'medium' },
      { type: 'runbook.open', risk: 'low' },
      { type: 'runbook.step.create', risk: 'low' },
      { type: 'status_page.update', risk: 'high' },
      { type: 'alert.severity.change', risk: 'medium' },
      { type: 'release.guard.warn', risk: 'low' },
      { type: 'release.guard.pause', risk: 'high' },
      { type: 'quota.throttle_recommend', risk: 'high' },
      { type: 'retention.archive', risk: 'medium' },
      { type: 'retention.purge_request', risk: 'critical' },
      { type: 'webhook.call', risk: 'high' },
    ];

    for (const { type, risk } of notImplementedActions) {
      this.register({
        actionType: type,
        riskLevel: risk,
        execute: async (_ctx) => notImplementedResult(type),
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Produces a safe not_implemented result that explicitly marks step as skipped.
 * Never fakes destructive behavior.
 */
function notImplementedResult(actionType: string): AutomationActionResult {
  return {
    success: true,
    skipped: true,
    output: {
      status: 'not_implemented',
      actionType,
      reason: `Integration for ${actionType} is not injected. Step skipped safely.`,
    },
  };
}

/**
 * Create an ActionRunnerRegistry with optional integrations injected.
 */
export function createActionRunner(integrations?: AutomationIntegrations): ActionRunnerRegistry {
  return new ActionRunnerRegistry(integrations ?? {});
}
