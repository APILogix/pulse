export declare function recordNotificationRouting(reason: string): void;
export declare function recordNotificationDelivery(reason: string): void;
export declare function recordConnectorTestDenied(): void;
export declare const notificationMetricNames: {
    readonly normal: "notification.routing.normal";
    readonly restricted: "notification.routing.email_only_restricted";
    readonly entitlementBlocked: "notification.routing.entitlement_blocked";
    readonly ownerFallback: "notification.routing.owner_fallback";
    readonly noRecipient: "notification.routing.no_recipient";
    readonly deliveryEntitlementBlocked: "notification.delivery.entitlement_blocked";
    readonly connectorTestDenied: "notification.connector.test_denied";
};
//# sourceMappingURL=notification-metrics.d.ts.map