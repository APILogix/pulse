import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema, type AlertSeverity } from '../common.js';
import type { RequestMeta } from '../types.js';


import { AppError } from '../../../shared/errors/app-error.js';

export const RoutingConditionsSchema = z.object({
  severity: z.array(AlertSeveritySchema).optional(),
  source: z.array(z.string().max(100)).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export type RoutingConditions = z.infer<typeof RoutingConditionsSchema>;

export const CreateRoutingRuleSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  description: z.string().max(2000).optional(),
  priority: z.number().int().default(100),
  conditions: RoutingConditionsSchema.default({}),
  targetConnectorIds: z.array(UuidSchema).max(50).default([]),
  targetRouteIds: z.array(UuidSchema).max(50).default([]),
  fallbackConnectorIds: z.array(UuidSchema).max(50).default([]),
  templateId: UuidSchema.optional(),
  isActive: z.boolean().default(true),
});

export type CreateRoutingRuleBody = z.infer<typeof CreateRoutingRuleSchema>;

export const UpdateRoutingRuleSchema = CreateRoutingRuleSchema.partial();

export type UpdateRoutingRuleBody = z.infer<typeof UpdateRoutingRuleSchema>;

export const TestRoutingSchema = z.object({
  severity: AlertSeveritySchema,
  source: z.string().max(100),
  labels: z.record(z.string(), z.string()).default({}),
});

export type TestRoutingBody = z.infer<typeof TestRoutingSchema>;

export interface AlertRoutingRuleRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  priority: number;
  conditions: RoutingConditions;
  target_connector_ids: string[];
  target_route_ids: string[];
  fallback_connector_ids: string[];
  template_id: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

