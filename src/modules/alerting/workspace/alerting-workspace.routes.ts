import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../shared/middleware/requireorg.js';
import { AppError, NotFoundError } from '../../../shared/errors/app-error.js';
import {
  AlertingPolicyParamsSchema,
  AlertingWorkspaceParamsSchema,
  CreateAlertingPolicySchema,
  CreateAlertingPolicyVersionSchema,
  UpdateMaintenanceConfigSchema,
  UpdateNotificationDefaultsSchema,
  UpdateAlertingSettingsSchema,
  PaginationSchema,
} from './alerting-workspace.schemas.js';
import { AlertingWorkspaceService } from './alerting-workspace.service.js';
import type { JsonObject } from './alerting-workspace.types.js';

type AuthenticatedRequest = FastifyRequest & { user: { id: string } };

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      success: false,
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
  }
  return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected Alerting workspace error' } });
}

function withErrorHandling(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, 'Alerting workspace route failed');
      return handleError(error, reply);
    }
  };
}

export async function alertingWorkspaceRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AlertingWorkspaceService(undefined, undefined, fastify.log);
  const guard = { preHandler: [authenticate, requireOrgAccess] };

  fastify.get('/alert-workspace', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const data = await service.getWorkspaceSnapshot(orgId);
    if (!data) throw new NotFoundError('Alerting workspace');
    return reply.send({ success: true, data });
  }));

  fastify.get('/alert-policies', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const query = PaginationSchema.parse(request.query);
    const result = await service.listPolicies(orgId, query);
    return reply.send({
      success: true,
      data: result.data,
      meta: { total: result.total, limit: result.limit, offset: result.offset },
    });
  }));

  fastify.get('/alert-policies/:policyId', guard, withErrorHandling(async (request, reply) => {
    const { orgId, policyId } = AlertingPolicyParamsSchema.parse(request.params);
    return reply.send({ success: true, data: await service.getPolicy(orgId, policyId) });
  }));

  fastify.post('/alert-policies', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const body = CreateAlertingPolicySchema.parse(request.body);
    const data = await service.createPolicy(orgId, (request as AuthenticatedRequest).user.id, body);
    return reply.code(201).send({ success: true, data });
  }));

  fastify.post('/alert-policies/:policyId/versions', guard, withErrorHandling(async (request, reply) => {
    const { orgId, policyId } = AlertingPolicyParamsSchema.parse(request.params);
    const body = CreateAlertingPolicyVersionSchema.parse(request.body);
    const data = await service.createPolicyVersion(orgId, (request as AuthenticatedRequest).user.id, policyId, body.definition as JsonObject);
    return reply.code(201).send({ success: true, data });
  }));

  fastify.get('/alert-policy-categories', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const snapshot = await service.getWorkspaceSnapshot(orgId);
    if (!snapshot) throw new NotFoundError('Alerting workspace');
    return reply.send({ success: true, data: snapshot.categories, meta: { total: snapshot.categories.length } });
  }));

  fastify.get('/alert-routing-defaults', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const snapshot = await service.getWorkspaceSnapshot(orgId);
    if (!snapshot) throw new NotFoundError('Alerting workspace');
    return reply.send({ success: true, data: snapshot.routingDefaults, meta: { total: snapshot.routingDefaults.length } });
  }));

  fastify.get('/alert-settings', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const snapshot = await service.getWorkspaceSnapshot(orgId);
    if (!snapshot) throw new NotFoundError('Alerting workspace');
    return reply.send({ success: true, data: snapshot.settings });
  }));

  fastify.patch('/alert-settings', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const body = UpdateAlertingSettingsSchema.parse(request.body);
    const data = await service.updateSettings(orgId, (request as AuthenticatedRequest).user.id, body);
    return reply.send({ success: true, data });
  }));

  fastify.get('/maintenance-config', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const snapshot = await service.getWorkspaceSnapshot(orgId);
    if (!snapshot) throw new NotFoundError('Alerting workspace');
    return reply.send({ success: true, data: snapshot.maintenance });
  }));

  fastify.patch('/maintenance-config', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const body = UpdateMaintenanceConfigSchema.parse(request.body);
    const data = await service.updateMaintenance(orgId, (request as AuthenticatedRequest).user.id, body);
    return reply.send({ success: true, data });
  }));

  fastify.get('/notification-defaults', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const snapshot = await service.getWorkspaceSnapshot(orgId);
    if (!snapshot) throw new NotFoundError('Alerting workspace');
    return reply.send({ success: true, data: snapshot.notificationDefaults });
  }));

  fastify.patch('/notification-defaults', guard, withErrorHandling(async (request, reply) => {
    const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
    const body = UpdateNotificationDefaultsSchema.parse(request.body);
    const data = await service.updateNotificationDefaults(orgId, (request as AuthenticatedRequest).user.id, body);
    return reply.send({ success: true, data });
  }));

  const snapshotCollectionRoutes: Array<[string, string]> = [
    ['/escalation-policies-v2', 'escalationPolicies'],
    ['/provider-catalog', 'providerCatalog'],
    ['/alert-entitlements', 'entitlements'],
    ['/alert-usage', 'usage'],
    ['/alert-feature-flags', 'featureFlags'],
    ['/dashboard-config', 'dashboardWidgets'],
    ['/saved-views', 'savedViews'],
    ['/alert-audit', 'audit'],
  ];
  for (const [path, key] of snapshotCollectionRoutes) {
    fastify.get(path, guard, withErrorHandling(async (request, reply) => {
      const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
      const snapshot = await service.getWorkspaceSnapshot(orgId);
      if (!snapshot) throw new NotFoundError('Alerting workspace');
      const data = snapshot[key as keyof typeof snapshot];
      return reply.send({ success: true, data, meta: Array.isArray(data) ? { total: data.length } : undefined });
    }));
  }
}
