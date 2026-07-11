import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema } from '../common.js';
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
export const UpdateTemplateSchema = CreateTemplateSchema.partial();
export const PreviewTemplateSchema = z.object({
    sampleData: z.record(z.string(), z.unknown()).optional(),
});
//# sourceMappingURL=templates.types.js.map