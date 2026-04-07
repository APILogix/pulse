export interface ClerkAuthResult {
    userId: string;
    orgId: string | null;
    orgRole: string | null;
    sessionId: string;
    email: string;
    firstName: string;
    lastName: string;
    imageUrl: string;
}
export declare function verifyClerkToken(token: string): Promise<ClerkAuthResult | null>;
export declare function verifyClerkWebhook(payload: string, headers: Record<string, string>): any;
export declare function syncClerkUserToDB(clerkUser: any): Promise<string>;
//# sourceMappingURL=clerk.d.ts.map