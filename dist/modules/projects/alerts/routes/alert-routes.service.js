import { AlertRoutesRepository } from "./alert-routes.repository.js";
import { ProjectsService } from "../../service.js";
export class ProjectAlertRouteService {
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
    async createRoute(orgId, projectId, userId, dto, meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "admin");
        const created = await this.repository.withTransaction(async (client) => {
            // Create the route scoped to project
            return this.repository.createRoute(orgId, projectId, dto, client);
        });
        await this.projectsService.audit(meta, {
            orgId: orgId,
            action: "route_created",
            entityType: "project_alert_route",
            entityId: created.id,
            newValues: { name: created.name, is_active: created.isActive },
        });
        this.logger.info({ orgId, projectId, routeId: created.id }, "Project alert route created");
        return created;
    }
    async getRoute(routeId, orgId, projectId, userId) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
        const route = await this.repository.getRoute(routeId, orgId, projectId);
        if (!route) {
            throw new Error("Route not found");
        }
        return route;
    }
    async listRoutes(orgId, projectId, userId, query) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
        const routes = await this.repository.listRoutes(orgId, projectId, query);
        const offset = query.offset ?? 0;
        return { routes, limit: query.limit, offset };
    }
    async updateRoute(routeId, orgId, projectId, userId, dto, meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "admin");
        const route = await this.repository.getRoute(routeId, orgId, projectId);
        if (!route)
            throw new Error("Route not found");
        const updated = await this.repository.updateRoute(routeId, dto);
        await this.projectsService.audit(meta, {
            orgId: orgId,
            action: "route_updated",
            entityType: "project_alert_route",
            entityId: routeId,
            newValues: { dto },
        });
        return updated;
    }
    async toggleRoute(routeId, orgId, projectId, userId, isActive, meta) {
        return this.updateRoute(routeId, orgId, projectId, userId, { is_active: isActive }, meta);
    }
    async deleteRoute(routeId, orgId, projectId, userId, meta) {
        await this.projectsService.requireProjectAccess(orgId, projectId, userId, "admin");
        const route = await this.repository.getRoute(routeId, orgId, projectId);
        if (!route)
            throw new Error("Route not found");
        await this.repository.deleteRoute(routeId);
        await this.projectsService.audit(meta, {
            orgId: orgId,
            action: "route_deleted",
            entityType: "project_alert_route",
            entityId: routeId,
        });
    }
}
//# sourceMappingURL=alert-routes.service.js.map