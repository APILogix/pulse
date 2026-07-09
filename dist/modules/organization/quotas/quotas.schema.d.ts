import { z } from "zod";
export declare const QuotaRequestStatusSchema: z.ZodEnum<{
    pending: "pending";
    approved: "approved";
    rejected: "rejected";
    cancelled: "cancelled";
}>;
export declare const QuotaTypeSchema: z.ZodEnum<{
    events: "events";
    api_requests: "api_requests";
    storage: "storage";
    projects: "projects";
    members: "members";
    alerts: "alerts";
}>;
export type QuotaRequestStatus = z.infer<typeof QuotaRequestStatusSchema>;
export type QuotaType = z.infer<typeof QuotaTypeSchema>;
export declare const CreateQuotaRequestSchema: z.ZodObject<{
    quotaType: z.ZodString;
    currentLimit: z.ZodNumber;
    requestedLimit: z.ZodNumber;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const ReviewQuotaRequestSchema: z.ZodObject<{
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
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
//# sourceMappingURL=quotas.schema.d.ts.map