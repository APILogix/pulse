/**
 * Connector business service.
 *
 * Owns connector lifecycle rules:
 *   - Validate the provided config against the connector type's Zod schema
 *     before persisting (via the registry / a transient connector instance).
 *   - Encrypt sensitive config at rest; derive capability flags from the
 *     registry so they cannot drift from the implementation.
 *   - Never return decrypted credentials to clients (DTOs are credential-free).
 *   - Write a connector audit record for every mutating operation.
 */
import type { FastifyBaseLogger } from 'fastify';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { type ConnectorJobName } from './job.constants.js';
import { type ConnectorAuditLogDto, type ConnectionTestResult, type ConnectorConfigRow, type ConnectorDto, type ConnectorOAuthStartDto, type ConnectorRouteDto, type ConnectorTypeInfoDto, type CreateConnectorRouteBody, type CreateConnectorBody, type DeliveryAttemptRow, type DeliveryDto, type DispatchSummary, type HealthStatus, type ListConnectorsQuery, type OAuthCallbackBody, type PaginationQuery, type PreviewNotificationBody, type RequestMeta, type RotateSecretBody, type SendTestNotificationBody, type UpdateConnectorRouteBody, type UpdateConnectorBody, type ValidateConfigurationBody } from './types.js';
export interface ConnectorServiceDeps {
    repository: ConnectorRepository;
    dispatcher: NotificationDispatcher;
    logger: FastifyBaseLogger;
    emitEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
    enqueueConnectorJob?: (queue: ConnectorJobName, data: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
}
export declare class ConnectorService {
    private readonly repository;
    private readonly dispatcher;
    private readonly logger;
    private readonly emitEvent;
    private readonly enqueueConnectorJob?;
    constructor(deps: ConnectorServiceDeps);
    listTypes(): ConnectorTypeInfoDto[];
    createConnector(orgId: string, meta: RequestMeta, body: CreateConnectorBody): Promise<ConnectorDto>;
    listConnectors(orgId: string, query: ListConnectorsQuery): Promise<{
        data: ConnectorDto[];
        total: number;
        limit: number;
        offset: number;
    }>;
    getConnector(orgId: string, id: string): Promise<ConnectorDto>;
    updateConnector(orgId: string, meta: RequestMeta, id: string, body: UpdateConnectorBody): Promise<ConnectorDto>;
    deleteConnector(orgId: string, meta: RequestMeta, id: string): Promise<void>;
    setConnectorEnabled(orgId: string, meta: RequestMeta, id: string, enabled: boolean): Promise<ConnectorDto>;
    rotateSecret(orgId: string, meta: RequestMeta, id: string, body: RotateSecretBody): Promise<ConnectorDto>;
    validateConfiguration(body: ValidateConfigurationBody): {
        valid: boolean;
        errors: string[];
        normalized?: Record<string, unknown>;
    };
    testConnection(orgId: string, meta: RequestMeta, id: string): Promise<ConnectionTestResult>;
    runConnectionTest(row: ConnectorConfigRow, triggeredBy: string | null): Promise<ConnectionTestResult>;
    runHealthCheckForConnector(orgId: string, meta: RequestMeta, id: string): Promise<HealthStatus>;
    sendTest(orgId: string, meta: RequestMeta, id: string, body: SendTestNotificationBody): Promise<DispatchSummary>;
    listDeliveries(orgId: string, filters: {
        connectorId?: string;
        limit: number;
        offset: number;
    }): Promise<{
        data: DeliveryDto[];
        total: number;
    }>;
    getDelivery(orgId: string, deliveryId: string): Promise<DeliveryDto & {
        payload?: Record<string, unknown>;
    }>;
    listDeliveryAttempts(orgId: string, connectorId: string, deliveryId: string, query: PaginationQuery): Promise<{
        data: DeliveryAttemptRow[];
        total: number;
    }>;
    retryDelivery(orgId: string, meta: RequestMeta, deliveryId: string): Promise<DeliveryDto>;
    listHealthHistory(orgId: string, connectorId: string, query: PaginationQuery): Promise<{
        data: HealthStatus[];
        total: number;
    }>;
    listTestRuns(orgId: string, connectorId: string, query: PaginationQuery): Promise<{
        data: import('./types.js').ConnectorTestRunDto[];
        total: number;
    }>;
    listAudit(orgId: string, connectorId: string | null, query: PaginationQuery): Promise<{
        data: ConnectorAuditLogDto[];
        total: number;
    }>;
    createRoute(orgId: string, meta: RequestMeta, connectorId: string, body: CreateConnectorRouteBody): Promise<ConnectorRouteDto>;
    updateRoute(orgId: string, meta: RequestMeta, connectorId: string, routeId: string, body: UpdateConnectorRouteBody): Promise<ConnectorRouteDto>;
    deleteRoute(orgId: string, meta: RequestMeta, connectorId: string, routeId: string): Promise<void>;
    listRoutes(orgId: string, connectorId: string, query: PaginationQuery): Promise<{
        data: ConnectorRouteDto[];
        total: number;
    }>;
    startOAuth(orgId: string, meta: RequestMeta, connectorId: string): Promise<ConnectorOAuthStartDto>;
    completeOAuth(orgId: string, meta: RequestMeta, connectorId: string, body: OAuthCallbackBody): Promise<{
        connected: boolean;
        refreshQueued: boolean;
        refreshJobId: string | null;
    }>;
    refreshOAuth(orgId: string, meta: RequestMeta, connectorId: string): Promise<{
        queued: boolean;
        jobId: string | null;
    }>;
    disconnectOAuth(orgId: string, meta: RequestMeta, connectorId: string): Promise<{
        disconnected: boolean;
    }>;
    previewNotification(body: PreviewNotificationBody): Promise<Record<string, unknown>>;
    /** Run a health check for a connector row (used by the background monitor). */
    runHealthCheck(row: ConnectorConfigRow): Promise<HealthStatus>;
    private requireConnector;
    private validateConfigOrThrow;
    private audit;
    private toDto;
    private deliveryToDto;
    private routeToDto;
    private resolveOAuthExpiry;
    private enqueueOAuthRefreshIfNeeded;
    private enqueueConnectorTestIfAvailable;
}
//# sourceMappingURL=service.d.ts.map