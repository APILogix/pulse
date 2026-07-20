/**
 * Project connector subscription persistence.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Enforce tenant isolation by scoping every query to project_id and/or
 *    organization_id.
 * 3. Support transactional reads/writes so alert routing can resolve targets
 *    consistently within a single connection.
 */
import type { Pool, PoolClient } from "pg";
import type { CreateProjectConnectorSubscriptionBody, ListProjectConnectorSubscriptionsQuery, ProjectConnectorSubscription, UpdateProjectConnectorSubscriptionBody, AlertRoutingTarget } from "./connector-subscription.types.js";
type DbClient = Pool | PoolClient;
export declare class ConnectorSubscriptionRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    listByProject(projectId: string, query: ListProjectConnectorSubscriptionsQuery, client?: DbClient): Promise<{
        subscriptions: ProjectConnectorSubscription[];
        total: number;
    }>;
    findById(subscriptionId: string, client?: DbClient): Promise<ProjectConnectorSubscription | null>;
    findByProjectAndConnector(projectId: string, connectorId: string, client?: DbClient): Promise<ProjectConnectorSubscription | null>;
    create(projectId: string, organizationId: string, createdByUserId: string, body: CreateProjectConnectorSubscriptionBody, client?: DbClient): Promise<ProjectConnectorSubscription>;
    update(subscriptionId: string, updatedByUserId: string, body: UpdateProjectConnectorSubscriptionBody, client?: DbClient): Promise<ProjectConnectorSubscription>;
    delete(subscriptionId: string, deletedByUserId: string, client?: DbClient): Promise<void>;
    /**
     * Deterministic alert routing lookup: API Key -> Environment -> Project ->
     * Project Connector Subscriptions -> Project Members.
     *
     * Resolves a single API key to its routing context including the active
     * connector subscriptions and project members that should receive alerts.
     */
    resolveAlertRoutingTarget(apiKeyId: string, client?: DbClient): Promise<AlertRoutingTarget | null>;
    /**
     * Resolve alert routing targets by project id.
     *
     * Fallback for alert events that do not carry an explicit api_key_id but are
     * already scoped to a project. Still enforces the same Project -> Subscriptions
     * -> Members lookup.
     */
    resolveAlertRoutingTargetByProjectId(projectId: string, client?: DbClient): Promise<AlertRoutingTarget | null>;
    private mapSubscription;
}
export {};
//# sourceMappingURL=connector-subscription.repository.d.ts.map