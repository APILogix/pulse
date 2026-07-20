import { z } from "zod";
import { AlertSeveritySchema } from "../../../alerting/common.js";
import { UuidSchema } from "../../../alerting/types.js";
import { normalizeObjectKeys } from "../../shared/schema-utils.js";
import { AlertCategorySchema } from "../subscriptions/connector-subscription.types.js";
export const NotificationChannelSchema = z.enum([
    "slack",
    "email",
    "webhook",
    "push",
    "sms",
]);
export const UpdateAlertPreferenceBodySchema = z.object({
    enabled: z.boolean().optional(),
    severity_threshold: AlertSeveritySchema.optional(),
    digest_mode: z.string().max(30).optional(),
    quiet_hours: z.record(z.string(), z.unknown()).nullable().optional(),
});
export const BulkSubscribeBodySchema = z.object({
    channel: NotificationChannelSchema,
    category: AlertCategorySchema,
    userIds: z.array(UuidSchema),
});
//# sourceMappingURL=alert-preferences.types.js.map