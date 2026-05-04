import type { BillingAddress } from './types.js';
export declare function generateInvitationToken(): string;
export declare function hashToken(token: string): string;
export declare function generateSlug(name: string): string;
export declare function sanitizeBillingAddress(value: unknown): BillingAddress | null;
export declare function createOrganizationLogger(context: string): {
    info: (message: string, meta?: any) => void;
    error: (message: string, error?: any) => void;
    warn: (message: string, meta?: any) => void;
    debug: (message: string, meta?: any) => void;
};
//# sourceMappingURL=utils.d.ts.map