import { z } from "zod";
export declare const UpdateAlertPreferenceBodySchema: z.ZodObject<{
    is_subscribed: z.ZodOptional<z.ZodBoolean>;
    min_severity: z.ZodOptional<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    quiet_hours_start: z.ZodOptional<z.ZodString>;
    quiet_hours_end: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type UpdateAlertPreferenceBody = z.infer<typeof UpdateAlertPreferenceBodySchema>;
export declare const BulkSubscribeBodySchema: z.ZodObject<{
    routeId: z.ZodString;
    userIds: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type BulkSubscribeBody = z.infer<typeof BulkSubscribeBodySchema>;
export interface ProjectMemberAlertPreference {
    id: string;
    projectId: string;
    userId: string;
    routeId: string;
    isSubscribed: boolean;
    minSeverity: string;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=alert-preferences.types.d.ts.map