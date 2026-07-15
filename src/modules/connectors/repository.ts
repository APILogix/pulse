import { ConnectorRepository as CoreRepo, type CreateConnectorInput } from './core/connector.repository.js';
import { DeliveryRepository, type InsertDeliveryInput } from './delivery/delivery.repository.js';
import { ConnectorMetricsRepository } from './metrics/metrics.repository.js';
import { ConnectorAuditRepository } from './audit/audit.repository.js';
import { ConnectorRoutesRepository } from './routing/routes.repository.js';
import type { PoolClient } from 'pg';
import type { ConnectorConfigRow, ConnectorStatus, ConnectorType, DeliveryRow, DeliveryStatus, FailureCategory, HealthCheckRow, HealthState, ListConnectorsQuery, NotificationSeverity } from './types.js';

export * from './core/connector.repository.js';
export * from './delivery/delivery.repository.js';
export * from './metrics/metrics.repository.js';
export * from './audit/audit.repository.js';
export * from './routing/routes.repository.js';

export class ConnectorRepository {
  private readonly core = new CoreRepo();
  private readonly delivery = new DeliveryRepository();
  private readonly metrics = new ConnectorMetricsRepository();
  private readonly audit = new ConnectorAuditRepository();
  private readonly routes = new ConnectorRoutesRepository();

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.core.withTransaction(fn);
  }

  // Core
  async create(input: CreateConnectorInput) { return this.core.create(input); }
  async findById(organizationId: string, id: string) { return this.core.findById(organizationId, id); }
  async findByIdInternal(id: string) { return this.core.findByIdInternal(id); }
  async getByIds(ids: string[]) { return this.core.getByIds(ids); }
  async list(organizationId: string, query: ListConnectorsQuery) { return this.core.list(organizationId, query); }
  async listMonitorable() { return this.core.listMonitorable(); }
  async update(organizationId: string, id: string, fields: Record<string, unknown>) { return this.core.update(organizationId, id, fields); }
  async upsertCredential(input: import('./core/connector.repository.js').UpsertConnectorCredentialInput) { return this.core.upsertCredential(input); }
  async getCredential(organizationId: string, connectorId: string, keyName: string) { return this.core.getCredential(organizationId, connectorId, keyName); }
  async softDelete(organizationId: string, id: string) { return this.core.softDelete(organizationId, id); }
  async setStatus(organizationId: string, id: string, status: ConnectorStatus) { return this.core.setStatus(organizationId, id, status); }

  // Delivery
  async insertDelivery(input: InsertDeliveryInput) { return this.delivery.insertDelivery(input); }
  async markDeliverySent(id: string, update: { externalMessageId: string | null; responseStatusCode: number | null; responseBody: string | null; latencyMs: number; }) { return this.delivery.markDeliverySent(id, update); }
  async markDeliveryRetrying(id: string, nextRetryAt: Date, errorMessage: string) { return this.delivery.markDeliveryRetrying(id, nextRetryAt, errorMessage); }
  async markDeliveryFailed(id: string, errorMessage: string, errorDetails: Record<string, unknown> | null) { return this.delivery.markDeliveryFailed(id, errorMessage, errorDetails); }
  async claimRetryableDeliveries(limit: number) { return this.delivery.claimRetryableDeliveries(limit); }
  async listDeliveries(organizationId: string, filters: { connectorId?: string; status?: DeliveryStatus; limit: number; offset: number }) { return this.delivery.listDeliveries(organizationId, filters); }
  async getDelivery(organizationId: string, id: string) { return this.delivery.getDelivery(organizationId, id); }
  async listAttempts(organizationId: string, connectorId: string, deliveryId: string, filters: { limit: number; offset: number }) { return this.delivery.listAttempts(organizationId, connectorId, deliveryId, filters); }
  async retryDelivery(organizationId: string, id: string) { return this.delivery.retryDelivery(organizationId, id); }
  async insertDeadLetter(input: { originalDeliveryId: string; organizationId: string; connectorId: string; failureReason: string; failureCategory: FailureCategory; errorStack: string | null; originalPayload: Record<string, unknown>; retryAttempts: number; }) { return this.delivery.insertDeadLetter(input); }

  // Metrics
  async recordSuccess(connectorId: string) { return this.metrics.recordSuccess(connectorId); }
  async recordFailure(connectorId: string) { return this.metrics.recordFailure(connectorId); }
  async insertHealthCheck(connectorId: string, state: HealthState, responseTimeMs: number | null, errorMessage: string | null, details: Record<string, unknown>) { return this.metrics.insertHealthCheck(connectorId, state, responseTimeMs, errorMessage, details); }
  async listHealthChecks(organizationId: string, connectorId: string, filters: { limit: number; offset: number }) { return this.metrics.listHealthChecks(organizationId, connectorId, filters); }
  async insertTestRun(input: { connectorId: string; triggeredBy: string | null; status: string; response: Record<string, unknown> | null; durationMs: number | null }) { return this.metrics.insertTestRun(input); }
  async listTestRuns(organizationId: string, connectorId: string, filters: { limit: number; offset: number }) { return this.metrics.listTestRuns(organizationId, connectorId, filters); }

  // Audit
  async insertAuditLog(input: { organizationId: string; connectorId: string | null; action: string; actorId: string | null; actorType?: string; previousState?: Record<string, unknown> | null; newState?: Record<string, unknown> | null; changesSummary?: Record<string, unknown> | null; ipAddress?: string | null; userAgent?: string | null; requestId?: string | null; }) { return this.audit.insertAuditLog(input); }
  async listAuditLogs(organizationId: string, connectorId: string | null, filters: { limit: number; offset: number }) { return this.audit.listAuditLogs(organizationId, connectorId, filters); }

  // Routes / OAuth
  async createRoute(organizationId: string, connectorId: string, input: import('./types.js').CreateConnectorRouteBody) { return this.routes.createRoute(organizationId, connectorId, input); }
  async updateRoute(organizationId: string, connectorId: string, routeId: string, input: import('./types.js').UpdateConnectorRouteBody) { return this.routes.updateRoute(organizationId, connectorId, routeId, input); }
  async deleteRoute(organizationId: string, connectorId: string, routeId: string) { return this.routes.deleteRoute(organizationId, connectorId, routeId); }
  async listRoutes(organizationId: string, connectorId: string, filters: { limit: number; offset: number }) { return this.routes.listRoutes(organizationId, connectorId, filters); }
  async listRoutesByIds(organizationId: string, routeIds: string[]) { return this.routes.listRoutesByIds(organizationId, routeIds); }
  async createOAuthState(input: { connectorId: string; state: string; codeVerifier: string; expiresAt: Date }) { return this.routes.createOAuthState(input); }
  async consumeOAuthState(organizationId: string, connectorId: string, state: string) { return this.routes.consumeOAuthState(organizationId, connectorId, state); }
  async cleanupExpiredOAuthStates() { return this.routes.cleanupExpiredOAuthStates(); }
}
