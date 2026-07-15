/**
 * Connector route registration.
 *
 * All routes are organization-scoped and require:
 *   - `authenticate` (valid session)
 *   - `requireOrgAccess` (active membership of :orgId)
 *
 * Handlers parse params/query/body with Zod, delegate to the service, and use
 * `withErrorHandling` to map AppError subclasses to HTTP responses.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { authenticate } from '../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../shared/middleware/requireorg.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  CONNECTOR_PERMISSIONS,
  requireConnectorPermission,
} from './middleware/permissions.js';
import {
  ConnectorParamsSchema,
  ConnectorDeliveryParamsSchema,
  ConnectorRouteParamsSchema,
  CreateConnectorSchema,
  CreateConnectorRouteSchema,
  DeliveryParamsSchema,
  ListConnectorsQuerySchema,
  OAuthCallbackSchema,
  OrgIdParamsSchema,
  PaginationQuerySchema,
  PreviewNotificationSchema,
  RotateSecretSchema,
  SendTestNotificationSchema,
  UpdateConnectorRouteSchema,
  UpdateConnectorSchema,
  ValidateConfigurationSchema,
  type RequestMeta,
} from './types.js';

type AuthedRequest = FastifyRequest & {
  user: { id: string };
};

export interface ConnectorRouteErrorResponse {
  statusCode: number;
  payload: {
    success: false;
    error: {
      code: string;
      message: string;
      details?: unknown;
    };
  };
}

function buildMeta(request: FastifyRequest): RequestMeta {
  const ua = request.headers['user-agent'];
  return {
    actorUserId: (request as AuthedRequest).user.id,
    actorIp: request.ip ?? '0.0.0.0',
    actorUserAgent: typeof ua === 'string' ? ua : null,
    requestId: request.id,
  };
}

export function connectorRouteErrorResponse(error: unknown): ConnectorRouteErrorResponse {
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        error: {
          code: 'CONNECTOR_VALIDATION_ERROR',
          message: 'Connector request validation failed',
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
              code: issue.code,
            })),
          },
        },
      },
    };
  }
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      payload: {
      success: false,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      },
    };
  }
  return {
    statusCode: 500,
    payload: {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Unexpected connector module error' },
    },
  };
}

function handleError(error: unknown, reply: FastifyReply) {
  const response = connectorRouteErrorResponse(error);
  return reply.code(response.statusCode).send(response.payload);
}

function withErrorHandling(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, 'Connector route failed');
      return handleError(error, reply);
    }
  };
}

/** Strip undefined keys to satisfy exactOptionalPropertyTypes when forwarding. */
function strip<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export async function connectorRoutes(fastify: FastifyInstance): Promise<void> {
  const svc = fastify.connectors.service;
  const guard = (permission: (typeof CONNECTOR_PERMISSIONS)[keyof typeof CONNECTOR_PERMISSIONS]) => ({
    preHandler: [authenticate, requireOrgAccess, requireConnectorPermission(permission)],
  });
  const viewGuard = guard(CONNECTOR_PERMISSIONS.viewConnectors);
  const createGuard = guard(CONNECTOR_PERMISSIONS.createConnector);
  const updateGuard = guard(CONNECTOR_PERMISSIONS.updateConnector);
  const deleteGuard = guard(CONNECTOR_PERMISSIONS.deleteConnector);
  const rotateGuard = guard(CONNECTOR_PERMISSIONS.rotateSecret);
  const testGuard = guard(CONNECTOR_PERMISSIONS.testConnection);
  const auditGuard = guard(CONNECTOR_PERMISSIONS.viewAudit);
  const deliveryGuard = guard(CONNECTOR_PERMISSIONS.viewDeliveries);
  const routesGuard = guard(CONNECTOR_PERMISSIONS.manageRoutes);

  // List available connector types (catalog). Org-scoped for consistent auth,
  // but the catalog itself is global.
  fastify.get('/types', viewGuard, withErrorHandling(async (request, reply) => {
    OrgIdParamsSchema.parse(request.params);
    return reply.send({ success: true, data: svc.listTypes() });
  }));

  // Create
  fastify.post('/', createGuard, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const body = CreateConnectorSchema.parse(request.body);
    const result = await svc.createConnector(orgId, buildMeta(request), strip(body));
    return reply.code(201).send({ success: true, data: result });
  }));

  // List (with filtering)
  fastify.get('/', viewGuard, withErrorHandling(async (request, reply) => {
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
  fastify.get('/:id', viewGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.getConnector(orgId, id);
    return reply.send({ success: true, data: result });
  }));

  fastify.get('/:id/details', viewGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.getConnector(orgId, id);
    return reply.send({ success: true, data: result });
  }));

  // Update
  fastify.patch('/:id', updateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const body = UpdateConnectorSchema.parse(request.body);
    const result = await svc.updateConnector(orgId, buildMeta(request), id, strip(body));
    return reply.send({ success: true, data: result });
  }));

  // Soft delete
  fastify.delete('/:id', deleteGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    await svc.deleteConnector(orgId, buildMeta(request), id);
    return reply.code(204).send();
  }));

  fastify.post('/:id/enable', updateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.setConnectorEnabled(orgId, buildMeta(request), id, true);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:id/disable', updateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.setConnectorEnabled(orgId, buildMeta(request), id, false);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:id/rotate-secret', rotateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const body = RotateSecretSchema.parse(request.body);
    const result = await svc.rotateSecret(orgId, buildMeta(request), id, body);
    return reply.send({ success: true, data: result });
  }));

  // Test connection
  fastify.post('/:id/test', testGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.testConnection(orgId, buildMeta(request), id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:id/health-check', testGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.runHealthCheckForConnector(orgId, buildMeta(request), id);
    return reply.send({ success: true, data: result });
  }));

  fastify.get('/:id/health-history', viewGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const query = PaginationQuerySchema.parse(request.query ?? {});
    const result = await svc.listHealthHistory(orgId, id, query);
    return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
  }));

  fastify.get('/:id/test-runs', viewGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const query = PaginationQuerySchema.parse(request.query ?? {});
    const result = await svc.listTestRuns(orgId, id, query);
    return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
  }));

  // Send a test notification
  fastify.post('/:id/send', testGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const body = SendTestNotificationSchema.parse(request.body ?? {});
    const result = await svc.sendTest(orgId, buildMeta(request), id, body);
    const code = result.success ? 200 : 502;
    return reply.code(code).send({ success: result.success, data: result });
  }));

  // Delivery history for a connector
  fastify.get('/:id/deliveries', deliveryGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const query = ListConnectorsQuerySchema.pick({ limit: true, offset: true }).parse(request.query ?? {});
    const result = await svc.listDeliveries(orgId, { connectorId: id, limit: query.limit, offset: query.offset });
    return reply.send({ success: true, data: result.data, meta: { total: result.total } });
  }));

  fastify.get('/deliveries/:deliveryId', deliveryGuard, withErrorHandling(async (request, reply) => {
    const { orgId, deliveryId } = DeliveryParamsSchema.parse(request.params);
    const result = await svc.getDelivery(orgId, deliveryId);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/deliveries/:deliveryId/retry', testGuard, withErrorHandling(async (request, reply) => {
    const { orgId, deliveryId } = DeliveryParamsSchema.parse(request.params);
    const result = await svc.retryDelivery(orgId, buildMeta(request), deliveryId);
    return reply.send({ success: true, data: result });
  }));

  fastify.get('/:id/deliveries/:deliveryId/attempts', deliveryGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id, deliveryId } = ConnectorDeliveryParamsSchema.parse(request.params);
    const query = PaginationQuerySchema.parse(request.query ?? {});
    const result = await svc.listDeliveryAttempts(orgId, id, deliveryId, query);
    return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
  }));

  fastify.get('/:id/audit', auditGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const query = PaginationQuerySchema.parse(request.query ?? {});
    const result = await svc.listAudit(orgId, id, query);
    return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
  }));

  fastify.get('/audit', auditGuard, withErrorHandling(async (request, reply) => {
    const { orgId } = OrgIdParamsSchema.parse(request.params);
    const query = PaginationQuerySchema.parse(request.query ?? {});
    const result = await svc.listAudit(orgId, null, query);
    return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
  }));

  fastify.post('/:id/routes', routesGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const body = CreateConnectorRouteSchema.parse(request.body);
    const result = await svc.createRoute(orgId, buildMeta(request), id, body);
    return reply.code(201).send({ success: true, data: result });
  }));

  fastify.get('/:id/routes', viewGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const query = PaginationQuerySchema.parse(request.query ?? {});
    const result = await svc.listRoutes(orgId, id, query);
    return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
  }));

  fastify.patch('/:id/routes/:routeId', routesGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id, routeId } = ConnectorRouteParamsSchema.parse(request.params);
    const body = UpdateConnectorRouteSchema.parse(request.body);
    const result = await svc.updateRoute(orgId, buildMeta(request), id, routeId, body);
    return reply.send({ success: true, data: result });
  }));

  fastify.delete('/:id/routes/:routeId', routesGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id, routeId } = ConnectorRouteParamsSchema.parse(request.params);
    await svc.deleteRoute(orgId, buildMeta(request), id, routeId);
    return reply.code(204).send();
  }));

  fastify.post('/:id/oauth/start', updateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.startOAuth(orgId, buildMeta(request), id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:id/oauth/callback', updateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const body = OAuthCallbackSchema.parse(request.body);
    const result = await svc.completeOAuth(orgId, buildMeta(request), id, body);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:id/oauth/refresh', updateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.refreshOAuth(orgId, buildMeta(request), id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/:id/oauth/disconnect', updateGuard, withErrorHandling(async (request, reply) => {
    const { orgId, id } = ConnectorParamsSchema.parse(request.params);
    const result = await svc.disconnectOAuth(orgId, buildMeta(request), id);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/preview', viewGuard, withErrorHandling(async (request, reply) => {
    OrgIdParamsSchema.parse(request.params);
    const body = PreviewNotificationSchema.parse(request.body ?? {});
    const result = await svc.previewNotification(body);
    return reply.send({ success: true, data: result });
  }));

  fastify.post('/validate-configuration', createGuard, withErrorHandling(async (request, reply) => {
    OrgIdParamsSchema.parse(request.params);
    const body = ValidateConfigurationSchema.parse(request.body);
    const result = svc.validateConfiguration(body);
    return reply.send({ success: true, data: result });
  }));
}
