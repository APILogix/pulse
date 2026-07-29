import { type FeatureKey, type KillswitchKey, type SchemaV1Config } from "./schema-v1.js";
/** Authoritative scope resolved from the presented API key. */
export interface ApiKeyMapping {
    organizationId: string;
    projectId: string;
    defaultEnvironmentId: string;
    allowedEnvironmentIds: string[];
}
/** Untrusted hints from the SDK delivery request body/headers. */
export interface DeliveryRequestHints {
    /** Resolved candidate environment id from the request's `environment` slug, if any. */
    environmentId?: string | null;
    /** Untrusted body projectId (current SDK does not send it). */
    projectId?: string | null;
    /** Advertised SDK capabilities (feature names). Unknown entries are ignored. */
    capabilities?: string[];
    /** Singular schema version advertised by the SDK. Must equal 1 for current SDK. */
    schemaVersion?: number;
}
export interface ResolveScopeOptions {
    /** When true, a body projectId that mismatches the key returns 422. Default false. */
    strictIdentity?: boolean;
}
export interface ResolvedDeliveryScope {
    organizationId: string;
    projectId: string;
    environmentId: string;
    /** True when an absent/unknown/ungranted environment hint fell back to default. */
    usedDefaultFallback: boolean;
}
export declare const SUPPORTED_SCHEMA_VERSIONS: readonly [1];
/** Reject an unsupported singular schema version; absent defaults to schema 1. */
export declare function assertSupportedSchemaVersion(version: number | undefined): void;
/**
 * Select the delivery environment. The hint is honored only when it is the key's
 * default or a member of `allowedEnvironmentIds`; otherwise it falls back to the
 * default. Body identity is never consulted here.
 */
export declare function selectDeliveryEnvironment(mapping: ApiKeyMapping, hintEnvironmentId: string | null | undefined): {
    environmentId: string;
    usedDefaultFallback: boolean;
};
/**
 * Resolve the authoritative delivery scope from the API-key mapping. The body
 * `projectId` hint is IGNORED for authorization (or rejected under strict mode);
 * organization/project always come from the key.
 */
export declare function resolveDeliveryScope(mapping: ApiKeyMapping, hints: DeliveryRequestHints, options?: ResolveScopeOptions): ResolvedDeliveryScope;
/** Active operator override patch. Only emergency disables dominate delivery. */
export interface OperatorOverride {
    /** Force these killswitches on (emergency disables). */
    killswitches?: Partial<Record<KillswitchKey, boolean>>;
    /** Force these features off. */
    features?: Partial<Record<FeatureKey, false>>;
}
export interface DeliveryBuildInput {
    compiled: SchemaV1Config;
    capabilities?: string[];
    override?: OperatorOverride;
}
export interface DeliverySnapshot {
    config: SchemaV1Config;
    etag: string;
}
/**
 * Build the delivery snapshot: capability projection + operator override applied
 * over a clone of the compiled snapshot, then a recomputed configHash and a
 * matching `"cfg-<hash>"` ETag. Byte-equal representations yield equal ETags.
 */
export declare function buildDeliverySnapshot(input: DeliveryBuildInput): DeliverySnapshot;
//# sourceMappingURL=delivery.d.ts.map