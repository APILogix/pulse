import { z } from "zod";
const normalizeObjectKeys = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
    }
    const record = value;
    return {
        ...record,
        productionApiPrefix: record.productionApiPrefix ?? record.production_api_prefix,
        developmentApiPrefix: record.developmentApiPrefix ?? record.development_api_prefix,
        expiresAt: record.expiresAt ?? record.expires_at,
        gracePeriodHours: record.gracePeriodHours ?? record.grace_period_hours,
        sortBy: record.sortBy ?? record.sort_by,
        sortOrder: record.sortOrder ?? record.sort_order,
        isActive: record.isActive ?? record.is_active,
    };
};
const OptionalDateSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value instanceof Date) {
        return value;
    }
    if (typeof value === "string") {
        return new Date(value);
    }
    return value;
}, z.date().nullable().optional());
export const ProjectStatusSchema = z.enum(["active", "paused", "archived"]);
export const ProjectEnvironmentSchema = z.enum(["development", "production"]);
export const OrgRoleSchema = z.enum([
    "owner",
    "admin",
    "billing",
    "member",
    "viewer",
]);
export const OrgIdParamsSchema = z.object({
    orgId: z.string().uuid(),
});
export const ProjectParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
});
export const ApiKeyParamsSchema = z.object({
    orgId: z.string().uuid(),
    projectId: z.string().uuid(),
    apiKeyId: z.string().uuid(),
});
export const ListProjectsQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    status: ProjectStatusSchema.optional(),
    environment: ProjectEnvironmentSchema.optional(),
    search: z.string().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
}));
export const CreateProjectBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(255),
    description: z.string().max(5000).nullable().optional(),
    environment: ProjectEnvironmentSchema.default("development"),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
}));
export const UpdateProjectBodySchema = z.preprocess(normalizeObjectKeys, z
    .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(5000).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    environment: ProjectEnvironmentSchema.optional(),
    productionApiPrefix: z.string().max(20).nullable().optional(),
    developmentApiPrefix: z.string().max(20).nullable().optional(),
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export const ListApiKeysQuerySchema = z.preprocess(normalizeObjectKeys, z.object({
    environment: ProjectEnvironmentSchema.optional(),
    isActive: z.coerce.boolean().optional(),
    includeInactive: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
}));
export const CreateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    environment: ProjectEnvironmentSchema,
    name: z.string().min(1).max(255).nullable().optional(),
    expiresAt: OptionalDateSchema,
}));
export const UpdateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z
    .object({
    name: z.string().min(1).max(255).nullable().optional(),
    expiresAt: OptionalDateSchema,
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
}));
export const RotateApiKeyBodySchema = z.preprocess(normalizeObjectKeys, z.object({
    name: z.string().min(1).max(255).nullable().optional(),
    expiresAt: OptionalDateSchema,
    gracePeriodHours: z.coerce.number().int().min(0).max(168).optional(),
}));
//# sourceMappingURL=types.js.map