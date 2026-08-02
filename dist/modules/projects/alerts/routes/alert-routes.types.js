import { z } from "zod";
import { AlertSeveritySchema } from "../../../alerting/types.js";
import { UuidSchema, PaginationSchema } from "../../../alerting/types.js";
export const CreateProjectAlertRouteBodySchema = z.object({
    name: z.string().min(1).max(150),
    description: z.string().optional(),
    event_types: z.array(z.string()).default([]),
    severity_levels: z.array(AlertSeveritySchema).default([]),
    source_services: z.array(z.string()).default([]),
    target_connector_ids: z.array(UuidSchema),
    priority: z.number().int().default(100),
    throttle: z.record(z.string(), z.unknown()).optional(),
    schedule: z.record(z.string(), z.unknown()).optional(),
    is_active: z.boolean().default(true),
});
export const UpdateProjectAlertRouteBodySchema = CreateProjectAlertRouteBodySchema.partial();
export const ToggleProjectAlertRouteBodySchema = z.object({
    is_active: z.boolean(),
});
export const ListProjectAlertRoutesQuerySchema = PaginationSchema.extend({
    is_active: z.string().optional(),
    connector_type: z.string().optional(),
});
//# sourceMappingURL=alert-routes.types.js.map