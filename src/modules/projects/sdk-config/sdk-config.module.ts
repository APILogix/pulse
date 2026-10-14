/**
 * SDK config delivery module (composition root).
 *
 * Wires the Postgres-backed ConfigStore + RemoteSdkConfigService and registers
 * the API-key-authenticated `POST /v1/init` and `POST /v1/sdk-config` routes at
 * the root through one shared handler. These routes are intentionally NOT under the session-authenticated org prefix —
 * it authenticates SDKs by API key only.
 */
import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import fp from "fastify-plugin";
import { env } from "../../../config/env.js";
import { logger } from "../../../config/logger.js";
import { pool } from "../../../config/database.js";
import { PgConfigStore } from "./sdk-config.repository.js";
import { RemoteSdkConfigService } from "./sdk-config.service.js";
import { SdkConfigError } from "./errors.js";
import type { OperatorOverride } from "./delivery.js";
import { registerSdkDeliveryRoutes } from "./sdk-config.delivery.routes.js";
import { acceptEmptyJsonBodyAsObject } from "../../../shared/http/empty-json-body.js";

import { entitlementsService } from "../../billing/entitlements/service.js";
import { redisLookupCache } from "../../../db/redis/lookup-cache.js";

const moduleLogger = logger.child({ component: "sdk-config-delivery-module" });

// Invalidate Redis entitlement override and project remote configs when billing or subscriptions change
entitlementsService.onOrgInvalidate((orgId) => {
  void redisLookupCache.invalidateOrgOverride(orgId);
  pool.query<{ id: string }>(
    "SELECT id FROM projects WHERE org_id = $1 AND deleted_at IS NULL",
    [orgId]
  ).then((res) => {
    for (const row of res.rows) {
      void redisLookupCache.invalidateRemoteConfig(row.id);
    }
  }).catch((err) => {
    moduleLogger.debug({ err, orgId }, "Failed to sweep remote-config on org invalidate");
  });
});

/** Trusted ingest origin used to derive protected route URLs. */
function ingestBaseUrl(): string {
  return env.BACKEND_URL;
}

const SDK_PERSISTENCE_BUDGET_FEATURE = "quota.sdk_persistence_per_minute";
const SDK_PERSISTENCE_BUDGET_DEFAULT = 100_000;
const SDK_PERSISTENCE_BUDGET_BY_PLAN: Readonly<Record<string, number>> = {
  free: SDK_PERSISTENCE_BUDGET_DEFAULT,
  starter: 100_000,
  growth: 100_000,
  business: 250_000,
  enterprise: 1_000_000,
};

function resolvePersistenceBudget(planTier: string | null | undefined, entitlementValue: number | null | undefined): number {
  if (typeof entitlementValue === "number" && Number.isFinite(entitlementValue) && entitlementValue > 0) {
    return Math.min(Math.trunc(entitlementValue), 1_000_000);
  }
  return SDK_PERSISTENCE_BUDGET_BY_PLAN[planTier ?? ""] ?? SDK_PERSISTENCE_BUDGET_DEFAULT;
}

async function resolveSdkEntitlementOverride(organizationId: string): Promise<OperatorOverride | undefined> {
  // 1. Fast-Path: Check Redis Cache
  const cached = await redisLookupCache.getOrgEntitlementOverride(organizationId);
  if (cached !== null) {
    return cached;
  }

  // 2. Slow-Path: Query Entitlements & Subscription Services
  // getEffectiveEntitlements caches both the map and subscription state internally,
  // so getSubscriptionState resolves instantly from in-memory cache.
  const map = await entitlementsService.getEffectiveEntitlements(organizationId);
  const subscription = await entitlementsService.getSubscriptionState(organizationId);
  const remoteConfigEntitled = map["sdk.remote_config"]?.booleanValue;
  if (remoteConfigEntitled === false) {
    throw new SdkConfigError("policy_violation", "Remote SDK configuration is not included in this organization’s plan", 403);
  }
  if (remoteConfigEntitled === undefined) {
    void redisLookupCache.setOrgEntitlementOverride(organizationId, undefined);
    return undefined;
  }
  const persistenceBudget = resolvePersistenceBudget(
    subscription?.planTier ?? subscription?.planKey,
    map[SDK_PERSISTENCE_BUDGET_FEATURE]?.integerValue,
  );
  const override: OperatorOverride = {
    limits: {
      persistenceGovernance: {
        maxPersistPerMinute: persistenceBudget,
        adaptive: true,
        budgetExceededLogIntervalMs: 60_000,
      },
    },
  };

  void redisLookupCache.setOrgEntitlementOverride(organizationId, override);
  return override;
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
