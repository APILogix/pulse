import { describe, expect, it, vi } from 'vitest';
import { NotificationRoutingService } from '../../src/modules/alerting/runtime/notification-routing.service.js';
import type { EffectiveAlertPolicy } from '../../src/modules/alerting/policy/types.js';

const logger = {
  child: () => ({ debug: vi.fn() }),
} as never;

const policy: Pick<EffectiveAlertPolicy, 'effectiveRuleHash' | 'escalationPolicyId'> = {
  effectiveRuleHash: 'policy-hash',
  escalationPolicyId: null,
};

function makeService(overrides: {
  configured?: unknown[];
  fallback?: Array<{ userId: string; email: string }>;
  silences?: unknown[];
} = {}) {
  const channels = {
    resolveImmediateDeliveryTargets: vi.fn().mockResolvedValue(overrides.configured ?? []),
    resolveNoChannelEmailTargets: vi.fn().mockResolvedValue(overrides.fallback ?? []),
  };
  const config = {
    findActiveSilences: vi.fn().mockResolvedValue(overrides.silences ?? []),
  };
  return {
    service: new NotificationRoutingService({
      channelRepository: channels as never,
      configRepository: config as never,
      logger,
    }),
    channels,
    config,
  };
}

const input = {
  organizationId: 'org-1',
  projectId: 'project-1',
  ruleId: 'rule-1',
  policy,
  category: 'performance',
  severity: 'error' as const,
  labels: { source: 'window' },
};

describe('NotificationRoutingService', () => {
  it('suppresses notification creation for a matching silence', async () => {
    const { service, channels } = makeService({ silences: [{ matchers: { source: 'window' } }] });

    const decision = await service.resolve(input);

    expect(decision).toMatchObject({ suppressed: true, suppressionReason: 'silenced', targets: [] });
    expect(channels.resolveImmediateDeliveryTargets).not.toHaveBeenCalled();
  });

  it('uses configured project targets before fallback', async () => {
    const { service, channels } = makeService({
      configured: [{
        channelId: 'channel-1',
        channelType: 'slack',
        channelConnectorId: 'connector-1',
        subscriptionConnectorId: null,
        userId: 'member-1',
        memberDestination: null,
        channelDestination: '#alerts',
      }],
      fallback: [{ userId: 'member-2', email: 'fallback@example.test' }],
    });

    const decision = await service.resolve(input);

    expect(decision).toMatchObject({ suppressed: false, usedNoChannelFallback: false });
    expect(decision.targets).toEqual([expect.objectContaining({
      channelKind: 'slack',
      channelId: 'channel-1',
      connectorId: 'connector-1',
      recipientUserId: 'member-1',
    })]);
    expect(channels.resolveNoChannelEmailTargets).not.toHaveBeenCalled();
  });

  it('creates one deterministic fallback target per verified project email', async () => {
    const { service } = makeService({
      fallback: [
        { userId: 'member-1', email: 'owner@example.test' },
        { userId: 'member-2', email: 'owner@example.test' },
        { userId: 'member-3', email: 'admin@example.test' },
      ],
    });

    const decision = await service.resolve(input);

    expect(decision).toMatchObject({ suppressed: false, usedNoChannelFallback: true });
    expect(decision.targets).toHaveLength(2);
    expect(decision.targets.every((target) => target.channelKind === 'email')).toBe(true);
    expect(decision.decisionHash).toHaveLength(64);
  });

  it('keeps the alert without a notification job when no verified recipient exists', async () => {
    const { service } = makeService();

    const decision = await service.resolve(input);

    expect(decision).toMatchObject({
      suppressed: true,
      suppressionReason: 'no_verified_project_recipients',
      usedNoChannelFallback: true,
      targets: [],
    });
  });

  it('fails closed when project context is missing', async () => {
    const { service } = makeService();

    const decision = await service.resolve({ ...input, projectId: null });

    expect(decision).toMatchObject({
      suppressed: true,
      suppressionReason: 'missing_project_context',
      targets: [],
    });
  });
});
