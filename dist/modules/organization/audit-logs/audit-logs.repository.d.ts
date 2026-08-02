import { BaseRepository } from "../shared/base.repository.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { CreateAuditLogRecord, AuditLogFilters, AuditLogRow } from "./audit-logs.schema.js";
export declare class AuditLogsRepository extends BaseRepository {
    createAuditLog(entry: CreateAuditLogRecord): Promise<void>;
    listAuditLogs(orgId: string, q: CursorPaginationQuery, filters?: AuditLogFilters): Promise<CursorPaginatedResponse<AuditLogRow>>;
    exportAuditLogs(orgId: string, filters?: AuditLogFilters): Promise<AuditLogRow[]>;
    purgeExpiredAuditLogs(): Promise<number>;
}
//# sourceMappingURL=audit-logs.repository.d.ts.map