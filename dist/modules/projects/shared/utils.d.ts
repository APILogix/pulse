import type { FastifyReply } from "fastify";
import type { ApiKeyType, OrgRole, ProjectStatus } from "../types.js";
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
/** Public prefix for keys minted in a given environment slug. */
export declare function environmentKeyPrefix(environment: string): string;
export declare function buildApiPrefixes(): never;
export declare function validateStatusTransition(current: ProjectStatus, next: ProjectStatus): boolean;
export declare function hashApiKey(rawKey: string): string;
/**
 * Mint a new API key.
 *
 * Format: `pk_{env_slug}_{8 hex}.{32 hex}` (>= 20 bytes of entropy). The
 * segment before the dot is the public identifier; the full string is hashed
 * for persistence.
 */
export declare function createApiKey(environment: string): {
    fullKey: string;
    publicKey: string;
    secretHash: string;
};
export declare function extractApiKeyPrefix(rawKey: string): string | null;
export declare function constantTimeEqualHex(left: string, right: string): boolean;
/** Default permission set for a freshly minted key of a given type. */
export declare function defaultPermissionsForType(keyType: ApiKeyType): string[];
export declare function isReservedProjectSlug(slug: string): boolean;
//# sourceMappingURL=utils.d.ts.map