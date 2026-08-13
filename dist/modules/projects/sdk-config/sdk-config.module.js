import fp from "fastify-plugin";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { pool } from "../../../config/database.js";
import { PgConfigStore } from "./sdk-config.repository.js";
import { RemoteSdkConfigService } from "./sdk-config.service.js";
import { SdkConfigError } from "./errors.js";
import { registerSdkDeliveryRoutes } from "./sdk-config.delivery.routes.js";
import { acceptEmptyJsonBodyAsObject } from "../../../shared/http/empty-json-body.js";
import { entitlementsService } from "../../billing/entitlements/service.js";
const moduleLogger = logger.child({ component: "sdk-config-delivery-module" });
/** Trusted ingest origin used to derive protected route URLs. */
function ingestBaseUrl() {
    return env.BACKEND_URL;
}
const SDK_FEATURE_GATES = {
    "tracing.enabled": "tracing", "error_tracking.enabled": "errors",
    "metrics.enabled": "metrics", "logging.enabled": "logging",
    "profiling.enabled": "profiling", "uptime_cron.enabled": "crons",
    "session_replay.enabled": "sessionReplay",
};
async function resolveSdkEntitlementOverride(organizationId) {
    const map = await entitlementsService.getEffectiveEntitlements(organizationId);
    const remoteConfigEntitled = map["sdk.remote_config"]?.booleanValue;
    if (remoteConfigEntitled === false) {
        throw new SdkConfigError("policy_violation", "Remote SDK configuration is not included in this organization’s plan", 403);
    }
    if (remoteConfigEntitled === undefined)
        return undefined;
    const features = {};
    for (const [billingFeature, sdkFeature] of Object.entries(SDK_FEATURE_GATES)) {
        if (map[billingFeature]?.booleanValue !== true)
            features[sdkFeature] = false;
    }
    return { features };
}
async function sdkConfigDeliveryModule(fastify, _options) {
    const store = new PgConfigStore();
    const service = new RemoteSdkConfigService(store, {
        topology: { ingestBaseUrl: ingestBaseUrl() },
        deliveryOverride: resolveSdkEntitlementOverride,
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