import { z } from "zod";
import { UuidSchema } from "../shared/types.js";
export const SwitchOrganizationSchema = z.object({ orgId: UuidSchema });
export const SlugParamsSchema = z.object({ slug: z.string().min(1).max(255) });
export const CreateOrganizationSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(1000).optional(),
    industry: z.string().max(100).optional(),
    companySize: z.string().max(50).optional(),
    country: z.string().max(100).optional(),
    timezone: z.string().max(100).default("UTC"),
    billingEmail: z.string().email().optional(),
});
export const UpdateOrganizationSchema = z.object({
    name: z.string().min(1).max(255).trim().optional(),
    description: z.string().max(1000).nullable().optional(),
    logoUrl: z.string().url().nullable().optional(),
    websiteUrl: z.string().url().nullable().optional(),
    industry: z.string().max(100).nullable().optional(),
    companySize: z.string().max(50).nullable().optional(),
    country: z.string().max(100).nullable().optional(),
    timezone: z.string().max(100).optional(),
    billingEmail: z.string().email().optional(),
    supportEmail: z.string().email().nullable().optional(),
});
export const TransferOwnershipSchema = z.object({
    newOwnerUserId: UuidSchema,
});
export const UpdateSettingsSchema = z.object({
    enforceSso: z.boolean().optional(),
    enforceMfa: z.boolean().optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
    dataRegion: z.enum(["us-east-1", "eu-west-1", "ap-south-1"]).optional(),
    dataRetentionDays: z.number().int().min(1).max(3650).optional(),
    auditLogRetentionDays: z.number().int().min(30).max(3650).optional(),
    allowPublicProjects: z.boolean().optional(),
});
//# sourceMappingURL=core.schema.js.map