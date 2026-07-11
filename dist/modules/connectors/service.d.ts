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
import { type ConnectionTestResult, type ConnectorConfigRow, type ConnectorDto, type ConnectorTypeInfoDto, type CreateConnectorBody, type DeliveryDto, type DispatchSummary, type HealthStatus, type ListConnectorsQuery, type RequestMeta, type SendTestNotificationBody, type UpdateConnectorBody } from './types.js';
export interface ConnectorServiceDeps {
    repository: ConnectorRepository;
    dispatcher: NotificationDispatcher;
    logger: FastifyBaseLogger;
    emitEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
}
export declare class ConnectorService {
    private readonly repository;
    private readonly dispatcher;
    private readonly logger;
    private readonly emitEvent;
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
    testConnection(orgId: string, meta: RequestMeta, id: string): Promise<ConnectionTestResult>;
    sendTest(orgId: string, meta: RequestMeta, id: string, body: SendTestNotificationBody): Promise<DispatchSummary>;
    listDeliveries(orgId: string, filters: {
        connectorId?: string;
        limit: number;
        offset: number;
    }): Promise<{
        data: DeliveryDto[];
        total: number;
    }>;
    /** Run a health check for a connector row (used by the background monitor). */
    runHealthCheck(row: ConnectorConfigRow): Promise<HealthStatus>;
    private requireConnector;
    private validateConfigOrThrow;
    private audit;
    private toDto;
    private deliveryToDto;
}
//# sourceMappingURL=service.d.ts.map