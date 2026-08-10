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
  | 'PROJECT_MEMBER'
  | 'CHANNEL_DESTINATION';

export interface NotificationEntitlementReader {
  getEffectiveEntitlements(organizationId: string): Promise<EffectiveEntitlementRow[]>;
}

export interface NotificationEntitlementDecision {
  mode: NotificationDeliveryMode;
  connectorAccess: boolean;
  reason: NotificationEntitlementReason;
  featureKeys: string[];
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
        reason: 'ENTITLEMENT_UNKNOWN',
        featureKeys: [],
        isProviderAllowed: () => false,
      };
    }
  }

  private fromRows(rows: EffectiveEntitlementRow[]): NotificationEntitlementDecision {
    const values = new Map(rows.map((row) => [row.feature_key, entitlementValue(row)]));
    const alertingEnabled = values.get('alerting.enabled') === true;
    const connectorLimit = numericValue(values.get('quota.connectors'));
    const integrationLimit = numericValue(values.get('quota.integrations'));
    const effectiveLimit = connectorLimit > 0 || connectorLimit === -1 ? connectorLimit : integrationLimit;
    const enabledProviders = CONNECTOR_CHANNELS.filter((channel) => values.get(CONNECTOR_FEATURE_KEYS[channel]) === true);
    const connectorAccess = alertingEnabled
      && (effectiveLimit === -1 || effectiveLimit > 0)
      && enabledProviders.length > 0;

    const featureKeys = [
      'alerting.enabled',
      'quota.connectors',
      'quota.integrations',
      ...CONNECTOR_CHANNELS.map((channel) => CONNECTOR_FEATURE_KEYS[channel]),
    ];

    return {
      mode: connectorAccess ? 'NORMAL_CONNECTOR' : 'EMAIL_ONLY_RESTRICTED',
      connectorAccess,
      reason: connectorAccess ? 'CONNECTOR_ACCESS_ALLOWED' : 'CONNECTOR_ENTITLEMENT_REQUIRED',
      featureKeys,
      isProviderAllowed: (channelKind, connectorBacked = true) => {
        if (channelKind === 'in_app') return true;
        if (channelKind === 'email' && !connectorBacked) return true;
        const featureKey = CONNECTOR_FEATURE_KEYS[channelKind as keyof typeof CONNECTOR_FEATURE_KEYS];
        return featureKey ? values.get(featureKey) === true : false;
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
