import { AlertPreferencesRepository } from "./alert-preferences.repository.js";
import { ProjectsService } from "../../service.js";
import { AlertRoutesRepository } from "../routes/alert-routes.repository.js";
export class ProjectMemberAlertPreferenceService {
    repository;
    routesRepository;
    projectsService;
    orgRepo;
    logger;
    constructor(repository, routesRepository, projectsService, orgRepo, logger) {
        this.repository = repository;
        this.routesRepository = routesRepository;
        this.projectsService = projectsService;
        this.orgRepo = orgRepo;
        this.logger = logger;
    }
    async getPreferences(orgId, projectId, userId) {
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
    async updatePreference(orgId, projectId, prefId, userId, dto, meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
        // Ensure the pref belongs to the user
        const prefs = await this.repository.getPreferences(projectId, userId);
        const existing = prefs.find(p => p.id === prefId);
        if (!existing)
            throw new Error("Preference not found");
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
    async bulkSubscribe(orgId, projectId, routeId, userIds, actorId, meta) {
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
    async resolveRecipients(projectId, routeId, severity) {
        return this.repository.resolveRecipients(projectId, routeId, severity);
    }
    async sync(orgId, projectId, userId) {
        await this.getPreferences(orgId, projectId, userId);
    }
}
//# sourceMappingURL=alert-preferences.service.js.map