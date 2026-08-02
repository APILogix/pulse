import type { PoolClient } from "pg";
import type { CreateProjectAlertRouteBody, UpdateProjectAlertRouteBody, ListProjectAlertRoutesQuery, ProjectAlertRoute } from "./alert-routes.types.js";
export declare class AlertRoutesRepository {
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    private mapRow;
    createRoute(orgId: string, projectId: string, dto: CreateProjectAlertRouteBody, client?: PoolClient): Promise<ProjectAlertRoute>;
    getRoute(routeId: string, orgId: string, projectId: string): Promise<ProjectAlertRoute | null>;
    listRoutes(orgId: string, projectId: string, query: ListProjectAlertRoutesQuery): Promise<ProjectAlertRoute[]>;
    updateRoute(routeId: string, orgId: string, projectId: string, dto: UpdateProjectAlertRouteBody, client?: PoolClient): Promise<ProjectAlertRoute>;
    deleteRoute(routeId: string, orgId: string, projectId: string, client?: PoolClient): Promise<void>;
}
//# sourceMappingURL=alert-routes.repository.d.ts.map