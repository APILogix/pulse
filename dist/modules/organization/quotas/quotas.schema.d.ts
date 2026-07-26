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
    eventsUsed: number;
    eventLimit: number;
    remainingEvents: number;
    aiCreditsUsed: number;
    aiCreditLimit: number;
    remainingAiCredits: number;
    projectsUsed: number;
    apiKeysUsed: number;
    connectorsUsed: number;
    alertRulesUsed: number;
    dashboardsUsed: number;
}
export declare const BillingSummaryResponseSchema: z.ZodObject<{
    orgId: z.ZodString;
    subscriptionStatus: z.ZodString;
    planTier: z.ZodString;
    eventLimitMonthly: z.ZodNumber;
    hardCap: z.ZodBoolean;
    usage: z.ZodObject<{
        activeMembers: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        eventsMonthly: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            remaining: z.ZodNumber;
        }, z.core.$strip>;
        aiCredits: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            remaining: z.ZodNumber;
        }, z.core.$strip>;
        ssoProviders: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            enabled: z.ZodBoolean;
        }, z.core.$strip>;
        scimTokens: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            enabled: z.ZodBoolean;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strict>;
export declare const UsageLimitsResponseSchema: z.ZodObject<{
    subscriptionStatus: z.ZodString;
    planKey: z.ZodString;
    limits: z.ZodObject<{
        members: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            pending: z.ZodNumber;
        }, z.core.$strip>;
        projects: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        apiKeys: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        connectors: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        alertRules: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        dashboards: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
        }, z.core.$strip>;
        ssoProviders: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            enabled: z.ZodBoolean;
        }, z.core.$strip>;
        scimTokens: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            enabled: z.ZodBoolean;
        }, z.core.$strip>;
        eventsMonthly: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            remaining: z.ZodNumber;
            hardCap: z.ZodBoolean;
        }, z.core.$strip>;
        aiCredits: z.ZodObject<{
            used: z.ZodNumber;
            limit: z.ZodNullable<z.ZodNumber>;
            remaining: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strict>;
export type BillingSummaryResponse = z.infer<typeof BillingSummaryResponseSchema>;
export type UsageLimitsResponse = z.infer<typeof UsageLimitsResponseSchema>;
//# sourceMappingURL=quotas.schema.d.ts.map