import type { NotificationChannelKind } from './alert-runtime.repository.js';
import type {
  NotificationDeliveryMode,
  NotificationProvider,
  NotificationRecipientType,
} from './notification-entitlement.service.js';

export type RoutingSuppressionReason =
  | 'silenced'
  | 'missing_project_context'
  | 'no_eligible_channels'
  | 'no_verified_project_recipients'
  | 'owner_email_unavailable'
  | 'entitlement_unknown';

export interface CanonicalNotificationTarget {
  channelKind: NotificationChannelKind;
  channelId: string | null;
  connectorId: string | null;
  recipientUserId: string | null;
  recipientRef: string | null;
  routeId: string | null;
  deliveryMode: NotificationDeliveryMode;
  recipientType: NotificationRecipientType;
  provider: NotificationProvider;
}

export interface NotificationRoutingDecision {
  targets: CanonicalNotificationTarget[];
  suppressed: boolean;
  suppressionReason: RoutingSuppressionReason | null;
  usedNoChannelFallback: boolean;
  deliveryMode: NotificationDeliveryMode;
  reason: string;
  decisionHash: string;
}
