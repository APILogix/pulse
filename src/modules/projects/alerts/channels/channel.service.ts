import type { FastifyBaseLogger } from "fastify";
import { ProjectMemberRole } from "../../types.js";
import type { ProjectsService, RequestMeta } from "../../service.js";
import { ProjectError } from "../../shared/utils.js";
import { AlertChannelRepository } from "./channel.repository.js";
import type {
  CreateProjectAlertChannelBody,
  DeleteMemberAlertChannelPreferenceQuery,
  ImmediateDeliveryRequest,
  ImmediateDeliveryTarget,
  ListProjectAlertChannelsQuery,
  ProjectAlertChannel,
  ProjectMemberAlertChannelPreference,
  ToggleProjectAlertChannelBody,
  UpsertMemberAlertChannelPreferenceBody,
  UpdateProjectAlertChannelBody,
} from "./channel.types.js";

const URL_LIKE_VALUE = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|(?:^|[\s"'(])(?:localhost|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:[/?#:]|$))/i;

export function containsUrlLikeValue(value: unknown): boolean {
  if (typeof value === "string") return URL_LIKE_VALUE.test(value.trim());
  if (Array.isArray(value)) return value.some((entry) => containsUrlLikeValue(entry));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) => containsUrlLikeValue(entry));
  }
  return false;
}

export class ProjectAlertChannelService {
  constructor(
    private readonly repository: AlertChannelRepository,
    private readonly projectsService: ProjectsService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async list(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListProjectAlertChannelsQuery,
  ): Promise<{ channels: ProjectAlertChannel[]; total: number; limit: number; offset: number }> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const result = await this.repository.list(orgId, projectId, query);
    return { ...result, limit: query.limit, offset: query.offset ?? (query.page - 1) * query.limit };
  }


