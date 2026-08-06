import { z } from 'zod';
import { ProjectParamsSchema } from '../../core/project.types.js';

export const ProjectPolicyParamsSchema = ProjectParamsSchema.extend({
  subscriptionId: z.string().uuid().optional(),
  policyId: z.string().uuid().optional(),
});

export const SubscribePolicyBodySchema = z.object({ policyId: z.string().uuid() });

export const UpdatePolicySubscriptionBodySchema = z.object({
  state: z.enum(['subscribed', 'paused', 'muted', 'disabled', 'archived']),
});

export const UpdatePolicyOverrideBodySchema = z.object({
  threshold: z.record(z.string(), z.unknown()).nullable().optional(),
  cooldownSeconds: z.number().int().min(0).nullable().optional(),
  channels: z.array(z.string().max(50)).nullable().optional(),
  severity: z.enum(['info', 'warning', 'error', 'critical']).nullable().optional(),
  maintenanceWindows: z.array(z.string().uuid()).nullable().optional(),
  evaluationWindowSeconds: z.number().int().min(1).nullable().optional(),
  environment: z.string().max(100).nullable().optional(),
  escalationPolicyId: z.string().uuid().nullable().optional(),
  muteSchedule: z.record(z.string(), z.unknown()).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one override field is required' });

export type SubscribePolicyBody = z.infer<typeof SubscribePolicyBodySchema>;
export type UpdatePolicySubscriptionBody = z.infer<typeof UpdatePolicySubscriptionBodySchema>;
export type UpdatePolicyOverrideBody = z.infer<typeof UpdatePolicyOverrideBodySchema>;
