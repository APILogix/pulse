import type { FastifyReply, FastifyRequest } from "fastify";
import type { RequestMeta as OrganizationRequestMeta } from "../../organization/types.js";
import type { RequestMeta } from "../service.js";
import { handleProjectError } from "./utils.js";

export function requestMeta(request: FastifyRequest): RequestMeta {
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

export function organizationRequestMeta(request: FastifyRequest): OrganizationRequestMeta {
  const userAgent = request.headers["user-agent"];
  const user = request.user!;
  return {
    actorUserId: user.id,
    actorEmail: user.email ?? "",
    actorSessionId: user.sessionId ?? "",
    actorIp: request.ip ?? "0.0.0.0",
    actorUserAgent: typeof userAgent === "string" ? userAgent : null,
    requestId: request.id,
    httpMethod: request.method,
    endpoint: request.url,
  };
}

export function authenticatedUser(request: FastifyRequest) {
  return request.user!;
}

export function withErrorHandling(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      request.log.error({ err: error, path: request.url }, "Projects route failed");
      return handleProjectError(error, reply);
    }
  };
}
