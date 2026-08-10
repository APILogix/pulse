import promClient from 'prom-client';
import { register } from '../../../config/metrics.js';

const ROUTING_METRIC = 'notification_routing_total';
const DELIVERY_METRIC = 'notification_delivery_total';

function counter(name: string, help: string, labelNames: string[]): promClient.Counter<string> {
  const existing = register.getSingleMetric(name);
  if (existing) return existing as promClient.Counter<string>;
  return new promClient.Counter({ name, help, labelNames, registers: [register] });
}

export function recordNotificationRouting(reason: string): void {
  counter(
    ROUTING_METRIC,
    'Notification routing decisions by bounded outcome.',
    ['outcome'],
  ).inc({ outcome: reason });
}

export function recordNotificationDelivery(reason: string): void {
  counter(
    DELIVERY_METRIC,
    'Notification delivery outcomes by bounded reason.',
    ['outcome'],
  ).inc({ outcome: reason });
}

export function recordConnectorTestDenied(): void {
  counter(
    'notification_connector_test_denied_total',
    'Connector test attempts denied by notification entitlement.',
    [],
  ).inc();
}

export const notificationMetricNames = {
  normal: 'notification.routing.normal',
  restricted: 'notification.routing.email_only_restricted',
  entitlementBlocked: 'notification.routing.entitlement_blocked',
  ownerFallback: 'notification.routing.owner_fallback',
  noRecipient: 'notification.routing.no_recipient',
  deliveryEntitlementBlocked: 'notification.delivery.entitlement_blocked',
  connectorTestDenied: 'notification.connector.test_denied',
} as const;
