import type { FastifyReply } from 'fastify';
interface ScimActor {
    tokenId: string;
    ipAddress: string;
}
export declare function serviceProviderConfig(): Record<string, unknown>;
export declare function resourceTypes(): Record<string, unknown>;
export declare function schemas(): Record<string, unknown>;
export declare function listUsers(orgId: string, options: {
    startIndex: number;
    count: number;
    filter?: string;
}): Promise<Record<string, unknown>>;
export declare function getUser(orgId: string, externalId: string): Promise<Record<string, unknown>>;
export declare function createUser(orgId: string, body: Record<string, unknown>, actor?: ScimActor): Promise<Record<string, unknown>>;
export declare function patchUser(orgId: string, externalId: string, body: Record<string, unknown>, actor?: ScimActor): Promise<Record<string, unknown>>;
export declare function replaceUser(orgId: string, externalId: string, body: Record<string, unknown>, actor?: ScimActor): Promise<Record<string, unknown>>;
export declare function deleteUser(orgId: string, externalId: string, actor?: ScimActor): Promise<void>;
export declare function listGroups(orgId: string, options?: {
    startIndex?: number;
    count?: number;
    filter?: string;
}): Promise<Record<string, unknown>>;
export declare function getGroup(orgId: string, groupId: string): Promise<Record<string, unknown>>;
export declare function createGroup(orgId: string, body: Record<string, unknown>, actor: ScimActor): Promise<Record<string, unknown>>;
export declare function replaceGroup(orgId: string, groupId: string, body: Record<string, unknown>, actor: ScimActor): Promise<Record<string, unknown>>;
export declare function patchGroup(orgId: string, groupId: string, body: Record<string, unknown>, actor: ScimActor): Promise<Record<string, unknown>>;
export declare function deleteGroup(orgId: string, groupId: string, actor: ScimActor): Promise<void>;
export declare function handleScimError(error: unknown, reply: FastifyReply): void;
export {};
//# sourceMappingURL=scim.service.d.ts.map