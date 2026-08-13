import { type EffectiveEntitlementRow } from '../../billing/entitlements/repository.js';
import type { NotificationChannelKind } from './alert-runtime.repository.js';
export declare const CONNECTOR_FEATURE_KEYS: {
    readonly email: "integrations.email";
    readonly slack: "integrations.slack";
    readonly discord: "integrations.discord";
    readonly teams: "integrations.microsoft_teams";
    readonly pagerduty: "integrations.pagerduty";
    readonly webhook: "integrations.webhook";
    readonly sms: "integrations.sms";
};
export declare const CONNECTOR_ALIAS_KEYS: {
    readonly teams: "integrations.teams";
};
export declare const CONNECTOR_LEGACY_KEYS: {
    readonly email: "email_alerts";
    readonly slack: "slack_connector";
    readonly discord: "discord_connector";
    readonly teams: "teams_connector";
    readonly pagerduty: "pagerduty_connector";
    readonly webhook: "webhook_connector";
    readonly sms: "sms_connector";
};
export type NotificationDeliveryMode = 'NORMAL_CONNECTOR' | 'EMAIL_ONLY_RESTRICTED';
export type NotificationEntitlementReason = 'CONNECTOR_ACCESS_ALLOWED' | 'CONNECTOR_ENTITLEMENT_REQUIRED' | 'ENTITLEMENT_UNKNOWN';
export type NotificationProvider = 'MANAGED_EMAIL' | 'IN_APP' | 'EMAIL' | 'SLACK' | 'DISCORD' | 'TEAMS' | 'PAGERDUTY' | 'WEBHOOK' | 'SMS';
export type NotificationRecipientType = 'PROJECT_OWNER' | 'ORGANIZATION_FALLBACK' | 'PROJECT_MEMBER' | 'CHANNEL_DESTINATION';
export interface NotificationEntitlementReader {
    getEffectiveEntitlements(organizationId: string): Promise<EffectiveEntitlementRow[]>;
}
export interface NotificationEntitlementDecision {
    mode: NotificationDeliveryMode;
    connectorAccess: boolean;
    alertingEnabled: boolean;
    externalConnectorsEnabled: boolean;
    managedEmailEnabled: boolean;
    reason: NotificationEntitlementReason;
    featureKeys: string[];
    providers: {
        slack: boolean;
        discord: boolean;
        teams: boolean;
        pagerduty: boolean;
        webhook: boolean;
        sms: boolean;
        email: boolean;
    };
    isProviderAllowed(channelKind: NotificationChannelKind, connectorBacked?: boolean): boolean;
}
export declare class NotificationEntitlementService {
    private readonly reader;
    constructor(reader?: NotificationEntitlementReader);
    resolve(organizationId: string): Promise<NotificationEntitlementDecision>;
    private fromRows;
}
//# sourceMappingURL=notification-entitlement.service.d.ts.map