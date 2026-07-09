import { z } from 'zod';
import { PaginationSchema } from '../shared/types.js';
export const GetUsageRecordsSchema = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
}).merge(PaginationSchema);
export const IncrementUsageSchema = z.object({
    count: z.number().int().min(1).default(1),
});
//# sourceMappingURL=schemas.js.map