import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../organization/repository.js";
import { AlertPreferencesRepository } from "./alert-preferences.repository.js";
import type { UpdateAlertPreferenceBody, ProjectMemberAlertPreference } from "./alert-preferences.types.js";
import type { RequestMeta } from "./service.js";
import { ProjectsService } from "./service.js";
import { AlertRoutesRepository } from "./alert-routes.repository.js";
export declare class ProjectMemberAlertPreferenceService {
    private readonly repository;
    private readonly routesRepository;
    private readonly projectsService;
    private readonly orgRepo;
    private readonly logger;
    constructor(repository: AlertPreferencesRepository, routesRepository: AlertRoutesRepository, projectsService: ProjectsService, orgRepo: OrganizationRepository, logger: FastifyBaseLogger);
    getPreferences(orgId: string, projectId: string, userId: string): Promise<ProjectMemberAlertPreference[]>;
    updatePreference(orgId: string, projectId: string, prefId: string, userId: string, dto: UpdateAlertPreferenceBody, meta: RequestMeta): Promise<ProjectMemberAlertPreference>;
    bulkSubscribe(orgId: string, projectId: string, routeId: string, userIds: string[], actorId: string, meta: RequestMeta): Promise<void>;
    resolveRecipients(projectId: string, routeId: string, severity: string): Promise<string[]>;
    sync(orgId: string, projectId: string, userId: string): Promise<void>;
}
//# sourceMappingURL=alert-preferences.service.d.ts.map