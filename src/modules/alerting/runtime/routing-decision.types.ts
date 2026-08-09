import type { NotificationChannelKind } from './alert-runtime.repository.js';

export type RoutingSuppressionReason =
  | 'silenced'
  | 'missing_project_context'
  | 'no_eligible_channels'
  | 'no_verified_project_recipients';

export interface CanonicalNotificationTarget {
  channelKind: NotificationChannelKind;
  channelId: string | null;
  connectorId: string | null;
  recipientUserId: string | null;
  recipientRef: string | null;
  routeId: string | null;
}

export interface NotificationRoutingDecision {
  targets: CanonicalNotificationTarget[];
  suppressed: boolean;
  suppressionReason: RoutingSuppressionReason | null;
  usedNoChannelFallback: boolean;
  decisionHash: string;
}
