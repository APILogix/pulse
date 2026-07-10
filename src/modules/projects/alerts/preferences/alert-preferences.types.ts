import { z } from "zod";
import { AlertSeveritySchema } from "../../../alerting/types.js";
import { UuidSchema } from "../../../alerting/types.js";

export const UpdateAlertPreferenceBodySchema = z.object({
  is_subscribed: z.boolean().optional(),
  min_severity: AlertSeveritySchema.optional(),
  quiet_hours_start: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be HH:MM").optional(),
  quiet_hours_end: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Must be HH:MM").optional(),
});
export type UpdateAlertPreferenceBody = z.infer<typeof UpdateAlertPreferenceBodySchema>;

export const BulkSubscribeBodySchema = z.object({
  routeId: UuidSchema,
  userIds: z.array(UuidSchema),
});
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
