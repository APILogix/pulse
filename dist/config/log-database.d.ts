import { type PoolClient, type QueryResult } from 'pg';
declare class LogDatabaseManager {
    private primaryPool;
    private isShuttingDown;
    constructor();
    /**
     * Test connection on startup (FAIL FAST)
     */
    connect(): Promise<{
        primary: Date;
    }>;
    private setupPoolMonitoring;
    /**
     * Get connection (simplified - always returns primary)
     * When you add replica later, add 'operation' param here
     */
    getConnection(options?: {
        projectId?: string;
    }): Promise<PoolClient>;
    /**
     * Execute with retry logic
     */
    queryWithRetry<T = any>(sql: string, params?: any[], options?: {
        maxRetries?: number;
        projectId?: string;
        timeout?: number;
    }): Promise<QueryResult<T>>;
    /**
     * Batch insert (simplified without COPY protocol)
     */
    batchInsertEvents(events: Array<{
        project_id: string;
        type: string;
        timestamp: Date;
        payload: object;
    }>): Promise<void>;
    private insertRequests;
    private insertErrors;
    /**
     * Simple health check
     */
    healthCheck(): Promise<{
        healthy: boolean;
        timestamp?: Date;
    }>;
    close(): Promise<void>;
}
export declare const logDB: LogDatabaseManager;
export declare const logQuery: <T = any>(sql: string, params?: any[], options?: Parameters<(typeof logDB)["queryWithRetry"]>[2]) => Promise<QueryResult<T>>;
export declare const connectLogDB: () => Promise<{
    primary: Date;
}>;
export {};
//# sourceMappingURL=log-database.d.ts.map