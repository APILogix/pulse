import type { FastifyBaseLogger } from 'fastify';
import { AlertChannelRepository } from '../../projects/alerts/channels/channel.repository.js';
import type { ImmediateDeliveryRequest, ImmediateDeliveryTarget } from '../../projects/alerts/channels/channel.types.js';
import { AlertConfigRepository } from '../config/alert-config.repository.js';
import { hashCanonical } from './effective-rule-contract.js';
import { EmailOnlyRestrictedRouting, ProjectOwnerRepository } from './email-only-restricted-routing.js';
import {
  NotificationEntitlementService,
  type NotificationDeliveryMode,
  type NotificationEntitlementDecision,
  type NotificationProvider,
  type NotificationRecipientType,
} from './notification-entitlement.service.js';
import type { NotificationRoutingDecision, RoutingSuppressionReason } from './routing-decision.types.js';
import type { NotificationChannelKind } from './alert-runtime.repository.js';
import { recordNotificationRouting } from './notification-metrics.js';

export interface NotificationRoutingServiceDependencies {
  channelRepository?: AlertChannelRepository;
  configRepository?: AlertConfigRepository;
  entitlementService?: NotificationEntitlementService;
  restrictedRouting?: EmailOnlyRestrictedRouting;
  logger: FastifyBaseLogger;
}

export interface NotificationRoutingInput {
  organizationId: string;
  projectId: string | null;
  ruleId: string;
  policy: {
    effectiveRuleHash: string;
    escalationPolicyId: string | null;
  };
  category: string;
  severity: ImmediateDeliveryRequest['severity'];
  labels: Record<string, unknown>;
}

export class NotificationRoutingService {
  private readonly channels: AlertChannelRepository;
  private readonly config: AlertConfigRepository;
  private readonly entitlement: NotificationEntitlementService;
  private readonly restricted: EmailOnlyRestrictedRouting;
  private readonly log: FastifyBaseLogger;

  constructor(deps: NotificationRoutingServiceDependencies) {
    this.channels = deps.channelRepository ?? new AlertChannelRepository();
    this.config = deps.configRepository ?? new AlertConfigRepository();
    this.entitlement = deps.entitlementService ?? new NotificationEntitlementService();
    this.restricted = deps.restrictedRouting ?? new EmailOnlyRestrictedRouting(new ProjectOwnerRepository());
    this.log = deps.logger.child({ component: 'notification-routing-service' });
  }

  async resolve(
    input: NotificationRoutingInput,
    resolvedEntitlement?: NotificationEntitlementDecision,
  ): Promise<NotificationRoutingDecision> {
    if (!input.projectId) {
      return this.decision(input, [], true, 'missing_project_context', false, {
        mode: 'EMAIL_ONLY_RESTRICTED',
        reason: 'MISSING_PROJECT_CONTEXT',
      });
    }

    const silences = await this.config.findActiveSilences(input.organizationId, input.ruleId);
    if (silences.some((silence) => matchesSilence(input.labels, silence.matchers))) {
      return this.decision(input, [], true, 'silenced', false, {
        mode: 'EMAIL_ONLY_RESTRICTED',
        reason: 'SILENCED',
      });
    }

    const capability = resolvedEntitlement ?? await this.entitlement.resolve(input.organizationId);
    if (capability.reason === 'ENTITLEMENT_UNKNOWN') {
      return this.decision(input, [], true, 'entitlement_unknown', false, {
        mode: capability.mode,
        reason: capability.reason,
      });
    }

    if (capability.mode === 'EMAIL_ONLY_RESTRICTED') {
      const restricted = await this.restricted.resolve(input.organizationId, input.projectId);
      if (!restricted.target) {
        return this.decision(input, [], true, 'owner_email_unavailable', false, {
          mode: capability.mode,
          reason: restricted.reason,
        });
      }
      return this.decision(input, [restricted.target], false, null, false, {
        mode: capability.mode,
        reason: restricted.reason,
      });
    }

    const request: ImmediateDeliveryRequest = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      category: input.category,
      severity: input.severity,
    };
    const configuredTargets = (await this.channels.resolveImmediateDeliveryTargets(request))
      .filter((target) => capability.isProviderAllowed(
        toChannelKind(target.channelType),
        Boolean(target.channelConnectorId ?? target.subscriptionConnectorId),
      ));
    if (configuredTargets.length > 0) {
      return this.decision(input, configuredTargets.map(toTarget), false, null, false, {
        mode: capability.mode,
        reason: 'NORMAL_CONNECTOR_ROUTING',
      });
    }

