import { authenticate } from '../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../shared/middleware/requireorg.js';
import { AppError } from '../../shared/errors/app-error.js';
import { ConnectorParamsSchema, CreateConnectorSchema, ListConnectorsQuerySchema, OrgIdParamsSchema, SendTestNotificationSchema, UpdateConnectorSchema, } from './types.js';
function buildMeta(request) {
    const ua = request.headers['user-agent'];
    return {
        actorUserId: request.user.id,
        actorIp: request.ip ?? '0.0.0.0',
        actorUserAgent: typeof ua === 'string' ? ua : null,
        requestId: request.id,
    };
}
function handleError(error, reply) {
    console.log('[connectors.handleError]', error);
    if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        });
    }
    return reply.code(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Unexpected connector module error' },
    });
}
function withErrorHandling(handler) {
    return async (request, reply) => {
        try {
            return await handler(request, reply);
        }
        catch (error) {
            request.log.error({ err: error, path: request.url }, 'Connector route failed');
            return handleError(error, reply);
        }
    };
}
/** Strip undefined keys to satisfy exactOptionalPropertyTypes when forwarding. */
function strip(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj))
        if (v !== undefined)
            out[k] = v;
    return out;
}
export async function connectorRoutes(fastify) {
    const svc = fastify.connectors.service;
    const guard = { preHandler: [authenticate, requireOrgAccess] };
    // List available connector types (catalog). Org-scoped for consistent auth,
    // but the catalog itself is global.
    fastify.get('/types', guard, withErrorHandling(async (request, reply) => {
        OrgIdParamsSchema.parse(request.params);
        return reply.send({ success: true, data: svc.listTypes() });
    }));
    // Create
    fastify.post('/', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const body = CreateConnectorSchema.parse(request.body);
        const result = await svc.createConnector(orgId, buildMeta(request), strip(body));
        return reply.code(201).send({ success: true, data: result });
    }));
    // List (with filtering)
    fastify.get('/', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = OrgIdParamsSchema.parse(request.params);
        const query = ListConnectorsQuerySchema.parse(request.query ?? {});
        const result = await svc.listConnectors(orgId, query);
        return reply.send({
            success: true,
            data: result.data,
            meta: { total: result.total, limit: result.limit, offset: result.offset },
        });
    }));
    // Get one
    fastify.get('/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = ConnectorParamsSchema.parse(request.params);
        const result = await svc.getConnector(orgId, id);
        return reply.send({ success: true, data: result });
    }));
    // Update
    fastify.patch('/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = ConnectorParamsSchema.parse(request.params);
        const body = UpdateConnectorSchema.parse(request.body);
        const result = await svc.updateConnector(orgId, buildMeta(request), id, strip(body));
        return reply.send({ success: true, data: result });
    }));
    // Soft delete
    fastify.delete('/:id', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = ConnectorParamsSchema.parse(request.params);
        await svc.deleteConnector(orgId, buildMeta(request), id);
        return reply.code(204).send();
    }));
    // Test connection
    fastify.post('/:id/test', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = ConnectorParamsSchema.parse(request.params);
        const result = await svc.testConnection(orgId, buildMeta(request), id);
        return reply.send({ success: true, data: result });
    }));
    // Send a test notification
    fastify.post('/:id/send', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = ConnectorParamsSchema.parse(request.params);
        const body = SendTestNotificationSchema.parse(request.body ?? {});
        const result = await svc.sendTest(orgId, buildMeta(request), id, body);
        const code = result.success ? 200 : 502;
        return reply.code(code).send({ success: result.success, data: result });
    }));
    // Delivery history for a connector
    fastify.get('/:id/deliveries', guard, withErrorHandling(async (request, reply) => {
        const { orgId, id } = ConnectorParamsSchema.parse(request.params);
        const query = ListConnectorsQuerySchema.pick({ limit: true, offset: true }).parse(request.query ?? {});
        const result = await svc.listDeliveries(orgId, { connectorId: id, limit: query.limit, offset: query.offset });
        return reply.send({ success: true, data: result.data, meta: { total: result.total } });
    }));
}
//# sourceMappingURL=routes.js.map