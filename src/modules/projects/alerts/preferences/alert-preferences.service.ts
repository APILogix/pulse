import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../../organization/repository.js";
import { AlertPreferencesRepository } from "./alert-preferences.repository.js";
import type {
  UpdateAlertPreferenceBody,
  ProjectMemberAlertPreference,
} from "./alert-preferences.types.js";
import type { RequestMeta } from "../../service.js";
import { ProjectsService } from "../../service.js";
import { AlertRoutesRepository } from "../routes/alert-routes.repository.js";

export class ProjectMemberAlertPreferenceService {
  constructor(
    private readonly repository: AlertPreferencesRepository,
    private readonly routesRepository: AlertRoutesRepository,
    private readonly projectsService: ProjectsService,
    private readonly orgRepo: OrganizationRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async getPreferences(orgId: string, projectId: string, userId: string): Promise<ProjectMemberAlertPreference[]> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
    
    // Auto-create defaults for all project routes if missing
    // First get all project routes
    const routes = await this.routesRepository.listRoutes(orgId, projectId, { limit: 1000, offset: 0, sortOrder: "desc" });
    const prefs = await this.repository.getPreferences(projectId, userId);
    const existingRouteIds = new Set(prefs.map(p => p.routeId));

    const toCreate = routes.filter(r => !existingRouteIds.has(r.id));
    if (toCreate.length > 0) {
      await this.repository.withTransaction(async (client) => {
        for (const route of toCreate) {
          await this.repository.createPreference(projectId, userId, route.id, client);
        }
      });
      // Fetch fresh
      return this.repository.getPreferences(projectId, userId);
    }

    return prefs;
  }

  async updatePreference(
    orgId: string,
    projectId: string,
    prefId: string,
    userId: string,
    dto: UpdateAlertPreferenceBody,
    meta: RequestMeta,
  ): Promise<ProjectMemberAlertPreference> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
    
    // Ensure the pref belongs to the user
    const prefs = await this.repository.getPreferences(projectId, userId);
    const existing = prefs.find(p => p.id === prefId);
    if (!existing) throw new Error("Preference not found");

    const updated = await this.repository.updatePreference(prefId, projectId, userId, dto);

    await this.projectsService.audit(meta, {
      orgId: orgId,
      action: "preference_updated",
      entityType: "project_member_alert_preference",
      entityId: prefId,
      newValues: { dto },
    });

    return updated;
  }

  async bulkSubscribe(
    orgId: string,
    projectId: string,
    routeId: string,
    userIds: string[],
    actorId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.projectsService.requireProjectAccess(orgId, projectId, actorId, "admin");
    await this.repository.bulkSubscribe(projectId, routeId, userIds);

    await this.projectsService.audit(meta, {
      orgId: orgId,
      action: "bulk_subscribe",
      entityType: "project_alert_route",
      entityId: routeId,
      newValues: { userIds },
    });
  }

  async resolveRecipients(projectId: string, routeId: string, severity: string): Promise<string[]> {
    return this.repository.resolveRecipients(projectId, routeId, severity);
  }

  async sync(orgId: string, projectId: string, userId: string): Promise<void> {
    await this.getPreferences(orgId, projectId, userId);
  }
}
