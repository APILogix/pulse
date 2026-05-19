import type { FastifyRequest, FastifyReply } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        user: {
            id: string;
            email: string;
            isAdmin: boolean;
            sessionId: string;
            mfaVerified: boolean;
        };
    }
}
export declare function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
export declare function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
export declare function requireMFA(request: FastifyRequest, reply: FastifyReply): Promise<void>;
//# sourceMappingURL=auth.d.ts.map