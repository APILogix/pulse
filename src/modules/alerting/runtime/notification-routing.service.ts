import type { FastifyBaseLogger } from 'fastify';
import { AlertChannelRepository } from '../../projects/alerts/channels/channel.repository.js';
import type { ImmediateDeliveryRequest, ImmediateDeliveryTarget } from '../../projects/alerts/channels/channel.types.js';
import { AlertConfigRepository } from '../config/alert-config.repository.js';
import { hashCanonical } from './effective-rule-contract.js';
import type { NotificationRoutingDecision } from './routing-decision.types.js';
import type { NotificationChannelKind } from './alert-runtime.repository.js';

export interface NotificationRoutingServiceDependencies {
  channelRepository?: AlertChannelRepository;
  configRepository?: AlertConfigRepository;
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
  private readonly log: FastifyBaseLogger;

  constructor(deps: NotificationRoutingServiceDependencies) {
    this.channels = deps.channelRepository ?? new AlertChannelRepository();
    this.config = deps.configRepository ?? new AlertConfigRepository();
    this.log = deps.logger.child({ component: 'notification-routing-service' });
  }

  async resolve(input: NotificationRoutingInput): Promise<NotificationRoutingDecision> {
    if (!input.projectId) {
      return this.decision(input, [], true, 'missing_project_context', false);
    }

    const silences = await this.config.findActiveSilences(input.organizationId, input.ruleId);
    if (silences.some((silence) => matchesSilence(input.labels, silence.matchers))) {
      return this.decision(input, [], true, 'silenced', false);
    }

    const request: ImmediateDeliveryRequest = {
      organizationId: input.organizationId,
      projectId: input.projectId,
      category: input.category,
      severity: input.severity,
    };
    const configuredTargets = await this.channels.resolveImmediateDeliveryTargets(request);
    if (configuredTargets.length > 0) {
      return this.decision(input, configuredTargets.map(toTarget), false, null, false);
    }

    const fallbackRecipients = deduplicateRecipients(
      await this.channels.resolveNoChannelEmailTargets(request),
    );
    if (fallbackRecipients.length === 0) {
      return this.decision(input, [], true, 'no_verified_project_recipients', true);
    }

    return this.decision(input, fallbackRecipients.map((recipient) => ({
      channelKind: 'email',
      channelId: null,
      connectorId: null,
      recipientUserId: recipient.userId,
      recipientRef: recipient.email,
      routeId: null,
    })), false, null, true);
  }

  private decision(
    input: NotificationRoutingInput,
    targets: NotificationRoutingDecision['targets'],
    suppressed: boolean,
    suppressionReason: NotificationRoutingDecision['suppressionReason'],
    usedNoChannelFallback: boolean,
  ): NotificationRoutingDecision {
    const decision = {
      targets,
      suppressed,
      suppressionReason,
      usedNoChannelFallback,
      policyHash: input.policy.effectiveRuleHash,
      projectId: input.projectId,
      ruleId: input.ruleId,
    };
    const result = { ...decision, decisionHash: hashCanonical(decision) };
    this.log.debug({
      organizationId: input.organizationId,
      projectId: input.projectId,
      ruleId: input.ruleId,
      targets: targets.length,
      suppressed,
      suppressionReason,
      usedNoChannelFallback,
    }, 'Notification routing decision resolved');
    return result;
  }
}

function toTarget(target: ImmediateDeliveryTarget): NotificationRoutingDecision['targets'][number] {
  return {
    channelKind: toChannelKind(target.channelType),
    channelId: target.channelId,
    connectorId: target.channelConnectorId ?? target.subscriptionConnectorId,
    recipientUserId: target.userId,
    recipientRef: target.memberDestination ?? target.channelDestination,
    routeId: null,
  };
}

function toChannelKind(value: string): NotificationChannelKind {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'in_app' || normalized === 'email' || normalized === 'slack'
    || normalized === 'discord' || normalized === 'teams' || normalized === 'pagerduty'
    || normalized === 'webhook' || normalized === 'sms') return normalized;
  return 'in_app';
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
