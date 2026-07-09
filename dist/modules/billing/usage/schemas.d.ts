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
export type GetUsageRecordsQuery = z.infer<typeof GetUsageRecordsSchema>;
export type IncrementUsageBody = z.infer<typeof IncrementUsageSchema>;
//# sourceMappingURL=schemas.d.ts.map