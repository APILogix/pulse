import { z } from 'zod';
import { PaymentStatus } from '../shared/types.js';
export declare const ListPaymentsQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<typeof PaymentStatus>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodCoercedNumber<unknown>>>;
}, z.core.$strip>;
export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;
//# sourceMappingURL=schemas.d.ts.map