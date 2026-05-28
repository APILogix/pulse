import { z } from "zod";
export declare const ProjectStatusSchema: z.ZodEnum<{
    active: "active";
    paused: "paused";
    archived: "archived";
}>;
export declare const ProjectEnvironmentSchema: z.ZodEnum<{
    development: "development";
    production: "production";
}>;
export declare const OrgRoleSchema: z.ZodEnum<{
    billing: "billing";
    owner: "owner";
    admin: "admin";
    member: "member";
    viewer: "viewer";
}>;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const ProjectParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
}, z.core.$strip>;
export declare const ApiKeyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    apiKeyId: z.ZodString;
}, z.core.$strip>;
export declare const ListProjectsQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        paused: "paused";
        archived: "archived";
    }>>;
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        production: "production";
    }>>;
    search: z.ZodOptional<z.ZodString>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodDefault<z.ZodEnum<{
        name: "name";
        created_at: "created_at";
        updated_at: "updated_at";
    }>>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>>;
export declare const CreateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    environment: z.ZodDefault<z.ZodEnum<{
        development: "development";
        production: "production";
    }>>;
    productionApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    developmentApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export declare const UpdateProjectBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        paused: "paused";
        archived: "archived";
    }>>;
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        production: "production";
    }>>;
    productionApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    developmentApiPrefix: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export declare const ListApiKeysQuerySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environment: z.ZodOptional<z.ZodEnum<{
        development: "development";
        production: "production";
    }>>;
    isActive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    includeInactive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    page: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export declare const CreateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    environment: z.ZodEnum<{
        development: "development";
        production: "production";
    }>;
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
}, z.core.$strip>>;
export declare const UpdateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
}, z.core.$strip>>;
export declare const RotateApiKeyBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    expiresAt: z.ZodPipe<z.ZodTransform<{} | null | undefined, unknown>, z.ZodOptional<z.ZodNullable<z.ZodDate>>>;
    gracePeriodHours: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectEnvironment = z.infer<typeof ProjectEnvironmentSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type ListProjectsQuery = z.infer<typeof ListProjectsQuerySchema>;
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof UpdateProjectBodySchema>;
export type ListApiKeysQuery = z.infer<typeof ListApiKeysQuerySchema>;
export type CreateApiKeyBody = z.infer<typeof CreateApiKeyBodySchema>;
export type UpdateApiKeyBody = z.infer<typeof UpdateApiKeyBodySchema>;
export type RotateApiKeyBody = z.infer<typeof RotateApiKeyBodySchema>;
export interface Project {
    id: string;
    orgId: string;
    name: string;
    slug: string;
    description: string | null;
    status: ProjectStatus;
    environment: ProjectEnvironment;
    productionApiPrefix: string | null;
    developmentApiPrefix: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ProjectListItem extends Project {
    apiKeysCount: number;
    activeApiKeysCount: number;
}
export interface ProjectStats {
    totalRequests: number;
    apiKeysCount: number;
    activeKeysCount: number;
}
export interface ProjectWithStats extends Project {
    stats: ProjectStats;
}
export interface ProjectApiKey {
    id: string;
    projectId: string;
    keyPrefix: string;
    environment: ProjectEnvironment;
    name: string | null;
    isActive: boolean;
    createdBy: string | null;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date;
}
export interface ProjectApiKeyRecord extends ProjectApiKey {
    keyHash: string;
}
export interface CreateApiKeyResponse {
    apiKey: ProjectApiKey;
    fullKey: string;
}
export interface ApiKeyUsage {
    keyId: string;
    keyPrefix: string;
    totalRequests: number;
    lastUsedAt: Date | null;
    requestsByDay: Array<{
        date: string;
        count: number;
    }>;
}
export interface OrganizationMembership {
    orgId: string;
    userId: string;
    role: OrgRole;
    isActive: boolean;
}
//# sourceMappingURL=types.d.ts.map