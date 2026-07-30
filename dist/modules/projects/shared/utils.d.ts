import type { FastifyReply } from "fastify";
import type { OrgRole, ProjectStatus } from "../types.js";
export declare const ProjectErrorCodes: {
    readonly PROJECT_NOT_FOUND: 404;
    readonly PROJECT_SLUG_EXISTS: 409;
    readonly PROJECT_INVALID_TRANSITION: 400;
    readonly PROJECT_LIMIT_EXCEEDED: 400;
    readonly PROJECT_ARCHIVED: 409;
    readonly INSUFFICIENT_PERMISSIONS: 403;
    readonly ENVIRONMENT_NOT_FOUND: 404;
    readonly ENVIRONMENT_EXISTS: 409;
    readonly API_KEY_NOT_FOUND: 404;
    readonly API_KEY_LIMIT_EXCEEDED: 400;
    readonly API_KEY_REVOKED: 400;
    readonly API_KEY_EXPIRED: 400;
    readonly API_KEY_CONFLICT: 409;
    readonly API_KEY_INVALID_STATE: 400;
    readonly VALIDATION_ERROR: 422;
    readonly INTERNAL_ERROR: 500;
    readonly PROJECT_CONCURRENT_UPDATE: 409;
    readonly API_KEY_CONCURRENT_UPDATE: 409;
};
export declare class ProjectError extends Error {
    readonly code: keyof typeof ProjectErrorCodes | string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: keyof typeof ProjectErrorCodes | string, message: string, statusCode?: number, details?: Record<string, unknown> | undefined);
}
export declare function handleProjectError(error: unknown, reply: FastifyReply): FastifyReply;
export declare function hasRequiredRole(role: OrgRole, requiredRole: OrgRole): boolean;
export declare function slugifyProjectName(name: string): string;
export declare const API_KEY_PREFIXES: {
    readonly live: "pv_live_";
    readonly test: "pv_test_";
};
/** Public prefix for keys minted in a given environment. */
export declare function environmentKeyPrefix(environment: string): string;
export declare function buildApiPrefixes(): never;
export declare function validateStatusTransition(current: ProjectStatus, next: ProjectStatus): boolean;
export declare function hashApiKey(rawKey: string): string;
/**
 * Mint a new API key.
 *
 * Format: `pv_live_{24 hex}.{32 hex}` for Production and
 * `pv_test_{24 hex}.{32 hex}` for every non-production environment. The
 * segment before the dot is the public identifier; the full string is hashed
 * for persistence. Environment identity is stored in
 * project_api_keys.environment_id, not leaked into the public credential prefix.
 */
export declare function createApiKey(environment: string): {
    fullKey: string;
    publicKey: string;
    secretHash: string;
};
export declare function extractApiKeyPrefix(rawKey: string): string | null;
export declare function constantTimeEqualHex(left: string, right: string): boolean;
/**
 * Ingestion permissions granted to an authenticated credential. API keys are
 * not a permission engine: every valid key may ingest telemetry for its
 * environment, and finer authorization belongs to the policy modules.
 */
export declare function defaultIngestionPermissions(): string[];
export declare function isReservedProjectSlug(slug: string): boolean;
//# sourceMappingURL=utils.d.ts.map