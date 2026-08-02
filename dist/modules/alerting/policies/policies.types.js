import { z } from 'zod';
import { UuidSchema, PaginationSchema, AlertSeveritySchema } from '../common.js';
import { AppError } from '../../../shared/errors/app-error.js';
export const CreateEscalationPolicySchema = z.object({
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(2000).optional(),
    repeatIntervalMinutes: z.number().int().min(1).max(10_080).optional(),
    maxRepeats: z.number().int().min(0).max(100).default(0),
    isActive: z.boolean().default(true),
});
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
export const OrgPolicyParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
export const OrgPolicyStepParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema, stepId: UuidSchema });
//# sourceMappingURL=policies.types.js.map