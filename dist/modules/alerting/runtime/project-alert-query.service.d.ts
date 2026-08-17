import type { Pool } from 'pg';
import { NotificationEntitlementService } from './notification-entitlement.service.js';
import { ProjectOwnerRepository } from './email-only-restricted-routing.js';
export interface ProjectAlertQuery {
    status?: string;
    severity?: string;
    limit: number;
    offset: number;
}
export interface ProjectAlertingStatus {
    organizationId: string;
    projectId: string;
    connectorAccess: {
        allowed: boolean;
        reason: string;
    };
    connectorStatus: {
        configured: boolean;
        connected: boolean;
        primary: {
            id: string;
            name: string;
            type: string;
            status: string;
        } | null;
        totalActive: number;
    };
    defaultDestination: {
        type: 'EMAIL' | 'PRIMARY_CONNECTOR' | 'PROJECT_OWNER_EMAIL';
        target: string;
        source: 'PROJECT_OWNER' | 'PRIMARY_CONNECTOR' | 'ORGANIZATION_FALLBACK';
    };
    fallbackDestination: {
        type: 'PROJECT_OWNER_EMAIL' | 'ORGANIZATION_FALLBACK';
        target: string;
    };
    projectOwner: {
        userId: string;
        email: string;
    } | null;
}
export declare class ProjectAlertQueryService {
    private readonly runtime;
    private readonly entitlement;
    private readonly owners;
    private readonly primaryDb;
    constructor(logDb: Pool, primaryDb?: Pool, entitlement?: NotificationEntitlementService, owners?: ProjectOwnerRepository);
    list(organizationId: string, projectId: string, query: ProjectAlertQuery): Promise<{
        data: Array<Record<string, unknown>>;
        total: number;
    }>;
    get(organizationId: string, projectId: string, alertEventId: string): Promise<Record<string, unknown> | null>;
    getAlertingStatus(organizationId: string, projectId: string): Promise<ProjectAlertingStatus>;
}
//# sourceMappingURL=project-alert-query.service.d.ts.map