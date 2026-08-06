import type { PoolClient } from 'pg';

export const ALERTING_WORKSPACE_INITIALIZATION_VERSION = 'alerting-v2-1';

export type AlertingProvisioningContext = {
  organizationId: string;
  initializedBy: string;
  subscriptionId: string;
  planId: string;
};

export type AlertingProvisioningSummary = {
  workspaceId: string;
  initializationVersion: string;
  categories: number;
  policies: number;
  policyVersions: number;
  routingDefaults: number;
  escalationPolicies: number;
  escalationSteps: number;
  providers: number;
  dashboardWidgets: number;
  savedViews: number;
  featureFlags: number;
};

export type TransactionClient = PoolClient;

export type JsonObject = Record<string, unknown>;

export type AlertingWorkspaceRepository = {
  provision(client: TransactionClient, context: AlertingProvisioningContext): Promise<AlertingProvisioningSummary>;
};
