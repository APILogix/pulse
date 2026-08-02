import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import type { ProjectAlertChannelService } from "./channel.service.js";
export interface ProjectAlertChannelRouteOptions extends FastifyPluginOptions {
    service?: ProjectAlertChannelService;
}
/**
 * Register with prefix:
 * /organizations/:orgId/projects/:projectId/alert-channels
 */
export declare function projectAlertChannelRoutes(fastify: FastifyInstance, options: ProjectAlertChannelRouteOptions): Promise<void>;
//# sourceMappingURL=channel.routes.d.ts.map