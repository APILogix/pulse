/**
 * Project connector subscription route registration.
 *
 * Flow:
 * 1. Authenticate every endpoint.
 * 2. Parse params/query/body with module schemas before calling the service.
 * 3. Pass an audit-friendly RequestMeta into mutating calls so org audit logs
 *    capture actor, ip, user agent, request id, method, and endpoint.
 * 4. Normalize service errors through handleProjectError.
 *
 * Prefix: /organizations/:orgId/projects
 */
import type { FastifyInstance } from "fastify";
import { normalizeObjectKeys } from "../../shared/schema-utils.js";
import { authenticate } from "../../../../shared/middleware/auth.js";
import {
  CreateProjectConnectorSubscriptionBodySchema,
  ListProjectConnectorSubscriptionsQuerySchema,
  ProjectConnectorSubscriptionParamsSchema,
  UpdateProjectConnectorSubscriptionBodySchema,
} from "../subscriptions/connector-subscription.types.js";
import { ProjectParamsSchema } from "../../core/project.types.js";
import { handleProjectError } from "../../shared/utils.js";
import { requestMeta, authenticatedUser, withErrorHandling } from "../../shared/route-utils.js";

export async function projectConnectorSubscriptionRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.connectorSubscriptionsService;

  // ── Connector subscriptions ─────────────────────────────────────────────────

  fastify.get(
    "/:projectId/connectors",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const query = ListProjectConnectorSubscriptionsQuerySchema.parse(request.query ?? {});
      const result = await service.list(orgId, projectId, authenticatedUser(request).id, query);
      return reply.send({
        success: true,
        data: result.subscriptions,
        meta: { total: result.total, limit: result.limit, offset: result.offset },
      });
    }),
  );

  fastify.post(
    "/:projectId/connectors",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const body = CreateProjectConnectorSubscriptionBodySchema.parse(normalizeObjectKeys(request.body));
      const subscription = await service.create(
        orgId,
        projectId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.code(201).send({ success: true, data: subscription });
    }),
  );

  fastify.get(
    "/:projectId/connectors/:subscriptionId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, subscriptionId } = ProjectConnectorSubscriptionParamsSchema.parse(request.params);
      const subscription = await service.get(orgId, projectId, subscriptionId, authenticatedUser(request).id);
      return reply.send({ success: true, data: subscription });
    }),
  );

  fastify.patch(
    "/:projectId/connectors/:subscriptionId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, subscriptionId } = ProjectConnectorSubscriptionParamsSchema.parse(request.params);
      const body = UpdateProjectConnectorSubscriptionBodySchema.parse(normalizeObjectKeys(request.body));
      const subscription = await service.update(
        orgId,
        projectId,
        subscriptionId,
        authenticatedUser(request).id,
        body,
        requestMeta(request),
      );
      return reply.send({ success: true, data: subscription });
    }),
  );

  fastify.delete(
    "/:projectId/connectors/:subscriptionId",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId, subscriptionId } = ProjectConnectorSubscriptionParamsSchema.parse(request.params);
      await service.delete(
        orgId,
        projectId,
        subscriptionId,
        authenticatedUser(request).id,
        requestMeta(request),
      );
      return reply.code(204).send();
    }),
  );
}
