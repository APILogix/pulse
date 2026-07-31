import fp from "fastify-plugin";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { PgConfigStore } from "./sdk-config.repository.js";
import { RemoteSdkConfigService } from "./sdk-config.service.js";
import { registerSdkDeliveryRoutes } from "./sdk-config.delivery.routes.js";
import { acceptEmptyJsonBodyAsObject } from "../../../shared/http/empty-json-body.js";
const moduleLogger = logger.child({ component: "sdk-config-delivery-module" });
/** Trusted ingest origin used to derive protected route URLs. */
function ingestBaseUrl() {
    return env.BACKEND_URL;
}
async function sdkConfigDeliveryModule(fastify, _options) {
    const store = new PgConfigStore();
    const service = new RemoteSdkConfigService(store, {
        topology: { ingestBaseUrl: ingestBaseUrl() },
    });
    fastify.decorate("sdkConfigDelivery", service);
    await fastify.register(async (sdkRoutes) => {
        acceptEmptyJsonBodyAsObject(sdkRoutes);
        registerSdkDeliveryRoutes(sdkRoutes, service);
    });
    moduleLogger.info("SDK config delivery routes registered at POST /v1/init and POST /v1/sdk-config");
}
export const registerSdkConfigDeliveryModule = fp(sdkConfigDeliveryModule, {
    name: "sdk-config-delivery-module",
});
export default registerSdkConfigDeliveryModule;
//# sourceMappingURL=sdk-config.module.js.map