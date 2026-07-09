import { z } from "zod";

export const QuotaRequestStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

export const QuotaTypeSchema = z.enum([
  "api_requests",
  "events",
  "storage",
  "projects",
  "members",
  "alerts",
]);

export type QuotaRequestStatus = z.infer<typeof QuotaRequestStatusSchema>;
export type QuotaType = z.infer<typeof QuotaTypeSchema>;

export const CreateQuotaRequestSchema = z.object({
  quotaType: z.string().min(1).max(50),
  currentLimit: z.number().int().min(0),
  requestedLimit: z.number().int().min(1),
  reason: z.string().min(1).max(2000),
});

export const ReviewQuotaRequestSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export interface QuotaRequestRow {
  id: string;
  org_id: string;
  quota_type: string;
  current_limit: number;
  requested_limit: number;
  reason: string;
  status: QuotaRequestStatus;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface BillingEntitlementsRow {
  subscription_id: string;
  subscription_status: string;
  plan_id: string;
  plan_key: string;
  plan_tier: string;
  feature_config: Record<string, unknown>;
  event_limit_monthly: string | number;
  hard_cap: boolean;
}

export interface OrganizationUsageCounts {
  activeMembers: number;
  pendingInvitations: number;
  ssoProviders: number;
  scimTokens: number;
}
