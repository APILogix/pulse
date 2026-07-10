import { z } from "zod";
import { normalizeObjectKeys, CountryCode, Ipv4OrV6 } from "../shared/schema-utils.js";
import { ProjectEnvironmentSchema } from "../environments/environment.types.js";
export const ProjectStatusSchema = z.enum(["active", "paused", "archived"]);
export const ProjectParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
});
export const ProjectSdkConfigParamsSchema = ProjectParamsSchema.extend({
    configId: z.string().uuid(),
});
export const ListProjectsQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    status: ProjectStatusSchema.optional(),
    environment: ProjectEnvironmentSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    includeDeleted: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
export const projectConfigShape = {
    rateLimitPerSecond: z.coerce.number().int().min(1).max(1_000_000).optional(),
    rateLimitPerMinute: z.coerce.number().int().min(1).max(100_000_000).optional(),
    rateLimitPerHour: z.coerce.number().int().min(1).max(1_000_000_000).optional(),
    burstLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
    allowedEventTypes: z.array(z.string().min(1).max(100)).max(100).optional(),
    maxEventSizeBytes: z.coerce.number().int().min(1).max(67_108_864).optional(),
    maxBatchSize: z.coerce.number().int().min(1).max(10_000).optional(),
    allowedOrigins: z.array(z.string().min(1).max(255)).max(100).optional(),
    requireHttps: z.coerce.boolean().optional(),
    ipAllowlist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    ipBlocklist: z.array(Ipv4OrV6).max(256).nullable().optional(),
    geoRestrictionEnabled: z.coerce.boolean().optional(),
    allowedCountries: z.array(CountryCode).max(250).nullable().optional(),
    alertEmail: z.string().email().max(255).nullable().optional(),
    alertWebhookUrl: z.string().url().max(500).nullable().optional(),
    alertOnErrorRateThreshold: z.coerce.number().min(0).max(100).optional(),
    alertOnLatencyThresholdMs: z.coerce.number().int().min(1).max(600_000).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
};
export const CreateProjectBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    environment: ProjectEnvironmentSchema.default("development"),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
    stagingApiPrefix: z.string().max(20).nullable().optional(),
    ...projectConfigShape,
}));
export const UpdateProjectBodySchema = z.preprocess(normalizeObjectKeys, z
    .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    environment: ProjectEnvironmentSchema.optional(),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
    stagingApiPrefix: z.string().max(20).nullable().optional(),
    ...projectConfigShape,
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export var ProjectMemberRole;
(function (ProjectMemberRole) {
    ProjectMemberRole["OWNER"] = "owner";
    ProjectMemberRole["ADMIN"] = "admin";
    ProjectMemberRole["DEVELOPER"] = "developer";
    ProjectMemberRole["VIEWER"] = "viewer";
})(ProjectMemberRole || (ProjectMemberRole = {}));
//# sourceMappingURL=project.types.js.map