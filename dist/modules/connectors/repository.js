import { ConnectorRepository as CoreRepo } from './core/connector.repository.js';
import { DeliveryRepository } from './delivery/delivery.repository.js';
import { ConnectorMetricsRepository } from './metrics/metrics.repository.js';
import { ConnectorAuditRepository } from './audit/audit.repository.js';
export * from './core/connector.repository.js';
export * from './delivery/delivery.repository.js';
export * from './metrics/metrics.repository.js';
export * from './audit/audit.repository.js';
export class ConnectorRepository {
    core = new CoreRepo();
    delivery = new DeliveryRepository();
    metrics = new ConnectorMetricsRepository();
    audit = new ConnectorAuditRepository();
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
    async softDelete(organizationId, id) { return this.core.softDelete(organizationId, id); }
    async setStatus(organizationId, id, status) { return this.core.setStatus(organizationId, id, status); }
    // Delivery
    async insertDelivery(input) { return this.delivery.insertDelivery(input); }
    async markDeliverySent(id, update) { return this.delivery.markDeliverySent(id, update); }
    async markDeliveryRetrying(id, nextRetryAt, errorMessage) { return this.delivery.markDeliveryRetrying(id, nextRetryAt, errorMessage); }
    async markDeliveryFailed(id, errorMessage, errorDetails) { return this.delivery.markDeliveryFailed(id, errorMessage, errorDetails); }
    async claimRetryableDeliveries(limit) { return this.delivery.claimRetryableDeliveries(limit); }
    async listDeliveries(organizationId, filters) { return this.delivery.listDeliveries(organizationId, filters); }
    async insertDeadLetter(input) { return this.delivery.insertDeadLetter(input); }
    // Metrics
    async recordSuccess(connectorId) { return this.metrics.recordSuccess(connectorId); }
    async recordFailure(connectorId) { return this.metrics.recordFailure(connectorId); }
    async insertHealthCheck(connectorId, state, responseTimeMs, errorMessage, details) { return this.metrics.insertHealthCheck(connectorId, state, responseTimeMs, errorMessage, details); }
    // Audit
    async insertAuditLog(input) { return this.audit.insertAuditLog(input); }
}
//# sourceMappingURL=repository.js.map