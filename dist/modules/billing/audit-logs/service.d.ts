import { BillingAuditLogsRepository, type BillingAuditLogFilters } from './repository.js';
export declare class BillingAuditLogsService {
    private readonly repository;
    constructor(repository: BillingAuditLogsRepository);
    listAuditLogs(orgId: string, filters: BillingAuditLogFilters): Promise<{
        success: boolean;
        data: any[];
        meta: {
            page: number;
            limit: number;
            total: any;
            hasMore: boolean;
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map