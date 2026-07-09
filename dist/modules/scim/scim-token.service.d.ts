export interface CreateScimTokenInput {
    orgId: string;
    createdBy: string;
    scopes: string[];
    allowedIps?: string[];
    expiresInDays?: number;
}
export declare class ScimTokenService {
    createToken(input: CreateScimTokenInput): Promise<{
        rawToken: string;
        tokenId: string;
    }>;
    rotateToken(tokenId: string, orgId: string, rotatedBy: string): Promise<{
        rawToken: string;
        newTokenId: string;
    }>;
    revokeToken(tokenId: string, orgId: string, revokedBy: string): Promise<void>;
    listTokens(orgId: string): Promise<{
        id: string;
        created_at: Date;
        last_used_at: Date | null;
        expires_at: Date | null;
        revoked_at: Date | null;
        scopes: string[];
        allowed_ips: string[];
    }[]>;
    private createTokenInTransaction;
}
//# sourceMappingURL=scim-token.service.d.ts.map