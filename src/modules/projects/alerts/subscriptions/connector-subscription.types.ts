import { z } from "zod";
import { UuidSchema } from "../../../alerting/types.js";
import { AlertSeveritySchema } from "../../../alerting/common.js";
import { normalizeObjectKeys } from "../../shared/schema-utils.js";

export const AlertCategorySchema = z.enum([
  "error",
  "performance",
  "deployment",
  "cron",
  "release",
  "usage",
  "billing",
  "security",
  "ai",
]);
export type AlertCategory = z.infer<typeof AlertCategorySchema>;

export const ProjectConnectorSubscriptionParamsSchema = z.object({
  orgId: UuidSchema,
  projectId: UuidSchema,
  subscriptionId: UuidSchema,
});

export const CreateProjectConnectorSubscriptionBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    connectorId: UuidSchema,
    enabled: z.coerce.boolean().default(true),
    alertCategories: z.array(AlertCategorySchema).default(["error", "performance", "security"]),
    severityThreshold: AlertSeveritySchema.default("error"),
    memberIds: z.array(UuidSchema).default([]),
    channelOverrides: z.record(z.string(), z.unknown()).default({}),
    quietHours: z.record(z.string(), z.unknown()).nullable().optional(),
    digestMode: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
);
export type CreateProjectConnectorSubscriptionBody = z.infer<
  typeof CreateProjectConnectorSubscriptionBodySchema
>;

export const UpdateProjectConnectorSubscriptionBodySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    enabled: z.coerce.boolean().optional(),
    alertCategories: z.array(AlertCategorySchema).optional(),
    severityThreshold: AlertSeveritySchema.optional(),
    memberIds: z.array(UuidSchema).optional(),
    channelOverrides: z.record(z.string(), z.unknown()).optional(),
    quietHours: z.record(z.string(), z.unknown()).nullable().optional(),
    digestMode: z.record(z.string(), z.unknown()).nullable().optional(),
  }).refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  }),
);
export type UpdateProjectConnectorSubscriptionBody = z.infer<
  typeof UpdateProjectConnectorSubscriptionBodySchema
>;

export const ListProjectConnectorSubscriptionsQuerySchema = z.preprocess(
  normalizeObjectKeys,
  z.object({
    enabled: z.coerce.boolean().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
);
export type ListProjectConnectorSubscriptionsQuery = z.infer<
  typeof ListProjectConnectorSubscriptionsQuerySchema
>;

export interface ProjectConnectorSubscription {
  id: string;
  projectId: string;
  organizationId: string;
  connectorId: string;
  enabled: boolean;
  alertCategories: AlertCategory[];
  severityThreshold: string;
  memberIds: string[];
  channelOverrides: Record<string, unknown>;
  quietHours: Record<string, unknown> | null;
  digestMode: Record<string, unknown> | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertRoutingTarget {
  projectId: string;
  organizationId: string;
  environmentId: string | null;
  apiKeyId: string;
  subscriptions: {
    subscriptionId: string;
    connectorId: string;
    enabled: boolean;
    alertCategories: AlertCategory[];
    severityThreshold: string;
    memberIds: string[];
    channelOverrides: Record<string, unknown>;
  }[];
  members: {
    userId: string;
    role: string;
    email: string | null;
  }[];
}
