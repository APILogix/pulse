import type { FastifyReply } from "fastify";
import type { OrgRole, ProjectEnvironment, ProjectStatus } from "./types.js";
export declare class ProjectError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(code: string, message: string, statusCode?: number);
}
export declare function handleProjectError(error: unknown, reply: FastifyReply): FastifyReply;
export declare function hasRequiredRole(role: OrgRole, requiredRole: OrgRole): boolean;
export declare function slugifyProjectName(name: string): string;
export declare function buildApiPrefixes(slug: string): {
    productionApiPrefix: string;
    developmentApiPrefix: string;
};
export declare function validateStatusTransition(current: ProjectStatus, next: ProjectStatus): boolean;
export declare function hashApiKey(rawKey: string): string;
export declare function createApiKey(environment: ProjectEnvironment): {
    fullKey: string;
    keyPrefix: string;
    keyHash: string;
};
export declare function extractApiKeyPrefix(rawKey: string): string | null;
export declare function constantTimeEqualHex(left: string, right: string): boolean;
//# sourceMappingURL=utils.d.ts.map