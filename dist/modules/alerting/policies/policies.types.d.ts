import { z } from 'zod';
export declare const CreateEscalationPolicySchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    repeatIntervalMinutes: z.ZodOptional<z.ZodNumber>;
    maxRepeats: z.ZodDefault<z.ZodNumber>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateEscalationPolicyBody = z.infer<typeof CreateEscalationPolicySchema>;
export declare const UpsertEscalationStepSchema: z.ZodObject<{
    stepNumber: z.ZodNumber;
    waitMinutes: z.ZodDefault<z.ZodNumber>;
    connectorIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    routeIds: z.ZodDefault<z.ZodArray<z.ZodString>>;
    notifyOnCall: z.ZodDefault<z.ZodBoolean>;
    customMessageTemplate: z.ZodOptional<z.ZodString>;
    templateId: z.ZodOptional<z.ZodString>;
    isActive: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type UpsertEscalationStepBody = z.infer<typeof UpsertEscalationStepSchema>;
export interface AlertEscalationPolicyRow {
    id: string;
    organization_id: string;
    name: string;
    description: string | null;
    repeat_interval_minutes: number | null;
    max_repeats: number;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}
export interface AlertEscalationStepRow {
    id: string;
    policy_id: string;
    step_number: number;
    wait_minutes: number;
    connector_ids: string[];
    route_ids: string[];
    notify_on_call: boolean;
    custom_message_template: string | null;
    template_id: string | null;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
}
export declare const OrgPolicyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
export declare const OrgPolicyStepParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
    stepId: z.ZodString;
}, z.core.$strip>;
//# sourceMappingURL=policies.types.d.ts.map