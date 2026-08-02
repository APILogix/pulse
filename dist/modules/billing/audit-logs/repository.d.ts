import type { Pool, PoolClient } from 'pg';
type Db = Pool | PoolClient;
export interface BillingAuditLogFilters {
    action?: string;
    subscriptionId?: string;
    invoiceId?: string;
    paymentId?: string;
    startDate?: Date;
    endDate?: Date;
    limit: number;
    offset: number;
}
export declare class BillingAuditLogsRepository {
    private readonly db;
    constructor(db?: Pool);
    listAuditLogs(orgId: string, filters: BillingAuditLogFilters, db?: Db): Promise<{
        data: any[];
        total: any;
    }>;
}
export {};
//# sourceMappingURL=repository.d.ts.map