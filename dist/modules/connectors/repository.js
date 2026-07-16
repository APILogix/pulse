import { ConnectorRepository as CoreRepo } from './core/connector.repository.js';
import { DeliveryRepository } from './delivery/delivery.repository.js';
import { ConnectorMetricsRepository } from './metrics/metrics.repository.js';
import { ConnectorAuditRepository } from './audit/audit.repository.js';
import { ConnectorRoutesRepository } from './routing/routes.repository.js';
export * from './core/connector.repository.js';
export * from './delivery/delivery.repository.js';
export * from './metrics/metrics.repository.js';
export * from './audit/audit.repository.js';
export * from './routing/routes.repository.js';
export class ConnectorRepository {
    core = new CoreRepo();
    delivery = new DeliveryRepository();
    metrics = new ConnectorMetricsRepository();
    audit = new ConnectorAuditRepository();
    routes = new ConnectorRoutesRepository();
    async withTransaction(fn) {
        return this.core.withTransaction(fn);
    }
    // Core
    async create(input) { return this.core.create(input); }
    async findById(organizationId, id) { return this.core.findById(organizationId, id); }
    async findByIdInternal(id) { return this.core.findByIdInternal(id); }
    async getByIds(ids) { return this.core.getByIds(ids); }
    async list(organizationId, query) { return this.core.list(organizationId, query); }
    async listMonitorable() { return this.core.listMonitorable(); }
    async update(organizationId, id, fields) { return this.core.update(organizationId, id, fields); }
    async upsertCredential(input) { return this.core.upsertCredential(input); }
    async getCredential(organizationId, connectorId, keyName) { return this.core.getCredential(organizationId, connectorId, keyName); }
    async softDelete(organizationId, id) { return this.core.softDelete(organizationId, id); }
    async setStatus(organizationId, id, status) { return this.core.setStatus(organizationId, id, status); }
    // Delivery
    async insertDelivery(input) { return this.delivery.insertDelivery(input); }
    async markDeliverySent(id, update) { return this.delivery.markDeliverySent(id, update); }
    async markDeliveryRetrying(id, nextRetryAt, errorMessage) { return this.delivery.markDeliveryRetrying(id, nextRetryAt, errorMessage); }
    async markDeliveryFailed(id, errorMessage, errorDetails) { return this.delivery.markDeliveryFailed(id, errorMessage, errorDetails); }
    async claimRetryableDeliveries(limit) { return this.delivery.claimRetryableDeliveries(limit); }
    async listDeliveries(organizationId, filters) { return this.delivery.listDeliveries(organizationId, filters); }
    async getDelivery(organizationId, id) { return this.delivery.getDelivery(organizationId, id); }
    async insertDeliveryIdempotent(input) { return this.delivery.insertDeliveryIdempotent(input); }
    async findDeliveryByDedupKey(connectorId, dedupKey, windowMinutes) { return this.delivery.findDeliveryByDedupKey(connectorId, dedupKey, windowMinutes); }
    async listAttempts(organizationId, connectorId, deliveryId, filters) { return this.delivery.listAttempts(organizationId, connectorId, deliveryId, filters); }
    async retryDelivery(organizationId, id) { return this.delivery.retryDelivery(organizationId, id); }
    async getDlqGrowth(windowMinutes) { return this.delivery.getDlqGrowth(windowMinutes); }
    async insertDeadLetter(input) { return this.delivery.insertDeadLetter(input); }
    // Metrics
    async recordSuccess(connectorId) { return this.metrics.recordSuccess(connectorId); }
    async recordFailure(connectorId) { return this.metrics.recordFailure(connectorId); }
    async insertHealthCheck(connectorId, state, responseTimeMs, errorMessage, details) { return this.metrics.insertHealthCheck(connectorId, state, responseTimeMs, errorMessage, details); }
    async listHealthChecks(organizationId, connectorId, filters) { return this.metrics.listHealthChecks(organizationId, connectorId, filters); }
    async insertTestRun(input) { return this.metrics.insertTestRun(input); }
    async listTestRuns(organizationId, connectorId, filters) { return this.metrics.listTestRuns(organizationId, connectorId, filters); }
    // Audit
    async insertAuditLog(input) { return this.audit.insertAuditLog(input); }
    async listAuditLogs(organizationId, connectorId, filters) { return this.audit.listAuditLogs(organizationId, connectorId, filters); }
    // Routes / OAuth
    async createRoute(organizationId, connectorId, input) { return this.routes.createRoute(organizationId, connectorId, input); }
    async updateRoute(organizationId, connectorId, routeId, input) { return this.routes.updateRoute(organizationId, connectorId, routeId, input); }
    async deleteRoute(organizationId, connectorId, routeId) { return this.routes.deleteRoute(organizationId, connectorId, routeId); }
    async listRoutes(organizationId, connectorId, filters) { return this.routes.listRoutes(organizationId, connectorId, filters); }
    async listRoutesByIds(organizationId, routeIds) { return this.routes.listRoutesByIds(organizationId, routeIds); }
    async createOAuthState(input) { return this.routes.createOAuthState(input); }
    async consumeOAuthState(organizationId, connectorId, state) { return this.routes.consumeOAuthState(organizationId, connectorId, state); }
    async cleanupExpiredOAuthStates() { return this.routes.cleanupExpiredOAuthStates(); }
    async findOAuthStateWithConnector(client, state) { return this.routes.findOAuthStateWithConnector(client, state); }
    async deleteOAuthState(client, id) { return this.routes.deleteOAuthState(client, id); }
}
//# sourceMappingURL=repository.js.map