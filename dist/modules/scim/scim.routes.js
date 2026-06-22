import { authenticateScim } from './scim.middleware.js';
import * as scim from './scim.service.js';
const scimOpts = { preHandler: [authenticateScim] };
export async function registerScimRoutes(fastify) {
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
            const { orgId } = request.params;
            const query = request.query;
            const list = await scim.listUsers(orgId, {
                startIndex: query.startIndex ? parseInt(query.startIndex, 10) : 1,
                count: query.count ? parseInt(query.count, 10) : 100,
                ...(query.filter !== undefined ? { filter: query.filter } : {}),
            });
            return reply.send(list);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.get('/:orgId/Users/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            const user = await scim.getUser(orgId, id);
            return reply.send(user);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.post('/:orgId/Users', scimOpts, async (request, reply) => {
        try {
            const { orgId } = request.params;
            const created = await scim.createUser(orgId, request.body);
            return reply.status(201).send(created);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.put('/:orgId/Users/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            const updated = await scim.replaceUser(orgId, id, request.body);
            return reply.send(updated);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.patch('/:orgId/Users/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            const updated = await scim.patchUser(orgId, id, request.body);
            return reply.send(updated);
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.delete('/:orgId/Users/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            await scim.deleteUser(orgId, id);
            return reply.status(204).send();
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.get('/:orgId/Groups', scimOpts, async (request, reply) => {
        try {
            const { orgId } = request.params;
            return reply.send(await scim.listGroups(orgId));
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
    fastify.get('/:orgId/Groups/:id', scimOpts, async (request, reply) => {
        try {
            const { orgId, id } = request.params;
            return reply.send(await scim.getGroup(orgId, id));
        }
        catch (error) {
            return scim.handleScimError(error, reply);
        }
    });
}
//# sourceMappingURL=scim.routes.js.map