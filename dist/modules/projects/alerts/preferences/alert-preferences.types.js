import { z } from "zod";
import { AlertSeveritySchema } from "../../../alerting/types.js";
import { UuidSchema } from "../../../alerting/types.js";
export const UpdateAlertPreferenceBodySchema = z.object({
    is_subscribed: z.boolean().optional(),
    min_severity: AlertSeveritySchema.optional(),
    quiet_hours_start: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be HH:MM").optional(),
    quiet_hours_end: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be HH:MM").optional(),
});
export const BulkSubscribeBodySchema = z.object({
    routeId: UuidSchema,
    userIds: z.array(UuidSchema),
});
//# sourceMappingURL=alert-preferences.types.js.map