import type { FastifyBaseLogger } from 'fastify';
import { AlertChannelRepository } from '../../projects/alerts/channels/channel.repository.js';
import type { ImmediateDeliveryRequest } from '../../projects/alerts/channels/channel.types.js';
import { AlertConfigRepository } from '../config/alert-config.repository.js';
import { EmailOnlyRestrictedRouting } from './email-only-restricted-routing.js';
import { NotificationEntitlementService, type NotificationEntitlementDecision } from './notification-entitlement.service.js';
import type { NotificationRoutingDecision } from './routing-decision.types.js';
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
export declare class NotificationRoutingService {
    private readonly channels;
    private readonly config;
    private readonly entitlement;
    private readonly restricted;
    private readonly log;
    constructor(deps: NotificationRoutingServiceDependencies);
    resolve(input: NotificationRoutingInput, resolvedEntitlement?: NotificationEntitlementDecision): Promise<NotificationRoutingDecision>;
    private decision;
}
//# sourceMappingURL=notification-routing.service.d.ts.map