import type { Pool } from 'pg';
import { type EntitlementsService } from '../../billing/entitlements/service.js';
import { type UsageService } from '../../billing/usage/service.js';
export interface BootstrapUserContext {
    id: string;
    email: string;
    name?: string | null;
    avatarUrl?: string | null;
}
export interface BootstrapResponseData {
    currentOrganizationId: string | null;
    organizations: Array<{
        id: string;
        name: string;
        slug: string;
        role: string;
        isCurrent: boolean;
    }>;
    projects: Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
    }>;
    billing: {
        plan: {
            id: string;
            key: string;
            name: string;
        };
        status: string;
        currentPeriodEnd: string | null;
        cancelAtPeriodEnd: boolean;
    } | null;
    features: Record<string, boolean>;
    integrations: Record<string, boolean>;
    quotas: Record<string, {
        limit: number;
        used: number;
        remaining: number;
    }>;
    usage: {
        monthlyEvents: {
            limit: number;
            used: number;
            remaining: number;
            percentage: number;
        };
        aiCredits: {
            limit: number;
            used: number;
            remaining: number;
            percentage: number;
        };
    };
}
export declare class BootstrapService {
    private readonly db;
    private readonly entitlements;
    private readonly usage;
    constructor(db?: Pool, entitlements?: EntitlementsService, usage?: UsageService);
    private fetchQuotaUsageCounts;
    private emptyUsage;
    getBootstrapContext(user: BootstrapUserContext, preferredOrgId?: string | null): Promise<BootstrapResponseData>;
}
export declare const bootstrapService: BootstrapService;
//# sourceMappingURL=bootstrap.service.d.ts.map