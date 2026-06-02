import type { FastifyReply } from 'fastify';
export declare function serviceProviderConfig(): Record<string, unknown>;
export declare function resourceTypes(): Record<string, unknown>;
export declare function schemas(): Record<string, unknown>;
export declare function listUsers(orgId: string, options: {
    startIndex: number;
    count: number;
    filter?: string;
}): Promise<Record<string, unknown>>;
export declare function getUser(orgId: string, externalId: string): Promise<Record<string, unknown>>;
export declare function createUser(orgId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function patchUser(orgId: string, externalId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function replaceUser(orgId: string, externalId: string, body: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function deleteUser(orgId: string, externalId: string): Promise<void>;
export declare function listGroups(orgId: string): Promise<Record<string, unknown>>;
export declare function getGroup(orgId: string, groupId: string): Promise<Record<string, unknown>>;
export declare function handleScimError(error: unknown, reply: FastifyReply): void;
//# sourceMappingURL=scim.service.d.ts.map