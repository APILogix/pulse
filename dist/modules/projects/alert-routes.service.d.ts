import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../organization/repository.js";
import { AlertRoutesRepository } from "./alert-routes.repository.js";
import type { CreateProjectAlertRouteBody, UpdateProjectAlertRouteBody, ListProjectAlertRoutesQuery, ProjectAlertRoute } from "./alert-routes.types.js";
import type { RequestMeta } from "./service.js";
import { ProjectsService } from "./service.js";
export declare class ProjectAlertRouteService {
    private readonly repository;
    private readonly projectsService;
    private readonly orgRepo;
    private readonly logger;
    constructor(repository: AlertRoutesRepository, projectsService: ProjectsService, orgRepo: OrganizationRepository, logger: FastifyBaseLogger);
    createRoute(orgId: string, projectId: string, userId: string, dto: CreateProjectAlertRouteBody, meta: RequestMeta): Promise<ProjectAlertRoute>;
    getRoute(routeId: string, orgId: string, projectId: string, userId: string): Promise<ProjectAlertRoute>;
    listRoutes(orgId: string, projectId: string, userId: string, query: ListProjectAlertRoutesQuery): Promise<{
        routes: ProjectAlertRoute[];
        limit: number;
        offset: number;
    }>;
    updateRoute(routeId: string, orgId: string, projectId: string, userId: string, dto: UpdateProjectAlertRouteBody, meta: RequestMeta): Promise<ProjectAlertRoute>;
    toggleRoute(routeId: string, orgId: string, projectId: string, userId: string, isActive: boolean, meta: RequestMeta): Promise<ProjectAlertRoute>;
    deleteRoute(routeId: string, orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<void>;
}
//# sourceMappingURL=alert-routes.service.d.ts.map