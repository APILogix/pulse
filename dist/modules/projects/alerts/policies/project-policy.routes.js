import { authenticate } from '../../../../shared/middleware/auth.js';
import { authenticatedUser, requestMeta, withErrorHandling } from '../../shared/route-utils.js';
import { ProjectParamsSchema } from '../../core/project.types.js';
import { ProjectPolicyParamsSchema, SubscribePolicyBodySchema, UpdatePolicyOverrideBodySchema, UpdatePolicySubscriptionBodySchema, } from './project-policy.types.js';
import { ProjectPolicyService } from './project-policy.service.js';
import { ProjectPolicyRepository } from './project-policy.repository.js';
export async function projectPolicyRoutes(fastify) {
    const service = new ProjectPolicyService(new ProjectPolicyRepository(), fastify.projects.service.base, fastify.log);
    fastify.get('/:projectId/subscriptions', { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const data = await service.list(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data, meta: { total: data.length } });
    }));
    fastify.post('/:projectId/subscriptions', { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const body = SubscribePolicyBodySchema.parse(request.body);
        const data = await service.subscribe(orgId, projectId, requestMeta(request), body);
        return reply.code(201).send({ success: true, data });
    }));
    fastify.patch('/:projectId/subscriptions/:subscriptionId', { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, subscriptionId } = ProjectPolicyParamsSchema.parse(request.params);
        const body = UpdatePolicySubscriptionBodySchema.parse(request.body);
        const data = await service.updateState(orgId, projectId, requestMeta(request), subscriptionId, body);
        return reply.send({ success: true, data });
    }));
    fastify.post('/:projectId/subscriptions/:subscriptionId/overrides', { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, subscriptionId } = ProjectPolicyParamsSchema.parse(request.params);
        const body = UpdatePolicyOverrideBodySchema.parse(request.body);
        const data = await service.updateOverride(orgId, projectId, requestMeta(request), subscriptionId, body);
        return reply.send({ success: true, data });
    }));
    fastify.delete('/:projectId/subscriptions/:subscriptionId', { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, subscriptionId } = ProjectPolicyParamsSchema.parse(request.params);
        await service.remove(orgId, projectId, requestMeta(request), subscriptionId);
        return reply.code(204).send();
    }));
    fastify.get('/:projectId/effective-policies', { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
        const data = await service.listEffective(orgId, projectId, authenticatedUser(request).id);
        return reply.send({ success: true, data, meta: { total: data.length, persisted: false } });
    }));
    fastify.get('/:projectId/effective-policies/:policyId', { preHandler: [authenticate] }, withErrorHandling(async (request, reply) => {
        const { orgId, projectId, policyId } = ProjectPolicyParamsSchema.parse(request.params);
        const data = await service.resolve(orgId, projectId, policyId, authenticatedUser(request).id);
        return reply.send({ success: true, data, meta: { persisted: false } });
    }));
}
//# sourceMappingURL=project-policy.routes.js.map