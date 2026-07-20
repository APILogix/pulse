import { z } from "zod";
import { AlertSeveritySchema } from "../../../alerting/common.js";
import { UuidSchema } from "../../../alerting/types.js";
import { normalizeObjectKeys } from "../../shared/schema-utils.js";
import { AlertCategorySchema, type AlertCategory } from "../subscriptions/connector-subscription.types.js";

export const NotificationChannelSchema = z.enum([
  "slack",
  "email",
  "webhook",
  "push",
  "sms",
]);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const UpdateAlertPreferenceBodySchema = z.object({
  enabled: z.boolean().optional(),
  severity_threshold: AlertSeveritySchema.optional(),
  digest_mode: z.string().max(30).optional(),
  quiet_hours: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type UpdateAlertPreferenceBody = z.infer<typeof UpdateAlertPreferenceBodySchema>;

export const BulkSubscribeBodySchema = z.object({
  channel: NotificationChannelSchema,
  category: AlertCategorySchema,
  userIds: z.array(UuidSchema),
});
export type BulkSubscribeBody = z.infer<typeof BulkSubscribeBodySchema>;

export interface ProjectMemberNotificationPreference {
  id: string;
  projectId: string;
  userId: string;
  channel: NotificationChannel;
  category: AlertCategory;
  enabled: boolean;
  severityThreshold: string;
  digestMode: string;
  quietHours: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectNotificationPreference {
  id: string;
  projectId: string;
  organizationId: string;
  category: AlertCategory;
  enabled: boolean;
  severityThreshold: string;
  connectorIds: string[];
  memberIds: string[];
  quietHours: Record<string, unknown> | null;
  digestMode: string;
  createdAt: Date;
  updatedAt: Date;
}
