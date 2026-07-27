import { AlertPreferencesRepository } from "./alert-preferences.repository.js";
import { ProjectsService } from "../../service.js";
import { ProjectError } from "../../shared/utils.js";
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
        return this.repository.seedMissingMemberPreferences(orgId, projectId, userId);
    }
    async updatePreference(orgId, projectId, prefId, userId, dto, meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
        const prefs = await this.repository.getMemberPreferences(orgId, projectId, userId);
        const existing = prefs.find((p) => p.id === prefId);
        if (!existing)
            throw new ProjectError("PREFERENCE_NOT_FOUND", "Preference not found", 404);
        const updated = await this.repository.updateMemberPreference(prefId, orgId, projectId, userId, dto);
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
        await this.repository.bulkSubscribe(orgId, projectId, channel, category, userIds);
        await this.projectsService.audit(meta, {
            orgId: orgId,
            action: "notification_bulk_subscribe",
            entityType: "project_notification_preference",
            entityId: projectId,
            newValues: { channel, category, userIds },
        });
    }
    async resolveRecipients(orgId, projectId, category, severity) {
        return this.repository.resolveRecipients(orgId, projectId, category, severity);
    }
    async sync(orgId, projectId, userId) {
        await this.getPreferences(orgId, projectId, userId);
    }
}
//# sourceMappingURL=alert-preferences.service.js.map