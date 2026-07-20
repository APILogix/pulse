import { AlertPreferencesRepository } from "./alert-preferences.repository.js";
import { ProjectsService } from "../../service.js";
export class ProjectMemberAlertPreferenceService {
    repository;
    projectsService;
    orgRepo;
    logger;
    constructor(repository, projectsService, orgRepo, logger) {
        this.repository = repository;
        this.projectsService = projectsService;
        this.orgRepo = orgRepo;
        this.logger = logger;
    }
    async getPreferences(orgId, projectId, userId) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
        return this.repository.seedMissingMemberPreferences(projectId, userId);
    }
    async updatePreference(orgId, projectId, prefId, userId, dto, meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
        const prefs = await this.repository.getMemberPreferences(projectId, userId);
        const existing = prefs.find((p) => p.id === prefId);
        if (!existing)
            throw new Error("Preference not found");
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
    async bulkSubscribe(orgId, projectId, channel, category, userIds, actorId, meta) {
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
    async resolveRecipients(projectId, category, severity) {
        return this.repository.resolveRecipients(projectId, category, severity);
    }
    async sync(orgId, projectId, userId) {
        await this.getPreferences(orgId, projectId, userId);
    }
}
//# sourceMappingURL=alert-preferences.service.js.map