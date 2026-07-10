/**
 * Project route registration (management API only — NO ingestion routes).
 *
 * Flow:
 * 1. Authenticate every project/API-key/environment management endpoint.
 * 2. Parse params/query/body with module schemas before calling the service.
 * 3. Pass an audit-friendly RequestMeta into mutating calls so org audit logs
 *    capture actor, ip, user agent, request id, method, and endpoint.
 * 4. Normalize service errors through handleProjectError.
 *
 * Prefix: /organizations/:orgId/projects
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authenticate } from "../../../shared/middleware/auth.js";
import {
  ListSdkConfigsQuerySchema,
  ResolveSdkConfigQuerySchema,
  UpdateSdkConfigSchema,
} from "../../organization/sdk-config.types.js";
import type { RequestMeta as OrganizationRequestMeta } from "../../organization/types.js";
import type { RequestMeta } from "../service.js";
import {
  ApiKeyParamsSchema,
  BulkRevokeBodySchema,
  BulkRotateBodySchema,
  CreateApiKeyBodySchema,
  CreateEnvironmentBodySchema,
  CreateProjectBodySchema,
  EnvironmentParamsSchema,
  ListApiKeysQuerySchema,
  ListProjectActivityQuerySchema,
  ListProjectsQuerySchema,
  OrgIdParamsSchema,
  ProjectParamsSchema,
  ProjectSdkConfigParamsSchema,
  RevokeApiKeyBodySchema,
  RotateApiKeyBodySchema,
  UpdateApiKeyBodySchema,
  UpdateEnvironmentBodySchema,
  UpdateProjectBodySchema,
  UpdateProjectSettingsBodySchema,
} from "../types.js";
import { handleProjectError, ProjectError } from "../shared/utils.js";
import { requestMeta, organizationRequestMeta, authenticatedUser, withErrorHandling } from "../shared/route-utils.js";

export async function projectActivityRoutes(fastify: FastifyInstance): Promise<void> {
  const service = fastify.projects.service;
  const sdkConfigService = fastify.organization.sdkConfigService;

  // ── Project CRUD ──────────────────────────────────────────────────────────
  fastify.get(
    "/:projectId/activity",
    { preHandler: [authenticate] },
    withErrorHandling(async (request, reply) => {
      const { orgId, projectId } = ProjectParamsSchema.parse(request.params);
      const query = ListProjectActivityQuerySchema.parse(request.query ?? {});
      const result = await service.listProjectActivity(orgId, projectId, authenticatedUser(request).id, query);
      return reply.send({ success: true, data: result.data, meta: result.meta });
    }),
  );
  // ── Project Settings & Overview ─────────────────────────────────────────────
  // ── Environments ────────────────────────────────────────────────────────────
  // ── API keys ─────────────────────────────────────────────────────────────
  // Bulk operations are registered before the parameterized :apiKeyId routes so
  // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
}
