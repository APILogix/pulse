import { authenticate } from "../../shared/middleware/auth.js";
import { ListSdkConfigsQuerySchema, ResolveSdkConfigQuerySchema, UpdateSdkConfigSchema, } from "../organization/sdk-config.types.js";
import { ApiKeyParamsSchema, BulkRevokeBodySchema, BulkRotateBodySchema, CreateApiKeyBodySchema, CreateEnvironmentBodySchema, CreateProjectBodySchema, EnvironmentParamsSchema, ListApiKeysQuerySchema, ListProjectActivityQuerySchema, ListProjectsQuerySchema, OrgIdParamsSchema, ProjectParamsSchema, ProjectSdkConfigParamsSchema, RevokeApiKeyBodySchema, RotateApiKeyBodySchema, UpdateApiKeyBodySchema, UpdateEnvironmentBodySchema, UpdateProjectBodySchema, UpdateProjectSettingsBodySchema, } from "./types.js";
import { handleProjectError, ProjectError } from "./shared/utils.js";
import { projectCoreRoutes } from "./core/project.routes.js";
import { projectSettingsRoutes } from "./settings/settings.routes.js";
import { projectActivityRoutes } from "./activity/activity.routes.js";
import { projectEnvironmentRoutes } from "./environments/environment.routes.js";
import { projectApiKeyRoutes } from "./api-keys/api-key.routes.js";
import { projectMemberRoutes } from "./members/member.routes.js";
import { projectConnectorSubscriptionRoutes } from "./alerts/subscriptions/connector-subscription.routes.js";
import { projectAnalyticsRoutes } from "./usage/analytics.routes.js";
export async function projectsRoutes(fastify) {
    // ── Project CRUD ──────────────────────────────────────────────────────────
    // ── Project Settings & Overview ─────────────────────────────────────────────
    // ── Environments ────────────────────────────────────────────────────────────
    // ── API keys ─────────────────────────────────────────────────────────────
    // Bulk operations are registered before the parameterized :apiKeyId routes so
    // "bulk-rotate"/"bulk-revoke" are never captured as an apiKeyId.
    await fastify.register(projectAnalyticsRoutes);
    await fastify.register(projectCoreRoutes);
    await fastify.register(projectMemberRoutes);
    await fastify.register(projectConnectorSubscriptionRoutes);
    await fastify.register(projectSettingsRoutes);
    await fastify.register(projectActivityRoutes);
    await fastify.register(projectEnvironmentRoutes);
    await fastify.register(projectApiKeyRoutes);
}
//# sourceMappingURL=routes.js.map