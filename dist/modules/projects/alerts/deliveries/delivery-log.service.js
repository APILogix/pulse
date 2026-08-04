import { BaseProjectService } from "../../shared/base.service.js";
import { ProjectMemberRole } from "../../types.js";
function formatBytes(bytes) {
    if (bytes == null || bytes <= 0)
        return "0kb";
    const kb = bytes / 1024;
    if (kb < 1)
        return `${bytes}b`;
    if (kb < 1024)
        return `${kb.toFixed(1)}kb`;
    return `${(kb / 1024).toFixed(1)}mb`;
}
export class DeliveryLogService {
    repository;
    base;
    logger;
    constructor(repository, base, logger) {
        this.repository = repository;
        this.base = base;
        this.logger = logger;
    }
    toDeliveryDto(row) {
        return {
            id: row.id,
            timestamp: row.created_at.getTime(),
            routeName: row.connector_name ?? row.notification_type,
            connectorType: row.connector_provider ?? "unknown",
            status: row.status,
            severity: row.severity,
            attempts: row.attempts,
            latency: row.delivery_latency_ms,
        };
    }
    toDeadLetterDto(row) {
        return {
            id: row.id,
            timestamp: row.created_at.getTime(),
            routeName: row.connector_name ?? row.notification_type,
            target: row.connector_provider ?? "unknown",
            reason: row.error_message ?? "Delivery failed after maximum retries",
            payloadSize: formatBytes(row.payload_size_bytes),
        };
    }
    async listDeliveries(orgId, projectId, userId, filters) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const result = await this.repository.listDeliveries(orgId, projectId, filters);
        return { data: result.data.map((row) => this.toDeliveryDto(row)), total: result.total };
    }
    async listDeadLetters(orgId, projectId, userId, filters) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const result = await this.repository.listDeadLetters(orgId, projectId, filters);
        return { data: result.data.map((row) => this.toDeadLetterDto(row)), total: result.total };
    }
    async reprocessDeadLetter(orgId, projectId, userId, deliveryId) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
        const ok = await this.repository.reprocessDeadLetter(orgId, projectId, deliveryId);
        this.logger.info({ orgId, projectId, deliveryId, ok }, "Reprocessed dead-letter delivery");
        return ok;
    }
    async reprocessAll(orgId, projectId, userId) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
        const count = await this.repository.reprocessAll(orgId, projectId);
        this.logger.info({ orgId, projectId, count }, "Reprocessed all dead-letter deliveries");
        return count;
    }
    async discardDeadLetter(orgId, projectId, userId, deliveryId) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
        const ok = await this.repository.discardDeadLetter(orgId, projectId, deliveryId);
        this.logger.info({ orgId, projectId, deliveryId, ok }, "Discarded dead-letter delivery");
        return ok;
    }
    async purgeQueue(orgId, projectId, userId) {
        await this.base.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.DEVELOPER);
        const count = await this.repository.purgeQueue(orgId, projectId);
        this.logger.info({ orgId, projectId, count }, "Purged dead-letter queue");
        return count;
    }
}
//# sourceMappingURL=delivery-log.service.js.map