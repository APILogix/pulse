import type { JsonObject } from './alerting-workspace.types.js';
export type PolicyCategoryDefault = {
    slug: string;
    name: string;
    sortOrder: number;
};
export type PolicyDefault = {
    slug: string;
    name: string;
    description: string;
    category: string;
    severity: 'info' | 'warning' | 'error' | 'critical';
    metricSource: string;
    expression: string;
    defaultThreshold: JsonObject;
    recoveryThreshold: JsonObject;
    cooldownSeconds: number;
    evaluationWindowSeconds: number;
    enabled: boolean;
    documentation: string;
    dependencies: string[];
};
export declare const POLICY_CATEGORIES: readonly PolicyCategoryDefault[];
export declare const POLICY_DEFAULTS: readonly PolicyDefault[];
export declare const ROUTING_DEFAULTS: readonly [{
    readonly severity: "critical";
    readonly destinationType: "email";
    readonly priority: 100;
}, {
    readonly severity: "high";
    readonly destinationType: "email";
    readonly priority: 100;
}, {
    readonly severity: "medium";
    readonly destinationType: "dashboard";
    readonly priority: 100;
}, {
    readonly severity: "low";
    readonly destinationType: "dashboard";
    readonly priority: 100;
}];
export declare const ESCALATION_DEFAULTS: readonly [{
    readonly systemKey: "default";
    readonly name: "Default";
    readonly description: "Default organization escalation chain.";
    readonly acknowledgementTimeoutSeconds: 900;
    readonly repeatIntervalSeconds: 1800;
    readonly maxRepeats: 2;
}, {
    readonly systemKey: "critical";
    readonly name: "Critical";
    readonly description: "Critical incident escalation chain.";
    readonly acknowledgementTimeoutSeconds: 300;
    readonly repeatIntervalSeconds: 600;
    readonly maxRepeats: 3;
}, {
    readonly systemKey: "production";
    readonly name: "Production";
    readonly description: "Production service escalation chain.";
    readonly acknowledgementTimeoutSeconds: 600;
    readonly repeatIntervalSeconds: 900;
    readonly maxRepeats: 2;
}];
export declare const PROVIDER_DEFAULTS: readonly [{
    readonly providerKey: "slack";
    readonly displayName: "Slack";
    readonly capabilities: {
        readonly chat: true;
    };
}, {
    readonly providerKey: "discord";
    readonly displayName: "Discord";
    readonly capabilities: {
        readonly chat: true;
    };
}, {
    readonly providerKey: "teams";
    readonly displayName: "Teams";
    readonly capabilities: {
        readonly chat: true;
    };
}, {
    readonly providerKey: "pagerduty";
    readonly displayName: "PagerDuty";
    readonly capabilities: {
        readonly paging: true;
    };
}, {
    readonly providerKey: "webhook";
    readonly displayName: "Webhook";
    readonly capabilities: {
        readonly http: true;
    };
}, {
    readonly providerKey: "email";
    readonly displayName: "Email";
    readonly capabilities: {
        readonly email: true;
    };
}, {
    readonly providerKey: "sms";
    readonly displayName: "SMS";
    readonly capabilities: {
        readonly sms: true;
    };
}];
export declare const FEATURE_FLAG_DEFAULTS: readonly [{
    readonly key: "alerting_enabled";
    readonly entitlementKey: "in_app_alerts";
    readonly description: "Enables Alerting V2.";
}, {
    readonly key: "policy_simulation";
    readonly entitlementKey: "in_app_alerts";
    readonly description: "Enables policy simulation.";
}, {
    readonly key: "correlation";
    readonly entitlementKey: "in_app_alerts";
    readonly description: "Enables incident correlation.";
}, {
    readonly key: "maintenance";
    readonly entitlementKey: "in_app_alerts";
    readonly description: "Enables maintenance suppression.";
}, {
    readonly key: "escalation";
    readonly entitlementKey: "in_app_alerts";
    readonly description: "Enables escalation policies.";
}, {
    readonly key: "digest";
    readonly entitlementKey: "email_alerts";
    readonly description: "Enables digest notifications.";
}, {
    readonly key: "anomaly_detection";
    readonly entitlementKey: "ai_alert_analysis";
    readonly description: "Enables anomaly detection.";
}, {
    readonly key: "ai";
    readonly entitlementKey: "ai_alert_analysis";
    readonly description: "Enables AI alert analysis.";
}];
export declare const DASHBOARD_WIDGET_DEFAULTS: readonly ["open_incidents", "critical_incidents", "policies", "notification_health", "connector_health", "mttr", "mtta", "alert_volume"];
export declare const SAVED_VIEW_DEFAULTS: readonly [{
    readonly key: "all_incidents";
    readonly name: "All Incidents";
    readonly filters: {};
}, {
    readonly key: "critical";
    readonly name: "Critical";
    readonly filters: {
        readonly severity: readonly ["critical"];
    };
}, {
    readonly key: "production";
    readonly name: "Production";
    readonly filters: {
        readonly environment: "production";
    };
}, {
    readonly key: "acknowledged";
    readonly name: "Acknowledged";
    readonly filters: {
        readonly state: "acknowledged";
    };
}, {
    readonly key: "resolved";
    readonly name: "Resolved";
    readonly filters: {
        readonly state: "resolved";
    };
}, {
    readonly key: "open";
    readonly name: "Open";
    readonly filters: {
        readonly state: readonly ["triggered", "acknowledged", "escalated", "muted"];
    };
}];
export declare const USAGE_COUNTER_KEYS: readonly ["policies_count", "custom_policies_count", "project_subscriptions_count", "notifications_count", "sms_count", "connector_deliveries_count", "incidents_count", "maintenance_windows_count", "escalations_count"];
//# sourceMappingURL=alerting-workspace.defaults.d.ts.map