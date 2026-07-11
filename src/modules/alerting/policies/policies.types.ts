import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema, type AlertSeverity } from '../common.js';
import type { RequestMeta } from '../types.js';


import { AppError } from '../../../shared/errors/app-error.js';

export const CreateEscalationPolicySchema = z.object({
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(2000).optional(),
  repeatIntervalMinutes: z.number().int().min(1).max(10_080).optional(),
  maxRepeats: z.number().int().min(0).max(100).default(0),
  isActive: z.boolean().default(true),
});

export type CreateEscalationPolicyBody = z.infer<typeof CreateEscalationPolicySchema>;

export const UpsertEscalationStepSchema = z.object({
  stepNumber: z.number().int().min(1).max(100),
  waitMinutes: z.number().int().min(0).max(10_080).default(5),
  connectorIds: z.array(UuidSchema).max(50).default([]),
  routeIds: z.array(UuidSchema).max(50).default([]),
  notifyOnCall: z.boolean().default(false),
  customMessageTemplate: z.string().max(4000).optional(),
  templateId: UuidSchema.optional(),
  isActive: z.boolean().default(true),
});

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

export const OrgPolicyParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });

export const OrgPolicyStepParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema, stepId: UuidSchema });

