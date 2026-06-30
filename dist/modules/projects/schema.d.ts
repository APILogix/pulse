/**
 * Backwards-compatible schema re-exports.
 *
 * The canonical schemas live in types.ts. This module aliases the commonly
 * imported names so older import sites keep working.
 */
export { ApiKeyParamsSchema, BulkRevokeBodySchema, BulkRotateBodySchema, CreateApiKeyBodySchema as createApiKeySchema, CreateEnvironmentBodySchema as createEnvironmentSchema, CreateProjectBodySchema as createProjectSchema, EnvironmentParamsSchema, ListApiKeysQuerySchema as listApiKeysSchema, ListProjectsQuerySchema as listProjectsSchema, OrgIdParamsSchema, ProjectParamsSchema, RevokeApiKeyBodySchema as revokeApiKeySchema, RotateApiKeyBodySchema as rotateApiKeySchema, UpdateApiKeyBodySchema as updateApiKeySchema, UpdateEnvironmentBodySchema as updateEnvironmentSchema, UpdateProjectBodySchema as updateProjectSchema, } from "./types.js";
//# sourceMappingURL=schema.d.ts.map