/**
 * SCIM bearer token authentication (organization_scim_tokens).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        scim?: {
            orgId: string;
            tokenId: string;
        };
    }
}
export declare function authenticateScim(request: FastifyRequest, reply: FastifyReply): Promise<void>;
export declare function assertScimOrg(request: FastifyRequest, orgId: string): void;
//# sourceMappingURL=scim.middleware.d.ts.map