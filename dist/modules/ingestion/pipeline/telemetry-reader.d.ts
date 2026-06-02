import type { Pool } from 'pg';
import type { EnrichedEvent, ErrorEventListResult, ErrorEventRecord, NormalizedErrorEventListQuery } from '../types.js';
export declare class TelemetryReader {
    private readonly pool;
    constructor(pool: Pool);
    listErrorEvents(query: NormalizedErrorEventListQuery): Promise<ErrorEventListResult>;
    getErrorEventById(errorId: string, projectId: string): Promise<ErrorEventRecord | null>;
    getEventById(eventId: string, projectId: string): Promise<Record<string, unknown> | null>;
    getEventsForReplay(projectId: string, startTime: string, endTime: string, eventTypes?: string[], maxEvents?: number): Promise<EnrichedEvent[]>;
    private mapErrorRow;
    private rowToNormalizedEvent;
    private withProjectContext;
}
//# sourceMappingURL=telemetry-reader.d.ts.map