import { z } from 'zod';
export declare const GetUsageRecordsSchema: z.ZodObject<{
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export declare const IncrementUsageSchema: z.ZodObject<{
    count: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const UsageAttributionQuerySchema: z.ZodObject<{
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    bucket: z.ZodDefault<z.ZodOptional<z.ZodEnum<{
        day: "day";
        hour: "hour";
        minute: "minute";
    }>>>;
    projectId: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export declare const CurrentUsageDataSchema: z.ZodObject<{
    eventsUsed: z.ZodNumber;
    eventLimit: z.ZodNumber;
    remainingEvents: z.ZodNumber;
    aiCreditsUsed: z.ZodNumber;
    aiCreditLimit: z.ZodNumber;
    remainingAiCredits: z.ZodNumber;
    projectsUsed: z.ZodNumber;
    membersUsed: z.ZodNumber;
}, z.core.$strict>;
export declare const CurrentUsageResponseSchema: z.ZodObject<{
    success: z.ZodLiteral<true>;
    data: z.ZodObject<{
        eventsUsed: z.ZodNumber;
        eventLimit: z.ZodNumber;
        remainingEvents: z.ZodNumber;
        aiCreditsUsed: z.ZodNumber;
        aiCreditLimit: z.ZodNumber;
        remainingAiCredits: z.ZodNumber;
        projectsUsed: z.ZodNumber;
        membersUsed: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export type GetUsageRecordsQuery = z.infer<typeof GetUsageRecordsSchema>;
export type IncrementUsageBody = z.infer<typeof IncrementUsageSchema>;
export type UsageAttributionQuery = z.infer<typeof UsageAttributionQuerySchema>;
export type CurrentUsageResponse = z.infer<typeof CurrentUsageResponseSchema>;
//# sourceMappingURL=schemas.d.ts.map