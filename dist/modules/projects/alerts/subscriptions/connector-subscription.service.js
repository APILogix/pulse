import { ProjectMemberRole } from "../../core/project.types.js";
import { BaseProjectService } from "../../shared/base.service.js";
import { ConnectorSubscriptionRepository } from "./connector-subscription.repository.js";
export class ProjectConnectorSubscriptionService {
    repository;
    authService;
    orgRepo;
    logger;
    constructor(repository, authService, orgRepo, logger) {
        this.repository = repository;
        this.authService = authService;
        this.orgRepo = orgRepo;
        this.logger = logger;
    }
    async list(orgId, projectId, userId, query) {
        await this.authService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const result = await this.repository.listByProject(projectId, query);
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        return { ...result, limit: query.limit, offset };
    }
    async get(orgId, projectId, subscriptionId, userId) {
        await this.authService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
        const subscription = await this.repository.findById(subscriptionId);
        if (!subscription || subscription.projectId !== projectId) {
            throw new Error("Subscription not found");
        }
        return subscription;
    }
    async create(orgId, projectId, userId, body, meta) {
        await this.authService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const existing = await this.repository.findByProjectAndConnector(projectId, body.connectorId);
        if (existing) {
            throw new Error("A subscription for this connector already exists in this project");
        }
        const created = await this.repository.create(projectId, orgId, userId, body);
        await this.audit(meta, orgId, projectId, "connector_subscribed", created.id, {
            connectorId: created.connectorId,
            enabled: created.enabled,
            alertCategories: created.alertCategories,
            severityThreshold: created.severityThreshold,
        });
        return created;
    }
    async update(orgId, projectId, subscriptionId, userId, body, meta) {
        await this.authService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const existing = await this.repository.findById(subscriptionId);
        if (!existing || existing.projectId !== projectId) {
            throw new Error("Subscription not found");
        }
        const updated = await this.repository.update(subscriptionId, userId, body);
        await this.audit(meta, orgId, projectId, "connector_subscription_updated", updated.id, {
            connectorId: updated.connectorId,
            enabled: updated.enabled,
            alertCategories: updated.alertCategories,
            severityThreshold: updated.severityThreshold,
        });
        return updated;
    }
    async delete(orgId, projectId, subscriptionId, userId, meta) {
        await this.authService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
        const existing = await this.repository.findById(subscriptionId);
        if (!existing || existing.projectId !== projectId) {
            throw new Error("Subscription not found");
        }
        await this.repository.delete(subscriptionId, userId);
        await this.audit(meta, orgId, projectId, "connector_unsubscribed", subscriptionId, {
            connectorId: existing.connectorId,
        });
    }
    /**
     * Resolve alert routing targets for an API key.
     *
     * This is the deterministic lookup: API Key -> Environment -> Project ->
     * Project Connector Subscriptions -> Project Members.
     */
    async resolveRoutingTarget(apiKeyId) {
        return this.repository.resolveAlertRoutingTarget(apiKeyId);
    }
    /**
     * Resolve alert routing targets for a project.
     *
     * Fallback for metric/ingestion alerts that are project-scoped but do not
     * carry an explicit API key.
     */
    async resolveRoutingTargetByProjectId(projectId) {
        return this.repository.resolveAlertRoutingTargetByProjectId(projectId);
    }
    async audit(meta, orgId, projectId, action, entityId, newValues) {
        await this.authService.audit(meta, {
            orgId,
            action,
            entityType: "project_connector_subscription",
            entityId,
            newValues: { ...newValues, projectId },
        });
    }
}
//# sourceMappingURL=connector-subscription.service.js.map