import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema, type AlertSeverity } from '../common.js';
import type { RequestMeta } from '../types.js';


import { AppError } from '../../../shared/errors/app-error.js';

export const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  templateType: z.string().min(1).max(50).default('body'),
  content: z.string().min(1).max(20_000),
  variablesSchema: z.array(z.unknown()).default([]),
  defaultForSeverity: AlertSeveritySchema.optional(),
  connectorType: z.string().max(50).optional(),
  isDefault: z.boolean().default(false),
  sampleData: z.record(z.string(), z.unknown()).default({}),
});

export type CreateTemplateBody = z.infer<typeof CreateTemplateSchema>;

export const UpdateTemplateSchema = CreateTemplateSchema.partial();

export type UpdateTemplateBody = z.infer<typeof UpdateTemplateSchema>;

export const PreviewTemplateSchema = z.object({
  sampleData: z.record(z.string(), z.unknown()).optional(),
});

export type PreviewTemplateBody = z.infer<typeof PreviewTemplateSchema>;

export interface AlertTemplateRow {
  id: string;
  organization_id: string;
  name: string;
  template_type: string;
  content: string;
  variables_schema: unknown[];
  default_for_severity: AlertSeverity | null;
  connector_type: string | null;
  is_default: boolean;
  sample_data: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

