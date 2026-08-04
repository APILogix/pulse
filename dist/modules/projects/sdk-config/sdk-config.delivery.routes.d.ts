import type { FastifyInstance } from "fastify";
import type { RemoteSdkConfigService } from "./sdk-config.service.js";
/**
 * Register both SDK bootstrap names against one handler. This guarantees
 * `/v1/init` and `/v1/sdk-config` use the same API-key mapping, service call,
 * response document, and cache/revision headers.
 */
export declare function registerSdkDeliveryRoutes(fastify: FastifyInstance, service: RemoteSdkConfigService): void;
//# sourceMappingURL=sdk-config.delivery.routes.d.ts.map