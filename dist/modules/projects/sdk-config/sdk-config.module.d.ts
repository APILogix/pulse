/**
 * SDK config delivery module (composition root).
 *
 * Wires the Postgres-backed ConfigStore + RemoteSdkConfigService and registers
 * the API-key-authenticated `POST /v1/init` and `POST /v1/sdk-config` routes at
 * the root through one shared handler. These routes are intentionally NOT under the session-authenticated org prefix —
 * it authenticates SDKs by API key only.
 */
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { RemoteSdkConfigService } from "./sdk-config.service.js";
declare module "fastify" {
    interface FastifyInstance {
        sdkConfigDelivery: RemoteSdkConfigService;
    }
}
declare function sdkConfigDeliveryModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerSdkConfigDeliveryModule: typeof sdkConfigDeliveryModule;
export default registerSdkConfigDeliveryModule;
//# sourceMappingURL=sdk-config.module.d.ts.map