import { z } from 'zod';
export declare const ProjectPolicyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    projectId: z.ZodString;
    subscriptionId: z.ZodOptional<z.ZodString>;
    policyId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const SubscribePolicyBodySchema: z.ZodObject<{
    policyId: z.ZodString;
}, z.core.$strip>;
export declare const UpdatePolicySubscriptionBodySchema: z.ZodObject<{
    state: z.ZodEnum<{
        muted: "muted";
        archived: "archived";
        paused: "paused";
        disabled: "disabled";
        subscribed: "subscribed";
    }>;
}, z.core.$strip>;
export declare const UpdatePolicyOverrideBodySchema: z.ZodObject<{
    threshold: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
    cooldownSeconds: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    channels: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    severity: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
        critical: "critical";
        error: "error";
        info: "info";
        warning: "warning";
    }>>>;
    maintenanceWindows: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    evaluationWindowSeconds: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    environment: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    escalationPolicyId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    muteSchedule: z.ZodOptional<z.ZodNullable<z.ZodRecord<z.ZodString, z.ZodUnknown>>>;
}, z.core.$strip>;
export type SubscribePolicyBody = z.infer<typeof SubscribePolicyBodySchema>;
export type UpdatePolicySubscriptionBody = z.infer<typeof UpdatePolicySubscriptionBodySchema>;
export type UpdatePolicyOverrideBody = z.infer<typeof UpdatePolicyOverrideBodySchema>;
//# sourceMappingURL=project-policy.types.d.ts.map