import { z } from "zod";
import { UuidSchema } from "../shared/types.js";
import { ORGANIZATION_DEFAULTS } from "../shared/constants.js";
import type { OrgStatus, OrgRole } from "../shared/types.js";

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

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  timezone: string;
  owner_user_id: string;
  created_by: string | null;
  status: OrgStatus;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrgSettingsRow {
  org_id: string;
  enforce_sso: boolean;
  enforce_mfa: boolean;
  session_timeout_minutes: number;
  data_region: string;
  data_retention_days: number;
  audit_log_retention_days: number;
  allow_public_projects: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  timezone: string;
  ownerUserId: string;
  status: OrgStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgSettingsDto {
  enforceSso: boolean;
  enforceMfa: boolean;
  sessionTimeoutMinutes: number;
  dataRegion: string;
  dataRetentionDays: number;
  auditLogRetentionDays: number;
  allowPublicProjects: boolean;
}

export interface UserOrganizationDto {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: OrgRole;
  status: OrgStatus;
  createdAt: Date;
}

export interface OrganizationProvisioningResult {
  organization: OrganizationRow;
}

