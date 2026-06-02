/**
 * SCIM 2.0 User provisioning for organization members.
 */
import { createHash, randomUUID } from 'crypto';
import type { FastifyReply } from 'fastify';

import { logAudit } from '../../shared/middleware/audit-logger.js';
import * as repository from '../auth/repository.js';
import { AuthError, AuthErrorCodes } from '../auth/types.js';
import { normalizeEmail } from '../auth/utils.js';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

function emailToHash(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex');
}

const SCIM_GROUP_ROLES = ['member', 'admin', 'owner'] as const;

function memberRoleFromScimRole(role: string | undefined): string {
  const normalized = role?.toLowerCase();
  if (normalized === 'admin' || normalized === 'owner') {
    return normalized;
  }
  return 'member';
}

function parseScimFilter(filter: string | undefined): {
  userName?: string;
  externalId?: string;
} {
  if (!filter) return {};
  const userNameMatch = filter.match(/userName\s+eq\s+"([^"]+)"/i);
  if (userNameMatch?.[1]) return { userName: userNameMatch[1] };
  const idMatch = filter.match(/(?:externalId|id)\s+eq\s+"([^"]+)"/i);
  if (idMatch?.[1]) return { externalId: idMatch[1] };
  return {};
}

async function userToScimResource(
  orgId: string,
  userId: string,
  externalId: string,
): Promise<Record<string, unknown>> {
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

export function serviceProviderConfig(): Record<string, unknown> {
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

export function resourceTypes(): Record<string, unknown> {
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

export function schemas(): Record<string, unknown> {
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

export async function listUsers(
  orgId: string,
  options: { startIndex: number; count: number; filter?: string },
): Promise<Record<string, unknown>> {
  const { rows, total } = await repository.listScimMappingsForOrg(
    orgId,
    options.startIndex,
    Math.min(options.count, 200),
  );

  let filtered = rows;
  const parsedFilter = parseScimFilter(options.filter);
  if (parsedFilter.externalId) {
    filtered = rows.filter((r) => r.external_id === parsedFilter.externalId);
  } else if (parsedFilter.userName) {
    const email = normalizeEmail(parsedFilter.userName);
    const user = await repository.findUserByEmailHash(emailToHash(email));
    filtered = user ? rows.filter((r) => r.user_id === user.id) : [];
  }

  const resources: Record<string, unknown>[] = [];
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

export async function getUser(
  orgId: string,
  externalId: string,
): Promise<Record<string, unknown>> {
  const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
  if (!mapping) {
    throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
  }
  return userToScimResource(orgId, mapping.user_id, externalId);
}

export async function createUser(
  orgId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const externalId =
    (body.externalId as string | undefined) ||
    (body.id as string | undefined) ||
    randomUUID();
  const userName = (body.userName as string | undefined)?.trim();
  if (!userName) {
    throw new AuthError('userName is required', AuthErrorCodes.VALIDATION_ERROR, 400);
  }

  const existingMapping = await repository.findScimMappingByExternalId(orgId, externalId);
  if (existingMapping) {
    throw new AuthError('SCIM user already exists', AuthErrorCodes.SCIM_CONFLICT, 409);
  }

  const email = normalizeEmail(userName);
  const nameObj = body.name as { formatted?: string } | undefined;
  const fullName =
    nameObj?.formatted ||
    (body.displayName as string | undefined) ||
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

  const role = memberRoleFromScimRole(
    (body.roles as Array<{ value?: string }> | undefined)?.[0]?.value,
  );
  await repository.addOrgMemberSsoProvision(orgId, user.id, role);
  await repository.upsertScimUserMapping(orgId, user.id, externalId);

  logAudit({
    user_id: null,
    org_id: orgId,
    action: 'scim.user.created',
    resource_type: 'user',
    resource_id: user.id,
    ip_address: 'scim',
    request_id: 'scim',
    metadata: { external_id: externalId },
  });

  return userToScimResource(orgId, user.id, externalId);
}

export async function patchUser(
  orgId: string,
  externalId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
  if (!mapping) {
    throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
  }

  const user = await repository.findUserById(mapping.user_id);
  if (!user) {
    throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
  }

  const operations = body.Operations as Array<{
    op: string;
    path?: string;
    value?: unknown;
  }> | undefined;

  if (operations?.length) {
    for (const op of operations) {
      const operation = op.op?.toLowerCase();
      if (operation === 'replace' && op.path === 'active') {
        if (op.value === false) {
          await repository.deactivateOrgMemberScim(orgId, user.id);
        } else if (op.value === true) {
          await repository.addOrgMemberSsoProvision(orgId, user.id, 'member');
        }
      }
      if (operation === 'replace' && op.path === 'roles') {
        const roleValue =
          typeof op.value === 'object' && op.value !== null
            ? (op.value as Array<{ value?: string }>)[0]?.value
            : undefined;
        if (roleValue) {
          await repository.updateOrgMemberRole(
            orgId,
            user.id,
            memberRoleFromScimRole(roleValue),
          );
        }
      }
      if (operation === 'replace' && op.path?.startsWith('name')) {
        const formatted =
          typeof op.value === 'object' && op.value !== null
            ? (op.value as { formatted?: string }).formatted
            : undefined;
        if (formatted) {
          await repository.updateUser(user.id, { full_name: formatted });
        }
      }
    }
  } else if (body.active === false) {
    await repository.deactivateOrgMemberScim(orgId, user.id);
  } else if (body.active === true) {
    await repository.addOrgMemberSsoProvision(orgId, user.id, 'member');
  }

  if (body.name && typeof body.name === 'object') {
    const formatted = (body.name as { formatted?: string }).formatted;
    if (formatted) {
      await repository.updateUser(user.id, { full_name: formatted });
    }
  }

  return userToScimResource(orgId, user.id, externalId);
}

export async function replaceUser(
  orgId: string,
  externalId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
  if (!mapping) {
    throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
  }

  const patchBody: Record<string, unknown> = {
    active: body.active,
    name: body.name,
  };
  const roles = body.roles as Array<{ value?: string }> | undefined;
  if (roles?.[0]?.value) {
    await repository.updateOrgMemberRole(
      orgId,
      mapping.user_id,
      memberRoleFromScimRole(roles[0].value),
    );
  }

  return patchUser(orgId, externalId, patchBody);
}

export async function deleteUser(orgId: string, externalId: string): Promise<void> {
  const mapping = await repository.findScimMappingByExternalId(orgId, externalId);
  if (!mapping) {
    throw new AuthError('SCIM user not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
  }

  await repository.deactivateOrgMemberScim(orgId, mapping.user_id);
  await repository.deleteScimUserMapping(orgId, externalId);

  logAudit({
    user_id: null,
    org_id: orgId,
    action: 'scim.user.deleted',
    resource_type: 'user',
    resource_id: mapping.user_id,
    ip_address: 'scim',
    request_id: 'scim',
    metadata: { external_id: externalId },
  });
}

async function groupToScimResource(
  orgId: string,
  role: string,
): Promise<Record<string, unknown>> {
  const members = await repository.listOrgMemberScimIdsByRole(orgId, role);
  return {
    schemas: [GROUP_SCHEMA],
    id: role,
    displayName: role,
    members: members.map((userId) => ({ value: userId, display: userId })),
    meta: { resourceType: 'Group' },
  };
}

export async function listGroups(orgId: string): Promise<Record<string, unknown>> {
  const resources: Record<string, unknown>[] = [];
  for (const role of SCIM_GROUP_ROLES) {
    const members = await repository.listOrgMemberScimIdsByRole(orgId, role);
    if (members.length > 0) {
      resources.push(await groupToScimResource(orgId, role));
    }
  }
  return {
    schemas: [LIST_SCHEMA],
    totalResults: resources.length,
    Resources: resources,
  };
}

export async function getGroup(
  orgId: string,
  groupId: string,
): Promise<Record<string, unknown>> {
  if (!SCIM_GROUP_ROLES.includes(groupId as (typeof SCIM_GROUP_ROLES)[number])) {
    throw new AuthError('SCIM group not found', AuthErrorCodes.SCIM_NOT_FOUND, 404);
  }
  return groupToScimResource(orgId, groupId);
}

export function handleScimError(error: unknown, reply: FastifyReply): void {
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
