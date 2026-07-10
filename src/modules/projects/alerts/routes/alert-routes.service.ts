import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../../organization/repository.js";
import { AlertRoutesRepository } from "./alert-routes.repository.js";
import type {
  CreateProjectAlertRouteBody,
  UpdateProjectAlertRouteBody,
  ListProjectAlertRoutesQuery,
  ProjectAlertRoute,
} from "./alert-routes.types.js";
import type { RequestMeta } from "../../service.js";
import { ProjectsService } from "../../service.js";

export class ProjectAlertRouteService {
  constructor(
    private readonly repository: AlertRoutesRepository,
    private readonly projectsService: ProjectsService,
    private readonly orgRepo: OrganizationRepository,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async createRoute(
    orgId: string,
    projectId: string,
    userId: string,
    dto: CreateProjectAlertRouteBody,
    meta: RequestMeta,
  ): Promise<ProjectAlertRoute> {
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

  async getRoute(routeId: string, orgId: string, projectId: string, userId: string): Promise<ProjectAlertRoute> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
    const route = await this.repository.getRoute(routeId, orgId, projectId);
    if (!route) {
      throw new Error("Route not found");
    }
    return route;
  }

  async listRoutes(
    orgId: string,
    projectId: string,
    userId: string,
    query: ListProjectAlertRoutesQuery,
  ): Promise<{ routes: ProjectAlertRoute[], limit: number, offset: number }> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "member");
    const routes = await this.repository.listRoutes(orgId, projectId, query);
    const offset = query.offset ?? 0;
    return { routes, limit: query.limit, offset };
  }

  async updateRoute(
    routeId: string,
    orgId: string,
    projectId: string,
    userId: string,
    dto: UpdateProjectAlertRouteBody,
    meta: RequestMeta,
  ): Promise<ProjectAlertRoute> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "admin");
    const route = await this.repository.getRoute(routeId, orgId, projectId);
    if (!route) throw new Error("Route not found");

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

  async toggleRoute(
    routeId: string,
    orgId: string,
    projectId: string,
    userId: string,
    isActive: boolean,
    meta: RequestMeta,
  ): Promise<ProjectAlertRoute> {
    return this.updateRoute(routeId, orgId, projectId, userId, { is_active: isActive }, meta);
  }

  async deleteRoute(
    routeId: string,
    orgId: string,
    projectId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.projectsService.requireProjectAccess(orgId, projectId, userId, "admin");
    const route = await this.repository.getRoute(routeId, orgId, projectId);
    if (!route) throw new Error("Route not found");

    await this.repository.deleteRoute(routeId);

    await this.projectsService.audit(meta, {
      orgId: orgId,
      action: "route_deleted",
      entityType: "project_alert_route",
      entityId: routeId,
    });
  }
}
