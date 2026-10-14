import { z } from "zod";
import { UuidSchema } from "../shared/types.js";
import { ORGANIZATION_DEFAULTS } from "../shared/constants.js";
export const SwitchOrganizationSchema = z.object({ orgId: UuidSchema });
export const SlugParamsSchema = z.object({ slug: z.string().min(1).max(255) });
export const CreateOrganizationSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    slug: z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    timezone: z.string().max(100).default(ORGANIZATION_DEFAULTS.timezone),
});
export const UpdateOrganizationSchema = z.object({
    name: z.string().min(1).max(255).trim().optional(),
    logoUrl: z.string().url().nullable().optional(),
    timezone: z.string().max(100).optional(),
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