import type { FastifyInstance } from "fastify";
/**
 * SDK bootstrap clients may POST `Content-Type: application/json` with a
 * zero-byte body. Fastify's default JSON parser rejects that before handlers
 * can apply their own `{}` fallback, so this scoped override preserves the
 * default secure parser for real JSON and maps empty JSON to an empty object.
 */
export declare function acceptEmptyJsonBodyAsObject(fastify: FastifyInstance): void;
//# sourceMappingURL=empty-json-body.d.ts.map