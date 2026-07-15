import { type HealthCheckRow, type HealthState } from '../types.js';
export declare class ConnectorMetricsRepository {
    private readonly db;
    recordSuccess(connectorId: string): Promise<void>;
    /** Increment failures; flip to 'error' once the threshold is crossed. */
    recordFailure(connectorId: string): Promise<{
        consecutiveFailures: number;
        tripped: boolean;
    }>;
    insertHealthCheck(connectorId: string, state: HealthState, responseTimeMs: number | null, errorMessage: string | null, details: Record<string, unknown>): Promise<HealthCheckRow>;
    listHealthChecks(organizationId: string, connectorId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: HealthCheckRow[];
        total: number;
    }>;
    insertTestRun(input: {
        connectorId: string;
        triggeredBy: string | null;
        status: string;
        response: Record<string, unknown> | null;
        durationMs: number | null;
    }): Promise<void>;
    listTestRuns(organizationId: string, connectorId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import('../types.js').ConnectorTestRunRow[];
        total: number;
    }>;
}
//# sourceMappingURL=metrics.repository.d.ts.map