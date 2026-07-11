import { type CreateConnectorInput } from './core/connector.repository.js';
import { type InsertDeliveryInput } from './delivery/delivery.repository.js';
import type { PoolClient } from 'pg';
import type { ConnectorConfigRow, ConnectorStatus, DeliveryRow, DeliveryStatus, FailureCategory, HealthCheckRow, HealthState, ListConnectorsQuery } from './types.js';
export * from './core/connector.repository.js';
export * from './delivery/delivery.repository.js';
export * from './metrics/metrics.repository.js';
export * from './audit/audit.repository.js';
export declare class ConnectorRepository {
    private readonly core;
    private readonly delivery;
    private readonly metrics;
    private readonly audit;
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
}
//# sourceMappingURL=repository.d.ts.map