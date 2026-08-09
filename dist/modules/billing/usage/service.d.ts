import type { UsageRepository } from './repository.js';
interface BillingUserContext {
    id: string;
    currentOrgId?: string | null;
    orgId?: string | null;
}
export declare class UsageService {
    private readonly repository;
    constructor(repository: UsageRepository);
    resolveAuthorizedOrgId(user: BillingUserContext | undefined, requestedOrgId?: string): Promise<string>;
    getCurrentUsage(orgId: string): Promise<{
        success: true;
        data: {
            eventsUsed: number;
            eventLimit: number;
            remainingEvents: number;
            aiCreditsUsed: number;
            aiCreditLimit: number;
            remainingAiCredits: number;
            projectsUsed: number;
            membersUsed: number;
        };
    }>;
    incrementEventUsage(orgId: string, count?: number): Promise<{
        success: boolean;
    }>;
    getQuotaSummary(orgId: string): Promise<{
        success: true;
        data: {
            eventsLeft: number;
            totalEvents: number;
            billingCycleEndDate: string;
            aiCreditsTotal: number;
            aiCreditsLeft: number;
        };
    }>;
    getDailyUsage(orgId: string, startDate?: Date, endDate?: Date): Promise<{
        success: boolean;
        data: {
            date: any;
            eventsCount: any;
            aiCreditsUsed: any;
            errorsCount: any;
            requestsCount: any;
        }[];
    }>;
    getProjectAttribution(orgId: string, options: {
        bucket: 'minute' | 'hour' | 'day';
        startDate?: Date;
        endDate?: Date;
        projectId?: string;
        limit: number;
        offset: number;
    }): Promise<{
        success: boolean;
        data: any[];
    }>;
    getApiKeyAttribution(orgId: string, options: {
        startDate?: Date;
        endDate?: Date;
        projectId?: string;
        limit: number;
        offset: number;
    }): Promise<{
        success: boolean;
        data: any[];
    }>;
}
export {};
//# sourceMappingURL=service.d.ts.map