/**
 * SDK config delivery module (composition root).
 *
 * Wires the Postgres-backed ConfigStore + RemoteSdkConfigService and registers
 * the API-key-authenticated `POST /v1/sdk-config` delivery route at the root.
 * The route is intentionally NOT under the session-authenticated org prefix —
 * it authenticates SDKs by API key only.
 */
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { logger } from "../../../config/logger.js";
import { PgConfigStore } from "./sdk-config.repository.js";
import { RemoteSdkConfigService } from "./sdk-config.service.js";
import { registerSdkDeliveryRoutes } from "./sdk-config.delivery.routes.js";

const moduleLogger = logger.child({ component: "sdk-config-delivery-module" });

/** Trusted ingest origin used to derive protected route URLs. */
function ingestBaseUrl(): string {
  const configured = process.env["PULSE_INGEST_BASE_URL"];
  return configured && configured.length > 0 ? configured : "https://ingest.pulse.local";
}

declare module "fastify" {
  interface FastifyInstance {
    sdkConfigDelivery: RemoteSdkConfigService;
  }
}

async function sdkConfigDeliveryModule(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const store = new PgConfigStore();
  const service = new RemoteSdkConfigService(store, {
    topology: { ingestBaseUrl: ingestBaseUrl() },
  });

  fastify.decorate("sdkConfigDelivery", service);
  registerSdkDeliveryRoutes(fastify, service);

  moduleLogger.info("SDK config delivery route registered at POST /v1/sdk-config");
}

export const registerSdkConfigDeliveryModule = fp(sdkConfigDeliveryModule, {
  name: "sdk-config-delivery-module",
});

export default registerSdkConfigDeliveryModule;
