import { z } from 'zod';
/** Schemas shared by alerting submodules without importing the barrel module. */
export declare const UuidSchema: z.ZodString;
export declare const AlertSeveritySchema: z.ZodEnum<{
    error: "error";
    info: "info";
    warning: "warning";
    critical: "critical";
}>;
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>;
//# sourceMappingURL=common.d.ts.map