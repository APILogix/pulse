import fp from "fastify-plugin";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { pool } from "../../../config/database.js";
import { PgConfigStore } from "./sdk-config.repository.js";
import { RemoteSdkConfigService } from "./sdk-config.service.js";
import { SdkConfigError } from "./errors.js";
import { registerSdkDeliveryRoutes } from "./sdk-config.delivery.routes.js";
import { acceptEmptyJsonBodyAsObject } from "../../../shared/http/empty-json-body.js";
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
    const result = await pool.query(`SELECT feature_key, boolean_value FROM v_effective_entitlements
      WHERE organization_id = $1 AND feature_key = ANY($2::text[])`, [organizationId, ["sdk.remote_config", ...Object.keys(SDK_FEATURE_GATES)]]);
    const values = new Map(result.rows.map((row) => [row.feature_key, row.boolean_value === true]));
    if (values.get("sdk.remote_config") === false) {
        throw new SdkConfigError("policy_violation", "Remote SDK configuration is not included in this organization’s plan", 403);
    }
    if (!values.has("sdk.remote_config"))
        return undefined;
    const features = {};
    for (const [billingFeature, sdkFeature] of Object.entries(SDK_FEATURE_GATES)) {
        if (values.get(billingFeature) !== true)
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