import type { Pool } from 'pg';
export interface ProjectAlertQuery {
    status?: string;
    severity?: string;
    limit: number;
    offset: number;
}
export declare class ProjectAlertQueryService {
    private readonly runtime;
    constructor(logDb: Pool);
    list(organizationId: string, projectId: string, query: ProjectAlertQuery): Promise<{
        data: Array<Record<string, unknown>>;
        total: number;
    }>;
    get(organizationId: string, projectId: string, alertEventId: string): Promise<Record<string, unknown> | null>;
}
//# sourceMappingURL=project-alert-query.service.d.ts.map