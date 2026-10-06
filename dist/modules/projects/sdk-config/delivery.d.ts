import { type FeatureKey, type KillswitchKey, type PersistenceGovernance, type SchemaV1Config } from "./schema-v1.js";
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
export declare const SUPPORTED_SCHEMA_VERSIONS: readonly [1];
export declare function assertSupportedSchemaVersion(version: number | undefined): void;
export declare function selectDeliveryEnvironment(mapping: ApiKeyMapping, hintEnvironmentId: string | null | undefined): {
    environmentId: string;
    usedDefaultFallback: boolean;
};
export declare function resolveDeliveryScope(mapping: ApiKeyMapping, hints: DeliveryRequestHints, options?: ResolveScopeOptions): ResolvedDeliveryScope;
export interface OperatorOverride {
    killswitches?: Partial<Record<KillswitchKey, boolean>>;
    features?: Partial<Record<FeatureKey, false>>;
    limits?: {
        persistenceGovernance?: Partial<PersistenceGovernance>;
    };
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
export declare function buildDeliverySnapshot(input: DeliveryBuildInput): DeliverySnapshot;
//# sourceMappingURL=delivery.d.ts.map