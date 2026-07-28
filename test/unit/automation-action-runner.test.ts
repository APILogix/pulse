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

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// buildIdempotencyKey
// ═══════════════════════════════════════════════════════════════════════════════

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

  it('is deterministic (same inputs → same output)', () => {
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
    // HARDENED: key must NOT change with attempt — this is the stability fix
    const base = { organizationId: 'o', workflowId: 'w', runId: 'r', stepId: 's', attempt: 1 };
    expect(buildIdempotencyKey(base)).toBe(buildIdempotencyKey({ ...base, attempt: 2 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - registration and lookup
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - execution and risk validation
// ═══════════════════════════════════════════════════════════════════════════════

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

  it('throws for dangerous action (webhook.call) without approval even if risk is medium', async () => {
    registry.register({
      actionType: 'webhook.call',
      riskLevel: 'medium',
      execute: async () => ({ success: true, output: {} }),
    });
    const ctx = makeContext({
      actionType: 'webhook.call',
      riskLevel: 'medium',
      approvalGranted: false,
    });
    await expect(registry.execute(ctx)).rejects.toThrow(AutomationApprovalRequiredError);
  });

  it('dangerous action with approval proceeds', async () => {
    registry.register({
      actionType: 'status_page.update',
      riskLevel: 'high',
      execute: async () => ({ success: true, output: { updated: true } }),
    });
    const ctx = makeContext({
      actionType: 'status_page.update',
      riskLevel: 'high',
      approvalGranted: true,
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - timeout enforcement
// ═══════════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - not_implemented (no integrations injected)
// ═══════════════════════════════════════════════════════════════════════════════

describe('ActionRunnerRegistry: not_implemented without integrations', () => {
  let registry: ActionRunnerRegistry;

  beforeEach(() => {
    registry = createActionRunner({}); // No integrations
  });

  it('notification.send returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'notification.send' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.output.status).toBe('not_implemented');
    expect(result.output.actionType).toBe('notification.send');
  });

  it('connector.delivery.retry returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'connector.delivery.retry' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.output.status).toBe('not_implemented');
  });

  it('alert.silence.create returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'alert.silence.create' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.output.status).toBe('not_implemented');
  });

  it('ai.summary.generate returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'ai.summary.generate' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('ai.root_cause.generate returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'ai.root_cause.generate' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('report.export returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'report.export' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('approval.request returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'approval.request' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('quota.notify returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'quota.notify' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('security.notify returns skipped/not_implemented', async () => {
    const ctx = makeContext({ actionType: 'security.notify' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('rollback.recommend always succeeds (recommendation only, no integration needed)', async () => {
    const ctx = makeContext({ actionType: 'rollback.recommend' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined(); // Not skipped - it produces a recommendation
    expect(result.output.recommendation).toBe('rollback_recommended');
    expect(result.output.note).toContain('Phase 2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - with injected integrations
// ═══════════════════════════════════════════════════════════════════════════════

describe('ActionRunnerRegistry: with integrations', () => {
  it('notification.send calls real sender', async () => {
    const mockSender = {
      send: vi.fn().mockResolvedValue({ sent: true, messageId: 'msg-123' }),
    };
    const registry = createActionRunner({ notificationSender: mockSender });
    const ctx = makeContext({
      actionType: 'notification.send',
      config: { channel: 'slack', message: 'Test alert' },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(result.output.sent).toBe(true);
    expect(result.output.messageId).toBe('msg-123');
    expect(mockSender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-001',
        channel: 'slack',
        message: 'Test alert',
      })
    );
  });

  it('connector.delivery.retry calls real retrier', async () => {
    const mockRetrier = {
      retry: vi.fn().mockResolvedValue({ retried: true, newDeliveryId: 'del-456' }),
    };
    const registry = createActionRunner({ connectorRetrier: mockRetrier });
    const ctx = makeContext({
      actionType: 'connector.delivery.retry',
      config: { deliveryId: 'del-123' },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.retried).toBe(true);
    expect(result.output.newDeliveryId).toBe('del-456');
    expect(mockRetrier.retry).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryId: 'del-123' })
    );
  });

  it('connector.delivery.retry fails gracefully when no deliveryId', async () => {
    const mockRetrier = {
      retry: vi.fn().mockResolvedValue({ retried: true }),
    };
    const registry = createActionRunner({ connectorRetrier: mockRetrier });
    const ctx = makeContext({
      actionType: 'connector.delivery.retry',
      config: {}, // No deliveryId
      inputPayload: {}, // No deliveryId
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('MISSING_DELIVERY_ID');
    expect(mockRetrier.retry).not.toHaveBeenCalled();
  });

  it('alert.silence.create calls real creator', async () => {
    const mockCreator = {
      createSilence: vi.fn().mockResolvedValue({ silenceId: 'sil-789' }),
    };
    const registry = createActionRunner({ alertSilenceCreator: mockCreator });
    const ctx = makeContext({
      actionType: 'alert.silence.create',
      config: { matchers: { service: 'api' }, durationSeconds: 1800, reason: 'Maintenance' },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.silenceId).toBe('sil-789');
    expect(mockCreator.createSilence).toHaveBeenCalledWith(
      expect.objectContaining({ matchers: { service: 'api' }, durationSeconds: 1800 })
    );
  });

  it('ai.summary.generate calls real generator', async () => {
    const mockGenerator = {
      generateSummary: vi.fn().mockResolvedValue({ content: 'Summary text', creditsUsed: 5 }),
    };
    const registry = createActionRunner({ aiSummaryGenerator: mockGenerator });
    const ctx = makeContext({
      actionType: 'ai.summary.generate',
      inputPayload: { alertData: 'some data' },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.content).toBe('Summary text');
    expect(result.output.creditsUsed).toBe(5);
    expect(mockGenerator.generateSummary).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'summary' })
    );
  });

  it('ai.root_cause.generate calls generator with root_cause type', async () => {
    const mockGenerator = {
      generateSummary: vi.fn().mockResolvedValue({ content: 'Root cause found', creditsUsed: 10 }),
    };
    const registry = createActionRunner({ aiSummaryGenerator: mockGenerator });
    const ctx = makeContext({
      actionType: 'ai.root_cause.generate',
      inputPayload: { errorData: 'traces' },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.content).toBe('Root cause found');
    expect(mockGenerator.generateSummary).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'root_cause' })
    );
  });

  it('report.export calls real exporter', async () => {
    const mockExporter = {
      export: vi.fn().mockResolvedValue({ reportId: 'rpt-001', url: 'https://example.com/report' }),
    };
    const registry = createActionRunner({ reportExporter: mockExporter });
    const ctx = makeContext({
      actionType: 'report.export',
      config: { reportType: 'daily_health' },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.reportId).toBe('rpt-001');
    expect(result.output.url).toBe('https://example.com/report');
  });

  it('approval.request calls real requester', async () => {
    const mockRequester = {
      requestApproval: vi.fn().mockResolvedValue({ approvalId: 'appr-001' }),
    };
    const registry = createActionRunner({ approvalRequester: mockRequester });
    const ctx = makeContext({ actionType: 'approval.request' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.approvalId).toBe('appr-001');
  });

  it('quota.notify uses notificationSender with quota channel', async () => {
    const mockSender = {
      send: vi.fn().mockResolvedValue({ sent: true, messageId: 'q-msg-1' }),
    };
    const registry = createActionRunner({ notificationSender: mockSender });
    const ctx = makeContext({ actionType: 'quota.notify' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.type).toBe('quota_notification');
    expect(mockSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'quota' })
    );
  });

  it('security.notify uses notificationSender with security channel', async () => {
    const mockSender = {
      send: vi.fn().mockResolvedValue({ sent: true, messageId: 's-msg-1' }),
    };
    const registry = createActionRunner({ notificationSender: mockSender });
    const ctx = makeContext({ actionType: 'security.notify' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.output.type).toBe('security_notification');
    expect(mockSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'security' })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ActionRunnerRegistry - never fakes destructive behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe('ActionRunnerRegistry: no fake destructive behavior', () => {
  it('rollback.recommend never executes rollback, only recommends', async () => {
    const registry = createActionRunner();
    const ctx = makeContext({ actionType: 'rollback.recommend' });
    const result = await registry.execute(ctx);
    expect(result.output.recommendation).toBe('rollback_recommended');
    expect(result.output.note).toContain('no destructive execution');
    // Verify no "rolled_back" or "rollback_executed" keys
    expect(result.output).not.toHaveProperty('rolledBack');
    expect(result.output).not.toHaveProperty('rollbackExecuted');
  });

  it('dangerous registered actions require approval and return not_implemented safely', async () => {
    const registry = createActionRunner();
    // retention.purge_request is now registered as not_implemented but requires approval (critical risk)
    const ctx = makeContext({ actionType: 'retention.purge_request' as ActionType, riskLevel: 'critical', approvalGranted: true });
    const result = await registry.execute(ctx);
    expect(result.skipped).toBe(true);
    expect(result.output).toHaveProperty('status', 'not_implemented');
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
        send: vi.fn().mockResolvedValue({ sent: true }),
      },
    };
    const registry = createActionRunner(integrations);
    const ctx = makeContext({ actionType: 'notification.send' });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
    expect(integrations.notificationSender!.send).toHaveBeenCalled();
  });
});
