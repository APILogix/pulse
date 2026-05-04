import type { DashboardData, ErrorGroupListQuery, ErrorGroupUpdate, EventDetails, EventListQuery, PaginatedResult, TimeRange } from "./types.js";
export declare class AnalyticsRepository {
    private readonly db;
    private readonly maxLimit;
    constructor(db?: import("pg").Pool);
    listEvents(projectId: string, query: EventListQuery): Promise<PaginatedResult>;
    getEventDetails(projectId: string, eventId: string): Promise<EventDetails | null>;
    getRequestOverview(projectId: string, range: TimeRange): Promise<unknown>;
    getDashboard(projectId: string, range: TimeRange): Promise<DashboardData>;
    listErrorGroups(projectId: string, query: ErrorGroupListQuery): Promise<PaginatedResult>;
    updateErrorGroup(projectId: string, fingerprint: string, update: ErrorGroupUpdate): Promise<unknown | null>;
    checkHealth(projectId: string): Promise<boolean>;
    private one;
    private queryData;
    private queryRows;
    private withProjectContext;
    private clampLimit;
    private encodeCursor;
    private decodeCursor;
}
//# sourceMappingURL=repository.d.ts.map