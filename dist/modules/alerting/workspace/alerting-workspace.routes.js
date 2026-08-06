import { authenticate } from '../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../shared/middleware/requireorg.js';
import { AppError, NotFoundError } from '../../../shared/errors/app-error.js';
import { AlertingPolicyParamsSchema, AlertingWorkspaceParamsSchema, CreateAlertingPolicySchema, CreateAlertingPolicyVersionSchema, UpdateMaintenanceConfigSchema, UpdateNotificationDefaultsSchema, UpdateAlertingSettingsSchema, } from './alerting-workspace.schemas.js';
import { AlertingWorkspaceService } from './alerting-workspace.service.js';
function handleError(error, reply) {
    if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        });
    }
    return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected Alerting workspace error' } });
}
function withErrorHandling(handler) {
    return async (request, reply) => {
        try {
            return await handler(request, reply);
        }
        catch (error) {
            request.log.error({ err: error, path: request.url }, 'Alerting workspace route failed');
            return handleError(error, reply);
        }
    };
}
export async function alertingWorkspaceRoutes(fastify) {
    const service = new AlertingWorkspaceService(undefined, undefined, fastify.log);
    const guard = { preHandler: [authenticate, requireOrgAccess] };
    fastify.get('/alert-workspace', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const data = await service.getWorkspaceSnapshot(orgId);
        if (!data)
            throw new NotFoundError('Alerting workspace');
        return reply.send({ success: true, data });
    }));
    fastify.get('/alert-policies', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const data = await service.listPolicies(orgId);
        return reply.send({ success: true, data, meta: { total: data.length } });
    }));
    fastify.get('/alert-policies/:policyId', guard, withErrorHandling(async (request, reply) => {
        const { orgId, policyId } = AlertingPolicyParamsSchema.parse(request.params);
        return reply.send({ success: true, data: await service.getPolicy(orgId, policyId) });
    }));
    fastify.post('/alert-policies', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const body = CreateAlertingPolicySchema.parse(request.body);
        const data = await service.createPolicy(orgId, request.user.id, body);
        return reply.code(201).send({ success: true, data });
    }));
    fastify.post('/alert-policies/:policyId/versions', guard, withErrorHandling(async (request, reply) => {
        const { orgId, policyId } = AlertingPolicyParamsSchema.parse(request.params);
        const body = CreateAlertingPolicyVersionSchema.parse(request.body);
        const data = await service.createPolicyVersion(orgId, request.user.id, policyId, body.definition);
        return reply.code(201).send({ success: true, data });
    }));
    fastify.get('/alert-policy-categories', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const snapshot = await service.getWorkspaceSnapshot(orgId);
        if (!snapshot)
            throw new NotFoundError('Alerting workspace');
        return reply.send({ success: true, data: snapshot.categories, meta: { total: snapshot.categories.length } });
    }));
    fastify.get('/alert-routing-defaults', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const snapshot = await service.getWorkspaceSnapshot(orgId);
        if (!snapshot)
            throw new NotFoundError('Alerting workspace');
        return reply.send({ success: true, data: snapshot.routingDefaults, meta: { total: snapshot.routingDefaults.length } });
    }));
    fastify.get('/alert-settings', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const snapshot = await service.getWorkspaceSnapshot(orgId);
        if (!snapshot)
            throw new NotFoundError('Alerting workspace');
        return reply.send({ success: true, data: snapshot.settings });
    }));
    fastify.patch('/alert-settings', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const body = UpdateAlertingSettingsSchema.parse(request.body);
        const data = await service.updateSettings(orgId, request.user.id, body);
        return reply.send({ success: true, data });
    }));
    fastify.get('/maintenance-config', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const snapshot = await service.getWorkspaceSnapshot(orgId);
        if (!snapshot)
            throw new NotFoundError('Alerting workspace');
        return reply.send({ success: true, data: snapshot.maintenance });
    }));
    fastify.patch('/maintenance-config', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const body = UpdateMaintenanceConfigSchema.parse(request.body);
        const data = await service.updateMaintenance(orgId, request.user.id, body);
        return reply.send({ success: true, data });
    }));
    fastify.get('/notification-defaults', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const snapshot = await service.getWorkspaceSnapshot(orgId);
        if (!snapshot)
            throw new NotFoundError('Alerting workspace');
        return reply.send({ success: true, data: snapshot.notificationDefaults });
    }));
    fastify.patch('/notification-defaults', guard, withErrorHandling(async (request, reply) => {
        const { orgId } = AlertingWorkspaceParamsSchema.parse(request.params);
        const body = UpdateNotificationDefaultsSchema.parse(request.body);
        const data = await service.updateNotificationDefaults(orgId, request.user.id, body);
        return reply.send({ success: true, data });
    }));
    const snapshotCollectionRoutes = [
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
            if (!snapshot)
                throw new NotFoundError('Alerting workspace');
            const data = snapshot[key];
            return reply.send({ success: true, data, meta: Array.isArray(data) ? { total: data.length } : undefined });
        }));
    }
}
//# sourceMappingURL=alerting-workspace.routes.js.map