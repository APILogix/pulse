import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';
import { AlertingWorkspaceProvisioner } from './alerting-workspace.provisioner.js';
import type { AlertingProvisioningContext, JsonObject } from './alerting-workspace.types.js';
import { AlertingWorkspaceRepository } from './alerting-workspace.repository.js';
export declare class AlertingWorkspaceService {
    private readonly repository;
    private readonly provisioner;
    private readonly logger?;
    constructor(repository?: AlertingWorkspaceRepository, provisioner?: AlertingWorkspaceProvisioner, logger?: FastifyBaseLogger | undefined);
    provision(client: PoolClient, context: AlertingProvisioningContext): Promise<import("./alerting-workspace.types.js").AlertingProvisioningSummary>;
    provisionWorkspace(context: AlertingProvisioningContext): Promise<import("./alerting-workspace.types.js").AlertingProvisioningSummary>;
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
    updateSettings(organizationId: string, actorId: string, input: Record<string, unknown>): Promise<any>;
    updateMaintenance(organizationId: string, actorId: string, input: Record<string, unknown>): Promise<any>;
    updateNotificationDefaults(organizationId: string, actorId: string, input: Record<string, unknown>): Promise<any>;
    private requireRole;
}
//# sourceMappingURL=alerting-workspace.service.d.ts.map