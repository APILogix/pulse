import { z } from "zod";
import { QuietHoursSchema, type QuietHoursConfig } from "./quiet-hours.js";

const UuidSchema = z.string().uuid();
const JsonObjectSchema = z.record(z.string(), z.unknown());
const BooleanInputSchema = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

function normalizeChannelKeys(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = { ...source };
  const aliases: Record<string, string> = {
    connectorId: "connector_id",
    channelType: "channel_type",
    destinationMetadata: "destination_metadata",
    isDefault: "is_default",
    severityThreshold: "severity_threshold",
    digestMode: "digest_mode",
    quietHours: "quiet_hours",
    sortBy: "sort_by",
    sortOrder: "sort_order",
  };
  for (const [camel, snake] of Object.entries(aliases)) {
    if (result[camel] === undefined && source[snake] !== undefined) result[camel] = source[snake];
  }
  return result;
}

export const AlertChannelSeveritySchema = z.enum(["info", "warning", "error", "critical"]);
export type AlertChannelSeverity = z.infer<typeof AlertChannelSeveritySchema>;

export const AlertChannelDigestModeSchema = z.enum(["immediate", "hourly", "daily", "weekly"]);
export type AlertChannelDigestMode = z.infer<typeof AlertChannelDigestModeSchema>;

export const ProjectAlertChannelParamsSchema = z.object({
  orgId: UuidSchema,
  projectId: UuidSchema,
  channelId: UuidSchema,
});

export const ProjectAlertChannelBaseParamsSchema = ProjectAlertChannelParamsSchema.omit({ channelId: true });

export const ListProjectAlertChannelsQuerySchema = z.preprocess(
  normalizeChannelKeys,
  z.object({
    channelType: z.string().trim().min(1).max(50).optional(),
    enabled: BooleanInputSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
);

export type ListProjectAlertChannelsQuery = z.infer<typeof ListProjectAlertChannelsQuerySchema>;

export const CreateProjectAlertChannelBodySchema = z.preprocess(
  normalizeChannelKeys,
  z.object({
    connectorId: UuidSchema.nullable().optional(),
    channelType: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(150),
    description: z.string().max(5000).nullable().optional(),
    destination: z.string().trim().min(1).max(2048).nullable().optional(),
    destinationMetadata: JsonObjectSchema.default({}),
    isDefault: BooleanInputSchema.default(false),
    enabled: BooleanInputSchema.default(true),
  }).superRefine((body, context) => {
    if (!body.connectorId && !body.destination && body.channelType.toLowerCase() !== "email") {
      context.addIssue({
        code: "custom",
        path: ["destination"],
        message: "A connectorId or destination is required",
      });
    }
  }),
);
export type CreateProjectAlertChannelBody = z.infer<typeof CreateProjectAlertChannelBodySchema>;

export const UpdateProjectAlertChannelBodySchema = z.preprocess(
  normalizeChannelKeys,
  z.object({
    connectorId: UuidSchema.nullable().optional(),
    channelType: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().max(5000).nullable().optional(),
    destination: z.string().trim().min(1).max(2048).nullable().optional(),
    destinationMetadata: JsonObjectSchema.optional(),
    isDefault: BooleanInputSchema.optional(),
    enabled: BooleanInputSchema.optional(),
    version: z.coerce.number().int().min(1).optional(),
  }).refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  }),
);
export type UpdateProjectAlertChannelBody = z.infer<typeof UpdateProjectAlertChannelBodySchema>;

export const ToggleProjectAlertChannelBodySchema = z.preprocess(
  normalizeChannelKeys,
  z.object({
    enabled: BooleanInputSchema,
    version: z.coerce.number().int().min(1).optional(),
  }),
);
export type ToggleProjectAlertChannelBody = z.infer<typeof ToggleProjectAlertChannelBodySchema>;

export const UpsertMemberAlertChannelPreferenceBodySchema = z.preprocess(
  normalizeChannelKeys,
  z.object({
    category: z.string().trim().min(1).max(100).default("all"),
    severityThreshold: AlertChannelSeveritySchema.default("warning"),
    enabled: BooleanInputSchema.default(true),
    digestMode: AlertChannelDigestModeSchema.default("immediate"),
    quietHours: QuietHoursSchema.default({}),
  }),
);
export type UpsertMemberAlertChannelPreferenceBody = z.infer<
  typeof UpsertMemberAlertChannelPreferenceBodySchema
>;

export const DeleteMemberAlertChannelPreferenceQuerySchema = z.object({
  category: z.string().trim().min(1).max(100).default("all"),
});
export type DeleteMemberAlertChannelPreferenceQuery = z.infer<
  typeof DeleteMemberAlertChannelPreferenceQuerySchema
>;

export interface ProjectAlertChannel {
  id: string;
  organizationId: string;
  projectId: string;
  connectorId: string | null;
  channelType: string;
  name: string;
  description: string | null;
  destination: string | null;
  destinationMetadata: Record<string, unknown>;
  isDefault: boolean;
  enabled: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

export interface ProjectMemberAlertChannelPreference {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  projectAlertChannelId: string;
  category: string;
  severityThreshold: AlertChannelSeverity;
  enabled: boolean;
  digestMode: AlertChannelDigestMode;
  quietHours: QuietHoursConfig | Record<string, never>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
  channel?: ProjectAlertChannel;
}

export interface ImmediateDeliveryRequest {
  organizationId: string;
  projectId: string;
  category: string;
  severity: AlertChannelSeverity;
}

export interface ImmediateDeliveryTarget {
  organizationId: string;
  projectId: string;
  userId: string;
  memberRole: string;
  memberEmail: string | null;
  channelId: string;
  channelType: string;
  channelDestination: string | null;
  memberDestination: string | null;
  channelMetadata: Record<string, unknown>;
  channelConnectorId: string | null;
  subscriptionId: string | null;
  subscriptionConnectorId: string | null;
  connectorProvider: string | null;
  category: string;
  severity: AlertChannelSeverity;
  digest: {
    project: AlertChannelDigestMode;
    member: AlertChannelDigestMode;
    subscription: AlertChannelDigestMode;
  };
  quietHours: {
    project: Record<string, unknown>;
    member: Record<string, unknown>;
    subscription: Record<string, unknown>;
    configured: boolean;
  };
  immediateEligible: true;
}