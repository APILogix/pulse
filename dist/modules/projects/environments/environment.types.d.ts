import { z } from "zod";
export declare const ProjectEnvironmentSchema: z.ZodEnum<{
    development: "development";
    staging: "staging";
    production: "production";
}>;
export type ProjectEnvironment = z.infer<typeof ProjectEnvironmentSchema>;
export declare const EnvironmentParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    environment: z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>;
}, z.core.$strip>;
export declare const environmentConfigShape: {
    readonly isActive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    readonly rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    readonly rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    readonly rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    readonly burstLimit: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    readonly allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    readonly maxEventSizeBytes: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    readonly maxBatchSize: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    readonly requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    readonly ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    readonly ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    readonly alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    readonly alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
};
export declare const CreateEnvironmentBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    isActive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    burstLimit: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    maxBatchSize: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    environment: z.ZodEnum<{
        development: "development";
        staging: "staging";
        production: "production";
    }>;
}, z.core.$strip>>;
export declare const UpdateEnvironmentBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    isActive: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    rateLimitPerSecond: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerMinute: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    rateLimitPerHour: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    burstLimit: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    allowedEventTypes: z.ZodOptional<z.ZodArray<z.ZodString>>;
    maxEventSizeBytes: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    maxBatchSize: z.ZodOptional<z.ZodNullable<z.ZodCoercedNumber<unknown>>>;
    requireHttps: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipBlocklist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    alertEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    alertWebhookUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>>;
export type CreateEnvironmentBody = z.infer<typeof CreateEnvironmentBodySchema>;
export type UpdateEnvironmentBody = z.infer<typeof UpdateEnvironmentBodySchema>;
export interface ProjectEnvironmentConfig {
    id: string;
    projectId: string;
    orgId: string;
    environment: ProjectEnvironment;
    isActive: boolean;
    rateLimitPerSecond: number | null;
    rateLimitPerMinute: number | null;
    rateLimitPerHour: number | null;
    burstLimit: number | null;
    allowedEventTypes: string[];
    maxEventSizeBytes: number | null;
    maxBatchSize: number | null;
    requireHttps: boolean;
    ipAllowlist: string[] | null;
    ipBlocklist: string[] | null;
    alertEmail: string | null;
    alertWebhookUrl: string | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=environment.types.d.ts.map