/**
 * SCIM bearer token authentication (organization_scim_tokens).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        scim?: {
            orgId: string;
            tokenId: string;
            scopes: string[];
            ipAddress: string;
        };
    }
}
export declare function authenticateScim(request: FastifyRequest, reply: FastifyReply): Promise<void>;
export declare function assertScimOrg(request: FastifyRequest, orgId: string): void;
export declare function requireScimScope(request: FastifyRequest, reply: FastifyReply, scope: string): boolean;
//# sourceMappingURL=scim.middleware.d.ts.map