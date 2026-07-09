import { EntitlementsRepository } from './repository.js';
export declare class EntitlementsService {
    private readonly repository;
    constructor(repository: EntitlementsRepository);
    getAllEntitlements(orgId: string): Promise<{
        success: boolean;
        data: Record<string, any>;
    }>;
    checkFeatureAccess(orgId: string, featureKey: string, quantity?: number): Promise<{
        success: boolean;
        data: {
            granted: boolean;
            reason: string;
            limit?: never;
        };
    } | {
        success: boolean;
        data: {
            granted: boolean;
            limit: number;
            reason?: never;
        };
    } | {
        success: boolean;
        data: {
            granted: boolean;
            reason?: never;
            limit?: never;
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map