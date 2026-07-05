/**
 * SCIM 2.0 route registration (shared by /scim/v2 and /auth/scim/v2 mounts).
 */
import type { FastifyInstance } from 'fastify';

import { authenticateScim, requireScimScope } from './scim.middleware.js';
import * as scim from './scim.service.js';

const scimOpts = { preHandler: [authenticateScim] };

export async function registerScimRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/:orgId/ServiceProviderConfig', scimOpts, async (_request, reply) => {
    return reply.send(scim.serviceProviderConfig());
  });

  fastify.get('/:orgId/ResourceTypes', scimOpts, async (_request, reply) => {
    return reply.send(scim.resourceTypes());
  });

  fastify.get('/:orgId/Schemas', scimOpts, async (_request, reply) => {
    return reply.send(scim.schemas());
  });

  fastify.get('/:orgId/Users', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'users:read')) return;
      const { orgId } = request.params as { orgId: string };
      const query = request.query as {
        startIndex?: string;
        count?: string;
        filter?: string;
      };
      const list = await scim.listUsers(orgId, {
        startIndex: query.startIndex ? parseInt(query.startIndex, 10) : 1,
        count: query.count ? parseInt(query.count, 10) : 100,
        ...(query.filter !== undefined ? { filter: query.filter } : {}),
      });
      return reply.send(list);
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.get('/:orgId/Users/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'users:read')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      const user = await scim.getUser(orgId, id);
      return reply.send(user);
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.post('/:orgId/Users', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'users:write')) return;
      const { orgId } = request.params as { orgId: string };
      const created = await scim.createUser(
        orgId,
        request.body as Record<string, unknown>,
        request.scim,
      );
      return reply.status(201).send(created);
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.put('/:orgId/Users/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'users:write')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      const updated = await scim.replaceUser(
        orgId,
        id,
        request.body as Record<string, unknown>,
        request.scim,
      );
      return reply.send(updated);
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.patch('/:orgId/Users/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'users:write')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      const updated = await scim.patchUser(
        orgId,
        id,
        request.body as Record<string, unknown>,
        request.scim,
      );
      return reply.send(updated);
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.delete('/:orgId/Users/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'users:delete')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      await scim.deleteUser(orgId, id, request.scim);
      return reply.status(204).send();
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.get('/:orgId/Groups', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'groups:read')) return;
      const { orgId } = request.params as { orgId: string };
      const query = request.query as {
        startIndex?: string;
        count?: string;
        filter?: string;
      };
      return reply.send(await scim.listGroups(orgId, {
        startIndex: query.startIndex ? parseInt(query.startIndex, 10) : 1,
        count: query.count ? parseInt(query.count, 10) : 100,
        ...(query.filter !== undefined ? { filter: query.filter } : {}),
      }));
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.post('/:orgId/Groups', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'groups:write')) return;
      const { orgId } = request.params as { orgId: string };
      const created = await scim.createGroup(
        orgId,
        request.body as Record<string, unknown>,
        request.scim!,
      );
      return reply.status(201).send(created);
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.get('/:orgId/Groups/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'groups:read')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      return reply.send(await scim.getGroup(orgId, id));
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.put('/:orgId/Groups/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'groups:write')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      return reply.send(await scim.replaceGroup(
        orgId,
        id,
        request.body as Record<string, unknown>,
        request.scim!,
      ));
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.patch('/:orgId/Groups/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'groups:write')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      return reply.send(await scim.patchGroup(
        orgId,
        id,
        request.body as Record<string, unknown>,
        request.scim!,
      ));
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });

  fastify.delete('/:orgId/Groups/:id', scimOpts, async (request, reply) => {
    try {
      if (!requireScimScope(request, reply, 'groups:delete')) return;
      const { orgId, id } = request.params as { orgId: string; id: string };
      await scim.deleteGroup(orgId, id, request.scim!);
      return reply.status(204).send();
    } catch (error) {
      return scim.handleScimError(error, reply);
    }
  });
}
