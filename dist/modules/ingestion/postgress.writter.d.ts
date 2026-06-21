/**
 * Postgres writer for ingestion workers and lookup endpoints.
 *
 * Flow:
 * 1. API-key authentication reads project_api_keys joined to projects and
 *    returns only active, unexpired credentials.
 * 2. Worker writes first insert the shared events row, then insert type-specific
 *    child rows such as request_events or error_events in the same logical path.
 * 3. Debug and replay reads use project-scoped queries so callers can inspect or
 *    requeue historical telemetry without crossing tenant boundaries.
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
    private pool;
    constructor(pool: Pool);
    /**
     * Resolve project by API key hash.
     * Joins project_api_keys -> projects with active checks.
     */
    getProjectByApiKeyHash(keyHash: string): Promise<ProjectAuthResult | null>;
    /** Fire-and-forget last_used update (never block ingestion) */
    updateApiKeyLastUsed(apiKeyId: string): Promise<void>;
    /** Batch write to partitioned events table */
    writeEvents(events: EnrichedEvent[]): Promise<void>;
    /** Write request events to child partitioned table */
    writeRequestEvents(events: EnrichedEvent[]): Promise<void>;
    /** Write error events — error_groups handled by DB trigger */
    writeErrorEvents(events: EnrichedEvent[]): Promise<void>;
    listErrorEvents(query: NormalizedErrorEventListQuery): Promise<ErrorEventListResult>;
    getErrorEventById(errorId: string, projectId: string): Promise<ErrorEventRecord | null>;
    /** Debug endpoint: fetch full event graph */
    getEventById(eventId: string, projectId: string): Promise<any>;
    /** Replay: fetch historical events by time range */
    getEventsForReplay(projectId: string, startTime: string, endTime: string, eventTypes?: string[]): Promise<EnrichedEvent[]>;
    healthCheck(): Promise<boolean>;
    private mapErrorEvent;
    private withProjectContext;
}
//# sourceMappingURL=postgress.writter.d.ts.map