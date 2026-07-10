import { z } from "zod";
export declare const CreateProjectAlertRouteBodySchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    event_types: z.ZodDefault<z.ZodArray<z.ZodString>>;
    severity_levels: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>;
    source_services: z.ZodDefault<z.ZodArray<z.ZodString>>;
    target_connector_ids: z.ZodArray<z.ZodString>;
    priority: z.ZodDefault<z.ZodNumber>;
    throttle: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    schedule: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    is_active: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateProjectAlertRouteBody = z.infer<typeof CreateProjectAlertRouteBodySchema>;
export declare const UpdateProjectAlertRouteBodySchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    event_types: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    severity_levels: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>>>;
    source_services: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
    target_connector_ids: z.ZodOptional<z.ZodArray<z.ZodString>>;
    priority: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    throttle: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    schedule: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    is_active: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
}, z.core.$strip>;
export type UpdateProjectAlertRouteBody = z.infer<typeof UpdateProjectAlertRouteBodySchema>;
export declare const ToggleProjectAlertRouteBodySchema: z.ZodObject<{
    is_active: z.ZodBoolean;
}, z.core.$strip>;
export type ToggleProjectAlertRouteBody = z.infer<typeof ToggleProjectAlertRouteBodySchema>;
export declare const ListProjectAlertRoutesQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    is_active: z.ZodOptional<z.ZodString>;
    connector_type: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListProjectAlertRoutesQuery = z.infer<typeof ListProjectAlertRoutesQuerySchema>;
export interface ProjectAlertRoute {
    id: string;
    projectId: string;
    organizationId: string;
    name: string;
    description: string | null;
    eventTypes: string[];
    severityLevels: string[];
    sourceServices: string[];
    targetConnectorIds: string[];
    priority: number;
    isActive: boolean;
    throttle: Record<string, unknown> | null;
    schedule: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}
//# sourceMappingURL=alert-routes.types.d.ts.map