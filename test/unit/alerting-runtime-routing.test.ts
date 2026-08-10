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
  mode?: 'NORMAL_CONNECTOR' | 'EMAIL_ONLY_RESTRICTED';
  owner?: { userId: string; email: string } | null;
} = {}) {
  const channels = {
    resolveImmediateDeliveryTargets: vi.fn().mockResolvedValue(overrides.configured ?? []),
    resolveNoChannelEmailTargets: vi.fn().mockResolvedValue(overrides.fallback ?? []),
  };
  const config = {
    findActiveSilences: vi.fn().mockResolvedValue(overrides.silences ?? []),
  };
  const restrictedRouting = {
    resolve: vi.fn().mockResolvedValue(overrides.owner === undefined
      ? { target: null, reason: 'OWNER_EMAIL_UNAVAILABLE' }
      : overrides.owner
        ? {
            reason: 'EMAIL_ONLY_RESTRICTED',
            target: {
              channelKind: 'email',
              channelId: null,
              connectorId: null,
              recipientUserId: overrides.owner.userId,
              recipientRef: overrides.owner.email.trim().toLowerCase(),
              routeId: null,
              deliveryMode: 'EMAIL_ONLY_RESTRICTED',
              recipientType: 'PROJECT_OWNER',
              provider: 'MANAGED_EMAIL',
            },
          }
        : { target: null, reason: 'OWNER_EMAIL_UNAVAILABLE' }),
  };
  const entitlementService = {
    resolve: vi.fn().mockResolvedValue({
      mode: overrides.mode ?? 'NORMAL_CONNECTOR',
      connectorAccess: (overrides.mode ?? 'NORMAL_CONNECTOR') === 'NORMAL_CONNECTOR',
      reason: (overrides.mode ?? 'NORMAL_CONNECTOR') === 'NORMAL_CONNECTOR'
        ? 'CONNECTOR_ACCESS_ALLOWED'
        : 'CONNECTOR_ENTITLEMENT_REQUIRED',
      featureKeys: [],
      isProviderAllowed: () => true,
    }),
  };
  return {
    service: new NotificationRoutingService({
      channelRepository: channels as never,
      configRepository: config as never,
      entitlementService: entitlementService as never,
      restrictedRouting: restrictedRouting as never,
      logger,
    }),
    channels,
    config,
    entitlementService,
    restrictedRouting,
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

  it('routes restricted mode to exactly the verified project owner', async () => {
    const { service, channels, restrictedRouting } = makeService({
      mode: 'EMAIL_ONLY_RESTRICTED',
      owner: { userId: 'owner-1', email: ' Owner@Example.test ' },
    });

    const decision = await service.resolve(input);

    expect(decision).toMatchObject({
      suppressed: false,
      deliveryMode: 'EMAIL_ONLY_RESTRICTED',
      reason: 'EMAIL_ONLY_RESTRICTED',
    });
    expect(decision.targets).toEqual([expect.objectContaining({
      channelKind: 'email',
      connectorId: null,
      recipientUserId: 'owner-1',
      recipientRef: 'owner@example.test',
      deliveryMode: 'EMAIL_ONLY_RESTRICTED',
      recipientType: 'PROJECT_OWNER',
      provider: 'MANAGED_EMAIL',
    })]);
    expect(restrictedRouting.resolve).toHaveBeenCalledWith('org-1', 'project-1');
    expect(channels.resolveImmediateDeliveryTargets).not.toHaveBeenCalled();
    expect(channels.resolveNoChannelEmailTargets).not.toHaveBeenCalled();
  });

  it('suppresses restricted mode when the owner has no eligible email', async () => {
    const { service, channels } = makeService({ mode: 'EMAIL_ONLY_RESTRICTED', owner: null });

    const decision = await service.resolve(input);

    expect(decision).toMatchObject({
      suppressed: true,
      suppressionReason: 'owner_email_unavailable',
      deliveryMode: 'EMAIL_ONLY_RESTRICTED',
      targets: [],
    });
    expect(channels.resolveImmediateDeliveryTargets).not.toHaveBeenCalled();
    expect(channels.resolveNoChannelEmailTargets).not.toHaveBeenCalled();
  });
});
