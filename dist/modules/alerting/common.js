import { z } from 'zod';
/** Schemas shared by alerting submodules without importing the barrel module. */
export const UuidSchema = z.string().uuid();
export const AlertSeveritySchema = z.enum(['info', 'warning', 'error', 'critical']);
export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sortBy: z.string().max(50).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
//# sourceMappingURL=common.js.map