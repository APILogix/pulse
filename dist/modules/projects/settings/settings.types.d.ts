import { z } from "zod";
export interface ProjectSettings {
    id: string;
    projectId: string;
    organizationId: string;
    retentionDays: number;
    maxEventsPerSecond: number;
    autoArchive: boolean;
    alertingEnabled: boolean;
    ingestionEnabled: boolean;
    metadata: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}
export declare const UpdateProjectSettingsBodySchema: z.ZodObject<{
    retentionDays: z.ZodOptional<z.ZodNumber>;
    maxEventsPerSecond: z.ZodOptional<z.ZodNumber>;
    autoArchive: z.ZodOptional<z.ZodBoolean>;
    alertingEnabled: z.ZodOptional<z.ZodBoolean>;
    ingestionEnabled: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
//# sourceMappingURL=settings.types.d.ts.map