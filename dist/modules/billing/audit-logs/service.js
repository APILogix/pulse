import { BillingAuditLogsRepository } from './repository.js';
export class BillingAuditLogsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async listAuditLogs(orgId, filters) {
        const { data, total } = await this.repository.listAuditLogs(orgId, filters);
        const page = Math.floor(filters.offset / filters.limit) + 1;
        return {
            success: true,
            data,
            meta: {
                page,
                limit: filters.limit,
                total,
                hasMore: filters.offset + data.length < total,
            },
        };
    }
}
//# sourceMappingURL=service.js.map