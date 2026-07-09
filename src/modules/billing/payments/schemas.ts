import { z } from 'zod';
import { PaymentStatus, PaginationSchema } from '../shared/types.js';

export const ListPaymentsQuerySchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
}).merge(PaginationSchema);

export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;
