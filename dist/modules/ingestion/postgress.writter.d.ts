/**
 * PostgresWriter — API key resolution + telemetry reads (delegates to TelemetryReader).
 * Persistence for the ingestion worker lives in TelemetryWriter, not here.
 */
import { type Pool } from 'pg';
import type { EnrichedEvent, ErrorEventListResult, ErrorEventRecord, NormalizedErrorEventListQuery } from './types.js';
export interface ProjectAuthResult {
    projectId: string;
    orgId: string;
    projectName: string;
    projectStatus: string;
    environmentId: string;
    environmentName: string;
    environmentSlug: string;
    apiKeyId: string;
    keyType: string;
    rotationVersion: number;
    isActive: boolean;
    status: string;
    expiresAt: Date | null;
    permissions: string[];
    allowedEndpoints: string[];
    blockedEndpoints: string[];
    allowedEventTypes: string[];
    allowedOrigins: string[];
    allowedIps: string[];
    allowedDomains: string[];
    allowedSdks: string[];
    samplingRules: Record<string, unknown>;
    featureFlags: Record<string, unknown>;
    sdkConfig: Record<string, unknown>;
    rateLimitPerSecond: number | null;
    rateLimitPerMinute: number | null;
    rateLimitPerHour: number | null;
    /**
     * Raw billing plan tier (plans.tier) resolved via the organization's latest
     * live subscription. NULL when the org has no trialing/active/past_due
     * subscription — callers map it through normalizePlanTier().
     */
    planTier: string | null;
    /**
     * Optional org-wide ingest rate-limit overrides. No schema column carries
     * these today, so they are always NULL and the service falls back to the
     * INGESTION_ORG_RATE_LIMIT_* env defaults.
     */
    orgRateLimitPerSecond: number | null;
    orgRateLimitPerMinute: number | null;
}
export declare class PostgresWriter {
    readonly pool: Pool;
    private readonly reader;
    constructor(pool: Pool);
    /**
     * Resolve an ingestion API key by extracting its public prefix, looking up
     * candidate rows, and comparing the SHA-256 secret hash in constant time.
     * Returns the full project/auth context needed by the gateway, including the
     * environment, scoping fields, and billing plan tier.
     */
    resolveApiKey(rawKey: string): Promise<ProjectAuthResult | null>;
    /**
     * Billing context for a project (org + plan tier). Used by the admin replay
     * path, which has no API key to resolve through resolveApiKey().
     */
    getProjectPlanContext(projectId: string): Promise<{
        orgId: string;
        planTier: string | null;
    } | null>;
    updateApiKeyLastUsed(apiKeyId: string): Promise<void>;
    listErrorEvents(query: NormalizedErrorEventListQuery): Promise<ErrorEventListResult>;
    getErrorEventById(errorId: string, projectId: string): Promise<ErrorEventRecord | null>;
    getEventById(eventId: string, projectId: string): Promise<unknown>;
    getEventsForReplay(projectId: string, startTime: string, endTime: string, eventTypes?: string[], maxEvents?: number): Promise<EnrichedEvent[]>;
    healthCheck(): Promise<boolean>;
}
//# sourceMappingURL=postgress.writter.d.ts.map