  async get(
    orgId: string,
    projectId: string,
    channelId: string,
    userId: string,
  ): Promise<ProjectAlertChannel> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const channel = await this.repository.findById(orgId, projectId, channelId);
    if (!channel) throw new ProjectError("ALERT_CHANNEL_NOT_FOUND", "Alert channel not found", 404);
    return channel;
  }

  async create(
    orgId: string,
    projectId: string,
    userId: string,
    body: CreateProjectAlertChannelBody,
    meta: RequestMeta,
  ): Promise<ProjectAlertChannel> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const channel = await this.repository.withTransaction(async (client) => {
      const connector = body.connectorId
        ? await this.repository.requireActiveConnector(orgId, body.connectorId, client)
        : null;
      this.assertSafeWebhookConfiguration(
        connector?.provider ?? null,
        body.channelType,
        body.destination ?? null,
        body.destinationMetadata,
      );
      await this.repository.lockDefaultGroups(projectId, [body.channelType], client);
      const hasDefault = await this.repository.hasEnabledDefault(projectId, body.channelType, client);
      const isDefault = body.enabled && (body.isDefault || !hasDefault);
      if (isDefault) {
        await this.repository.unsetEnabledDefaults(projectId, body.channelType, null, userId, client);
      }
      return this.repository.create(orgId, projectId, userId, body, isDefault, client);
    });
    await this.audit(meta, orgId, projectId, "alert_channel_created", channel, {
      channelType: channel.channelType,
      connectorId: channel.connectorId,
      enabled: channel.enabled,
      isDefault: channel.isDefault,
    });
    this.logger.info({ orgId, projectId, channelId: channel.id }, "Project alert channel created");
    return channel;
  }

  async update(
    orgId: string,
    projectId: string,
    channelId: string,
    userId: string,
    body: UpdateProjectAlertChannelBody,
    meta: RequestMeta,
  ): Promise<ProjectAlertChannel> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const updated = await this.repository.withTransaction(async (client) => {
      await this.repository.lockDefaultGroups(projectId, [], client);
      const existing = await this.repository.findById(orgId, projectId, channelId, client, true);
      if (!existing) throw new ProjectError("ALERT_CHANNEL_NOT_FOUND", "Alert channel not found", 404);
      const connectorId = body.connectorId !== undefined ? body.connectorId : existing.connectorId;
      const connector = connectorId
        ? await this.repository.requireActiveConnector(orgId, connectorId, client)
        : null;
      const destination = body.destination !== undefined ? body.destination : existing.destination;
      const metadata = body.destinationMetadata ?? existing.destinationMetadata;
      const nextType = body.channelType ?? existing.channelType;
      if (!connectorId && !destination && nextType.toLowerCase() !== "email") {
        throw new ProjectError(
          "ALERT_CHANNEL_DESTINATION_REQUIRED",
          "A connector or destination is required",
          422,
        );
      }
      this.assertSafeWebhookConfiguration(
        connector?.provider ?? null,
        nextType,
        destination,
        metadata,
      );
      const nextEnabled = body.enabled ?? existing.enabled;
      const nextDefault = nextEnabled && (body.isDefault ?? existing.isDefault);
      if (nextDefault) {
        await this.repository.unsetEnabledDefaults(projectId, nextType, channelId, userId, client);
      }
      await this.repository.update(orgId, projectId, channelId, userId, body, nextDefault, client);
      await this.repository.ensureEnabledDefault(orgId, projectId, existing.channelType, userId, client);
      if (nextType !== existing.channelType) {
        await this.repository.ensureEnabledDefault(orgId, projectId, nextType, userId, client);
      }
      const result = await this.repository.findById(orgId, projectId, channelId, client);
      if (!result) throw new ProjectError("ALERT_CHANNEL_NOT_FOUND", "Alert channel not found", 404);
      return result;
    });
    await this.audit(meta, orgId, projectId, "alert_channel_updated", updated, { changes: body });
    return updated;
  }


  async toggle(
    orgId: string,
    projectId: string,
    channelId: string,
    userId: string,
    body: ToggleProjectAlertChannelBody,
    meta: RequestMeta,
  ): Promise<ProjectAlertChannel> {
    const updateBody: UpdateProjectAlertChannelBody = { enabled: body.enabled };
    if (body.version !== undefined) updateBody.version = body.version;
    return this.update(orgId, projectId, channelId, userId, updateBody, meta);
  }

  async delete(
    orgId: string,
    projectId: string,
    channelId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.ADMIN);
    const deleted = await this.repository.withTransaction(async (client) => {
      await this.repository.lockDefaultGroups(projectId, [], client);
      const existing = await this.repository.findById(orgId, projectId, channelId, client, true);
      if (!existing) throw new ProjectError("ALERT_CHANNEL_NOT_FOUND", "Alert channel not found", 404);
      await this.repository.softDelete(orgId, projectId, channelId, userId, client);
      await this.repository.ensureEnabledDefault(orgId, projectId, existing.channelType, userId, client);
      return existing;
    });
    await this.audit(meta, orgId, projectId, "alert_channel_deleted", deleted, {
      channelType: deleted.channelType,
    });
  }

  async listMyPreferences(
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberAlertChannelPreference[]> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    return this.repository.listMemberPreferences(orgId, projectId, userId);
  }

  async upsertMyPreference(
    orgId: string,
    projectId: string,
    channelId: string,
    userId: string,
    body: UpsertMemberAlertChannelPreferenceBody,
    meta: RequestMeta,
  ): Promise<ProjectMemberAlertChannelPreference> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const channel = await this.repository.findById(orgId, projectId, channelId);
    if (!channel) throw new ProjectError("ALERT_CHANNEL_NOT_FOUND", "Alert channel not found", 404);
    const preference = await this.repository.upsertMemberPreference(
      orgId,
      projectId,
      userId,
      channelId,
      body,
    );
    await this.projectsService.audit(meta, {
      orgId,
      projectId,
      action: "alert_channel_preference_updated",
      entityType: "project_member_alert_channel_preference",
      entityId: preference.id,
      newValues: { projectId, channelId, category: preference.category },
    });
    return preference;
  }

  async deleteMyPreference(
    orgId: string,
    projectId: string,
    channelId: string,
    userId: string,
    query: DeleteMemberAlertChannelPreferenceQuery,
    meta: RequestMeta,
  ): Promise<void> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    await this.repository.softDeleteMemberPreference(orgId, projectId, userId, channelId, query.category);
    await this.projectsService.audit(meta, {
      orgId,
      projectId,
      action: "alert_channel_preference_deleted",
      entityType: "project_member_alert_channel_preference",
      entityId: channelId,
      newValues: { projectId, category: query.category },
    });
  }

  /** Internal authoritative lookup; callers must provide tenant-scoped event data. */
  async resolveImmediateDeliveryTargets(
    request: ImmediateDeliveryRequest,
  ): Promise<ImmediateDeliveryTarget[]> {
    return this.repository.resolveImmediateDeliveryTargets(request);
  }

  private assertSafeWebhookConfiguration(
    connectorProvider: string | null,
    channelType: string,
    destination: string | null,
    metadata: Record<string, unknown>,
  ): void {
    const normalizedType = channelType.toLowerCase();
    if (connectorProvider === null) {
      if (normalizedType !== "email") {
        throw new ProjectError(
          "ALERT_CHANNEL_CONNECTOR_REQUIRED",
          "Only email channels may use platform delivery without an organization connector",
          422,
        );
      }
      if (destination && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
        throw new ProjectError("ALERT_CHANNEL_DESTINATION_INVALID", "Email destination is invalid", 422);
      }
    }
    const isWebhookBacked = connectorProvider?.toLowerCase() === "webhook"
      || normalizedType === "webhook";
    if (!isWebhookBacked) return;
    if (destination !== null && destination.trim() !== "") {
      throw new ProjectError(
        "ALERT_CHANNEL_WEBHOOK_SECRET_FORBIDDEN",
        "Webhook connector-backed channels cannot store a raw destination URL",
        422,
      );
    }
    if (containsUrlLikeValue(metadata)) {
      throw new ProjectError(
        "ALERT_CHANNEL_WEBHOOK_SECRET_FORBIDDEN",
        "Webhook destination metadata cannot contain URL-like values",
        422,
      );
    }
  }

  private async audit(
    meta: RequestMeta,
    orgId: string,
    projectId: string,
    action: string,
    channel: ProjectAlertChannel,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.projectsService.audit(meta, {
      orgId,
      projectId,
      action,
      entityType: "project_alert_channel",
      entityId: channel.id,
      entityName: channel.name,
      newValues: { ...newValues, projectId },
    });
  }
}