import type { Pool } from 'pg';
import { type EntitlementsService } from '../../billing/entitlements/service.js';
import { type UsageService } from '../../billing/usage/service.js';
export interface BootstrapUserContext {
    id: string;
    email: string;
    name?: string | null;
    avatarUrl?: string | null;
}
export interface OwnedOrganizationSummary {
    id: string;
    name: string;
    slug: string;
    status: string;
}
export interface OrganizationCreationEligibility {
    /** False when POST /organizations would reject with "User already owns an organization". */
    allowed: boolean;
    /** The organization that blocks creation, when there is one. */
    ownedOrganization: OwnedOrganizationSummary | null;
}
export interface BootstrapResponseData {
    currentOrganizationId: string | null;
    organizationCreation: OrganizationCreationEligibility;
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
    /**
     * Same rule as CoreRepository.createOrg: a user may own one organization
     * that is not deleted (archived ones still count). Returning it here lets
     * the console explain the limit before the user fills in the form.
     */
    private fetchOrganizationCreation;
    private emptyUsage;
    getBootstrapContext(user: BootstrapUserContext, preferredOrgId?: string | null): Promise<BootstrapResponseData>;
}
export declare const bootstrapService: BootstrapService;
//# sourceMappingURL=bootstrap.service.d.ts.map