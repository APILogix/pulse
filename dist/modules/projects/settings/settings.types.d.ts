import { z } from "zod";
export interface ProjectSettings {
    id: string;
    projectId: string;
    organizationId: string;
    dataRetentionDays: number;
    samplingRate: number;
    allowedDomains: string[];
    blockedDomains: string[];
    piiScrubbingEnabled: boolean;
    ipCollectionEnabled: boolean;
    releaseTrackingEnabled: boolean;
    sessionReplayEnabled: boolean;
    performanceMonitoringEnabled: boolean;
    errorMonitoringEnabled: boolean;
    logIngestionEnabled: boolean;
    metricIngestionEnabled: boolean;
    traceIngestionEnabled: boolean;
    profileIngestionEnabled: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}
export declare const UpdateProjectSettingsBodySchema: z.ZodPipe<z.ZodTransform<unknown, unknown>, z.ZodObject<{
    dataRetentionDays: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    samplingRate: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    allowedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    blockedDomains: z.ZodOptional<z.ZodArray<z.ZodString>>;
    piiScrubbingEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    ipCollectionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    releaseTrackingEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    sessionReplayEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    performanceMonitoringEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    errorMonitoringEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    logIngestionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    metricIngestionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    traceIngestionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    profileIngestionEnabled: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
    version: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strict>>;
export type UpdateProjectSettingsBody = z.infer<typeof UpdateProjectSettingsBodySchema>;
//# sourceMappingURL=settings.types.d.ts.map