import { type FeatureKey, type KillswitchKey, type Limits, type PersistenceGovernance, type SamplingSignal, type SchemaV1Config } from "./schema-v1.js";
export interface TrustedTopology {
    ingestBaseUrl: string;
}
export interface CompileIdentity {
    projectId: string;
    environment: string;
    release?: string;
}
type NumericLimitKey = Exclude<keyof Limits, "tenantGovernance" | "persistenceGovernance">;
type PersistenceGovernancePolicy = Partial<PersistenceGovernance>;
export interface OrgPolicy {
    forceFeaturesOff?: FeatureKey[];
    forceKillswitchesOn?: KillswitchKey[];
    maxSamplingRates?: Partial<Record<SamplingSignal, number>>;
    limitCeilings?: Partial<Record<NumericLimitKey, number>>;
    persistenceGovernance?: PersistenceGovernancePolicy;
    mandatoryScrubHeaders?: string[];
    mandatoryScrubFields?: string[];
    forcePiiEnabled?: boolean;
}
export interface CompileInput {
    identity: CompileIdentity;
    topology: TrustedTopology;
    requestedIntent: Record<string, unknown>;
    orgPolicy?: OrgPolicy;
    generatedAt: string;
    generatedBy?: string;
}
export declare const PLATFORM_MANDATORY_SCRUB_HEADERS: readonly ["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"];
export declare const PLATFORM_MANDATORY_SCRUB_FIELDS: readonly ["password", "secret", "token", "apiKey", "authorization", "creditCard", "ssn", "access_token", "refresh_token", "client_secret"];
export declare function compile(input: CompileInput): SchemaV1Config;
export declare function compileInitial(identity: CompileIdentity, topology: TrustedTopology, generatedAt: string, orgPolicy?: OrgPolicy): SchemaV1Config;
export {};
//# sourceMappingURL=compiler.d.ts.map