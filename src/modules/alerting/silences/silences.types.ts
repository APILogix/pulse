import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema, type AlertSeverity } from '../common.js';
import type { RequestMeta } from '../types.js';


import { AppError } from '../../../shared/errors/app-error.js';

export const CreateSilenceSchema = z.object({
  ruleId: UuidSchema.optional(),
  comment: z.string().max(2000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  matchers: z.record(z.string(), z.unknown()).default({}),
}).refine((s) => s.endsAt > s.startsAt, { message: 'endsAt must be after startsAt', path: ['endsAt'] });

export type CreateSilenceBody = z.infer<typeof CreateSilenceSchema>;

export const SilenceFromEventSchema = z.object({
  durationMinutes: z.number().int().min(1).max(20_160).default(60),
  comment: z.string().max(2000).optional(),
});

export type SilenceFromEventBody = z.infer<typeof SilenceFromEventSchema>;

export const ListSilencesQuerySchema = PaginationSchema.extend({
  active: z.coerce.boolean().optional(),
});

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

