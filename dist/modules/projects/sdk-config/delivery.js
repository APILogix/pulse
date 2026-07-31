import { computeConfigHash } from "./canonical.js";
import { SdkConfigError } from "./errors.js";
import { deepClone } from "./traversal.js";
import { validateSchemaV1 } from "./validator.js";
import { FEATURE_KEYS, KILLSWITCH_KEYS, SCHEMA_VERSION, } from "./schema-v1.js";
export const SUPPORTED_SCHEMA_VERSIONS = [SCHEMA_VERSION];
export function assertSupportedSchemaVersion(version) {
    if (version === undefined || version === SCHEMA_VERSION)
        return;
    throw new SdkConfigError("unsupported_schema", `Unsupported schemaVersion ${version}`, 422, [
        {
            path: "/schemaVersion",
            rule: "unsupported",
            message: "Only schemaVersion 1 is supported",
            allowed: SUPPORTED_SCHEMA_VERSIONS,
        },
    ]);
}
export function selectDeliveryEnvironment(mapping, hintEnvironmentId) {
    if (hintEnvironmentId &&
        (hintEnvironmentId === mapping.defaultEnvironmentId ||
            mapping.allowedEnvironmentIds.includes(hintEnvironmentId))) {
        return { environmentId: hintEnvironmentId, usedDefaultFallback: false };
    }
    return { environmentId: mapping.defaultEnvironmentId, usedDefaultFallback: true };
}
export function resolveDeliveryScope(mapping, hints, options = {}) {
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
function applyOperatorOverride(config, override) {
    if (!override)
        return;
    for (const key of KILLSWITCH_KEYS) {
        if (override.killswitches?.[key] === true)
            config.killswitches[key] = true;
    }
    for (const feature of FEATURE_KEYS) {
        if (override.features?.[feature] === false)
            config.features[feature] = false;
    }
}
/** Delivery never translates schemas: it clones the canonical snapshot and applies only emergency disables. */
export function buildDeliverySnapshot(input) {
    const config = deepClone(input.compiled);
    applyOperatorOverride(config, input.override);
    config.meta.configHash = computeConfigHash(config);
    validateSchemaV1(config);
    return { config, etag: `"cfg-${config.meta.configHash}"` };
}
//# sourceMappingURL=delivery.js.map