/**
 * SDK Remote Config routes. Mounted under the organization prefix
 * (/organizations) so the effective paths are /organizations/:orgId/sdk-configs.
 *
 * All management routes are authenticated (admin+ enforced in the service). The
 * resolve route is member-authenticated; the SDK-key public fetch path is
 * intentionally out of scope for this module (API-key auth is a separate module
 * per the architecture).
 */
import type { FastifyInstance } from "fastify";
import type { SdkConfigService } from "./sdk-config.service.js";
export declare function registerSdkConfigRoutes(fastify: FastifyInstance, svc: SdkConfigService): void;
//# sourceMappingURL=sdk-config.routes.d.ts.map