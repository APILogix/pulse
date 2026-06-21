import type { FastifyRequest } from 'fastify';
/** Extract project API key from X-API-Key or Authorization header. */
export declare function extractApiKeyFromRequest(request: FastifyRequest): string | null;
/** Header-first API key resolution for ingest/init bodies. */
export declare function resolveApiKey(request: FastifyRequest, body?: {
    apiKey?: string;
}): string | null;
//# sourceMappingURL=api-key.d.ts.map