/**
 * Unit tests for the automation action runner.
 *
 * Tests: handler registry, per-action timeout, deterministic idempotency,
 * risk validation, safe handlers with and without injected integrations,
 * not_implemented skipping, no fake destructive behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ActionRunnerRegistry,
  createActionRunner,
  buildIdempotencyKey,
  readActionWaitSeconds,
} from '../../src/modules/automation/action-runner.js';
import type {
  AutomationActionContext,
  AutomationIntegrations,
  ActionType,
} from '../../src/modules/automation/types.js';
import {
  AutomationApprovalRequiredError,
  AutomationActionNotSupportedError,
} from '../../src/modules/automation/errors.js';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function makeContext(overrides: Partial<AutomationActionContext> = {}): AutomationActionContext {
  return {
    runId: 'run-001',
    stepId: 'step-001',
    organizationId: 'org-001',
    projectId: null,
    workflowId: 'wf-001',
    actionType: 'noop',
    actionKey: 'test_action',
    config: {},
    inputPayload: {},
    idempotencyKey: 'automation:org-001:wf-001:run-001:step-001:1',
    attempt: 1,
    maxAttempts: 3,
    timeoutSeconds: 60,
    riskLevel: 'low',
    approvalGranted: false,
    metadata: {},
    ...overrides,
  };
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// buildIdempotencyKey
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('buildIdempotencyKey', () => {
  it('produces deterministic format', () => {
    const key = buildIdempotencyKey({
      organizationId: 'org-123',
      workflowId: 'wf-456',
      runId: 'run-789',
      stepId: 'step-abc',
      attempt: 2,
    });
    // HARDENED: key is stable and OMITS attempt
    expect(key).toBe('automation:org-123:wf-456:run-789:step-abc');
  });

  it('is deterministic (same inputs â†’ same output)', () => {
    const params = {
      organizationId: 'org-1',
      workflowId: 'wf-1',
      runId: 'run-1',
      stepId: 'step-1',
      attempt: 1,
    };
    expect(buildIdempotencyKey(params)).toBe(buildIdempotencyKey(params));
  });

  it('is stable across different attempt numbers', () => {
    // HARDENED: key must NOT change with attempt â€” this is the stability fix
    const base = { organizationId: 'o', workflowId: 'w', runId: 'r', stepId: 's', attempt: 1 };
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base, attempt: 2 }));
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ActionRunnerRegistry - registration and lookup
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ActionRunnerRegistry: registration', () => {
  let registry: ActionRunnerRegistry;

  beforeEach(() => {
    registry = createActionRunner();
  });

  it('registers default handlers on creation', () => {
    const types = registry.getRegisteredTypes();
    expect(types).toContain('noop');
    expect(types).toContain('notification.send');
    expect(types).toContain('approval.request');
    expect(types).toContain('connector.delivery.retry');
    expect(types).toContain('alert.silence.create');
    expect(types).toContain('ai.summary.generate');
    expect(types).toContain('ai.root_cause.generate');
    expect(types).toContain('report.export');
    expect(types).toContain('rollback.recommend');
    expect(types).toContain('quota.notify');
    expect(types).toContain('security.notify');
  });

  it('allows registering custom handlers', () => {
    registry.register({
      actionType: 'incident.create',
      riskLevel: 'medium',
      execute: async () => ({ success: true, output: { incidentId: '123' } }),
    });
    expect(registry.getHandler('incident.create')).toBeDefined();
    expect(registry.getRegisteredTypes()).toContain('incident.create');
  });

  it('getHandler returns undefined for unregistered types', () => {
    expect(registry.getHandler('completely.unknown.action' as any)).toBeUndefined();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ActionRunnerRegistry - execution and risk validation
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ActionRunnerRegistry: execution', () => {
  let registry: ActionRunnerRegistry;

  beforeEach(() => {
    registry = createActionRunner();
  });

  it('executes noop successfully', async () => {
    const ctx = makeContext({ actionType: 'noop' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.action).toBe('noop');
  });

  it('throws AutomationActionNotSupportedError for unregistered action', async () => {
    const ctx = makeContext({ actionType: 'completely.unknown.action' as ActionType });
    await expect(registry.execute(ctx)).rejects.toThrow(AutomationActionNotSupportedError);
  });

  it('throws AutomationApprovalRequiredError for high risk without approval', async () => {
    registry.register({
      actionType: 'release.guard.pause',
      riskLevel: 'high',
      execute: async () => ({ success: true, output: {} }),
    });
    const ctx = makeContext({
      actionType: 'release.guard.pause',
      riskLevel: 'high',
      approvalGranted: false,
    });
    await expect(registry.execute(ctx)).rejects.toThrow(AutomationApprovalRequiredError);
  });

  it('throws AutomationApprovalRequiredError for critical risk without approval', async () => {
    registry.register({
      actionType: 'retention.purge_request',
      riskLevel: 'critical',
      execute: async () => ({ success: true, output: {} }),
    });
    const ctx = makeContext({
      actionType: 'retention.purge_request',
      riskLevel: 'critical',
      approvalGranted: false,
    });
    await expect(registry.execute(ctx)).rejects.toThrow(AutomationApprovalRequiredError);
  });

  it('executes high-risk action when approval is granted', async () => {
    registry.register({
      actionType: 'release.guard.pause',
      riskLevel: 'high',
      execute: async () => ({ success: true, output: { paused: true } }),
    });
    const ctx = makeContext({
      actionType: 'release.guard.pause',
      riskLevel: 'high',
      approvalGranted: true,
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.paused).toBe(true);
  });

  /**
   * webhook.call is intentionally no longer in DANGEROUS_ACTIONS. It is now
   * connector-referenced only, so its destination is pre-validated infrastructure
   * rather than an arbitrary URL from the workflow author. Per-run approval added
   * friction without adding safety. Safety is instead enforced by rejecting inline
   * URLs outright (covered in the config-validation tests below).
   */
  it('webhook.call no longer demands per-run approval (connector-scoped destination)', async () => {
    registry.register({
      actionType: 'webhook.call',
      riskLevel: 'medium',
      execute: async () => ({ success: true, output: { delivered: true } }),
    });
    const ctx = makeContext({
      actionType: 'webhook.call',
      riskLevel: 'medium',
      approvalGranted: false,
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
  });

  it('still requires approval for any action whose declared risk is high', async () => {
    // The approval gate itself must remain fully wired: marking an action high-risk
    // (e.g. via automation_actions.risk_level) re-engages it immediately.
    registry.register({
      actionType: 'incident.assign_owner',
      riskLevel: 'high',
      execute: async () => ({ success: true, output: { assigned: true } }),
    });
    const ctx = makeContext({
      actionType: 'incident.assign_owner',
      riskLevel: 'high',
      approvalGranted: false,
    });
    await expect(registry.execute(ctx)).rejects.toThrow(AutomationApprovalRequiredError);
  });

  it('high-risk action with approval proceeds', async () => {
    registry.register({
      actionType: 'incident.assign_owner',
      riskLevel: 'high',
      execute: async () => ({ success: true, output: { assigned: true } }),
    });
    const ctx = makeContext({
      actionType: 'incident.assign_owner',
      riskLevel: 'high',
      approvalGranted: true,
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ActionRunnerRegistry - timeout enforcement
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

describe('ActionRunnerRegistry: timeout', () => {
  it('times out slow actions', async () => {
    const registry = createActionRunner();
    registry.register({
      actionType: 'incident.create',
      riskLevel: 'low',
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { success: true, output: {} };
      },
    });
    const ctx = makeContext({
      actionType: 'incident.create',
      timeoutSeconds: 0.05, // 50ms timeout
    });
    await expect(registry.execute(ctx)).rejects.toThrow(/timed out/);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ActionRunnerRegistry - not_implemented (no integrations injected)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/**
 * CONTRACT CHANGE (deliberate): when an action's backing integration is missing it
 * must FAIL, not report a skipped success.
 *
 * The previous contract returned { success: true, skipped: true } for 26 of 28
 * action types, which let a workflow finish as "succeeded" while performing no
 * side effect whatsoever. These tests now assert the opposite, because a silent
 * false success is worse for the operator than a visible failure.
 */
describe('ActionRunnerRegistry: fails explicitly without integrations', () => {
  let registry: ActionRunnerRegistry;

  beforeEach(() => {
    registry = createActionRunner({}); // No integrations
  });

  const integrationBackedActions: Array<{ actionType: ActionType; requires: string }> = [
    { actionType: 'notification.send', requires: 'notificationSender' },
    { actionType: 'quota.notify', requires: 'notificationSender' },
    { actionType: 'security.notify', requires: 'notificationSender' },
    { actionType: 'pagerduty.trigger', requires: 'notificationSender' },
    { actionType: 'connector.delivery.retry', requires: 'connectorRetrier' },
    { actionType: 'alert.silence.create', requires: 'alertSilenceCreator' },
    { actionType: 'incident.create', requires: 'incidentManager' },
    { actionType: 'approval.request', requires: 'approvalRequester' },
    { actionType: 'ai.summary.generate', requires: 'aiSummaryGenerator' },
    { actionType: 'ai.root_cause.generate', requires: 'aiSummaryGenerator' },
    { actionType: 'incident.postmortem.generate_draft', requires: 'aiSummaryGenerator' },
    { actionType: 'report.export', requires: 'reportExporter' },
    { actionType: 'ticket.github.create', requires: 'ticketCreator' },
    { actionType: 'ticket.jira.create', requires: 'ticketCreator' },
  ];

  for (const { actionType, requires } of integrationBackedActions) {
    it(`${actionType} fails with INTEGRATION_NOT_CONFIGURED, never a fake success`, async () => {
      const ctx = makeContext({ actionType });
      const result = await registry.execute(ctx);
      expect(result.success).toBe(false);
      expect(result.skipped).toBeFalsy();
      expect(result.errorCode).toBe('INTEGRATION_NOT_CONFIGURED');
      expect(result.output.status).toBe('integration_not_configured');
      expect(result.output.requiredIntegration).toBe(requires);
      // The message must name the action so an operator can act on it.
      expect(result.errorMessage).toContain(actionType);
    });
  }

  it('no action type anywhere reports the old skipped-success shape', async () => {
    for (const actionType of registry.getRegisteredTypes()) {
      const result = await registry.execute(
        makeContext({ actionType, approvalGranted: true }),
      );
      // The exact combination that made the old implementation dishonest.
      const isFakeSuccess = result.success === true && result.skipped === true;
      expect(isFakeSuccess, `${actionType} returned a fake skipped-success`).toBe(false);
    }
  });

  it('getAvailability reports unavailable actions so the UI can warn up front', () => {
    const availability = registry.getAvailability();
    const notification = availability.find((a) => a.actionType === 'notification.send');
    expect(notification).toEqual({
      actionType: 'notification.send',
      available: false,
      requires: 'notificationSender',
    });
    // noop needs nothing and is always available.
    expect(availability.find((a) => a.actionType === 'noop')).toEqual({
      actionType: 'noop',
      available: true,
    });
  });

  it('noop succeeds with no integrations (genuinely does nothing)', async () => {
    const result = await registry.execute(makeContext({ actionType: 'noop' }));
    expect(result.success).toBe(true);
    expect(result.skipped).toBeFalsy();
  });

  it('rollback.recommend succeeds and is honest about being advisory only', async () => {
    const ctx = makeContext({ actionType: 'rollback.recommend', approvalGranted: true });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBeFalsy();
    expect(result.output.recommendation).toBe('rollback_recommended');
    expect(result.output.advisoryOnly).toBe(true);
    expect(String(result.output.note)).toContain('never executes a rollback');
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ActionRunnerRegistry - with injected integrations
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•


describe('ActionRunnerRegistry: with integrations', () => {
  /** Minimal fake matching the current NotificationSender contract. */
  function fakeSender(overrides: Record<string, unknown> = {}) {
    return {
      send: vi.fn().mockResolvedValue({
        sent: true,
        deliveryId: 'del-abc',
        connectorId: 'con-abc',
        connectorType: 'slack',
        status: 'sent',
        deduplicated: false,
        ...overrides,
      }),
    };
  }

  it('notification.send delivers through the sender and returns delivery identity', async () => {
    const mockSender = fakeSender();
    const registry = createActionRunner({ notificationSender: mockSender });
    const ctx = makeContext({
      actionType: 'notification.send',
      config: { connectorType: 'slack', title: 'Heads up', body: 'Test alert' },
    });
    const result = await registry.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.skipped).toBeFalsy();
    expect(result.output.sent).toBe(true);
    expect(result.output.deliveryId).toBe('del-abc');
    expect(result.output.connectorType).toBe('slack');
    expect(mockSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-001',
        notificationType: 'automation.notification',
        title: 'Heads up',
        body: 'Test alert',
        target: expect.objectContaining({ connectorType: 'slack' }),
      }),
    );
  });

  /**
   * The whole point of the idempotency key is that it reaches the provider. Before
   * this change it was computed and then dropped, so a redelivered job could send
   * the same notification twice.
   */
  it('forwards the stable idempotency key to the integration', async () => {
    const mockSender = fakeSender();
    const registry = createActionRunner({ notificationSender: mockSender });
    const ctx = makeContext({ actionType: 'notification.send' });
    await registry.execute(ctx);
    expect(mockSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: ctx.idempotencyKey }),
    );
  });

  it('treats a provider-deduplicated delivery as success, not failure', async () => {
    const mockSender = fakeSender({ sent: true, status: 'suppressed', deduplicated: true });
    const registry = createActionRunner({ notificationSender: mockSender });
    const result = await registry.execute(makeContext({ actionType: 'notification.send' }));
    expect(result.success).toBe(true);
    expect(result.output.deduplicated).toBe(true);
  });

  it('surfaces a failed delivery as a step failure', async () => {
    const mockSender = fakeSender({ sent: false, status: 'failed', deduplicated: false });
    const registry = createActionRunner({ notificationSender: mockSender });
    const result = await registry.execute(makeContext({ actionType: 'notification.send' }));
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DELIVERY_FAILED');
  });

  it('converts an integration exception into a failed step, never a crash', async () => {
    const mockSender = {
      send: vi.fn().mockRejectedValue(new Error('no active slack connector')),
    };
    const registry = createActionRunner({ notificationSender: mockSender });
    const result = await registry.execute(makeContext({ actionType: 'notification.send' }));
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DELIVERY_ERROR');
    expect(result.errorMessage).toContain('no active slack connector');
  });

  it('quota.notify and security.notify use distinct notification types', async () => {
    const mockSender = fakeSender();
    const registry = createActionRunner({ notificationSender: mockSender });

    await registry.execute(makeContext({ actionType: 'quota.notify' }));
    expect(mockSender.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ notificationType: 'automation.quota', severity: 'warning' }),
    );

    await registry.execute(makeContext({ actionType: 'security.notify' }));
    expect(mockSender.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ notificationType: 'automation.security', severity: 'critical' }),
    );
  });

  // ── webhook.call: connector-scoped only ──────────────────────────────────────

  it('webhook.call rejects an inline url instead of calling an arbitrary host', async () => {
    const mockSender = fakeSender();
    const registry = createActionRunner({ notificationSender: mockSender });
    const ctx = makeContext({
      actionType: 'webhook.call',
      config: { url: 'http://169.254.169.254/latest/meta-data/' },
    });
    const result = await registry.execute(ctx);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_ACTION_CONFIG');
    expect(result.errorMessage).toContain('inline "url" is not supported');
    // Critically, nothing was dispatched anywhere.
    expect(mockSender.send).not.toHaveBeenCalled();
  });

  it('webhook.call pins delivery to a webhook connector', async () => {
    const mockSender = fakeSender({ connectorType: 'webhook' });
    const registry = createActionRunner({ notificationSender: mockSender });
    await registry.execute(makeContext({ actionType: 'webhook.call', config: {} }));
    expect(mockSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.objectContaining({ connectorType: 'webhook' }) }),
    );
  });

  it('webhook.call refuses to be redirected to a different transport', async () => {
    const mockSender = fakeSender();
    const registry = createActionRunner({ notificationSender: mockSender });
    const result = await registry.execute(
      makeContext({ actionType: 'webhook.call', config: { connectorType: 'email' } }),
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_ACTION_CONFIG');
    expect(mockSender.send).not.toHaveBeenCalled();
  });

  it('pagerduty.trigger pins delivery to a pagerduty connector', async () => {
    const mockSender = fakeSender({ connectorType: 'pagerduty' });
    const registry = createActionRunner({ notificationSender: mockSender });
    await registry.execute(makeContext({ actionType: 'pagerduty.trigger' }));
    expect(mockSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ connectorType: 'pagerduty' }),
        // PagerDuty natively honours dedupKey, so the stable key matters most here.
        idempotencyKey: expect.stringContaining('automation:'),
      }),
    );
  });

  // ── connector.delivery.retry ────────────────────────────────────────────────

  it('connector.delivery.retry passes the deliveryId through', async () => {
    const mockRetrier = {
      retry: vi.fn().mockResolvedValue({ retried: true, status: 'retrying' }),
    };
    const registry = createActionRunner({ connectorRetrier: mockRetrier });
    const result = await registry.execute(
      makeContext({ actionType: 'connector.delivery.retry', config: { deliveryId: 'del-123' } }),
    );
    expect(result.success).toBe(true);
    expect(result.output.retried).toBe(true);
    expect(mockRetrier.retry).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'del-123' }),
    );
  });

  it('connector.delivery.retry fails with a clear config error when deliveryId is absent', async () => {
    const mockRetrier = { retry: vi.fn() };
    const registry = createActionRunner({ connectorRetrier: mockRetrier });
    const result = await registry.execute(
      makeContext({ actionType: 'connector.delivery.retry', config: {}, inputPayload: {} }),
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_ACTION_CONFIG');
    expect(mockRetrier.retry).not.toHaveBeenCalled();
  });

  it('connector.delivery.retry reports a non-retryable delivery as failure', async () => {
    const mockRetrier = {
      retry: vi.fn().mockResolvedValue({ retried: false, status: 'already_sent' }),
    };
    const registry = createActionRunner({ connectorRetrier: mockRetrier });
    const result = await registry.execute(
      makeContext({ actionType: 'connector.delivery.retry', config: { deliveryId: 'del-9' } }),
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('RETRY_REJECTED');
  });

  // ── alert.silence.create ───────────────────────────────────────────────────

  it('alert.silence.create passes matchers, duration and workflow attribution', async () => {
    const mockCreator = {
      createSilence: vi.fn().mockResolvedValue({
        silenceId: 'sil-789',
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2026-01-01T00:30:00.000Z',
      }),
    };
    const registry = createActionRunner({ alertSilenceCreator: mockCreator });
    const result = await registry.execute(
      makeContext({
        actionType: 'alert.silence.create',
        config: { matchers: { service: 'api' }, durationSeconds: 1800, reason: 'Maintenance' },
      }),
    );
    expect(result.success).toBe(true);
    expect(result.output.silenceId).toBe('sil-789');
    expect(mockCreator.createSilence).toHaveBeenCalledWith(
      expect.objectContaining({
        matchers: { service: 'api' },
        durationSeconds: 1800,
        reason: 'Maintenance',
        // Needed so the silence is attributed to the workflow's owning user.
        workflowId: 'wf-001',
      }),
    );
  });

  it('alert.silence.create rejects an out-of-range duration', async () => {
    const mockCreator = { createSilence: vi.fn() };
    const registry = createActionRunner({ alertSilenceCreator: mockCreator });
    const result = await registry.execute(
      makeContext({ actionType: 'alert.silence.create', config: { durationSeconds: -5 } }),
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_ACTION_CONFIG');
    expect(mockCreator.createSilence).not.toHaveBeenCalled();
  });

  // Regression test for a found-in-production-readiness-review dead config key:
  // the seeded deduplicate-noisy-alerts template sets "durationMinutes", which
  // this handler previously never read at all (silently ignored, "worked" only
  // because 60 minutes happened to equal the 3600s default).
  it('alert.silence.create accepts "durationMinutes" as a fallback for "durationSeconds"', async () => {
    const mockCreator = {
      createSilence: vi.fn().mockResolvedValue({
        silenceId: 'sil-minutes', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T01:00:00.000Z',
      }),
    };
    const registry = createActionRunner({ alertSilenceCreator: mockCreator });
    const result = await registry.execute(
      makeContext({ actionType: 'alert.silence.create', config: { durationMinutes: 60 } }),
    );
    expect(result.success).toBe(true);
    expect(mockCreator.createSilence).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 3600 }),
    );
  });

  it('alert.silence.create prefers "durationSeconds" over "durationMinutes" when both are present', async () => {
    const mockCreator = {
      createSilence: vi.fn().mockResolvedValue({
        silenceId: 'sil-both', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-01T00:10:00.000Z',
      }),
    };
    const registry = createActionRunner({ alertSilenceCreator: mockCreator });
    await registry.execute(
      makeContext({ actionType: 'alert.silence.create', config: { durationSeconds: 600, durationMinutes: 60 } }),
    );
    expect(mockCreator.createSilence).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 600 }),
    );
  });

  // ── incidents ──────────────────────────────────────────────────────────────

  it('incident.create reports a reused incident as success with reusedExisting', async () => {
    const mockIncidents = {
      createIncident: vi.fn().mockResolvedValue({
        incidentId: 'inc-1',
        created: false,
        status: 'open',
      }),
      appendTimelineEvent: vi.fn(),
      assignOwner: vi.fn(),
    };
    const registry = createActionRunner({ incidentManager: mockIncidents });
    const result = await registry.execute(
      makeContext({ actionType: 'incident.create', config: { title: 'API down' } }),
    );
    // Deduplication is correct behaviour, not a failure.
    expect(result.success).toBe(true);
    expect(result.output.created).toBe(false);
    expect(result.output.reusedExisting).toBe(true);
    expect(mockIncidents.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'API down', idempotencyKey: expect.any(String) }),
    );
  });

  it('incident.timeline.append requires an incidentId', async () => {
    const mockIncidents = {
      createIncident: vi.fn(),
      appendTimelineEvent: vi.fn(),
      assignOwner: vi.fn(),
    };
    const registry = createActionRunner({ incidentManager: mockIncidents });
    const result = await registry.execute(
      makeContext({ actionType: 'incident.timeline.append', config: {} }),
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_ACTION_CONFIG');
    expect(mockIncidents.appendTimelineEvent).not.toHaveBeenCalled();
  });

  it('incident.assign_owner requires both incidentId and assigneeUserId', async () => {
    const mockIncidents = {
      createIncident: vi.fn(),
      appendTimelineEvent: vi.fn(),
      assignOwner: vi.fn(),
    };
    const registry = createActionRunner({ incidentManager: mockIncidents });

    const noIncident = await registry.execute(
      makeContext({
        actionType: 'incident.assign_owner',
        riskLevel: 'medium',
        config: { assigneeUserId: 'user-1' },
      }),
    );
    expect(noIncident.errorCode).toBe('INVALID_ACTION_CONFIG');

    const noAssignee = await registry.execute(
      makeContext({
        actionType: 'incident.assign_owner',
        riskLevel: 'medium',
        config: { incidentId: 'inc-1' },
      }),
    );
    expect(noAssignee.errorCode).toBe('INVALID_ACTION_CONFIG');
    expect(mockIncidents.assignOwner).not.toHaveBeenCalled();
  });

  // ── AI / reports / tickets ─────────────────────────────────────────────────

  it('ai actions pass the correct generation type', async () => {
    const mockGenerator = {
      generateSummary: vi.fn().mockResolvedValue({ content: 'text', creditsUsed: 5 }),
    };
    const registry = createActionRunner({ aiSummaryGenerator: mockGenerator });

    await registry.execute(makeContext({ actionType: 'ai.summary.generate' }));
    expect(mockGenerator.generateSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'summary' }),
    );

    await registry.execute(makeContext({ actionType: 'ai.root_cause.generate' }));
    expect(mockGenerator.generateSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'root_cause' }),
    );

    await registry.execute(makeContext({ actionType: 'incident.postmortem.generate_draft' }));
    expect(mockGenerator.generateSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'postmortem_draft' }),
    );
  });

  it('report.export returns the report identity', async () => {
    const mockExporter = {
      export: vi.fn().mockResolvedValue({ reportId: 'rpt-001', url: 'https://example.com/r' }),
    };
    const registry = createActionRunner({ reportExporter: mockExporter });
    const result = await registry.execute(
      makeContext({ actionType: 'report.export', config: { reportType: 'daily_health' } }),
    );
    expect(result.success).toBe(true);
    expect(result.output.reportId).toBe('rpt-001');
  });

  it('ticket actions pass the right provider', async () => {
    const mockTickets = {
      createTicket: vi.fn().mockResolvedValue({ ticketId: 'T-1' }),
    };
    const registry = createActionRunner({ ticketCreator: mockTickets });

    await registry.execute(makeContext({ actionType: 'ticket.github.create', riskLevel: 'medium' }));
    expect(mockTickets.createTicket).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'github' }),
    );

    await registry.execute(makeContext({ actionType: 'ticket.jira.create', riskLevel: 'medium' }));
    expect(mockTickets.createTicket).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'jira' }),
    );
  });

  it('approval.request returns the approval identity and status', async () => {
    const mockRequester = {
      requestApproval: vi.fn().mockResolvedValue({ approvalId: 'appr-001', status: 'pending' }),
    };
    const registry = createActionRunner({ approvalRequester: mockRequester });
    const result = await registry.execute(makeContext({ actionType: 'approval.request' }));
    expect(result.success).toBe(true);
    expect(result.output.approvalId).toBe('appr-001');
    expect(result.output.status).toBe('pending');
  });

  it('getAvailability reports all wired actions as available', () => {
    const registry = createActionRunner({
      notificationSender: fakeSender(),
      connectorRetrier: { retry: vi.fn() },
      alertSilenceCreator: { createSilence: vi.fn() },
      incidentManager: {
        createIncident: vi.fn(),
        appendTimelineEvent: vi.fn(),
        assignOwner: vi.fn(),
      },
      approvalRequester: { requestApproval: vi.fn() },
    });
    const availability = registry.getAvailability();
    const unavailable = availability.filter((a) => !a.available).map((a) => a.actionType);
    // Only the three genuinely-unimplemented integrations should remain unavailable.
    expect(unavailable.sort()).toEqual(
      [
        'ai.root_cause.generate',
        'ai.summary.generate',
        'incident.postmortem.generate_draft',
        'report.export',
        'ticket.github.create',
        'ticket.jira.create',
      ].sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - never fakes destructive behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe('ActionRunnerRegistry: no fake destructive behavior', () => {
  it('rollback.recommend never claims to have executed a rollback', async () => {
    const registry = createActionRunner();
    const ctx = makeContext({ actionType: 'rollback.recommend', approvalGranted: true });
    const result = await registry.execute(ctx);
    expect(result.output.recommendation).toBe('rollback_recommended');
    expect(result.output.advisoryOnly).toBe(true);
    expect(result.output).not.toHaveProperty('rolledBack');
    expect(result.output).not.toHaveProperty('rollbackExecuted');
  });

  /**
   * The irreversible/unbacked action types are gone from the product rather than
   * gated, so they cannot be requested at all. Attempting one is an unsupported
   * action, which is strictly safer than a stub that returns success.
   */
  it('removed destructive action types are no longer registered at all', () => {
    const registry = createActionRunner();
    const types = registry.getRegisteredTypes() as string[];
    for (const removed of [
      'retention.purge_request',
      'retention.archive',
      'release.guard.pause',
      'release.guard.warn',
      'status_page.update',
      'runbook.open',
      'runbook.step.create',
      'quota.throttle_recommend',
      'alert.severity.change',
    ]) {
      expect(types).not.toContain(removed);
    }
  });

  it('executing a removed action type raises not-supported', async () => {
    const registry = createActionRunner();
    const ctx = makeContext({ actionType: 'retention.purge_request' as ActionType });
    await expect(registry.execute(ctx)).rejects.toThrow(AutomationActionNotSupportedError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - createActionRunner factory
// ═══════════════════════════════════════════════════════════════════════════════

describe('createActionRunner factory', () => {
  it('returns a working registry with no integrations', () => {
    const registry = createActionRunner();
    expect(registry).toBeInstanceOf(ActionRunnerRegistry);
    expect(registry.getRegisteredTypes().length).toBeGreaterThan(0);
  });

  it('returns a registry with injected integrations', async () => {
    const integrations: AutomationIntegrations = {
      notificationSender: {
        send: vi.fn().mockResolvedValue({
          sent: true,
          deliveryId: 'd1',
          connectorId: 'c1',
          connectorType: 'email',
          status: 'sent',
          deduplicated: false,
        }),
      },
    };
    const registry = createActionRunner(integrations);
    const result = await registry.execute(makeContext({ actionType: 'notification.send' }));
    expect(result.success).toBe(true);
    expect(result.skipped).toBeFalsy();
    expect(integrations.notificationSender!.send).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// readActionWaitSeconds
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Regression coverage for a found-in-production-readiness-review dead config
 * key: the seeded escalate-unresolved-critical-alert template sets
 * "waitMinutes" on its pagerduty.trigger action, which nothing in this module
 * ever read. This is now a real, generic pre-step delay applied by
 * createRunWithSteps regardless of actionType (see repository.ts's
 * initialDelaySeconds and workers.ts/service.ts's use of this helper).
 */
describe('readActionWaitSeconds', () => {
  it('converts waitMinutes to seconds', () => {
    expect(readActionWaitSeconds({ waitMinutes: 15 })).toBe(900);
  });

  it('honours waitSeconds directly when present', () => {
    expect(readActionWaitSeconds({ waitSeconds: 45 })).toBe(45);
  });

  it('prefers waitSeconds over waitMinutes when both are present', () => {
    expect(readActionWaitSeconds({ waitSeconds: 10, waitMinutes: 15 })).toBe(10);
  });

  it('returns undefined when neither key is present', () => {
    expect(readActionWaitSeconds({})).toBeUndefined();
    expect(readActionWaitSeconds(null)).toBeUndefined();
    expect(readActionWaitSeconds(undefined)).toBeUndefined();
  });

  it('ignores a non-positive wait (treated as "no delay", not an error)', () => {
    expect(readActionWaitSeconds({ waitMinutes: 0 })).toBeUndefined();
    expect(readActionWaitSeconds({ waitMinutes: -5 })).toBeUndefined();
    expect(readActionWaitSeconds({ waitSeconds: 0 })).toBeUndefined();
  });
});
