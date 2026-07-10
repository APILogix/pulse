import type { FastifyInstance, FastifyRequest } from "fastify";
import { authenticate } from "../../../../shared/middleware/auth.js";
import {
  UpdateAlertPreferenceBodySchema,
} from "./alert-preferences.types.js";
import { ProjectParamsSchema } from "../../types.js";
import type { RequestMeta } from "../../service.js";
import { z } from "zod";

function requestMeta(request: FastifyRequest): RequestMeta {
  const userAgent = request.headers["user-agent"];
  const user = request.user!;
  return {
    actorUserId: user.id,
    actorEmail: user.email ?? null,
    actorSessionId: user.sessionId ?? null,
    actorIp: request.ip ?? "0.0.0.0",
    actorUserAgent: typeof userAgent === "string" ? userAgent : null,
    requestId: request.id,
    httpMethod: request.method,
    endpoint: request.url,
  };
}

export async function projectAlertPreferencesRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.alertPreferencesService;

  fastify.get(
    "/",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const preferences = await service.getPreferences(orgId, projectId, request.user!.id);
      return reply.send({ success: true, data: preferences });
    }
  );

  fastify.patch(
    "/:prefId",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const paramsSchema = ProjectParamsSchema.extend({ prefId: z.string().uuid() });
      const { orgId, projectId, prefId } = paramsSchema.parse(request.params);
      const body = UpdateAlertPreferenceBodySchema.parse(request.body);
      const preference = await service.updatePreference(orgId, projectId, prefId, request.user!.id, body, requestMeta(request));
      return reply.send({ success: true, data: preference });
    }
  );

  fastify.post(
    "/sync",
    { preHandler: [authenticate] },
    async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      await service.sync(orgId, projectId, request.user!.id);
      return reply.send({ success: true });
    }
  );
}
