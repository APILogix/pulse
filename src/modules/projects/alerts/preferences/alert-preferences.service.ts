import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../../organization/repository.js";
import { AlertPreferencesRepository } from "./alert-preferences.repository.js";
import type {
  UpdateAlertPreferenceBody,
  ProjectMemberNotificationPreference,
} from "./alert-preferences.types.js";
import type { RequestMeta } from "../../service.js";
import { ProjectsService } from "../../service.js";

export class ProjectMemberAlertPreferenceService {
  constructor(
    private readonly repository: AlertPreferencesRepository,
    private readonly projectsService: ProjectsService,
    private readonly orgRepo: OrganizationRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async getPreferences(
    orgId: string,
    projectId: string,
    userId: string,
  ): Promise<ProjectMemberNotificationPreference[]> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
    return this.repository.seedMissingMemberPreferences(projectId, userId);
  }

  async updatePreference(
    orgId: string,
    projectId: string,
    prefId: string,
    userId: string,
    dto: UpdateAlertPreferenceBody,
    meta: RequestMeta,
  ): Promise<ProjectMemberNotificationPreference> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");

    const prefs = await this.repository.getMemberPreferences(projectId, userId);
    const existing = prefs.find((p) => p.id === prefId);
    if (!existing) throw new Error("Preference not found");

    const updated = await this.repository.updateMemberPreference(prefId, projectId, userId, dto);

    await this.projectsService.audit(meta, {
      orgId: orgId,
      action: "notification_preference_updated",
      entityType: "project_member_notification_preference",
      entityId: prefId,
      newValues: { dto },
    });

    return updated;
  }

  async bulkSubscribe(
    orgId: string,
    projectId: string,
    channel: import("./alert-preferences.types.js").NotificationChannel,
    category: string,
    userIds: string[],
    actorId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.projectsService.requireProjectAccess(orgId, projectId, actorId, "admin");
    await this.repository.bulkSubscribe(projectId, channel, category, userIds);

    await this.projectsService.audit(meta, {
      orgId: orgId,
      action: "notification_bulk_subscribe",
      entityType: "project_notification_preference",
      entityId: projectId,
      newValues: { channel, category, userIds },
    });
  }

  async resolveRecipients(projectId: string, category: string, severity: string): Promise<string[]> {
    return this.repository.resolveRecipients(projectId, category, severity);
  }

  async sync(orgId: string, projectId: string, userId: string): Promise<void> {
    await this.getPreferences(orgId, projectId, userId);
  }
}
