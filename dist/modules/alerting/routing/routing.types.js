import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema } from '../common.js';
import { AppError } from '../../../shared/errors/app-error.js';
export const RoutingConditionsSchema = z.object({
    severity: z.array(AlertSeveritySchema).optional(),
    source: z.array(z.string().max(100)).optional(),
    labels: z.record(z.string(), z.string()).optional(),
});
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
export const UpdateRoutingRuleSchema = CreateRoutingRuleSchema.partial();
export const TestRoutingSchema = z.object({
    severity: AlertSeveritySchema,
    source: z.string().max(100),
    labels: z.record(z.string(), z.string()).default({}),
});
//# sourceMappingURL=routing.types.js.map