import { z } from 'zod';
export declare const CreateSilenceSchema: z.ZodObject<{
    ruleId: z.ZodOptional<z.ZodString>;
    comment: z.ZodOptional<z.ZodString>;
    startsAt: z.ZodCoercedDate<unknown>;
    endsAt: z.ZodCoercedDate<unknown>;
    matchers: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CreateSilenceBody = z.infer<typeof CreateSilenceSchema>;
export declare const SilenceFromEventSchema: z.ZodObject<{
    durationMinutes: z.ZodDefault<z.ZodNumber>;
    comment: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SilenceFromEventBody = z.infer<typeof SilenceFromEventSchema>;
export declare const ListSilencesQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    active: z.ZodOptional<z.ZodCoercedBoolean<unknown>>;
}, z.core.$strip>;
export type ListSilencesQuery = z.infer<typeof ListSilencesQuerySchema>;
export interface AlertSilenceRow {
    id: string;
    organization_id: string;
    rule_id: string | null;
    created_by: string;
    comment: string | null;
    starts_at: Date;
    ends_at: Date;
    matchers: Record<string, unknown>;
    is_active: boolean;
    expired_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
//# sourceMappingURL=silences.types.d.ts.map