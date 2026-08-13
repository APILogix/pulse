import { EntitlementsRepository, type EffectiveEntitlementRow } from '../../billing/entitlements/repository.js';
import type { NotificationChannelKind } from './alert-runtime.repository.js';

export const CONNECTOR_FEATURE_KEYS = {
  email: 'integrations.email',
  slack: 'integrations.slack',
  discord: 'integrations.discord',
  teams: 'integrations.microsoft_teams',
  pagerduty: 'integrations.pagerduty',
  webhook: 'integrations.webhook',
  sms: 'integrations.sms',
} as const satisfies Partial<Record<NotificationChannelKind, string>>;

export const CONNECTOR_ALIAS_KEYS = {
  teams: 'integrations.teams',
} as const;

export const CONNECTOR_LEGACY_KEYS = {
  email: 'email_alerts',
  slack: 'slack_connector',
  discord: 'discord_connector',
  teams: 'teams_connector',
  pagerduty: 'pagerduty_connector',
  webhook: 'webhook_connector',
  sms: 'sms_connector',
} as const satisfies Partial<Record<NotificationChannelKind, string>>;

export type NotificationDeliveryMode = 'NORMAL_CONNECTOR' | 'EMAIL_ONLY_RESTRICTED';

export type NotificationEntitlementReason =
  | 'CONNECTOR_ACCESS_ALLOWED'
  | 'CONNECTOR_ENTITLEMENT_REQUIRED'
  | 'ENTITLEMENT_UNKNOWN';

export type NotificationProvider =
  | 'MANAGED_EMAIL'
  | 'IN_APP'
  | 'EMAIL'
  | 'SLACK'
  | 'DISCORD'
  | 'TEAMS'
  | 'PAGERDUTY'
  | 'WEBHOOK'
  | 'SMS';

export type NotificationRecipientType =
  | 'PROJECT_OWNER'
  | 'ORGANIZATION_FALLBACK'
  | 'PROJECT_MEMBER'
  | 'CHANNEL_DESTINATION';

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

const CONNECTOR_CHANNELS = Object.keys(CONNECTOR_FEATURE_KEYS) as Array<keyof typeof CONNECTOR_FEATURE_KEYS>;

export class NotificationEntitlementService {
  constructor(
    private readonly reader: NotificationEntitlementReader = new EntitlementsRepository(),
  ) {}

  async resolve(organizationId: string): Promise<NotificationEntitlementDecision> {
    try {
      const rows = await this.reader.getEffectiveEntitlements(organizationId);
      return this.fromRows(rows);
    } catch {
      return {
        mode: 'EMAIL_ONLY_RESTRICTED',
        connectorAccess: false,
        alertingEnabled: false,
        externalConnectorsEnabled: false,
        managedEmailEnabled: true,
        reason: 'ENTITLEMENT_UNKNOWN',
        featureKeys: [],
        providers: {
          slack: false,
          discord: false,
          teams: false,
          pagerduty: false,
          webhook: false,
          sms: false,
          email: false,
        },
        isProviderAllowed: () => false,
      };
    }
  }

  private fromRows(rows: EffectiveEntitlementRow[]): NotificationEntitlementDecision {
    const values = new Map(rows.map((row) => [row.feature_key, entitlementValue(row)]));
    const alertRulesLimit = numericValue(values.get('alert_rules') ?? values.get('quota.alert_rules'));
    const alertingEnabled = values.get('alerting.enabled') === true
      || values.get('in_app_alerts') === true
      || values.get('email_alerts') === true
      || alertRulesLimit > 0
      || alertRulesLimit === -1;

    const connectorLimit = numericValue(values.get('quota.connectors') ?? values.get('connectors'));
    const integrationLimit = numericValue(values.get('quota.integrations'));
    const effectiveLimit = connectorLimit > 0 || connectorLimit === -1 ? connectorLimit : integrationLimit;

    const isProviderActive = (channel: keyof typeof CONNECTOR_FEATURE_KEYS): boolean => {
      const canonicalKey = CONNECTOR_FEATURE_KEYS[channel];
      const aliasKey = channel in CONNECTOR_ALIAS_KEYS ? CONNECTOR_ALIAS_KEYS[channel as keyof typeof CONNECTOR_ALIAS_KEYS] : null;
      const legacyKey = CONNECTOR_LEGACY_KEYS[channel];
      return (Boolean(canonicalKey) && values.get(canonicalKey!) === true)
        || (Boolean(aliasKey) && values.get(aliasKey!) === true)
        || (Boolean(legacyKey) && values.get(legacyKey!) === true);
    };

    const providers = {
      slack: isProviderActive('slack'),
      discord: isProviderActive('discord'),
      teams: isProviderActive('teams'),
      pagerduty: isProviderActive('pagerduty'),
      webhook: isProviderActive('webhook'),
      sms: isProviderActive('sms'),
      email: isProviderActive('email'),
    };

    const enabledProviders = CONNECTOR_CHANNELS.filter((ch) => providers[ch]);
    const externalConnectorsEnabled = (effectiveLimit === -1 || effectiveLimit > 0) && enabledProviders.length > 0;
    const connectorAccess = alertingEnabled && externalConnectorsEnabled;
    const managedEmailEnabled = alertingEnabled || values.get('email_alerts') === true || rows.length === 0;

    const featureKeys = [
      'alerting.enabled',
      'quota.connectors',
      'quota.integrations',
      'connectors',
      'alert_rules',
      ...CONNECTOR_CHANNELS.map((channel) => CONNECTOR_FEATURE_KEYS[channel]),
      ...Object.values(CONNECTOR_ALIAS_KEYS),
      ...CONNECTOR_CHANNELS.map((channel) => CONNECTOR_LEGACY_KEYS[channel]),
    ];

    return {
      mode: connectorAccess ? 'NORMAL_CONNECTOR' : 'EMAIL_ONLY_RESTRICTED',
      connectorAccess,
      alertingEnabled,
      externalConnectorsEnabled,
      managedEmailEnabled,
      reason: connectorAccess ? 'CONNECTOR_ACCESS_ALLOWED' : 'CONNECTOR_ENTITLEMENT_REQUIRED',
      featureKeys,
      providers,
      isProviderAllowed: (channelKind, connectorBacked = true) => {
        if (channelKind === 'in_app') return true;
        if (channelKind === 'email' && !connectorBacked) return true;
        if (channelKind in providers) {
          return providers[channelKind as keyof typeof providers];
        }
        return false;
      },
    };
  }
}

function entitlementValue(row: EffectiveEntitlementRow): boolean | number | string | null {
  if (row.boolean_value !== null) return row.boolean_value;
  if (row.integer_value !== null) return Number(row.integer_value);
  if (row.decimal_value !== null) return Number(row.decimal_value);
  return row.string_value;
}

function numericValue(value: boolean | number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
