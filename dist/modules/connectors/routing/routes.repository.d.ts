import type { ConnectorOAuthStateRow, ConnectorRouteRow, CreateConnectorRouteBody, UpdateConnectorRouteBody } from '../types.js';
export declare class ConnectorRoutesRepository {
    private readonly db;
    createRoute(organizationId: string, connectorId: string, input: CreateConnectorRouteBody): Promise<ConnectorRouteRow>;
    updateRoute(organizationId: string, connectorId: string, routeId: string, input: UpdateConnectorRouteBody): Promise<ConnectorRouteRow | null>;
    deleteRoute(organizationId: string, connectorId: string, routeId: string): Promise<boolean>;
    getRoute(organizationId: string, connectorId: string, routeId: string): Promise<ConnectorRouteRow | null>;
    listRoutes(organizationId: string, connectorId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: ConnectorRouteRow[];
        total: number;
    }>;
    listRoutesByIds(organizationId: string, routeIds: string[]): Promise<ConnectorRouteRow[]>;
    createOAuthState(input: {
        connectorId: string;
        state: string;
        codeVerifier: string;
        expiresAt: Date;
    }): Promise<ConnectorOAuthStateRow>;
    consumeOAuthState(organizationId: string, connectorId: string, state: string): Promise<ConnectorOAuthStateRow | null>;
    cleanupExpiredOAuthStates(): Promise<number>;
    findOAuthStateWithConnector(client: import('pg').PoolClient, state: string): Promise<any>;
    deleteOAuthState(client: import('pg').PoolClient, id: string): Promise<void>;
    private requireOwnedConnector;
    private requireOwnedProject;
}
//# sourceMappingURL=routes.repository.d.ts.map