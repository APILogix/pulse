import { z } from "zod";
export declare enum EnvironmentType {
    PRODUCTION = "production",
    PRE_PRODUCTION = "pre_production",
    STAGING = "staging",
    PRE_STAGING = "pre_staging",
    DEVELOPMENT = "development",
    TESTING = "testing",
    PREVIEW = "preview",
    PRE_DEPLOYMENT = "pre_deployment",
    CUSTOM = "custom"
}
export declare const EnvironmentTypeSchema: z.ZodEnum<{
    production: EnvironmentType.PRODUCTION;
    pre_production: EnvironmentType.PRE_PRODUCTION;
    staging: EnvironmentType.STAGING;
    pre_staging: EnvironmentType.PRE_STAGING;
    development: EnvironmentType.DEVELOPMENT;
    testing: EnvironmentType.TESTING;
    preview: EnvironmentType.PREVIEW;
    pre_deployment: EnvironmentType.PRE_DEPLOYMENT;
    custom: EnvironmentType.CUSTOM;
}>;
export declare const EnvironmentNameSchema: z.ZodString;
export declare const EnvironmentSlugSchema: z.ZodString;
export declare const EnvironmentColorSchema: z.ZodString;
export declare const EnvironmentParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    environmentId: z.ZodString;
}, z.core.$strip>;
export declare const CreateEnvironmentBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodString;
    slug: z.ZodString;
    type: z.ZodEnum<{
        production: EnvironmentType.PRODUCTION;
        pre_production: EnvironmentType.PRE_PRODUCTION;
        staging: EnvironmentType.STAGING;
        pre_staging: EnvironmentType.PRE_STAGING;
        development: EnvironmentType.DEVELOPMENT;
        testing: EnvironmentType.TESTING;
        preview: EnvironmentType.PREVIEW;
        pre_deployment: EnvironmentType.PRE_DEPLOYMENT;
        custom: EnvironmentType.CUSTOM;
    }>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    color: z.ZodString;
    isActive: z.ZodOptional<z.ZodBoolean>;
    isDefault: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>>;
export declare const UpdateEnvironmentBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    slug: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<{
        production: EnvironmentType.PRODUCTION;
        pre_production: EnvironmentType.PRE_PRODUCTION;
        staging: EnvironmentType.STAGING;
        pre_staging: EnvironmentType.PRE_STAGING;
        development: EnvironmentType.DEVELOPMENT;
        testing: EnvironmentType.TESTING;
        preview: EnvironmentType.PREVIEW;
        pre_deployment: EnvironmentType.PRE_DEPLOYMENT;
        custom: EnvironmentType.CUSTOM;
    }>>;
    description: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    color: z.ZodOptional<z.ZodString>;
    isActive: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
    isDefault: z.ZodOptional<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strict>>;
export declare const ListEnvironmentsQuerySchema: z.ZodObject<{
    includeDeleted: z.ZodDefault<z.ZodPipe<z.ZodTransform<boolean, unknown>, z.ZodBoolean>>;
}, z.core.$strip>;
export type CreateEnvironmentBody = z.infer<typeof CreateEnvironmentBodySchema>;
export type UpdateEnvironmentBody = z.infer<typeof UpdateEnvironmentBodySchema>;
export type ListEnvironmentsQuery = z.infer<typeof ListEnvironmentsQuerySchema>;
export interface ProjectEnvironmentConfig {
    id: string;
    projectId: string;
    orgId: string;
    name: string;
    slug: string;
    type: EnvironmentType;
    description: string | null;
    color: string;
    isDefault: boolean;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}
export interface EnvironmentReference {
    id: string;
    name: string;
    slug: string;
    type: EnvironmentType;
}
//# sourceMappingURL=environment.types.d.ts.map