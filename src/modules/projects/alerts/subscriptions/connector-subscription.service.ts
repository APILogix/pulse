/**
 * Project connector subscription business service.
 *
 * Flow:
 * 1. Authorize via project membership (tenant isolation + role gating).
 * 2. Enforce business rules: only admins can manage subscriptions; connectors
 *    are organization-owned resources that projects subscribe to.
 * 3. Persist mutations and write immutable audit records.
 */
import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../../organization/repository.js";
import { ProjectMemberRole } from "../../core/project.types.js";
import { BaseProjectService } from "../../shared/base.service.js";
import { ConnectorSubscriptionRepository } from "./connector-subscription.repository.js";
import type {
  CreateProjectConnectorSubscriptionBody,
  ListProjectConnectorSubscriptionsQuery,
  ProjectConnectorSubscription,
  UpdateProjectConnectorSubscriptionBody,
  AlertRoutingTarget,
} from "./connector-subscription.types.js";
import type { RequestMeta } from "../../service.js";

export class ProjectConnectorSubscriptionService {
  constructor(
    private readonly repository: ConnectorSubscriptionRepository,
    private readonly authService: BaseProjectService,
    private readonly orgRepo: OrganizationRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async list(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListProjectConnectorSubscriptionsQuery,
  ): Promise<{ subscriptions: ProjectConnectorSubscription[]; total: number; limit: number; offset: number }> {
    await this.authService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const result = await this.repository.listByProject(projectId, query);
    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    return { ...result, limit: query.limit, offset };
  }

  async get(
    orgId: string,
    projectId: string,
    subscriptionId: string,
    userId: string,
  ): Promise<ProjectConnectorSubscription> {
    await this.authService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const subscription = await this.repository.findById(subscriptionId);
    if (!subscription || subscription.projectId !== projectId) {
      throw new Error("Subscription not found");
    }
    return subscription;
  }

  async create(
    orgId: string,
    projectId: string,
    userId: string,
    body: CreateProjectConnectorSubscriptionBody,
    meta: RequestMeta,
  ): Promise<ProjectConnectorSubscription> {
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

  async update(
    orgId: string,
    projectId: string,
    subscriptionId: string,
    userId: string,
    body: UpdateProjectConnectorSubscriptionBody,
    meta: RequestMeta,
  ): Promise<ProjectConnectorSubscription> {
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

  async delete(
    orgId: string,
    projectId: string,
    subscriptionId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
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
  async resolveRoutingTarget(apiKeyId: string): Promise<AlertRoutingTarget | null> {
    return this.repository.resolveAlertRoutingTarget(apiKeyId);
  }

  /**
   * Resolve alert routing targets for a project.
   *
   * Fallback for metric/ingestion alerts that are project-scoped but do not
   * carry an explicit API key.
   */
  async resolveRoutingTargetByProjectId(projectId: string): Promise<AlertRoutingTarget | null> {
    return this.repository.resolveAlertRoutingTargetByProjectId(projectId);
  }

  private async audit(
    meta: RequestMeta,
    orgId: string,
    projectId: string,
    action: string,
    entityId: string,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.authService.audit(meta, {
      orgId,
      action,
      entityType: "project_connector_subscription",
      entityId,
      newValues: { ...newValues, projectId },
    });
  }
}
