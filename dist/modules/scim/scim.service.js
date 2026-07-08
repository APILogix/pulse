/**
 * SCIM 2.0 User provisioning for organization members.
 */
import { createHash, randomUUID } from 'crypto';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import * as repository from '../auth/infrastructure/repositories/index.js';
import { AuthError, AuthErrorCodes } from '../auth/domain/types.js';
import { normalizeEmail } from '../auth/domain/constants.js';
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
function emailToHash(email) {
    return createHash('sha256').update(email.toLowerCase()).digest('hex');
}
function memberRoleFromScimRole(role) {
    const normalized = role?.toLowerCase();
    if (normalized === 'admin' || normalized === 'owner') {
        return normalized;
    }
    return 'member';
}
function parseScimFilter(filter) {
    if (!filter)
        return {};
    const userNameMatch = filter.match(/userName\s+eq\s+"([^"]+)"/i);
    if (userNameMatch?.[1])
        return { userName: userNameMatch[1] };
    const idMatch = filter.match(/(?:externalId|id)\s+eq\s+"([^"]+)"/i);
    if (idMatch?.[1])
        return { externalId: idMatch[1] };
    return {};
}
async function userToScimResource(orgId, userId, externalId) {
    const user = await repository.findUserById(userId);
    const member = await repository.findActiveOrgMember(orgId, userId);
    if (!user || !member) {
        throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    const active = user.status === 'active' && !user.deleted_at;
    return {
        schemas: [USER_SCHEMA],
        id: externalId,
        externalId,
        userName: user.email,
        active,
        name: {
            formatted: user.full_name,
            givenName: user.full_name.split(' ')[0] ?? user.full_name,
            familyName: user.full_name.split(' ').slice(1).join(' ') || user.full_name,
        },
        emails: [{ value: user.email, primary: true }],
        meta: {
            resourceType: 'User',
            created: user.created_at.toISOString(),
            lastModified: user.updated_at.toISOString(),
        },
    };
}
export function serviceProviderConfig() {
    return {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
        patch: { supported: true },
        bulk: { supported: false },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
            {
                type: 'oauthbearertoken',
                name: 'OAuth Bearer Token',
                description: 'SCIM bearer token from organization settings',
            },
        ],
    };
}
export function resourceTypes() {
    return {
        schemas: [LIST_SCHEMA],
        totalResults: 2,
        Resources: [
            {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
                id: 'User',
                name: 'User',
                endpoint: '/Users',
                schema: USER_SCHEMA,
            },
            {
                schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
                id: 'Group',
                name: 'Group',
                endpoint: '/Groups',
                schema: GROUP_SCHEMA,
            },
        ],
    };
}
export function schemas() {
    return {
        schemas: [LIST_SCHEMA],
        totalResults: 1,
        Resources: [
            {
                id: USER_SCHEMA,
                name: 'User',
                description: 'User Account',
            },
        ],
    };
}
export async function listUsers(orgId, options) {
    const { rows, total } = await repository.listScimMappingsForOrg(orgId, options.startIndex, Math.min(options.count, 200));
    let filtered = rows;
    const parsedFilter = parseScimFilter(options.filter);
    if (parsedFilter.externalId) {
        filtered = rows.filter((r) => r.external_id === parsedFilter.externalId);
    }
    else if (parsedFilter.userName) {
        const email = normalizeEmail(parsedFilter.userName);
        const user = await repository.findUserByEmailHash(emailToHash(email));
        filtered = user ? rows.filter((r) => r.user_id === user.id) : [];
    }
    const resources = [];
    for (const row of filtered) {
        resources.push(await userToScimResource(orgId, row.user_id, row.external_id));
    }
    return {
        schemas: [LIST_SCHEMA],
        totalResults: options.filter ? resources.length : total,
        startIndex: options.startIndex,
        itemsPerPage: resources.length,
        Resources: resources,
    };
}
export async function getUser(orgId, externalId) {
    const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
    if (!mapping) {
        throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    return userToScimResource(orgId, mapping.user_id, externalId);
}
export async function createUser(orgId, body, actor) {
    const externalId = body.externalId ||
        body.id ||
        randomUUID();
    const userName = body.userName?.trim();
    if (!userName) {
        throw new AuthError('userName is required', AuthErrorCodes.VALIDATION_ERROR, 400);
    }
    const existingMapping = await repository.findScimMappingByExternalId(orgId, externalId);
    if (existingMapping) {
        throw new AuthError('SCIM user already exists', AuthErrorCodes.SCIM_CONFLICT, 409);
    }
    const email = normalizeEmail(userName);
    const nameObj = body.name;
    const fullName = nameObj?.formatted ||
        body.displayName ||
        email.split('@')[0] ||
        'User';
    let user = await repository.findUserByEmailHash(emailToHash(email));
    if (!user) {
        user = await repository.createSsoJitUser({
            id: randomUUID(),
            email,
            full_name: fullName,
        });
    }
    const role = memberRoleFromScimRole(body.roles?.[0]?.value);
    await repository.addOrgMemberSsoProvision(orgId, user.id, role);
    await repository.upsertScimUserMapping(orgId, user.id, externalId);
    logAudit({
        user_id: null,
        org_id: orgId,
        actor_type: 'scim',
        actor_id: actor?.tokenId ?? null,
        action: 'scim.user.created',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: actor?.ipAddress ?? '0.0.0.0',
        request_id: `scim:${actor?.tokenId ?? 'system'}`,
        metadata: { external_id: externalId },
    });
    return userToScimResource(orgId, user.id, externalId);
}
export async function patchUser(orgId, externalId, body, actor) {
    const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
    if (!mapping) {
        throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    const user = await repository.findUserById(mapping.user_id);
    if (!user) {
        throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    const operations = body.Operations;
    if (operations?.length) {
        for (const op of operations) {
            const operation = op.op?.toLowerCase();
            if (operation === 'replace' && op.path === 'active') {
                if (op.value === false) {
                    await repository.deactivateOrgMemberScim(orgId, user.id);
                }
                else if (op.value === true) {
                    await repository.addOrgMemberSsoProvision(orgId, user.id, 'member');
                }
            }
            if (operation === 'replace' && op.path === 'roles') {
                const roleValue = typeof op.value === 'object' && op.value !== null
                    ? op.value[0]?.value
                    : undefined;
                if (roleValue) {
                    await repository.updateOrgMemberRole(orgId, user.id, memberRoleFromScimRole(roleValue));
                }
            }
            if (operation === 'replace' && op.path?.startsWith('name')) {
                const formatted = typeof op.value === 'object' && op.value !== null
                    ? op.value.formatted
                    : undefined;
                if (formatted) {
                    await repository.updateUser(user.id, { full_name: formatted });
                }
            }
        }
    }
    else if (body.active === false) {
        await repository.deactivateOrgMemberScim(orgId, user.id);
    }
    else if (body.active === true) {
        await repository.addOrgMemberSsoProvision(orgId, user.id, 'member');
    }
    if (body.name && typeof body.name === 'object') {
        const formatted = body.name.formatted;
        if (formatted) {
            await repository.updateUser(user.id, { full_name: formatted });
        }
    }
    logAudit({
        user_id: null,
        org_id: orgId,
        actor_type: 'scim',
        actor_id: actor?.tokenId ?? null,
        action: 'scim.user.updated',
        resource_type: 'user',
        resource_id: user.id,
        ip_address: actor?.ipAddress ?? '0.0.0.0',
        request_id: `scim:${actor?.tokenId ?? 'system'}`,
        metadata: { external_id: externalId },
    });
    return userToScimResource(orgId, user.id, externalId);
}
export async function replaceUser(orgId, externalId, body, actor) {
    const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
    if (!mapping) {
        throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    const patchBody = {
        active: body.active,
        name: body.name,
    };
    const roles = body.roles;
    if (roles?.[0]?.value) {
        await repository.updateOrgMemberRole(orgId, mapping.user_id, memberRoleFromScimRole(roles[0].value));
    }
    return patchUser(orgId, externalId, patchBody, actor);
}
export async function deleteUser(orgId, externalId, actor) {
    const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
    if (!mapping) {
        throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    await repository.deactivateOrgMemberScim(orgId, mapping.user_id);
    await repository.deleteScimUserMapping(orgId, externalId);
    logAudit({
        user_id: null,
        org_id: orgId,
        actor_type: 'scim',
        actor_id: actor?.tokenId ?? null,
        action: 'scim.user.deleted',
        resource_type: 'user',
        resource_id: mapping.user_id,
        ip_address: actor?.ipAddress ?? '0.0.0.0',
        request_id: `scim:${actor?.tokenId ?? 'system'}`,
        metadata: { external_id: externalId },
    });
}
async function groupToScimResource(orgId, group) {
    const members = await repository.listScimGroupMembers(group.id);
    return {
        schemas: [GROUP_SCHEMA],
        id: group.id,
        externalId: group.external_id,
        displayName: group.display_name,
        members,
        meta: {
            resourceType: 'Group',
            created: group.meta_created.toISOString(),
            lastModified: group.meta_last_modified.toISOString(),
            version: `W/"${group.meta_version}"`,
        },
        active: group.active,
    };
}
export async function listGroups(orgId, options) {
    const startIndex = options?.startIndex ?? 1;
    const count = Math.min(options?.count ?? 100, 200);
    const { rows, total } = await repository.listScimGroups(orgId, startIndex, count, options?.filter);
    const resources = [];
    for (const row of rows) {
        resources.push(await groupToScimResource(orgId, row));
    }
    return {
        schemas: [LIST_SCHEMA],
        totalResults: total,
        startIndex,
        itemsPerPage: resources.length,
        Resources: resources,
    };
}
export async function getGroup(orgId, groupId) {
    const group = await repository.findScimGroupById(orgId, groupId);
    if (!group) {
        throw new AuthError('SCIM group not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    return groupToScimResource(orgId, group);
}
function parseGroupPatchMemberReference(path) {
    if (!path)
        return null;
    const value = path.match(/\[value eq "([^"]+)"\]/i)?.[1];
    return value ?? null;
}
async function resolveScimMemberUserId(orgId, memberValue) {
    const mapping = await repository.findScimMappingByExternalId(orgId, memberValue);
    if (mapping) {
        return mapping.user_id;
    }
    const direct = await repository.findActiveOrgMember(orgId, memberValue);
    if (direct) {
        return direct.user_id;
    }
    throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
}
export async function createGroup(orgId, body, actor) {
    const externalId = body.externalId ||
        body.id ||
        randomUUID();
    const displayName = body.displayName?.trim();
    if (!displayName) {
        throw new AuthError('displayName is required', AuthErrorCodes.VALIDATION_ERROR, 400);
    }
    const existing = await repository.findScimGroupByExternalId(orgId, externalId);
    if (existing) {
        throw new AuthError('SCIM group already exists', AuthErrorCodes.SCIM_CONFLICT, 409);
    }
    const group = await repository.createScimGroup(orgId, externalId, displayName);
    const members = Array.isArray(body.members)
        ? body.members
        : [];
    if (members.length > 0) {
        const userIds = await Promise.all(members
            .map((member) => member.value?.trim())
            .filter((value) => Boolean(value))
            .map((value) => resolveScimMemberUserId(orgId, value)));
        await repository.replaceScimGroupMembers(orgId, group.id, userIds);
    }
    logAudit({
        user_id: null,
        org_id: orgId,
        actor_type: 'scim',
        actor_id: actor.tokenId,
        action: 'scim.group.created',
        resource_type: 'group',
        resource_id: group.id,
        ip_address: actor.ipAddress,
        request_id: `scim:${actor.tokenId}`,
        metadata: { external_id: externalId, display_name: displayName },
    });
    return getGroup(orgId, group.id);
}
export async function replaceGroup(orgId, groupId, body, actor) {
    const existing = await repository.findScimGroupById(orgId, groupId);
    if (!existing) {
        throw new AuthError('SCIM group not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    const displayName = body.displayName?.trim();
    if (!displayName) {
        throw new AuthError('displayName is required', AuthErrorCodes.VALIDATION_ERROR, 400);
    }
    await repository.updateScimGroup(orgId, groupId, displayName);
    const members = Array.isArray(body.members)
        ? body.members
        : [];
    const userIds = await Promise.all(members
        .map((member) => member.value?.trim())
        .filter((value) => Boolean(value))
        .map((value) => resolveScimMemberUserId(orgId, value)));
    await repository.replaceScimGroupMembers(orgId, groupId, userIds);
    logAudit({
        user_id: null,
        org_id: orgId,
        actor_type: 'scim',
        actor_id: actor.tokenId,
        action: 'scim.group.updated',
        resource_type: 'group',
        resource_id: groupId,
        ip_address: actor.ipAddress,
        request_id: `scim:${actor.tokenId}`,
    });
    return getGroup(orgId, groupId);
}
export async function patchGroup(orgId, groupId, body, actor) {
    const existing = await repository.findScimGroupById(orgId, groupId);
    if (!existing) {
        throw new AuthError('SCIM group not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    const operations = body.Operations;
    if (!operations?.length) {
        throw new AuthError('Operations are required', AuthErrorCodes.VALIDATION_ERROR, 400);
    }
    let patchedDisplayName = null;
    for (const op of operations) {
        const operation = op.op?.toLowerCase();
        if (operation === 'replace' && op.path === 'displayName' && typeof op.value === 'string') {
            patchedDisplayName = op.value.trim();
            continue;
        }
        if (operation === 'add' && op.path === 'members' && Array.isArray(op.value)) {
            for (const member of op.value) {
                if (!member.value)
                    continue;
                const userId = await resolveScimMemberUserId(orgId, member.value);
                await repository.addScimGroupMember(orgId, groupId, userId);
            }
            continue;
        }
        if (operation === 'remove') {
            if (op.path === 'members') {
                await repository.replaceScimGroupMembers(orgId, groupId, []);
                continue;
            }
            const reference = parseGroupPatchMemberReference(op.path);
            if (reference) {
                const userId = await resolveScimMemberUserId(orgId, reference);
                await repository.removeScimGroupMember(groupId, userId);
            }
        }
    }
    await repository.updateScimGroup(orgId, groupId, patchedDisplayName);
    logAudit({
        user_id: null,
        org_id: orgId,
        actor_type: 'scim',
        actor_id: actor.tokenId,
        action: 'scim.group.patched',
        resource_type: 'group',
        resource_id: groupId,
        ip_address: actor.ipAddress,
        request_id: `scim:${actor.tokenId}`,
    });
    return getGroup(orgId, groupId);
}
export async function deleteGroup(orgId, groupId, actor) {
    const existing = await repository.findScimGroupById(orgId, groupId);
    if (!existing) {
        throw new AuthError('SCIM group not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
    }
    await repository.deleteScimGroup(orgId, groupId);
    logAudit({
        user_id: null,
        org_id: orgId,
        actor_type: 'scim',
        actor_id: actor.tokenId,
        action: 'scim.group.deleted',
        resource_type: 'group',
        resource_id: groupId,
        ip_address: actor.ipAddress,
        request_id: `scim:${actor.tokenId}`,
    });
}
export function handleScimError(error, reply) {
    if (error instanceof AuthError) {
        const status = error.statusCode === 404 ? '404' : String(error.statusCode);
        reply.status(error.statusCode).send({
            schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
            status,
            detail: error.message,
            scimType: error.code,
        });
        return;
    }
    reply.status(500).send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        status: '500',
        detail: 'Internal error',
    });
}
//# sourceMappingURL=scim.service.js.map