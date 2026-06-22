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
    environment: string;
    apiKeyId: string;
    isActive: boolean;
    expiresAt: Date | null;
}
export declare class PostgresWriter {
    readonly pool: Pool;
    private readonly reader;
    constructor(pool: Pool);
    getProjectByApiKeyHash(keyHash: string): Promise<ProjectAuthResult | null>;
    updateApiKeyLastUsed(apiKeyId: string): Promise<void>;
    listErrorEvents(query: NormalizedErrorEventListQuery): Promise<ErrorEventListResult>;
    getErrorEventById(errorId: string, projectId: string): Promise<ErrorEventRecord | null>;
    getEventById(eventId: string, projectId: string): Promise<unknown>;
    getEventsForReplay(projectId: string, startTime: string, endTime: string, eventTypes?: string[], maxEvents?: number): Promise<EnrichedEvent[]>;
    healthCheck(): Promise<boolean>;
}
//# sourceMappingURL=postgress.writter.d.ts.map