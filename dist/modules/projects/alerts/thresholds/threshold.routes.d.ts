import type { FastifyInstance } from "fastify";
import type { ThresholdService } from "./threshold.service.js";
export interface ThresholdRoutesOptions {
    service?: ThresholdService;
}
/** Mount with prefix /organizations/:orgId/projects/:projectId/alert-thresholds. */
export declare function thresholdRoutes(fastify: FastifyInstance, options: ThresholdRoutesOptions): Promise<void>;
//# sourceMappingURL=threshold.routes.d.ts.map