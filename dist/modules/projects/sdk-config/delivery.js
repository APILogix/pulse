/**
 * SDK delivery projection and API-key scope resolution.
 *
 * Authorization root is the API-key mapping — NOT request-body identity
 * (design.md §3.1/§7.3, Property 1 "Project Isolation"). The request body's
 * `projectId`, `service`, and `environment` are untrusted hints:
 *   - `projectId` never affects authorization (optionally 422 on mismatch).
 *   - `environment` selects an environment only when explicitly granted to the
 *     key; otherwise it falls back to the key's default for SDK compatibility.
 *
 * The delivery document is the complete schema-v1 snapshot after conservative
 * capability projection and any active operator override, with a delivery ETag
 * derived from canonical bytes (meta.configHash omitted from hash input).
 */
import { computeConfigHash } from "./canonical.js";
import { SdkConfigError } from "./errors.js";
import { deepClone } from "./traversal.js";
import { FEATURE_KEYS, KILLSWITCH_KEYS, SCHEMA_VERSION } from "./schema-v1.js";
export const SUPPORTED_SCHEMA_VERSIONS = [SCHEMA_VERSION];
/** Reject an unsupported singular schema version; absent defaults to schema 1. */
export function assertSupportedSchemaVersion(version) {
    if (version === undefined)
        return;
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
        throw new SdkConfigError("unsupported_schema", `Unsupported schemaVersion ${version}`, 422, [
            { path: "/schemaVersion", rule: "unsupported", message: "Only schemaVersion 1 is supported", allowed: SUPPORTED_SCHEMA_VERSIONS },
        ]);
    }
}
/**
 * Select the delivery environment. The hint is honored only when it is the key's
 * default or a member of `allowedEnvironmentIds`; otherwise it falls back to the
 * default. Body identity is never consulted here.
 */
export function selectDeliveryEnvironment(mapping, hintEnvironmentId) {
    if (hintEnvironmentId && hintEnvironmentId.length > 0) {
        const granted = hintEnvironmentId === mapping.defaultEnvironmentId ||
            mapping.allowedEnvironmentIds.includes(hintEnvironmentId);
        if (granted)
            return { environmentId: hintEnvironmentId, usedDefaultFallback: false };
    }
    return { environmentId: mapping.defaultEnvironmentId, usedDefaultFallback: true };
}
/**
 * Resolve the authoritative delivery scope from the API-key mapping. The body
 * `projectId` hint is IGNORED for authorization (or rejected under strict mode);
 * organization/project always come from the key.
 */
export function resolveDeliveryScope(mapping, hints, options = {}) {
    if (options.strictIdentity && hints.projectId && hints.projectId !== mapping.projectId) {
        throw new SdkConfigError("identity_hint_mismatch", "Request identity does not match API key scope", 422, [
            { path: "/projectId", rule: "mismatch", message: "Body projectId does not match the authenticated key" },
        ]);
    }
    const { environmentId, usedDefaultFallback } = selectDeliveryEnvironment(mapping, hints.environmentId);
    return {
        organizationId: mapping.organizationId,
        projectId: mapping.projectId,
        environmentId,
        usedDefaultFallback,
    };
}
/**
 * Conservative capability projection: when the SDK advertises a non-empty
 * capability list, features whose capability is absent are turned OFF. Projection
 * can never enable a feature, relax privacy, increase limits, or alter topology.
 */
function applyCapabilityProjection(config, capabilities) {
    if (!capabilities || capabilities.length === 0)
        return;
    const advertised = new Set(capabilities);
    for (const feature of FEATURE_KEYS) {
        if (!advertised.has(feature) && config.features[feature]) {
            config.features[feature] = false;
        }
    }
}
/** Apply an operator override. Emergency disables dominate the published snapshot. */
function applyOperatorOverride(config, override) {
    if (!override)
        return;
    for (const key of KILLSWITCH_KEYS) {
        const forced = override.killswitches?.[key];
        if (forced === true)
            config.killswitches[key] = true;
    }
    for (const feature of FEATURE_KEYS) {
        if (override.features?.[feature] === false)
            config.features[feature] = false;
    }
}
/**
 * Build the delivery snapshot: capability projection + operator override applied
 * over a clone of the compiled snapshot, then a recomputed configHash and a
 * matching `"cfg-<hash>"` ETag. Byte-equal representations yield equal ETags.
 */
export function buildDeliverySnapshot(input) {
    const config = deepClone(input.compiled);
    applyCapabilityProjection(config, input.capabilities);
    applyOperatorOverride(config, input.override);
    const hash = computeConfigHash(config);
    config.meta.configHash = hash;
    return { config, etag: `"cfg-${hash}"` };
}
//# sourceMappingURL=delivery.js.map