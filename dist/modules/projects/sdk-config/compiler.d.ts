import { type FeatureKey, type KillswitchKey, type Limits, type SamplingSignal, type SchemaV1Config } from "./schema-v1.js";
/** Trusted, platform-owned ingest topology. Never user-supplied. */
export interface TrustedTopology {
    /** HTTPS origin used to derive every route URL, e.g. `https://ingest.pulse.dev`. */
    ingestBaseUrl: string;
}
/** Immutable identity derived from the authoritative project/environment scope. */
export interface CompileIdentity {
    projectId: string;
    environment: string;
    release?: string;
}
/** Organization policy that narrows the editable envelope. All fields optional. */
export interface OrgPolicy {
    forceFeaturesOff?: FeatureKey[];
    forceKillswitchesOn?: KillswitchKey[];
    maxSamplingRates?: Partial<Record<SamplingSignal, number>>;
    limitCeilings?: Partial<Record<keyof LimitScalars, number>>;
    mandatoryScrubHeaders?: string[];
    mandatoryScrubFields?: string[];
    forcePiiEnabled?: boolean;
}
type LimitScalars = Omit<Limits, "tenantGovernance">;
export interface CompileInput {
    identity: CompileIdentity;
    topology: TrustedTopology;
    /** Validated, allowlisted editable intent (requested_config). */
    requestedIntent: Record<string, unknown>;
    orgPolicy?: OrgPolicy;
    /** Frozen ISO timestamp for meta.generatedAt (caller supplies for determinism). */
    generatedAt: string;
    generatedBy?: string;
}
/** Platform-mandatory scrub rules that project intent can never remove. */
export declare const PLATFORM_MANDATORY_SCRUB_HEADERS: readonly ["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"];
export declare const PLATFORM_MANDATORY_SCRUB_FIELDS: readonly ["password", "secret", "token", "apiKey", "authorization"];
/**
 * Compile a complete schema-v1 document. The output is deterministic for a given
 * input and always contains all ten sections and exactly nine routes.
 */
export declare function compile(input: CompileInput): SchemaV1Config;
/** Convenience for atomic environment initialization: compile with empty intent. */
export declare function compileInitial(identity: CompileIdentity, topology: TrustedTopology, generatedAt: string, orgPolicy?: OrgPolicy): SchemaV1Config;
export {};
//# sourceMappingURL=compiler.d.ts.map