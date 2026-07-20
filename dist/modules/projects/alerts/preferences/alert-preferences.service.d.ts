import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../../organization/repository.js";
import { AlertPreferencesRepository } from "./alert-preferences.repository.js";
import type { UpdateAlertPreferenceBody, ProjectMemberNotificationPreference } from "./alert-preferences.types.js";
import type { RequestMeta } from "../../service.js";
import { ProjectsService } from "../../service.js";
export declare class ProjectMemberAlertPreferenceService {
    private readonly repository;
    private readonly projectsService;
    private readonly orgRepo;
    private readonly logger;
    constructor(repository: AlertPreferencesRepository, projectsService: ProjectsService, orgRepo: OrganizationRepository, logger: FastifyBaseLogger);
    getPreferences(orgId: string, projectId: string, userId: string): Promise<ProjectMemberNotificationPreference[]>;
    updatePreference(orgId: string, projectId: string, prefId: string, userId: string, dto: UpdateAlertPreferenceBody, meta: RequestMeta): Promise<ProjectMemberNotificationPreference>;
    bulkSubscribe(orgId: string, projectId: string, channel: import("./alert-preferences.types.js").NotificationChannel, category: string, userIds: string[], actorId: string, meta: RequestMeta): Promise<void>;
    resolveRecipients(projectId: string, category: string, severity: string): Promise<string[]>;
    sync(orgId: string, projectId: string, userId: string): Promise<void>;
}
//# sourceMappingURL=alert-preferences.service.d.ts.map