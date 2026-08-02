import { z } from "zod";
import type { OrgStatus, OrgRole } from "../shared/types.js";
export declare const SwitchOrganizationSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const SlugParamsSchema: z.ZodObject<{
    slug: z.ZodString;
}, z.core.$strip>;
export declare const CreateOrganizationSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    industry: z.ZodOptional<z.ZodString>;
    companySize: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    timezone: z.ZodDefault<z.ZodString>;
    billingEmail: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const UpdateOrganizationSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    websiteUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    industry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    companySize: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    country: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    timezone: z.ZodOptional<z.ZodString>;
    billingEmail: z.ZodOptional<z.ZodString>;
    supportEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const TransferOwnershipSchema: z.ZodObject<{
    newOwnerUserId: z.ZodString;
}, z.core.$strip>;
export declare const UpdateSettingsSchema: z.ZodObject<{
    enforceSso: z.ZodOptional<z.ZodBoolean>;
    enforceMfa: z.ZodOptional<z.ZodBoolean>;
    sessionTimeoutMinutes: z.ZodOptional<z.ZodNumber>;
    dataRegion: z.ZodOptional<z.ZodEnum<{
        "us-east-1": "us-east-1";
        "eu-west-1": "eu-west-1";
        "ap-south-1": "ap-south-1";
    }>>;
    dataRetentionDays: z.ZodOptional<z.ZodNumber>;
    auditLogRetentionDays: z.ZodOptional<z.ZodNumber>;
    allowPublicProjects: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export interface OrganizationRow {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    website_url: string | null;
    industry: string | null;
    company_size: string | null;
    country: string | null;
    timezone: string;
    billing_email: string | null;
    support_email: string | null;
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
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    industry: string | null;
    companySize: string | null;
    country: string | null;
    timezone: string;
    billingEmail: string | null;
    supportEmail: string | null;
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
//# sourceMappingURL=core.schema.d.ts.map