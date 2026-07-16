import { type CreateConnectorInput } from './core/connector.repository.js';
import { type InsertDeliveryInput } from './delivery/delivery.repository.js';
import type { PoolClient } from 'pg';
import type { ConnectorConfigRow, ConnectorStatus, DeliveryRow, DeliveryStatus, FailureCategory, HealthCheckRow, HealthState, ListConnectorsQuery } from './types.js';
export * from './core/connector.repository.js';
export * from './delivery/delivery.repository.js';
export * from './metrics/metrics.repository.js';
export * from './audit/audit.repository.js';
export * from './routing/routes.repository.js';
export declare class ConnectorRepository {
    private readonly core;
    private readonly delivery;
    private readonly metrics;
    private readonly audit;
    private readonly routes;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    create(input: CreateConnectorInput): Promise<ConnectorConfigRow>;
    findById(organizationId: string, id: string): Promise<ConnectorConfigRow | null>;
    findByIdInternal(id: string): Promise<ConnectorConfigRow | null>;
    getByIds(ids: string[]): Promise<ConnectorConfigRow[]>;
    list(organizationId: string, query: ListConnectorsQuery): Promise<{
        data: ConnectorConfigRow[];
        total: number;
    }>;
    listMonitorable(): Promise<ConnectorConfigRow[]>;
    update(organizationId: string, id: string, fields: Record<string, unknown>): Promise<ConnectorConfigRow>;
    upsertCredential(input: import('./core/connector.repository.js').UpsertConnectorCredentialInput): Promise<void>;
    getCredential(organizationId: string, connectorId: string, keyName: string): Promise<import("./core/connector.repository.js").ConnectorCredentialRow | null>;
    softDelete(organizationId: string, id: string): Promise<void>;
    setStatus(organizationId: string, id: string, status: ConnectorStatus): Promise<void>;
    insertDelivery(input: InsertDeliveryInput): Promise<DeliveryRow>;
    markDeliverySent(id: string, update: {
        externalMessageId: string | null;
        responseStatusCode: number | null;
        responseBody: string | null;
        latencyMs: number;
    }): Promise<void>;
    markDeliveryRetrying(id: string, nextRetryAt: Date, errorMessage: string): Promise<void>;
    markDeliveryFailed(id: string, errorMessage: string, errorDetails: Record<string, unknown> | null): Promise<void>;
    claimRetryableDeliveries(limit: number): Promise<DeliveryRow[]>;
    listDeliveries(organizationId: string, filters: {
        connectorId?: string;
        status?: DeliveryStatus;
        limit: number;
        offset: number;
    }): Promise<{
        data: DeliveryRow[];
        total: number;
    }>;
    getDelivery(organizationId: string, id: string): Promise<DeliveryRow | null>;
    insertDeliveryIdempotent(input: import('./delivery/delivery.repository.js').InsertDeliveryInput): Promise<{
        row: DeliveryRow;
        existed: boolean;
    }>;
    findDeliveryByDedupKey(connectorId: string, dedupKey: string, windowMinutes: number): Promise<DeliveryRow | null>;
    listAttempts(organizationId: string, connectorId: string, deliveryId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import("./types.js").DeliveryAttemptRow[];
        total: number;
    }>;
    retryDelivery(organizationId: string, id: string): Promise<DeliveryRow | null>;
    getDlqGrowth(windowMinutes: number): Promise<number>;
    insertDeadLetter(input: {
        originalDeliveryId: string;
        organizationId: string;
        connectorId: string;
        failureReason: string;
        failureCategory: FailureCategory;
        errorStack: string | null;
        originalPayload: Record<string, unknown>;
        retryAttempts: number;
    }): Promise<void>;
    recordSuccess(connectorId: string): Promise<void>;
    recordFailure(connectorId: string): Promise<{
        consecutiveFailures: number;
        tripped: boolean;
    }>;
    insertHealthCheck(connectorId: string, state: HealthState, responseTimeMs: number | null, errorMessage: string | null, details: Record<string, unknown>): Promise<HealthCheckRow>;
    listHealthChecks(organizationId: string, connectorId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: HealthCheckRow[];
        total: number;
    }>;
    insertTestRun(input: {
        connectorId: string;
        triggeredBy: string | null;
        status: string;
        response: Record<string, unknown> | null;
        durationMs: number | null;
    }): Promise<void>;
    listTestRuns(organizationId: string, connectorId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import("./types.js").ConnectorTestRunRow[];
        total: number;
    }>;
    insertAuditLog(input: {
        organizationId: string;
        connectorId: string | null;
        action: string;
        actorId: string | null;
        actorType?: string;
        previousState?: Record<string, unknown> | null;
        newState?: Record<string, unknown> | null;
        changesSummary?: Record<string, unknown> | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        requestId?: string | null;
    }): Promise<void>;
    listAuditLogs(organizationId: string, connectorId: string | null, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import("./types.js").ConnectorAuditLogRow[];
        total: number;
    }>;
    createRoute(organizationId: string, connectorId: string, input: import('./types.js').CreateConnectorRouteBody): Promise<import("./types.js").ConnectorRouteRow>;
    updateRoute(organizationId: string, connectorId: string, routeId: string, input: import('./types.js').UpdateConnectorRouteBody): Promise<import("./types.js").ConnectorRouteRow | null>;
    deleteRoute(organizationId: string, connectorId: string, routeId: string): Promise<boolean>;
    listRoutes(organizationId: string, connectorId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import("./types.js").ConnectorRouteRow[];
        total: number;
    }>;
    listRoutesByIds(organizationId: string, routeIds: string[]): Promise<import("./types.js").ConnectorRouteRow[]>;
    createOAuthState(input: {
        connectorId: string;
        state: string;
        codeVerifier: string;
        expiresAt: Date;
    }): Promise<import("./types.js").ConnectorOAuthStateRow>;
    consumeOAuthState(organizationId: string, connectorId: string, state: string): Promise<import("./types.js").ConnectorOAuthStateRow | null>;
    cleanupExpiredOAuthStates(): Promise<number>;
    findOAuthStateWithConnector(client: PoolClient, state: string): Promise<any>;
    deleteOAuthState(client: PoolClient, id: string): Promise<void>;
}
//# sourceMappingURL=repository.d.ts.map