import type { PoolClient } from 'pg';
import { type AlertingProvisioningContext, type AlertingProvisioningSummary, type JsonObject } from './alerting-workspace.types.js';
export declare class AlertingWorkspaceRepository {
    provision(client: PoolClient, context: AlertingProvisioningContext): Promise<AlertingProvisioningSummary>;
    private syncDefaultPolicyCatalog;
    private readySummary;
    private lockWorkspace;
    getWorkspaceSnapshot(organizationId: string): Promise<{
        workspace: any;
        categories: any[];
        policies: any[];
        routingDefaults: any[];
        escalationPolicies: any[];
        settings: any;
        maintenance: any;
        notificationDefaults: any;
        providerCatalog: any[];
        entitlements: any;
        usage: any;
        featureFlags: any[];
        dashboardWidgets: any[];
        savedViews: any[];
        audit: any[];
        search: any;
    } | null>;
    listPolicies(organizationId: string, query?: {
        limit?: number;
        offset?: number;
    }): Promise<{
        data: any[];
        total: number;
        limit: number;
        offset: number;
    }>;
    getPolicy(organizationId: string, policyId: string): Promise<any>;
    createPolicy(organizationId: string, actorId: string, input: {
        slug: string;
        name: string;
        description: string;
        category: string;
        severity: string;
        metricSource: string;
        expression: string;
        defaultThreshold: JsonObject;
        recoveryThreshold: JsonObject;
        cooldownSeconds: number;
        evaluationWindowSeconds: number;
        documentation: string;
        dependencies: string[];
    }): Promise<any>;
    createPolicyVersion(organizationId: string, actorId: string, policyId: string, definition: JsonObject): Promise<any>;
    updateSettings(organizationId: string, input: Record<string, unknown>): Promise<any>;
    updateMaintenance(organizationId: string, input: Record<string, unknown>): Promise<any>;
    updateNotificationDefaults(organizationId: string, input: Record<string, unknown>): Promise<any>;
    private updateWorkspaceRow;
    private withTransaction;
}
//# sourceMappingURL=alerting-workspace.repository.d.ts.map