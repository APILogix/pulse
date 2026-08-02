/**
 * Project alert delivery + dead-letter routes.
 *
 * Mounted under /organizations/:orgId/projects, so the concrete paths are:
 *   GET    /:projectId/alert-deliveries
 *   GET    /:projectId/dead-letters
 *   POST   /:projectId/dead-letters/reprocess-all
 *   POST   /:projectId/dead-letters/:deliveryId/reprocess
 *   DELETE /:projectId/dead-letters/:deliveryId
 *   DELETE /:projectId/dead-letters
 */
import type { FastifyInstance } from "fastify";
export declare function projectDeliveryLogRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=delivery-log.routes.d.ts.map