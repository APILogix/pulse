import { computeConfigHash } from "./canonical.js";
import { SdkConfigError } from "./errors.js";
import { deepClone } from "./traversal.js";
import { validateSchemaV1 } from "./validator.js";
import {
  FEATURE_KEYS,
  KILLSWITCH_KEYS,
  SCHEMA_VERSION,
  type FeatureKey,
  type KillswitchKey,
  type PersistenceGovernance,
  type SchemaV1Config,
} from "./schema-v1.js";

export interface ApiKeyMapping {
  organizationId: string;
  projectId: string;
  defaultEnvironmentId: string;
  allowedEnvironmentIds: string[];
  keyId?: string;
  allowedIps?: string[];
  allowedEndpoints?: string[];
}

export interface DeliveryRequestHints {
  environmentId?: string | null;
  environment?: string | null;
  projectId?: string | null;
  schemaVersion?: number;
}

export interface ResolveScopeOptions {
  strictIdentity?: boolean;
}

export interface ResolvedDeliveryScope {
  organizationId: string;
  projectId: string;
  environmentId: string | null;
  environment: string | null;
  usedDefaultFallback: boolean;
  source: "sdk_metadata" | "api_key";
}

export const SUPPORTED_SCHEMA_VERSIONS = [SCHEMA_VERSION] as const;

export function assertSupportedSchemaVersion(version: number | undefined): void {
  if (version === undefined || version === SCHEMA_VERSION) return;
  throw new SdkConfigError("unsupported_schema", `Unsupported schemaVersion ${version}`, 422, [
    {
      path: "/schemaVersion",
      rule: "unsupported",
      message: "Only schemaVersion 1 is supported",
      allowed: SUPPORTED_SCHEMA_VERSIONS,
    },
  ]);
}

export function selectDeliveryEnvironment(
  mapping: ApiKeyMapping,
  hintEnvironmentId: string | null | undefined,
): { environmentId: string; usedDefaultFallback: boolean } {
  if (
    hintEnvironmentId &&
    (hintEnvironmentId === mapping.defaultEnvironmentId ||
      mapping.allowedEnvironmentIds.includes(hintEnvironmentId))
  ) {
    return { environmentId: hintEnvironmentId, usedDefaultFallback: false };
  }
  return { environmentId: mapping.defaultEnvironmentId, usedDefaultFallback: true };
}

export function resolveDeliveryScope(
  mapping: ApiKeyMapping,
  hints: DeliveryRequestHints,
  options: ResolveScopeOptions = {},
): ResolvedDeliveryScope {
  const sdkProjectId = typeof hints.projectId === "string" && hints.projectId.trim().length > 0
    ? hints.projectId.trim()
    : null;
  const sdkEnvironment = typeof hints.environment === "string" && hints.environment.trim().length > 0
    ? hints.environment.trim()
    : null;
  if (sdkProjectId && sdkEnvironment) {
    return {
      organizationId: mapping.organizationId,
      projectId: sdkProjectId,
      environmentId: null,
      environment: sdkEnvironment,
      usedDefaultFallback: false,
      source: "sdk_metadata",
    };
  }
  if (options.strictIdentity && hints.projectId && hints.projectId !== mapping.projectId) {
    throw new SdkConfigError("identity_hint_mismatch", "Request identity does not match API key scope", 422, [
      {
        path: "/projectId",
        rule: "mismatch",
        message: "Body projectId does not match the authenticated key",
      },
    ]);
  }
  const selected = selectDeliveryEnvironment(mapping, hints.environmentId);
  return {
    organizationId: mapping.organizationId,
    projectId: mapping.projectId,
    environmentId: selected.environmentId,
    environment: null,
    usedDefaultFallback: selected.usedDefaultFallback,
    source: "api_key",
  };
}

export interface OperatorOverride {
  killswitches?: Partial<Record<KillswitchKey, boolean>>;
  features?: Partial<Record<FeatureKey, false>>;
  limits?: {
    persistenceGovernance?: Partial<PersistenceGovernance>;
  };
}

function applyOperatorOverride(config: SchemaV1Config, override: OperatorOverride | undefined): void {
  if (!override) return;
  for (const key of KILLSWITCH_KEYS) {
    if (override.killswitches?.[key] === true) config.killswitches[key] = true;
  }
  for (const feature of FEATURE_KEYS) {
    if (override.features?.[feature] === false) config.features[feature] = false;
  }
  const persistence = override.limits?.persistenceGovernance;
  if (persistence) {
    if (typeof persistence.maxPersistPerMinute === "number") {
      config.limits.persistenceGovernance.maxPersistPerMinute = Math.min(
        config.limits.persistenceGovernance.maxPersistPerMinute,
        persistence.maxPersistPerMinute,
      );
    }
    if (typeof persistence.adaptive === "boolean") {
      config.limits.persistenceGovernance.adaptive = persistence.adaptive;
    }
    if (typeof persistence.budgetExceededLogIntervalMs === "number") {
      config.limits.persistenceGovernance.budgetExceededLogIntervalMs = Math.max(
        config.limits.persistenceGovernance.budgetExceededLogIntervalMs,
        persistence.budgetExceededLogIntervalMs,
      );
    }
  }
}

export interface DeliveryBuildInput {
  compiled: SchemaV1Config;
  override?: OperatorOverride;
}

export interface DeliverySnapshot {
  config: SchemaV1Config;
  etag: string;
}

/** Delivery never translates schemas: it clones the canonical snapshot and applies only emergency disables. */
export function buildDeliverySnapshot(input: DeliveryBuildInput): DeliverySnapshot {
  const config = deepClone(input.compiled);
  applyOperatorOverride(config, input.override);
  config.meta.configHash = computeConfigHash(config);
  validateSchemaV1(config);
  return { config, etag: `"cfg-${config.meta.configHash}"` };
}
