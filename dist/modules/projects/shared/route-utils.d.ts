import type { FastifyReply, FastifyRequest } from "fastify";
import type { RequestMeta as OrganizationRequestMeta } from "../../organization/types.js";
import type { RequestMeta } from "../service.js";
export declare function requestMeta(request: FastifyRequest): RequestMeta;
export declare function organizationRequestMeta(request: FastifyRequest): OrganizationRequestMeta;
export declare function authenticatedUser(request: FastifyRequest): {
    id: string;
    email: string;
    isAdmin: boolean;
    currentOrgId?: string | null;
    sessionId: string;
    mfaVerified: boolean;
    stepUpFresh: boolean;
};
export declare function withErrorHandling(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>): (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
//# sourceMappingURL=route-utils.d.ts.map