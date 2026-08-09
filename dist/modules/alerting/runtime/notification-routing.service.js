import { AlertChannelRepository } from '../../projects/alerts/channels/channel.repository.js';
import { AlertConfigRepository } from '../config/alert-config.repository.js';
import { hashCanonical } from './effective-rule-contract.js';
export class NotificationRoutingService {
    channels;
    config;
    log;
    constructor(deps) {
        this.channels = deps.channelRepository ?? new AlertChannelRepository();
        this.config = deps.configRepository ?? new AlertConfigRepository();
        this.log = deps.logger.child({ component: 'notification-routing-service' });
    }
    async resolve(input) {
        if (!input.projectId) {
            return this.decision(input, [], true, 'missing_project_context', false);
        }
        const silences = await this.config.findActiveSilences(input.organizationId, input.ruleId);
        if (silences.some((silence) => matchesSilence(input.labels, silence.matchers))) {
            return this.decision(input, [], true, 'silenced', false);
        }
        const request = {
            organizationId: input.organizationId,
            projectId: input.projectId,
            category: input.category,
            severity: input.severity,
        };
        const configuredTargets = await this.channels.resolveImmediateDeliveryTargets(request);
        if (configuredTargets.length > 0) {
            return this.decision(input, configuredTargets.map(toTarget), false, null, false);
        }
        const fallbackRecipients = deduplicateRecipients(await this.channels.resolveNoChannelEmailTargets(request));
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
    decision(input, targets, suppressed, suppressionReason, usedNoChannelFallback) {
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
function toTarget(target) {
    return {
        channelKind: toChannelKind(target.channelType),
        channelId: target.channelId,
        connectorId: target.channelConnectorId ?? target.subscriptionConnectorId,
        recipientUserId: target.userId,
        recipientRef: target.memberDestination ?? target.channelDestination,
        routeId: null,
    };
}
function toChannelKind(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'in_app' || normalized === 'email' || normalized === 'slack'
        || normalized === 'discord' || normalized === 'teams' || normalized === 'pagerduty'
        || normalized === 'webhook' || normalized === 'sms')
        return normalized;
    return 'in_app';
}
function deduplicateRecipients(recipients) {
    const seen = new Set();
    return recipients.filter((recipient) => {
        const email = recipient.email.trim().toLowerCase();
        if (!email || seen.has(email))
            return false;
        seen.add(email);
        return true;
    }).map((recipient) => ({ ...recipient, email: recipient.email.trim().toLowerCase() }));
}
function matchesSilence(labels, matchers) {
    const entries = Object.entries(matchers ?? {});
    if (entries.length === 0)
        return true;
    return entries.every(([key, value]) => String(labels[key] ?? '') === String(value));
}
//# sourceMappingURL=notification-routing.service.js.map