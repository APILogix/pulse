import { UsageRepository } from './repository.js';
export declare class UsageService {
    private readonly repository;
    constructor(repository: UsageRepository);
    getCurrentUsage(orgId: string): Promise<{
        success: boolean;
        data: {
            eventsUsed: number;
            eventLimit: number;
            aiCreditsUsed: number;
            aiCreditLimit: number;
            remainingEvents?: never;
            remainingAiCredits?: never;
            projectsUsed?: never;
            membersUsed?: never;
        };
    } | {
        success: boolean;
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
}
//# sourceMappingURL=service.d.ts.map