import { BillingAuditLogsRepository, type BillingAuditLogFilters } from './repository.js';

export class BillingAuditLogsService {
  constructor(private readonly repository: BillingAuditLogsRepository) {}

  async listAuditLogs(orgId: string, filters: BillingAuditLogFilters) {
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