    const fallbackRecipients = deduplicateRecipients(
      await this.channels.resolveNoChannelEmailTargets(request),
    );
    if (fallbackRecipients.length === 0) {
      return this.decision(input, [], true, 'no_verified_project_recipients', true, {
        mode: capability.mode,
        reason: 'NO_ELIGIBLE_CHANNEL',
      });
    }

    return this.decision(input, fallbackRecipients.map((recipient) => ({
      channelKind: 'email',
      channelId: null,
      connectorId: null,
      recipientUserId: recipient.userId,
      recipientRef: recipient.email,
      routeId: null,
      deliveryMode: 'NORMAL_CONNECTOR',
      recipientType: 'PROJECT_MEMBER',
      provider: 'EMAIL',
    })), false, null, true, {
      mode: capability.mode,
      reason: 'NO_ELIGIBLE_CHANNEL',
    });
  }

  private decision(
    input: NotificationRoutingInput,
    targets: NotificationRoutingDecision['targets'],
    suppressed: boolean,
    suppressionReason: NotificationRoutingDecision['suppressionReason'],
    usedNoChannelFallback: boolean,
    metadata: { mode: NotificationDeliveryMode; reason: string },
  ): NotificationRoutingDecision {
    const decision = {
      targets,
      suppressed,
      suppressionReason,
      usedNoChannelFallback,
      deliveryMode: metadata.mode,
      reason: metadata.reason,
      policyHash: input.policy.effectiveRuleHash,
      projectId: input.projectId,
      ruleId: input.ruleId,
    };
    const result = { ...decision, decisionHash: hashCanonical(decision) };
    if (suppressed && suppressionReason === 'owner_email_unavailable') {
      this.log.warn({
        organizationId: input.organizationId,
        projectId: input.projectId,
        ruleId: input.ruleId,
      }, 'Critical alert delivery suppressed: neither project owner nor organization fallback email is available');
    }
    recordNotificationRouting(metadata.mode === 'EMAIL_ONLY_RESTRICTED'
      ? (suppressed && suppressionReason === 'owner_email_unavailable'
          ? 'notification.routing.owner_unavailable'
          : 'notification.routing.email_only_restricted')
      : suppressed && suppressionReason === 'entitlement_unknown'
        ? 'notification.routing.entitlement_blocked'
        : usedNoChannelFallback
          ? 'notification.routing.owner_fallback'
          : targets.length === 0
            ? 'notification.routing.no_recipient'
            : 'notification.routing.normal');
    this.log.debug({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ruleId: input.ruleId,
      targets: targets.length,
      deliveryMode: metadata.mode,
      reason: metadata.reason,
      suppressed,
      suppressionReason,
      usedNoChannelFallback,
    }, 'Notification routing decision resolved');
    return result;
  }
}

function toTarget(target: ImmediateDeliveryTarget): NotificationRoutingDecision['targets'][number] {
  const channelKind = toChannelKind(target.channelType);
  return {
    channelKind,
    channelId: target.channelId,
    connectorId: target.channelConnectorId ?? target.subscriptionConnectorId,
    recipientUserId: target.userId,
    recipientRef: target.memberDestination ?? target.channelDestination,
    routeId: null,
    deliveryMode: 'NORMAL_CONNECTOR',
    recipientType: target.userId ? 'PROJECT_MEMBER' : 'CHANNEL_DESTINATION',
    provider: toProvider(channelKind),
  };
}

function toChannelKind(value: string): NotificationChannelKind {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'in_app' || normalized === 'email' || normalized === 'slack'
    || normalized === 'discord' || normalized === 'teams' || normalized === 'pagerduty'
    || normalized === 'webhook' || normalized === 'sms') return normalized;
  return 'in_app';
}

function toProvider(channelKind: NotificationChannelKind): NotificationProvider {
  if (channelKind === 'email') return 'EMAIL';
  if (channelKind === 'in_app') return 'IN_APP';
  return channelKind.toUpperCase() as NotificationProvider;
}

function deduplicateRecipients(
  recipients: Array<{ userId: string; email: string }>,
): Array<{ userId: string; email: string }> {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const email = recipient.email.trim().toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  }).map((recipient) => ({ ...recipient, email: recipient.email.trim().toLowerCase() }));
}

function matchesSilence(labels: Record<string, unknown>, matchers: Record<string, unknown>): boolean {
  const entries = Object.entries(matchers ?? {});
  if (entries.length === 0) return true;
  return entries.every(([key, value]) => String(labels[key] ?? '') === String(value));
}
